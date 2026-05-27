import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  ConnectionMode,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useProject } from "@/core/project";

// Types + DIAGRAM_VIEW_LABELS + serializeTarget moved to
// @/features/diagram/types.ts. Re-export here so ChatView + AppShell
// keep their existing import paths during the refactor; the final
// migration commit deletes this file and flips them directly.
import {
  DIAGRAM_VIEW_LABELS,
  serializeTarget,
  type ArrowsAddedDetail,
  type BlockNodeData,
  type ConnectionOption,
  type DiagramArrow,
  type DiagramBlock,
  type DiagramSchema,
  type DiagramView,
  type EditTarget,
  type FetchState,
  type MiniNodeData,
  type OptionExecutedDetail,
  type OptionsReadyDetail,
  type VisualEditDetail,
} from "@/features/diagram";

export {
  DIAGRAM_VIEW_LABELS,
  serializeTarget,
  type ArrowsAddedDetail,
  type BlockNodeData,
  type ConnectionOption,
  type DiagramArrow,
  type DiagramBlock,
  type DiagramSchema,
  type DiagramView,
  type EditTarget,
  type FetchState,
  type MiniNodeData,
  type OptionExecutedDetail,
  type OptionsReadyDetail,
  type VisualEditDetail,
};

// Pure helpers extracted to feature subfolders. Re-export the two
// chat-facing parsers so ChatView keeps its existing import path.
import { layoutSchema } from "@/features/diagram/layout/layoutSchema";
import {
  VISUAL_EDIT_SENTINEL_PREFIX,
  VISUAL_EDIT_SENTINEL_SUFFIX,
  buildTargetSentinel,
  parseTargetMetadata,
  parseVisualEditMessage,
} from "@/features/diagram/protocol/sentinels";
import {
  buildArrowJsonSuffix,
  buildFileTreeBlock,
} from "@/features/diagram/protocol/prompts";
import { useDiagramStructureFetch } from "@/features/diagram/hooks/useDiagramStructureFetch";
import { useAdaptiveFocus } from "@/features/diagram/hooks/useAdaptiveFocus";
import {
  useRecentChanges,
  type PreRegenSnapshot,
} from "@/features/diagram/hooks/useRecentChanges";
import { useEditSummary } from "@/features/diagram/hooks/useEditSummary";
import {
  useChatSettleEffect,
  type ChosenOption,
} from "@/features/diagram/hooks/useChatSettleEffect";
import { nodeTypes } from "@/features/diagram/components/nodes/BlockNode";
import { edgeTypes } from "@/features/diagram/components/nodes/LabeledEdge";
import { DiagramViewSwitcher } from "@/features/diagram/components/DiagramViewSwitcher";
import { ConnectionOptionsOverlay } from "@/features/diagram/components/overlays/ConnectionOptionsOverlay";
import { IntentGate } from "@/features/diagram/components/overlays/IntentGate";
import { DiagramFetchOverlay } from "@/features/diagram/components/overlays/DiagramFetchOverlay";
import { EditSummaryToast } from "@/features/diagram/components/overlays/EditSummaryToast";
import { RegeneratingChip } from "@/features/diagram/components/overlays/RegeneratingChip";
import { AdaptiveFocusBanner } from "@/features/diagram/components/overlays/AdaptiveFocusBanner";
import { AddNewBlockButton } from "@/features/diagram/components/overlays/AddNewBlockButton";
import { DiagramFocusPanel } from "@/features/diagram/components/panel/DiagramFocusPanel";

export { parseTargetMetadata, parseVisualEditMessage, DiagramViewSwitcher };

/**
 * Custom DOM event the diagram uses to push prompts into the chat
 * session (which lives in <ChatView>, a sibling component). Carries a
 * pre-formatted user-message prompt; ChatView listens and calls its
 * `handleSend` so the visual edit shows up in conversation alongside
 * typed messages.
 */
export const VISUAL_EDIT_EVENT = "app:diagram-visual-edit";

// EditTarget, serializeTarget, ConnectionOption, OptionsReadyDetail,
// OptionExecutedDetail, ArrowsAddedDetail moved to
// @/features/diagram/types.ts (imported above). The event-name string
// constants below stay until the typed bus migration (commit 11).

