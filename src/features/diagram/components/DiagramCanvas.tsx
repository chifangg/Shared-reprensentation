/**
 * The diagram canvas — public entry point of the feature.
 *
 * `DiagramCanvas` is a thin wrapper that mounts the ReactFlowProvider
 * so the inner orchestrator can call `useReactFlow()` (via the
 * useCanvasFit / useViewportFocusFit hooks). All the actual state +
 * effects + interactions live inside `DiagramCanvasInner` below.
 *
 * The inner component is still ~700 lines — most of that is the
 * handler callbacks (handleAddConnection, handleAddNewBlock, …) and
 * the JSX layout shell. Hooks own the heavy state machinery (fetch
 * lifecycles, settle effect, recent-changes diff, canvas fit).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  ConnectionMode,
  Controls,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useProject } from "@/core/project";
import {
  serializeTarget,
  type BlockNodeData,
  type ConnectionOption,
  type DiagramArrow,
  type DiagramBlock,
  type DiagramSchema,
  type DiagramView,
  type EditTarget,
} from "../types";
import { layoutSchema } from "../layout/layoutSchema";
import {
  composeExecuteDirectPrompt,
  composeExecuteOptionPrompt,
  composeRenamePrompt,
  composeSuggestionsRound1Prompt,
} from "../protocol/prompts";
import { useDiagramStructureFetch } from "../hooks/useDiagramStructureFetch";
import { useCapabilityScan } from "../hooks/useCapabilityScan";
import { useAdaptiveFocus } from "../hooks/useAdaptiveFocus";
import {
  useRecentChanges,
  type PreRegenSnapshot,
} from "../hooks/useRecentChanges";
import { useEditSummary } from "../hooks/useEditSummary";
import {
  useChatSettleEffect,
  type ChosenOption,
} from "../hooks/useChatSettleEffect";
import { useCanvasFit } from "../hooks/useCanvasFit";
import { useViewportFocusFit } from "../hooks/useViewportFocusFit";
import { useBubbleFocus } from "../hooks/useBubbleFocus";
import {
  useDiagramBus,
  useDiagramBusSubscribe,
} from "../protocol/bus";
import { dlog, dwarn } from "../util/debug";
import { nodeTypes } from "./nodes/BlockNode";
import { edgeTypes } from "./nodes/LabeledEdge";
import { ConnectionOptionsOverlay } from "./overlays/ConnectionOptionsOverlay";
import { IntentGate } from "./overlays/IntentGate";
import { DiagramFetchOverlay } from "./overlays/DiagramFetchOverlay";
import { EditSummaryToast } from "./overlays/EditSummaryToast";
import { RegeneratingChip } from "./overlays/RegeneratingChip";
import { AdaptiveFocusBanner } from "./overlays/AdaptiveFocusBanner";
import { AddNewBlockButton } from "./overlays/AddNewBlockButton";
import { CategoryLegend } from "./overlays/CategoryLegend";
import { IntentSurvey } from "./overlays/IntentSurvey";
import { SurveyPreparingOverlay } from "./overlays/SurveyPreparingOverlay";
import { RegenerateDiagramButton } from "./overlays/RegenerateDiagramButton";
import { DiagramFocusPanel } from "./panel/DiagramFocusPanel";

export function DiagramCanvas({ view }: { view: DiagramView }) {
  return (
    <ReactFlowProvider>
      <DiagramCanvasInner view={view} />
    </ReactFlowProvider>
  );
}

function DiagramCanvasInner({ view }: { view: DiagramView }) {
  const { files, chatMessages, chatRunning, projectKey } = useProject();
  const bus = useDiagramBus();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [promoted, setPromoted] = useState<{
    blocks: DiagramBlock[];
    arrows: DiagramArrow[];
  }>({ blocks: [], arrows: [] });
  const [panelWidth, setPanelWidth] = useState(380);
  // Round-1 options Claude returned for the most-recent edit target
  // (arrow, block, or new-block). Set by the OPTIONS_READY_EVENT
  // listener (fired from ChatView once it parses the JSON). Cleared
  // when the user picks a card or cancels. Drives the floating cards
  // overlay on the canvas.
  const [pendingOptions, setPendingOptions] = useState<{
    target: EditTarget;
    options: ConnectionOption[];
  } | null>(null);
  // First-stage gate for arrow / block / new-block flows: before
  // anything is sent to chat, ask the user whether they want to
  // describe the change themselves (skip suggestions round-trip) or
  // ask Claude for suggestions (current cards flow). The visual side
  // (pending arrow / placeholder block) is already on canvas by the
  // time this state is set.
  const [intentGate, setIntentGate] = useState<{
    target: EditTarget;
  } | null>(null);
  // Snapshot of the schema captured just before each auto-regen so
  // useRecentChanges can diff and glow whatever Claude added.
  const preRegenSnapshotRef = useRef<PreRegenSnapshot | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<BlockNodeData>>(
    [],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Positions the user has dragged blocks to, keyed by block id. Re-laid
  // out nodes (e.g. when selection toggles or a bubble cluster opens)
  // are overridden with these so a manual move survives the relayout
  // instead of snapping back to dagre's slot. Cleared on project change.
  const userPositionsRef = useRef<Map<string, { x: number; y: number }>>(
    new Map(),
  );
  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      for (const c of changes) {
        if (c.type === "position" && c.position) {
          userPositionsRef.current.set(c.id, c.position);
        }
      }
      onNodesChange(changes);
    },
    [onNodesChange],
  );

  // Onboarding survey: gates the structure fetch. Null until the user
  // submits the survey; reset to null on projectKey change AND on the
  // explicit "Regenerate" button (which re-opens the modal).
  const [userGoal, setUserGoal] = useState<string | null>(null);
  // Gates the survey behind the intro overlay: the survey only opens
  // once the intro timeline finished AND the scan resolved. Reset
  // alongside userGoal (projectKey change + Regenerate).
  const [surveyIntroDone, setSurveyIntroDone] = useState(false);
  const handleSurveyIntroReady = useCallback(
    () => setSurveyIntroDone(true),
    [],
  );

  // Capability scan fires in parallel with the survey opening — by the
  // time the user picks Edit/Reference the picklist is usually ready.
  const scanState = useCapabilityScan({ projectKey, files });

  // Structure fetch lifecycle: reset on projectKey, stream
  // /api/diagram?view=structure into FetchState + nodes + edges. Gated
  // on userGoal — fires only after the survey completes.
  const { state, setState, setRetryNonce } = useDiagramStructureFetch({
    projectKey,
    files,
    userGoal,
    selectedId,
    setNodes,
    setEdges,
  });

  // Adaptive focus lifecycle: debounced /api/diagram?view=focus on
  // each new user turn. Resets on projectKey.
  const { focused, setFocused, regenerating } = useAdaptiveFocus({
    view,
    state,
    files,
    chatMessages,
    projectKey,
  });

  // recentChanges (the glow) + editSummary (the toast) lifecycles.
  const { recentChanges, setRecentChanges } = useRecentChanges({
    state,
    preRegenSnapshotRef,
  });
  const { editSummary, setEditSummary } = useEditSummary();

  // Click-a-block-to-expand-bubbles state. Bubbles are derived from the
  // block's provenance.functions and rendered as fan-laid ReactFlow
  // nodes; viewport pans/zooms to the cluster and restores on collapse.
  const {
    bubbleNodes,
    borrowOffsets,
    toggleBlock: toggleBubbleBlock,
    clear: clearBubbles,
  } = useBubbleFocus({
    projectKey,
    blocks: state.kind === "ready" ? state.schema.blocks : [],
    nodes,
  });

  // Merge bubble nodes with the layout-computed nodes for the ReactFlow
  // render. Kept derived (not state) so layoutSchema re-runs don't have
  // to know about bubbles, and bubbles vanish the instant useBubbleFocus
  // returns an empty array.
  //
  // Cast: BubbleNodeData ≠ BlockNodeData structurally, but bubble nodes
  // route through `type: "bubble"` → FunctionBubble (not BlockNode), and
  // are non-selectable / non-draggable, so onNodesChange never touches
  // their data fields. Safe at runtime; types just need the alignment.
  const renderedNodes = useMemo<Node<BlockNodeData>[]>(() => {
    // Apply "borrow" make-way offsets to whichever blocks the open
    // bubble fan would cover; React Flow's transform transition glides
    // them aside on expand and back when borrowOffsets empties.
    const base =
      borrowOffsets.size === 0
        ? nodes
        : nodes.map((n) => {
            const moved = borrowOffsets.get(n.id);
            return moved ? { ...n, position: moved } : n;
          });
    return bubbleNodes.length === 0
      ? base
      : [...base, ...(bubbleNodes as unknown as Node<BlockNodeData>[])];
  }, [nodes, bubbleNodes, borrowOffsets]);

  // Reset the small in-component state on USER-initiated project
  // change. (FetchState, nodes/edges, focused, regenerating are
  // already reset by the hooks above.)
  useEffect(() => {
    setSelectedId(null);
    setPromoted({ blocks: [], arrows: [] });
    setUserGoal(null);
    setSurveyIntroDone(false);
    userPositionsRef.current.clear();
  }, [projectKey]);

  /** "Regenerate" FAB handler: clear the goal so the survey re-opens,
   *  reset the structure fetch state to idle, and wipe the canvas so
   *  the new run starts from a blank slate. */
  const handleRegenerate = useCallback(() => {
    setUserGoal(null);
    setSurveyIntroDone(false);
    setState({ kind: "idle" });
    setNodes([]);
    setEdges([]);
    setSelectedId(null);
    setPromoted({ blocks: [], arrows: [] });
  }, [setState, setNodes, setEdges]);

  // We deliberately do NOT clear `focused` when switching away from
  // focus view — the layout/panel both already gate on `view === "focus"`,
  // so the side panel and spotlight just disappear visually while the
  // state survives. Toggling back into focus restores what the user
  // was looking at instead of forcing them to re-ask the question.

  /** Clears the "just edited" visual state — recent-change highlight
   *  on blocks/arrows AND the edit-summary toast. Called from every
   *  user-action handler so the highlight survives until they
   *  actually look away. */
  const dismissRecentEdit = useCallback(() => {
    setRecentChanges(null);
    setEditSummary(null);
  }, []);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      dismissRecentEdit();
      // Ignore clicks on bubbles themselves — they're visual-only for
      // now. The parent block (or pane click) collapses them.
      if (node.type === "bubble") return;
      setSelectedId((prev) => (prev === node.id ? null : node.id));
      toggleBubbleBlock(node.id);
    },
    [dismissRecentEdit, toggleBubbleBlock],
  );

  /**
   * User asked to add a new module (clicked "+" or double-clicked the
   * empty canvas). We:
   *   1. Add a dashed-border placeholder block to the schema RIGHT NOW
   *      so the user gets immediate visual feedback ("yes I heard you,
   *      something is happening"). The placeholder lives in schema with
   *      pending=true and a generated id; auto-regen after Claude
   *      finishes will wipe it and surface the real block(s) instead.
   *   2. Open the intent gate so they can pick describe vs ask.
   */
  const handleAddNewBlock = useCallback(() => {
    if (state.kind !== "ready") return;
    dismissRecentEdit();
    const placeholderId = `__pending_new_${Date.now()}`;
    setState((prev) => {
      if (prev.kind !== "ready") return prev;
      const placeholder: DiagramBlock = {
        id: placeholderId,
        label: "New module…",
        caption: "Waiting for you to describe it or pick a suggestion.",
        parent: null,
        provenance: { files: [], functions: [] },
        pending: true,
      };
      return {
        kind: "ready",
        schema: {
          blocks: [...prev.schema.blocks, placeholder],
          arrows: prev.schema.arrows,
        },
      };
    });
    setIntentGate({ target: { kind: "new-block" } });
  }, [state, dismissRecentEdit]);

  // Detect double-click on the empty canvas (no built-in handler in
  // React Flow for this on the pane). Two onPaneClick events within
  // 300ms => add-new-block. A single click still deselects as before.
  const lastPaneClickRef = useRef(0);
  const onPaneClick = useCallback(() => {
    const now = Date.now();
    if (now - lastPaneClickRef.current < 300) {
      lastPaneClickRef.current = 0;
      handleAddNewBlock();
      return;
    }
    lastPaneClickRef.current = now;
    dismissRecentEdit();
    setSelectedId(null);
    clearBubbles();
  }, [handleAddNewBlock, dismissRecentEdit, clearBubbles]);

  /**
   * Commit a visual rename: update the local diagram schema so the
   * label change shows up immediately, then fire a chat prompt so
   * Claude rewrites the corresponding identifier(s) in source. This
   * is the slow-path side of the bidirectional loop — visual edit
   * shows up in chat as a user turn, Claude responds with edits, the
   * diff card renders in chat, code panel reflects the change.
   *
   * No-op if there's no diagram yet (state isn't "ready"), or if the
   * label didn't actually change.
   */
  const handleRenameBlock = useCallback(
    (blockId: string, newLabel: string) => {
      setState((prev) => {
        if (prev.kind !== "ready") return prev;
        const block = prev.schema.blocks.find((b) => b.id === blockId);
        if (!block) return prev;
        const oldLabel = block.label;
        if (oldLabel === newLabel) return prev;

        bus.emit("visual-edit", {
          prompt: composeRenamePrompt(block, newLabel),
          kind: "rename",
        });

        return {
          kind: "ready",
          schema: {
            blocks: prev.schema.blocks.map((b) =>
              b.id === blockId ? { ...b, label: newLabel } : b,
            ),
            arrows: prev.schema.arrows,
          },
        };
      });
    },
    [setState],
  );

  /**
   * "Ask Claude for suggestions" path (round-1). Dispatches a prompt
   * asking Claude to list ≤5 options as JSON. The chat-side cards
   * renderer will surface them as canvas cards via OPTIONS_READY_EVENT.
   * No code change in this round.
   */
  const dispatchSuggestionsRound1 = useCallback(
    (target: EditTarget) => {
      if (state.kind !== "ready") return;
      bus.emit("visual-edit", {
        prompt: composeSuggestionsRound1Prompt(target, state.schema),
        kind: "suggestions-round1",
      });
    },
    [state, bus],
  );

  /**
   * "Describe yourself" path: skip round-1 and go straight to a
   * round-2 execute, packing the user's free-text description as the
   * intent. Also fires OPTION_EXECUTED_EVENT with a synthesized option
   * (kind=detail) so the chatRunning settle effect knows what to do
   * with any pending arrow / placeholder block (default: drop arrow,
   * let auto-regen pick up real outcomes).
   */
  const dispatchExecuteDirect = useCallback(
    (target: EditTarget, userText: string) => {
      if (state.kind !== "ready") return;
      const trimmed = userText.trim();
      const synthOption: ConnectionOption = {
        title: trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed,
        detail: "User-described change.",
        kind: "detail",
      };
      bus.emit("option-executed", { target, option: synthOption });
      bus.emit("visual-edit", {
        prompt: composeExecuteDirectPrompt(
          target,
          state.schema,
          files,
          trimmed,
          synthOption.title,
        ),
        kind: "execute-direct",
      });
    },
    [state, files, bus],
  );

  /**
   * User dropped a new arrow. Add it to the schema with pending="claude"
   * (marching-ants) AND open the intent gate so they can pick whether
   * to describe the change themselves or have Claude suggest options.
   * No chat dispatch until the gate closes.
   */
  const handleAddConnection = useCallback((connection: Connection) => {
    const { source, target } = connection;
    if (!source || !target) return;
    if (source === target) return;
    dismissRecentEdit();
    let opened = false;
    setState((prev) => {
      if (prev.kind !== "ready") return prev;
      const fromBlock = prev.schema.blocks.find((b) => b.id === source);
      const toBlock = prev.schema.blocks.find((b) => b.id === target);
      if (!fromBlock || !toBlock) return prev;
      const duplicate = prev.schema.arrows.some(
        (a) => a.from === source && a.to === target,
      );
      if (duplicate) return prev;
      const newArrow: DiagramArrow = {
        from: source,
        to: target,
        label: "",
        pending: "claude",
      };
      opened = true;
      return {
        kind: "ready",
        schema: {
          blocks: prev.schema.blocks,
          arrows: [...prev.schema.arrows, newArrow],
        },
      };
    });
    if (opened) {
      setIntentGate({ target: { kind: "arrow", from: source, to: target } });
    }
  }, [dismissRecentEdit]);

  /**
   * Round 2: chat-side card click fires OPTION_EXECUTED_EVENT. We
   * store the winning option keyed by arrow id; once chatRunning
   * transitions to false (the execute turn finishes), the dedicated
   * effect below applies the outcome — label the arrow or drop it.
   */
  const chosenOptionsRef = useRef(
    new Map<string, ChosenOption>(), // key = serializeTarget(target)
  );
  useDiagramBusSubscribe("option-executed", (detail) => {
    if (!detail) return;
    chosenOptionsRef.current.set(serializeTarget(detail.target), {
      target: detail.target,
      option: detail.option,
    });

    // For new-block: rename the next unclaimed placeholder eagerly so
    // any arrows-added Claude emits during this turn can resolve its
    // label. Without this, the placeholder stays "New module…" until
    // the chatRunning settle runs (after Claude is fully done), so any
    // mid-stream arrows-added → resolveId silently drops every arrow
    // pointing at the new block. We keep `pending: true` so the dashed
    // border still signals "Claude is implementing this".
    if (detail.target.kind === "new-block") {
      setState((prev) => {
        if (prev.kind !== "ready") return prev;
        let claimed = false;
        const nextBlocks = prev.schema.blocks.map((b) => {
          if (claimed) return b;
          if (!b.pending || !b.id.startsWith("__pending_new_")) return b;
          if (b.label !== "New module…") return b;
          claimed = true;
          return {
            ...b,
            label: detail.option.title.slice(0, 40),
            caption: detail.option.detail.slice(0, 200) || b.caption,
          };
        });
        if (!claimed) return prev;
        return {
          kind: "ready",
          schema: { blocks: nextBlocks, arrows: prev.schema.arrows },
        };
      });
    }
  });

  /**
   * Receive parsed round-1 options from ChatView and surface them as
   * a floating cards overlay on the canvas. Also clears any stale
   * chosen-option for the same target — this catches the case where
   * the user took the "Describe yourself" path with vague text and
   * Claude bailed out with options instead of executing (we'd have
   * pre-fired OPTION_EXECUTED_EVENT optimistically; cancel it).
   */
  useDiagramBusSubscribe("options-ready", (detail) => {
    if (!detail) return;
    chosenOptionsRef.current.delete(serializeTarget(detail.target));
    setPendingOptions({ target: detail.target, options: detail.options });
  });

  /**
   * ChatView dispatches this when Claude's response includes a trailing
   * `added_arrows` JSON block. We resolve block labels → ids against
   * the current schema and append arrows with pending="claude" so they
   * render with marching-ants until the chatRunning settle. Duplicates
   * (same from→to direction) and unresolved labels are silently
   * dropped — Claude sometimes hallucinates labels.
   */
  useDiagramBusSubscribe("arrows-added", (detail) => {
    if (!detail || detail.arrows.length === 0) return;
    dlog("recent-debug:arrows-added handler", {
      detailArrows: detail.arrows,
    });
    setState((prev) => {
      if (prev.kind !== "ready") return prev;
      const resolveId = (label: string): string | null => {
        const lc = label.trim().toLowerCase();
        const exact = prev.schema.blocks.find(
          (b) => b.label.toLowerCase() === lc,
        );
        if (exact) return exact.id;
        // Fuzzy: substring match either way.
        const fuzzy = prev.schema.blocks.find(
          (b) =>
            b.label.toLowerCase().includes(lc) ||
            lc.includes(b.label.toLowerCase()),
        );
        if (!fuzzy) {
          // Surface mismatches in dev — silently dropping arrows
          // makes it impossible to tell whether Claude forgot to
          // emit them vs. emitted wrong labels.
          dwarn(
            "diagram",
            `added_arrows label "${label}" did not match any block. Existing labels:`,
            prev.schema.blocks.map((b) => b.label),
          );
        }
        return fuzzy?.id ?? null;
      };
      const toAdd: DiagramArrow[] = [];
      for (const a of detail.arrows) {
        const from = resolveId(a.from);
        const to = resolveId(a.to);
        if (!from || !to || from === to) continue;
        const duplicate = prev.schema.arrows.some(
          (x) => x.from === from && x.to === to,
        );
        if (duplicate) continue;
        if (toAdd.some((x) => x.from === from && x.to === to)) continue;
        toAdd.push({
          from,
          to,
          label: a.label?.trim() || "uses",
          pending: "claude",
        });
      }
      if (toAdd.length === 0) return prev;
      dlog("recent-debug:arrows-added applied", {
        toAdd: toAdd.map((a) => `${a.from}->${a.to}(${a.label})`),
      });
      return {
        kind: "ready",
        schema: {
          blocks: prev.schema.blocks,
          arrows: [...prev.schema.arrows, ...toAdd],
        },
      };
    });
  });

  /**
   * User picked a card (or submitted "Others"). Fire OPTION_EXECUTED
   * so the diagram's own listener captures the chosen option keyed by
   * target; fire VISUAL_EDIT_EVENT to send the round-2 execute prompt;
   * clear the overlay.
   */
  const handlePickOption = useCallback(
    (option: ConnectionOption) => {
      if (!pendingOptions) return;
      if (state.kind !== "ready") return;
      const { target } = pendingOptions;

      bus.emit("option-executed", { target, option });
      bus.emit("visual-edit", {
        prompt: composeExecuteOptionPrompt(
          target,
          state.schema,
          files,
          option,
        ),
        kind: "execute-option",
      });
      setPendingOptions(null);
    },
    [pendingOptions, state, files],
  );

  /** Strip any pending arrow / placeholder block tied to the target
   *  out of the schema. Shared by "cancel intent gate" and "cancel
   *  cards overlay" paths (both want the on-canvas placeholder gone). */
  const removeTargetVisual = useCallback((target: EditTarget) => {
    setState((prev) => {
      if (prev.kind !== "ready") return prev;
      if (target.kind === "arrow") {
        const { from, to } = target;
        return {
          kind: "ready",
          schema: {
            blocks: prev.schema.blocks,
            arrows: prev.schema.arrows.filter(
              (a) => !(a.from === from && a.to === to && a.pending),
            ),
          },
        };
      }
      if (target.kind === "new-block") {
        return {
          kind: "ready",
          schema: {
            blocks: prev.schema.blocks.filter((b) => !b.pending),
            arrows: prev.schema.arrows,
          },
        };
      }
      return prev;
    });
  }, []);

  /** "Cancel" on the cards overlay: clear the cards + drop any
   *  on-canvas placeholder tied to the target. */
  const handleCancelOptions = useCallback(() => {
    if (!pendingOptions) return;
    removeTargetVisual(pendingOptions.target);
    setPendingOptions(null);
  }, [pendingOptions, removeTargetVisual]);

  /** Intent gate: user picked "Ask Claude for suggestions". Fire the
   *  round-1 prompt; the cards UI will land in pendingOptions when
   *  ChatView parses the response. */
  const handleIntentGateAskSuggestions = useCallback(() => {
    if (!intentGate) return;
    dispatchSuggestionsRound1(intentGate.target);
    setIntentGate(null);
  }, [intentGate, dispatchSuggestionsRound1]);

  /** Intent gate: user picked "Describe yourself" + submitted text.
   *  Skip round-1 and dispatch a self-contained execute prompt. */
  const handleIntentGateDescribe = useCallback(
    (text: string) => {
      if (!intentGate) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      dispatchExecuteDirect(intentGate.target, trimmed);
      setIntentGate(null);
    },
    [intentGate, dispatchExecuteDirect],
  );

  /** Intent gate cancel: drop any on-canvas placeholder. */
  const handleIntentGateCancel = useCallback(() => {
    if (!intentGate) return;
    removeTargetVisual(intentGate.target);
    setIntentGate(null);
  }, [intentGate, removeTargetVisual]);

  /**
   * Inject `onLabelChange` callbacks into nodes produced by
   * `layoutSchema` (which is pure and doesn't know about component
   * state). Only applied to post-stream layouts; during streaming the
   * schema is mid-build so inline editing is disabled.
   */
  /**
   * User clicked the "⋯" affordance on a block. Select the block (so
   * the user gets visual feedback that "this is the block I'm acting
   * on") and open the intent gate so they can pick describe vs ask.
   */
  const handleBlockAction = useCallback((blockId: string) => {
    if (state.kind !== "ready") return;
    if (!state.schema.blocks.some((b) => b.id === blockId)) return;
    dismissRecentEdit();
    setSelectedId(blockId);
    setIntentGate({ target: { kind: "block", id: blockId } });
  }, [state, dismissRecentEdit]);

  const attachInteractive = useCallback(
    (laidNodes: Node<BlockNodeData>[]) => {
      const result = laidNodes.map((n) => {
        const dragged = userPositionsRef.current.get(n.id);
        return {
          ...n,
          // Honor a manual drag over the freshly computed dagre slot so
          // relayouts (selection toggle, bubble open) don't yank the
          // block back.
          position: dragged ?? n.position,
          data: {
            ...n.data,
            isRecentlyAdded:
              recentChanges?.blockIds.has(n.id) ?? false,
            onLabelChange: (newLabel: string) =>
              handleRenameBlock(n.id, newLabel),
            onActions: () => handleBlockAction(n.id),
          },
        };
      });
      dlog("recent-debug:attachInteractive ran", {
        recentChangesBlockIds: recentChanges
          ? Array.from(recentChanges.blockIds)
          : null,
        nodeIds: result.map((n) => n.id),
        highlightedNodeIds: result
          .filter((n) => n.data.isRecentlyAdded)
          .map((n) => n.id),
      });
      return result;
    },
    [handleRenameBlock, handleBlockAction, recentChanges],
  );

  /** Post-pass on layoutSchema's edges that tags any edge whose
   *  source/target pair landed in recentChanges with the
   *  `recent-change-edge` class — solid blue stroke that persists
   *  until the user takes their next action (dismissRecentEdit). */
  const tagRecentEdges = useCallback(
    (laidEdges: Edge[]) => {
      if (!recentChanges || recentChanges.arrowKeys.size === 0) {
        dlog("recent-debug:tagRecentEdges (no recent arrows)", {
          recentChanges: recentChanges ? "non-null but empty" : "null",
        });
        return laidEdges;
      }
      const matched: string[] = [];
      const result = laidEdges.map((e) => {
        const key = `${e.source}->${e.target}`;
        if (!recentChanges.arrowKeys.has(key)) return e;
        matched.push(key);
        // Override the inline style directly — layoutSchema puts a
        // hard-coded `stroke: "#666666"` on every settled edge, which
        // beats our `.recent-change-edge` CSS class on actual render
        // (inline style wins specificity even against !important in
        // some React Flow paths). Setting it here is the only sure
        // way to get blue stroke on the recent edges.
        return {
          ...e,
          className: e.className
            ? `${e.className} recent-change-edge`
            : "recent-change-edge",
          style: {
            ...(e.style ?? {}),
            stroke: "#78716C",
            strokeWidth: 2,
          },
          data: { ...(e.data ?? {}), recent: true },
        };
      });
      dlog("recent-debug:tagRecentEdges ran", {
        recentChangesArrowKeys: Array.from(recentChanges.arrowKeys),
        laidEdges: laidEdges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          key: `${e.source}->${e.target}`,
        })),
        matched,
      });
      return result;
    },
    [recentChanges],
  );

  // Structure fetch lifecycle handled by useDiagramStructureFetch above.

  // Re-layout when selection toggles, so dagre makes room for the
  // expanded block and surrounding nodes glide via CSS transition.
  useEffect(() => {
    if (state.kind !== "ready") return;
    const laid = layoutSchema(state.schema, selectedId);
    setNodes(attachInteractive(laid.nodes));
    setEdges(tagRecentEdges(laid.edges));
  }, [selectedId, state, setNodes, setEdges, attachInteractive, tagRecentEdges]);

  // Diff-on-ready glow handled by useRecentChanges above.
  // Settle effect (arrow outcomes, regen, edit-summary) handled below.
  useChatSettleEffect({
    chatRunning,
    chatMessages,
    state,
    setState,
    chosenOptionsRef,
    preRegenSnapshotRef,
    setRetryNonce,
    setRecentChanges,
    setEditSummary,
  });

  // Adaptive focus lifecycle handled by useAdaptiveFocus above.

  // Re-render base canvas. Detail blocks live in the side panel by
  // default; the user can promote individual ones into the main
  // diagram and from then on they layout alongside base blocks.
  useEffect(() => {
    if (state.kind !== "ready") return;
    const focusedIds =
      view === "focus" && focused ? focused.ids : null;
    const merged: DiagramSchema = {
      blocks: [...state.schema.blocks, ...promoted.blocks],
      arrows: [...state.schema.arrows, ...promoted.arrows],
    };
    const laid = layoutSchema(merged, selectedId, focusedIds);
    dlog("recent-debug:base-canvas layout effect", {
      schemaArrowKeys: state.schema.arrows.map(
        (a) => `${a.from}->${a.to}(pending=${a.pending ?? "none"})`,
      ),
      laidEdgeKeys: laid.edges.map((e) => `${e.source}->${e.target}`),
      recentChanges: null,
    });
    setNodes(attachInteractive(laid.nodes));
    setEdges(tagRecentEdges(laid.edges));
  }, [state, selectedId, focused, view, promoted, setNodes, setEdges, attachInteractive, tagRecentEdges]);

  // Camera pan to focused base block(s) when a focus delta arrives.
  useViewportFocusFit({ view, focused });

  // Auto-fit during streaming + final fit + ResizeObserver-driven refit.
  const canvasContainerRef = useCanvasFit({ state, view, focused, nodes });

  const panelOpen =
    view === "focus" &&
    !!focused &&
    (focused.ids.length > 0 ||
      focused.blocks.length > 0 ||
      focused.arrows.length > 0);

  return (
    <div className="relative flex h-full w-full bg-[#FAFAFA]">
      <div
        ref={canvasContainerRef}
        className={`relative h-full ${panelOpen ? "flex-1 min-w-0" : "w-full"} transition-opacity duration-300 ${
          regenerating ? "opacity-60" : "opacity-100"
        }`}
      >
        <ReactFlow
          nodes={renderedNodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={handleAddConnection}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1.6 }}
          proOptions={{ hideAttribution: true }}
          minZoom={0.3}
          maxZoom={2}
          nodesDraggable
          nodesConnectable={state.kind === "ready"}
          connectionMode={ConnectionMode.Loose}
          nodesFocusable={false}
          elementsSelectable={false}
        >
          <Background color="#E0E0E0" gap={16} />
          <Controls
            showInteractive={false}
            className="!border-[#D4D4D4] !bg-white"
          />
        </ReactFlow>
        <DiagramFetchOverlay
          state={state}
          hasFiles={files.length > 0}
          nodeCount={nodes.length}
          onRetry={() => setRetryNonce((n) => n + 1)}
        />
        {regenerating && <RegeneratingChip />}
        {view === "focus" &&
          nodes.length > 0 &&
          chatMessages.length === 0 &&
          !regenerating && <AdaptiveFocusBanner />}
        {pendingOptions && state.kind === "ready" && (
          <ConnectionOptionsOverlay
            target={pendingOptions.target}
            options={pendingOptions.options}
            blocks={state.schema.blocks}
            onPick={handlePickOption}
            onCancel={handleCancelOptions}
          />
        )}
        {intentGate && state.kind === "ready" && (
          <IntentGate
            target={intentGate.target}
            blocks={state.schema.blocks}
            onAskSuggestions={handleIntentGateAskSuggestions}
            onDescribe={handleIntentGateDescribe}
            onCancel={handleIntentGateCancel}
          />
        )}
        {state.kind === "ready" && !pendingOptions && !intentGate && (
          <AddNewBlockButton onClick={handleAddNewBlock} />
        )}
        {state.kind === "ready" && userGoal !== null && (
          <RegenerateDiagramButton onClick={handleRegenerate} />
        )}
        {userGoal === null &&
          files.length > 0 &&
          (surveyIntroDone &&
          (scanState.kind === "ready" || scanState.kind === "error") ? (
            <IntentSurvey
              scanState={scanState}
              onComplete={(goal) => setUserGoal(goal)}
            />
          ) : (
            <SurveyPreparingOverlay
              scanState={scanState}
              onReady={handleSurveyIntroReady}
            />
          ))}
        {editSummary && (
          <EditSummaryToast
            summary={editSummary}
            onDismiss={() => setEditSummary(null)}
          />
        )}
        {state.kind === "ready" && view === "overview" && (
          <CategoryLegend
            present={
              new Set(
                state.schema.blocks
                  .map((b) => b.category)
                  .filter((c): c is NonNullable<typeof c> => !!c),
              )
            }
          />
        )}
      </div>
      {panelOpen && state.kind === "ready" && (
        <DiagramFocusPanel
          baseBlocks={state.schema.blocks}
          focused={focused!}
          promotedIds={new Set(promoted.blocks.map((b) => b.id))}
          width={panelWidth}
          onWidthChange={setPanelWidth}
          onClose={() => setFocused(null)}
          onPromote={(b) => {
            setPromoted((prev) => {
              if (prev.blocks.some((x) => x.id === b.id)) return prev;
              const knownIds = new Set([
                ...state.schema.blocks.map((x) => x.id),
                ...prev.blocks.map((x) => x.id),
                b.id,
              ]);
              const newArrows = focused!.arrows.filter(
                (a) =>
                  (a.from === b.id || a.to === b.id) &&
                  knownIds.has(a.from) &&
                  knownIds.has(a.to) &&
                  !prev.arrows.some(
                    (p) =>
                      p.from === a.from &&
                      p.to === a.to &&
                      p.label === a.label,
                  ),
              );
              return {
                blocks: [...prev.blocks, b],
                arrows: [...prev.arrows, ...newArrows],
              };
            });
          }}
          onUnpromote={(b) => {
            setPromoted((prev) => ({
              blocks: prev.blocks.filter((x) => x.id !== b.id),
              arrows: prev.arrows.filter(
                (a) => a.from !== b.id && a.to !== b.id,
              ),
            }));
          }}
        />
      )}
    </div>
  );
}

// DiagramFocusPanel, MiniBlockNode, MiniLabeledEdge, FocusMiniGraph,
// DiagramViewSwitcher, DiagramFetchOverlay, ElapsedClock, DiagramLoadingCard,
// ConnectionOptionsOverlay, IntentGate, and OptionCardButton all moved
// to @/features/diagram/components/. Imported above.