/**
 * Fired by the chat side once it has parsed Claude's round-1 JSON
 * options response. The diagram listens and renders the cards as a
 * floating overlay on the canvas, so the user picks "on the diagram"
 * rather than "in chat".
 */
export const OPTIONS_READY_EVENT = "app:diagram-options-ready";

/**
 * Fired by an option card on the canvas once the user has picked which
 * concrete change should happen. Carries the target + picked option.
 * Diagram's chatRunning effect uses this to finalize per-target state
 * (e.g. arrow kind → keep + label vs drop) after Claude executes.
 */
export const OPTION_EXECUTED_EVENT = "app:diagram-option-executed";

/**
 * Fired by ChatView when Claude's round-2 response includes a trailing
 * `added_arrows` JSON block (see buildArrowJsonSuffix). The diagram
 * resolves block labels → ids and adds the arrows live, with
 * marching-ants until chatRunning settles.
 */
export const ARROWS_ADDED_EVENT = "app:diagram-arrows-added";

// Sentinels (VISUAL_EDIT_ARROW_*, VISUAL_EDIT_BLOCK_*, VISUAL_EDIT_NEW_BLOCK,
// VISUAL_EDIT_SENTINEL_*), buildTargetSentinel, parseTargetMetadata,
// parseVisualEditMessage moved to @/features/diagram/protocol/sentinels.
// buildArrowJsonSuffix + buildFileTreeBlock moved to
// @/features/diagram/protocol/prompts. Imported above.

// BlockNode + nodeTypes moved to @/features/diagram/components/nodes/BlockNode.
// LabeledEdge + edgeTypes moved to @/features/diagram/components/nodes/LabeledEdge.
// Both imported above.

// estimateExpandedHeight, layoutSchema moved to
// @/features/diagram/layout/layoutSchema (imported above).

export function DiagramCanvas({ view }: { view: DiagramView }) {
  return (
    <ReactFlowProvider>
      <DiagramCanvasInner view={view} />
    </ReactFlowProvider>
  );
}

// buildChatContext moved to @/features/diagram/api/buildChatContext (imported above).

function DiagramCanvasInner({ view }: { view: DiagramView }) {
  const { files, chatMessages, chatRunning, projectKey } = useProject();
  const { fitView } = useReactFlow();

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

  // Structure fetch lifecycle: reset on projectKey, stream
  // /api/diagram?view=structure into FetchState + nodes + edges.
  const { state, setState, setRetryNonce } = useDiagramStructureFetch({
    projectKey,
    files,
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

  // Reset the small in-component state on USER-initiated project
  // change. (FetchState, nodes/edges, focused, regenerating are
  // already reset by the hooks above.)
  useEffect(() => {
    setSelectedId(null);
    setPromoted({ blocks: [], arrows: [] });
  }, [projectKey]);

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
      setSelectedId((prev) => (prev === node.id ? null : node.id));
    },
    [dismissRecentEdit],
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
  }, [handleAddNewBlock, dismissRecentEdit]);

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

        const files = block.provenance?.files ?? [];
        const fns = block.provenance?.functions ?? [];
        const summary = `Renamed block: ${oldLabel} → ${newLabel}`;
        // The sentinel on line 1 lets the chat renderer collapse the
        // long prompt body into a one-line bubble (full text still goes
        // to Claude — model just ignores the marker line).
        const prompt = [
          `${VISUAL_EDIT_SENTINEL_PREFIX}${summary}${VISUAL_EDIT_SENTINEL_SUFFIX}`,
          "",
          `[Diagram edit] User renamed block "${oldLabel}" → "${newLabel}" in the project diagram.`,
          "",
          "Block context:",
          `- Caption: ${block.caption}`,
          files.length > 0
            ? `- Files: ${files.join(", ")}`
            : "- Files: (none recorded)",
          fns.length > 0
            ? `- Functions in this block: ${fns.join(", ")}`
            : "- Functions: (none recorded)",
          "",
          `Please rename the identifier(s) in those files that correspond to this block so they reflect the new name "${newLabel}". The block label is descriptive — translate it to the appropriate code form (e.g. a class declaration, module name, or related identifier; preserve the casing convention already used in the file). Use \`edit_project_file\` for each change.`,
          "",
          `If you can't confidently determine which identifier this block refers to, make your best guess and clearly summarize what you changed in 1–2 sentences so the user can verify or revert.`,
        ].join("\n");

        window.dispatchEvent(
          new CustomEvent<VisualEditDetail>(VISUAL_EDIT_EVENT, {
            detail: { prompt, kind: "rename" },
          }),
        );

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
    [],
  );

  /**
   * Build the "this is what the target looks like" lines used in both
   * round-1 (suggestions) and round-2 (execute) prompts. Centralized
   * so arrow / block / new-block all describe their context the same
   * way and we don't duplicate the if-block-else-arrow-else-new-block
   * branching twice.
   */
  const buildTargetContextLines = useCallback(
    (target: EditTarget, schema: DiagramSchema): string[] => {
      const block = (id: string) => schema.blocks.find((b) => b.id === id);
      const line = (
        label: string,
        files: string[],
        fns: string[],
        caption: string,
      ): string[] => [
        `${label}:`,
        `- Caption: ${caption}`,
        files.length > 0
          ? `- Files: ${files.join(", ")}`
          : "- Files: (none recorded)",
        fns.length > 0
          ? `- Functions: ${fns.join(", ")}`
          : "- Functions: (none recorded)",
      ];
      if (target.kind === "arrow") {
        const from = block(target.from);
        const to = block(target.to);
        if (!from || !to) return [];
        return [
          ...line(
            `Source block ("${from.label}")`,
            from.provenance?.files ?? [],
            from.provenance?.functions ?? [],
            from.caption,
          ),
          "",
          ...line(
            `Target block ("${to.label}")`,
            to.provenance?.files ?? [],
            to.provenance?.functions ?? [],
            to.caption,
          ),
        ];
      }
      if (target.kind === "block") {
        const b = block(target.id);
        if (!b) return [];
        return line(
          `Block ("${b.label}")`,
          b.provenance?.files ?? [],
          b.provenance?.functions ?? [],
          b.caption,
        );
      }
      // new-block: no specific block context, just give project shape.
      const labels = schema.blocks
        .filter((b) => !b.pending)
        .map((b) => b.label)
        .join(", ");
      return [`Existing blocks on the diagram: ${labels || "(none)"}.`];
    },
    [],
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
      const ctx = buildTargetContextLines(target, state.schema);
      let intro: string;
      let kindGuide: string[];
      if (target.kind === "arrow") {
        intro = `User drew a new arrow on the diagram and wants suggestions for what it should mean.`;
        kindGuide = [
          `\`kind\` guide:`,
          `- "block_level": real new cross-block dependency (import / fetch / subscription). Provide a short \`label\` (e.g. "imports", "fetches").`,
          `- "detail": small inline change in one block; no new arrow needed.`,
          `- "none": already connected / no change required.`,
        ];
      } else if (target.kind === "block") {
        intro = `User clicked the "actions" affordance on a block and wants suggestions for what to do with it.`;
        kindGuide = [
          `\`kind\` guide: use "detail" for actual code changes, "none" for "no change needed". Don't use "block_level" here.`,
        ];
      } else {
        intro = `User wants to ADD A NEW MODULE to the project and wants suggestions for what to scaffold.`;
        kindGuide = [`\`kind\` guide: use "detail" for all options here.`];
      }
      const summary =
        target.kind === "arrow"
          ? `Suggestions for connection`
          : target.kind === "block"
            ? `Suggestions for block action`
            : `Suggestions for new module`;
      const prompt = [
        `${VISUAL_EDIT_SENTINEL_PREFIX}${summary}${VISUAL_EDIT_SENTINEL_SUFFIX}`,
        buildTargetSentinel(target),
        "",
        `[Diagram edit, round 1 of 2] ${intro}`,
        "",
        ...ctx,
        "",
        `DO NOT CHANGE ANY CODE. Propose 3–5 concrete options. Be terse — \`title\` ≤8 words, \`detail\` ≤1 sentence (~15 words). No fluff.`,
        "",
        `Return ONLY a single fenced JSON code block:`,
        "```json",
        `{`,
        `  "options": [`,
        `    { "title": "...", "detail": "...", "kind": "block_level|detail|none", "label": "..." }`,
        `  ]`,
        `}`,
        "```",
        "",
        ...kindGuide,
        "",
        `Output ONLY the JSON, no surrounding prose.`,
      ].join("\n");
      window.dispatchEvent(
        new CustomEvent<VisualEditDetail>(VISUAL_EDIT_EVENT, {
          detail: { prompt, kind: "suggestions-round1" },
        }),
      );
    },
    [state, buildTargetContextLines],
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
      const ctx = buildTargetContextLines(target, state.schema);
      const trimmed = userText.trim();
      const synthOption: ConnectionOption = {
        title: trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed,
        detail: "User-described change.",
        kind: "detail",
      };
      window.dispatchEvent(
        new CustomEvent<OptionExecutedDetail>(OPTION_EXECUTED_EVENT, {
          detail: { target, option: synthOption },
        }),
      );

      let intro: string;
      if (target.kind === "arrow") {
        intro = `User drew a new arrow on the diagram and described what they want it to mean.`;
      } else if (target.kind === "block") {
        intro = `User clicked a block's "actions" affordance and described what they want done.`;
      } else {
        intro = `User wants to add a new module and described what it should be.`;
      }
      const summary = `User-described: ${synthOption.title}`;
      const prompt = [
        `${VISUAL_EDIT_SENTINEL_PREFIX}${summary}${VISUAL_EDIT_SENTINEL_SUFFIX}`,
        buildTargetSentinel(target),
        "",
        `[Diagram edit] ${intro}`,
        "",
        `User's description:`,
        `"${trimmed}"`,
        "",
        ...ctx,
        "",
        `FIRST decide whether this description is concrete enough to act on.`,
        "",
        `If the description is concrete (a specific change you can implement in 1–3 file edits with high confidence):`,
        `→ Realize it in code. Use \`read_project_file\` to confirm the relevant files, then \`edit_project_file\` (or \`write_project_file\` for new files). Keep edits minimal. Briefly summarize in 1–2 sentences.`,
        ...buildFileTreeBlock(files.map((f) => f.path)),
        ...buildArrowJsonSuffix(
          target.kind === "new-block" ? synthOption.title : "",
          state.schema.blocks
            .filter((b) => !b.pending)
            .map((b) => b.label),
        ),
        "",
        `If the description is VAGUE or OPEN-ENDED (e.g. "add features", "make this better", "improve performance", "refactor", "clean up", "add tests" with no specifics, etc.):`,
        `→ DO NOT touch code. Instead respond with ONLY a JSON options block (same shape as round-1 suggestions), proposing 3–5 concrete interpretations the user might have meant. The user will then pick one:`,
        "",
        "```json",
        `{ "options": [ { "title": "...", "detail": "...", "kind": "block_level|detail|none", "label": "..." } ] }`,
        "```",
        "",
        `Be honest about vagueness — if you're guessing at intent, fall back to options. The cost of executing the wrong thing is high; the cost of asking one extra round is low.`,
      ].join("\n");
      window.dispatchEvent(
        new CustomEvent<VisualEditDetail>(VISUAL_EDIT_EVENT, {
          detail: { prompt, kind: "execute-direct" },
        }),
      );
    },
    [state, buildTargetContextLines, files],
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
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<OptionExecutedDetail>).detail;
      if (!detail) return;
      chosenOptionsRef.current.set(serializeTarget(detail.target), {
        target: detail.target,
        option: detail.option,
      });

      // For new-block: rename the next unclaimed placeholder eagerly so
      // any ARROWS_ADDED Claude emits during this turn can resolve its
      // label. Without this, the placeholder stays "New module…" until
      // the chatRunning settle runs (after Claude is fully done), so any
      // mid-stream ARROWS_ADDED → resolveId silently drops every arrow
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
              caption:
                detail.option.detail.slice(0, 200) || b.caption,
            };
          });
          if (!claimed) return prev;
          return {
            kind: "ready",
            schema: { blocks: nextBlocks, arrows: prev.schema.arrows },
          };
        });
      }
    };
    window.addEventListener(OPTION_EXECUTED_EVENT, handler);
    return () => window.removeEventListener(OPTION_EXECUTED_EVENT, handler);
  }, []);

  /**
   * Receive parsed round-1 options from ChatView and surface them as
   * a floating cards overlay on the canvas. Also clears any stale
   * chosen-option for the same target — this catches the case where
   * the user took the "Describe yourself" path with vague text and
   * Claude bailed out with options instead of executing (we'd have
   * pre-fired OPTION_EXECUTED_EVENT optimistically; cancel it).
   */
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<OptionsReadyDetail>).detail;
      if (!detail) return;
      chosenOptionsRef.current.delete(serializeTarget(detail.target));
      setPendingOptions({ target: detail.target, options: detail.options });
    };
    window.addEventListener(OPTIONS_READY_EVENT, handler);
    return () => window.removeEventListener(OPTIONS_READY_EVENT, handler);
  }, []);

  /**
   * ChatView dispatches this when Claude's response includes a trailing
   * `added_arrows` JSON block. We resolve block labels → ids against
   * the current schema and append arrows with pending="claude" so they
   * render with marching-ants until the chatRunning settle. Duplicates
   * (same from→to direction) and unresolved labels are silently
   * dropped — Claude sometimes hallucinates labels.
   */
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ArrowsAddedDetail>).detail;
      if (!detail || detail.arrows.length === 0) return;
      console.log("[recent-debug] ARROWS_ADDED handler", {
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
            console.warn(
              `[diagram] added_arrows label "${label}" did not match any block. Existing labels:`,
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
        console.log("[recent-debug] ARROWS_ADDED applied", {
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
    };
    window.addEventListener(ARROWS_ADDED_EVENT, handler);
    return () => window.removeEventListener(ARROWS_ADDED_EVENT, handler);
  }, []);

  /**
   * User picked a card (or submitted "Others"). Fire OPTION_EXECUTED
   * so the diagram's own listener captures the chosen option keyed by
   * target; fire VISUAL_EDIT_EVENT to send the round-2 execute prompt;
   * clear the overlay.
   */
  const handlePickOption = useCallback(
    (option: ConnectionOption) => {
      if (!pendingOptions) return;
      const { target } = pendingOptions;

      window.dispatchEvent(
        new CustomEvent<OptionExecutedDetail>(OPTION_EXECUTED_EVENT, {
          detail: { target, option },
        }),
      );

      const summary = `Executing: ${option.title}`;
      const promptLines = [
        `${VISUAL_EDIT_SENTINEL_PREFIX}${summary}${VISUAL_EDIT_SENTINEL_SUFFIX}`,
        buildTargetSentinel(target),
        "",
        `[Diagram edit, round 2 of 2] User picked this option:`,
        "",
        `Title: ${option.title}`,
        `Detail: ${option.detail}`,
        `Kind: ${option.kind}`,
      ];
      if (
        target.kind === "arrow" &&
        option.kind === "block_level" &&
        option.label
      ) {
        promptLines.push(
          `Arrow label (already shown on diagram): ${option.label}`,
        );
      }
      promptLines.push(
        "",
        option.kind === "none"
          ? `The user picked an option with kind="none" — confirm in 1 sentence why no code change is needed. Do NOT use edit_project_file.`
          : `Now realize this change in code. Use \`read_project_file\` to confirm the relevant files, then \`edit_project_file\` (or \`write_project_file\` if creating new files) to make the edit. Keep the change minimal and focused on what this option described. Briefly summarize in 1–2 sentences.`,
      );
      if (option.kind !== "none") {
        promptLines.push(...buildFileTreeBlock(files.map((f) => f.path)));
        const newBlockLabel =
          target.kind === "new-block" ? option.title.slice(0, 40) : "";
        const existingLabels =
          state.kind === "ready"
            ? state.schema.blocks
                .filter((b) => !b.pending)
                .map((b) => b.label)
            : [];
        promptLines.push(
          ...buildArrowJsonSuffix(newBlockLabel, existingLabels),
        );
      }

      window.dispatchEvent(
        new CustomEvent<VisualEditDetail>(VISUAL_EDIT_EVENT, {
          detail: {
            prompt: promptLines.join("\n"),
            kind: "execute-option",
          },
        }),
      );
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
      const result = laidNodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          isRecentlyAdded:
            recentChanges?.blockIds.has(n.id) ?? false,
          onLabelChange: (newLabel: string) =>
            handleRenameBlock(n.id, newLabel),
          onActions: () => handleBlockAction(n.id),
        },
      }));
      console.log("[recent-debug] attachInteractive ran", {
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
        console.log("[recent-debug] tagRecentEdges (no recent arrows)", {
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
            stroke: "#3B5BD9",
            strokeWidth: 2,
          },
          data: { ...(e.data ?? {}), recent: true },
        };
      });
      console.log("[recent-debug] tagRecentEdges ran", {
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
    console.log("[recent-debug] base-canvas layout effect", {
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
  // Detail content lives in the side panel now, so we only fit the
  // base blocks the chat is talking about. Wait long enough for the
  // panel slide-in to finish so the canvas viewport has its real size.
  useEffect(() => {
    if (view !== "focus") return;
    if (!focused) return;
    if (focused.ids.length === 0) return;
    const t = window.setTimeout(() => {
      fitView({
        nodes: focused.ids.map((id) => ({ id })),
        padding: 0.3,
        duration: 700,
        maxZoom: 1.3,
        minZoom: 0.5,
      });
    }, 320);
    return () => window.clearTimeout(t);
  }, [focused, view, fitView]);

  // Auto-fit viewport whenever the node set grows during streaming, so
  // the canvas keeps pace with new blocks instead of leaving the user
  // staring at empty whitespace if Claude lays things out off-screen.
  useEffect(() => {
    if (nodes.length === 0) return;
    const t = window.setTimeout(() => {
      fitView({ padding: 0.15, duration: 400, maxZoom: 1.6 });
    }, 60);
    return () => window.clearTimeout(t);
  }, [nodes.length, fitView]);

  // Final fit after streaming completes — edges may have arrived after
  // the last node-trigger, and dagre may have shifted positions.
  useEffect(() => {
    if (state.kind !== "ready") return;
    if (nodes.length === 0) return;
    const t = window.setTimeout(() => {
      fitView({ padding: 0.15, duration: 500, maxZoom: 1.6 });
    }, 120);
    return () => window.clearTimeout(t);
  }, [state, fitView, nodes.length]);

  // Recenter the viewport whenever the canvas's available width
  // changes — the side panel sliding in/out, the user dragging the
  // resize handle, the window itself resizing. Without this, growing
  // the panel pushes the diagram off the visible area and shrinking
  // it leaves a lopsided composition.
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const fitFnRef = useRef<() => void>(() => {});
  fitFnRef.current = () => {
    if (state.kind !== "ready") return;
    if (nodes.length === 0) return;
    if (view === "focus" && focused && focused.ids.length > 0) {
      fitView({
        nodes: focused.ids.map((id) => ({ id })),
        padding: 0.3,
        duration: 220,
        maxZoom: 1.3,
        minZoom: 0.5,
      });
    } else {
      fitView({ padding: 0.15, duration: 220, maxZoom: 1.6 });
    }
  };
  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    let timer: number | undefined;
    let isFirst = true;
    const ro = new ResizeObserver(() => {
      // Skip the very first observation — that's the initial mount,
      // already handled by React Flow's `fitView` prop and the streaming
      // effects above. We only want to react to subsequent size changes.
      if (isFirst) {
        isFirst = false;
        return;
      }
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => fitFnRef.current(), 80);
    });
    ro.observe(el);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      ro.disconnect();
    };
  }, []);

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
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
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
        {editSummary && (
          <EditSummaryToast
            summary={editSummary}
            onDismiss={() => setEditSummary(null)}
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
