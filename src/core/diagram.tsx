import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  BaseEdge,
  Background,
  ConnectionMode,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Position,
  getSmoothStepPath,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Loader2,
  Plus,
  X,
} from "lucide-react";
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
import {
  PANEL_MAX,
  PANEL_MIN,
} from "@/features/diagram/layout/constants";
import {
  estimateMiniExpandedHeight,
  layoutSchema,
} from "@/features/diagram/layout/layoutSchema";
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
import { buildProjectContext } from "@/features/diagram/api/buildProjectContext";
import { buildChatContext } from "@/features/diagram/api/buildChatContext";
import { nodeTypes } from "@/features/diagram/components/nodes/BlockNode";
import { edgeTypes } from "@/features/diagram/components/nodes/LabeledEdge";

export { parseTargetMetadata, parseVisualEditMessage };

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

  const filesKey = files
    .map((f) => f.path)
    .sort()
    .join("|");

  const [state, setState] = useState<FetchState>({ kind: "idle" });
  const [retryNonce, setRetryNonce] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [focused, setFocused] = useState<{
    ids: string[];
    blocks: DiagramBlock[];
    arrows: DiagramArrow[];
  } | null>(null);
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
  // Captures what the diagram looked like immediately before the most
  // recent auto-regen so the next "ready" transition can diff and
  // highlight what Claude added. Reset to null once the diff fires.
  const preRegenSnapshotRef = useRef<{
    blockIds: Set<string>;
    arrowKeys: Set<string>;
  } | null>(null);
  // IDs of blocks / arrows that materialized in the latest regen and
  // should briefly glow. Cleared by a setTimeout ~3.5s after they're
  // set (matches the recent-change-glow keyframes duration).
  const [recentChanges, setRecentChanges] = useState<{
    blockIds: Set<string>;
    arrowKeys: Set<string>;
  } | null>(null);
  // Floating toast on the canvas summarising the most-recent Claude
  // turn (which files were touched + a 1-line summary). Auto-dismissed
  // after ~7s by the chatRunning settle effect's setTimeout, or by ✕.
  const [editSummary, setEditSummary] = useState<{
    files: string[];
    text: string;
  } | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<BlockNodeData>>(
    [],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    // Only fire on USER-initiated project changes (upload, reset) —
    // tracked via projectKey from ProjectContext. Previously this
    // depended on `filesKey` (paths joined), so Claude calling
    // write_project_file with a new path would flip filesKey →
    // entire diagram wiped to "idle" mid-turn → "Claude is drawing"
    // re-fetch kicked in. Switching to projectKey makes it stable
    // across Claude's per-turn file mutations.
    setState({ kind: "idle" });
    setNodes([]);
    setEdges([]);
    setSelectedId(null);
    setRegenerating(false);
    setFocused(null);
    setPromoted({ blocks: [], arrows: [] });
  }, [projectKey, setNodes, setEdges]);

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
    new Map<string, { target: EditTarget; option: ConnectionOption }>(), // key = serializeTarget(target)
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

  useEffect(() => {
    if (files.length === 0) return;
    if (state.kind !== "idle") return;

    setState({ kind: "loading", startedAt: Date.now() });
    setNodes([]);
    setEdges([]);
    const controller = new AbortController();
    const projectContext = buildProjectContext(files, null);

    const blocks: DiagramBlock[] = [];
    const arrows: DiagramArrow[] = [];

    const reLayout = () => {
      const laid = layoutSchema({ blocks, arrows }, selectedId);
      setNodes(laid.nodes);
      setEdges(laid.edges);
    };

    (async () => {
      try {
        const resp = await fetch("/api/diagram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_context: projectContext,
            view: "structure",
          }),
          signal: controller.signal,
        });
        if (!resp.body) throw new Error("no response body");

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let errorMessage: string | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          let nl: number;
          while ((nl = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let evt: { kind?: string; data?: unknown; message?: string };
            try {
              evt = JSON.parse(line);
            } catch {
              continue;
            }
            console.log("[diagram/structure]", evt);
            if (evt.kind === "block" && evt.data) {
              const block = evt.data as DiagramBlock;
              const dupIdx = blocks.findIndex((b) => b.id === block.id);
              if (dupIdx >= 0) blocks[dupIdx] = block;
              else blocks.push(block);
              reLayout();
            } else if (evt.kind === "arrow" && evt.data) {
              const arrow = evt.data as DiagramArrow;
              const dupIdx = arrows.findIndex(
                (a) => a.from === arrow.from && a.to === arrow.to,
              );
              if (dupIdx >= 0) arrows[dupIdx] = arrow;
              else arrows.push(arrow);
              reLayout();
            } else if (evt.kind === "error") {
              errorMessage = evt.message || "stream error";
            }
          }
        }

        if (controller.signal.aborted) return;
        if (errorMessage) {
          setState({ kind: "error", message: errorMessage });
        } else {
          setState({
            kind: "ready",
            schema: { blocks, arrows },
          });
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: String(e) });
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey, retryNonce, setNodes, setEdges]);

  // Re-layout when selection toggles, so dagre makes room for the
  // expanded block and surrounding nodes glide via CSS transition.
  useEffect(() => {
    if (state.kind !== "ready") return;
    const laid = layoutSchema(state.schema, selectedId);
    setNodes(attachInteractive(laid.nodes));
    setEdges(tagRecentEdges(laid.edges));
  }, [selectedId, state, setNodes, setEdges, attachInteractive, tagRecentEdges]);

  // When state lands on "ready" AND we have a pre-regen snapshot,
  // diff the two schemas. Whatever's new gets marked in recentChanges,
  // which the layout effect propagates into BlockNodeData.isRecentlyAdded
  // + edge className. A 3.5s timer clears the highlight (matches the
  // recent-change-glow keyframes duration).
  useEffect(() => {
    if (state.kind !== "ready") return;
    if (!preRegenSnapshotRef.current) return;
    const snap = preRegenSnapshotRef.current;
    preRegenSnapshotRef.current = null;
    const newBlockIds = new Set<string>();
    for (const b of state.schema.blocks) {
      if (b.pending) continue;
      if (!snap.blockIds.has(b.id)) newBlockIds.add(b.id);
    }
    const newArrowKeys = new Set<string>();
    for (const a of state.schema.arrows) {
      if (a.pending) continue;
      const key = `${a.from}->${a.to}`;
      if (!snap.arrowKeys.has(key)) newArrowKeys.add(key);
    }
    console.log("[recent-debug] diff effect fired", {
      snapBlockIds: Array.from(snap.blockIds),
      snapArrowKeys: Array.from(snap.arrowKeys),
      currentBlockIds: state.schema.blocks.filter((b) => !b.pending).map((b) => b.id),
      currentArrowKeys: state.schema.arrows.filter((a) => !a.pending).map((a) => `${a.from}->${a.to}`),
      newBlockIds: Array.from(newBlockIds),
      newArrowKeys: Array.from(newArrowKeys),
    });
    if (newBlockIds.size === 0 && newArrowKeys.size === 0) return;
    setRecentChanges({ blockIds: newBlockIds, arrowKeys: newArrowKeys });
    // No auto-dismiss. Per user feedback the "just edited" highlight
    // should persist until they take the NEXT action — that way they
    // can scan the diagram at leisure and see exactly what Claude
    // changed. dismissRecentEdit (declared up top) wipes it on any
    // user mutation handler.
  }, [state]);

  // Resolve arrows whose chosen option just finished executing AND
  // auto-regen the diagram if Claude touched any files. chatRunning
  // true → false transition signals "Claude's current turn ended".
  //
  // Branches:
  //   1. chosenOptionsRef non-empty → round-2 of an arrow flow. Apply
  //      each option's outcome (block_level keeps + labels the arrow;
  //      detail/none drops it). Clear the map. We do NOT auto-regen
  //      after this — the user just set a label and the local state
  //      is exactly the outcome we want; a fresh server fetch could
  //      relabel or rename the arrow and surprise them.
  //   2. chosenOptionsRef empty BUT the just-finished turn used
  //      edit_project_file / write_project_file → typed-chat edit (or
  //      a future block / new-block action). Force a structure regen
  //      so the diagram reflects the new file state.
  //   3. Otherwise (no edits, no chosen option) → likely round-1 of an
  //      arrow flow, or a no-op chat reply. Do nothing.
  const prevChatRunningRef = useRef(false);
  useEffect(() => {
    if (prevChatRunningRef.current && !chatRunning) {
      console.log("[recent-debug] settle entry — schema snapshot", {
        stateKind: state.kind,
        arrows:
          state.kind === "ready"
            ? state.schema.arrows.map((a) => ({
                key: `${a.from}->${a.to}`,
                pending: a.pending ?? null,
              }))
            : null,
        blocks:
          state.kind === "ready"
            ? state.schema.blocks.map((b) => ({
                id: b.id,
                label: b.label,
                pending: b.pending ?? null,
              }))
            : null,
      });
      const chosen = chosenOptionsRef.current;
      // Only ARROW-kind targets need per-arrow outcome handling here;
      // block / new-block just want a fresh regen, same as a typed
      // chat edit. So narrow `chosen` to its arrow entries first.
      const arrowEntries = Array.from(chosen.values()).filter(
        (entry) => entry.target.kind === "arrow",
      );
      const blockOrNewBlockEntries = Array.from(chosen.values()).filter(
        (entry) => entry.target.kind !== "arrow",
      );
      const hadArrowExecute = arrowEntries.length > 0;
      const hadBlockOrNewBlockExecute = blockOrNewBlockEntries.length > 0;

      // Collect IDs / arrow keys of EVERYTHING that just settled in
      // this transition so we can flag them in recentChanges (solid
      // blue until the user takes their next action).
      //
      // CRITICAL: we compute the next blocks / arrows + settled sets
      // SYNCHRONOUSLY here, before any setState. Side-effect mutations
      // inside a setState updater callback do not run until the next
      // render — so the size check at the bottom would silently see
      // an empty set and skip setRecentChanges, leaving the canvas
      // grey even though we just settled stuff.
      const settledBlockIds = new Set<string>();
      const settledArrowKeys = new Set<string>();
      let nextBlocks =
        state.kind === "ready" ? state.schema.blocks : null;
      let nextArrows =
        state.kind === "ready" ? state.schema.arrows : null;
      let schemaChanged = false;

      if (state.kind === "ready") {
        if (hadArrowExecute) {
          const arrowOptionByKey = new Map<string, ConnectionOption>();
          for (const entry of arrowEntries) {
            if (entry.target.kind !== "arrow") continue;
            arrowOptionByKey.set(
              `${entry.target.from}->${entry.target.to}`,
              entry.option,
            );
          }
          const built: DiagramArrow[] = [];
          for (const a of state.schema.arrows) {
            const key = `${a.from}->${a.to}`;
            const opt = arrowOptionByKey.get(key);
            if (!opt) {
              // No chosen-option for this arrow — either long-settled
              // (no-op) or a Claude-added arrow from ARROWS_ADDED_EVENT
              // (still pending="claude"). Settle the latter and flag.
              if (a.pending === "claude") {
                settledArrowKeys.add(key);
                built.push({ ...a, pending: undefined });
              } else {
                built.push(a);
              }
              continue;
            }
            if (opt.kind === "block_level") {
              settledArrowKeys.add(key);
              built.push({
                ...a,
                label: opt.label?.trim() || "uses",
                pending: undefined,
              });
            }
            // detail / none → drop the arrow (don't push)
          }
          nextArrows = built;
          schemaChanged = true;
          chosen.clear();
        } else {
          // No user-chosen-option this turn, but Claude may still have
          // added arrows via ARROWS_ADDED_EVENT (pending="claude").
          // Settle them so the marching-ants stops AND flag them.
          const hasClaudePending = state.schema.arrows.some(
            (a) => a.pending === "claude",
          );
          if (hasClaudePending) {
            nextArrows = state.schema.arrows.map((a) => {
              if (a.pending !== "claude") return a;
              settledArrowKeys.add(`${a.from}->${a.to}`);
              return { ...a, pending: undefined };
            });
            schemaChanged = true;
          }
        }

        // Card-driven flows (block / new-block) — settle locally, NO
        // regen. The user already knows what they asked for; a full
        // wipe + re-layout would lose their spatial memory of where
        // existing blocks sit. For new-block specifically: update the
        // placeholder so it shows the chosen module title instead of
        // staying as "New module…".
        if (hadBlockOrNewBlockExecute) {
          const newBlockOptions = blockOrNewBlockEntries
            .filter((e) => e.target.kind === "new-block")
            .map((e) => e.option);
          if (newBlockOptions.length > 0) {
            // Walk placeholder blocks (FIFO) and bind each to one
            // chosen option in order. If user fired multiple new-block
            // flows back-to-back this matches them positionally.
            let optIdx = 0;
            nextBlocks = state.schema.blocks.map((b) => {
              if (!b.pending || !b.id.startsWith("__pending_new_")) return b;
              const opt = newBlockOptions[optIdx];
              if (!opt) return b;
              settledBlockIds.add(b.id);
              optIdx++;
              return {
                ...b,
                label: opt.title.slice(0, 40),
                caption:
                  opt.detail.slice(0, 200) || "Just created by Claude.",
                pending: undefined,
              };
            });
            schemaChanged = true;
          }
          chosen.clear();
        }
      }

      if (schemaChanged && nextBlocks && nextArrows) {
        setState({
          kind: "ready",
          schema: { blocks: nextBlocks, arrows: nextArrows },
        });
      }

      // Auto-regen ONLY for typed-chat turns that edited files. Skip
      // when the turn was a card-driven (arrow / block / new-block)
      // execute — those already settled their target locally above
      // and regen would destroy the rest of the user's spatial layout.
      let shouldRegen = false;
      const walkLog: Array<{ idx: number; type: unknown; toolNames: string[]; contentKind: string }> = [];
      if (!hadArrowExecute && !hadBlockOrNewBlockExecute) {
        for (let i = chatMessages.length - 1; i >= 0; i--) {
          const m = chatMessages[i] as {
            type?: string;
            message?: { content?: unknown };
          };
          const content = m.message?.content;
          const toolNames: string[] = [];
          if (Array.isArray(content)) {
            for (const b of content as Array<{ type?: string; name?: string }>) {
              if (b?.type === "tool_use" && b.name) toolNames.push(b.name);
            }
          }
          walkLog.push({
            idx: i,
            type: m.type,
            toolNames,
            contentKind: Array.isArray(content)
              ? "array"
              : typeof content,
          });
          if (m.type === "user") break;
          if (m.type !== "assistant") continue;
          if (!Array.isArray(content)) continue;
          for (const name of toolNames) {
            if (name === "edit_project_file" || name === "write_project_file") {
              shouldRegen = true;
              break;
            }
          }
          if (shouldRegen) break;
        }
      }
      console.log("[recent-debug] shouldRegen walk", {
        hadArrowExecute,
        hadBlockOrNewBlockExecute,
        shouldRegen,
        chatMessagesLength: chatMessages.length,
        walk: walkLog,
      });
      if (shouldRegen) {
        chosen.clear();
        // Snapshot what's currently on screen so the next "ready"
        // transition can diff against it and glow whatever Claude
        // added during this turn.
        if (state.kind === "ready") {
          preRegenSnapshotRef.current = {
            blockIds: new Set(
              state.schema.blocks
                .filter((b) => !b.pending)
                .map((b) => b.id),
            ),
            arrowKeys: new Set(
              state.schema.arrows
                .filter((a) => !a.pending)
                .map((a) => `${a.from}->${a.to}`),
            ),
          };
        }
        setState({ kind: "idle" });
        setRetryNonce((n) => n + 1);
      }

      // Build the edit-summary toast from the just-finished assistant
      // turn. Pulls all edit/write file paths + the last text block
      // (with JSON fences stripped) so the user gets a quick "here's
      // what just changed" without having to scroll the chat.
      const editedFiles = new Set<string>();
      const textChunks: string[] = [];
      for (let i = chatMessages.length - 1; i >= 0; i--) {
        const m = chatMessages[i] as {
          type?: string;
          message?: { content?: unknown };
        };
        if (m.type === "user") break;
        if (m.type !== "assistant") continue;
        const content = m.message?.content;
        if (!Array.isArray(content)) continue;
        for (const b of content as Array<{
          type?: string;
          name?: string;
          input?: { path?: string };
          text?: string;
        }>) {
          if (
            b?.type === "tool_use" &&
            (b.name === "edit_project_file" ||
              b.name === "write_project_file") &&
            typeof b.input?.path === "string"
          ) {
            editedFiles.add(b.input.path);
          } else if (b?.type === "text" && typeof b.text === "string") {
            textChunks.unshift(b.text);
          }
        }
      }
      if (editedFiles.size > 0) {
        const fullText = textChunks.join("\n");
        const stripped = fullText
          .replace(/```(?:json)?\s*\n[\s\S]*?\n```/g, "")
          .trim();
        const firstParagraph = stripped.split(/\n\n+/)[0] ?? "";
        setEditSummary({
          files: Array.from(editedFiles),
          text:
            firstParagraph.length > 220
              ? `${firstParagraph.slice(0, 217)}…`
              : firstParagraph,
        });
      }

      // Flush everything that just settled into recentChanges so the
      // canvas paints them solid blue until the user's next action.
      // Skipped when nothing settled (e.g. a no-op chat reply).
      console.log("[recent-debug] settle effect", {
        hadArrowExecute,
        hadBlockOrNewBlockExecute,
        shouldRegen,
        settledBlockIds: Array.from(settledBlockIds),
        settledArrowKeys: Array.from(settledArrowKeys),
      });
      if (settledBlockIds.size > 0 || settledArrowKeys.size > 0) {
        setRecentChanges({
          blockIds: settledBlockIds,
          arrowKeys: settledArrowKeys,
        });
      }
    }
    prevChatRunningRef.current = chatRunning;
    // chatMessages is read inside; including it as a dep means the
    // effect runs more often than strictly necessary, but the
    // transition guard above keeps it idempotent.
  }, [chatRunning, chatMessages]);

  // Adaptive focus: fire one focus-delta request per user turn. We
  // count user messages (not total chatMessages.length) so the assistant
  // streaming many intermediate items — thinking, tool calls, tool
  // results, text chunks — doesn't keep retriggering the regen and
  // making the panel flicker. We hold a ref to the latest chat history
  // so the deferred fetch picks up whatever the assistant has produced
  // by then, even though the effect doesn't re-run on every chunk.
  const chatMessagesRef = useRef(chatMessages);
  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);

  const userMessageCount = chatMessages.reduce(
    (n, m) => n + ((m as { type?: string }).type === "user" ? 1 : 0),
    0,
  );
  const lastUserCountRef = useRef(0);
  useEffect(() => {
    if (view !== "focus") return;
    if (state.kind !== "ready") return;
    if (files.length === 0) return;
    if (userMessageCount === lastUserCountRef.current) return;
    lastUserCountRef.current = userMessageCount;
    if (userMessageCount === 0) return;

    const controller = new AbortController();
    const debounceTimer = window.setTimeout(() => {
      const projectContext = buildProjectContext(files, null);
      const chatContext = buildChatContext(chatMessagesRef.current, 3);
      const baseSchemaJson = JSON.stringify({
        blocks: state.schema.blocks.map((b) => ({
          id: b.id,
          label: b.label,
          caption: b.caption,
        })),
      });
      setRegenerating(true);

      const newDetailBlocks: DiagramBlock[] = [];
      const newDetailArrows: DiagramArrow[] = [];
      const newFocusedIds: string[] = [];

      (async () => {
        try {
          const resp = await fetch("/api/diagram", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              project_context: projectContext,
              view: "focus",
              chat_context: chatContext,
              base_schema: baseSchemaJson,
            }),
            signal: controller.signal,
          });
          if (!resp.body) throw new Error("no response body");
          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf("\n")) !== -1) {
              const line = buf.slice(0, nl).trim();
              buf = buf.slice(nl + 1);
              if (!line) continue;
              let evt: {
                kind?: string;
                data?: unknown;
                ids?: string[];
              };
              try {
                evt = JSON.parse(line);
              } catch {
                continue;
              }
              console.log("[diagram/focus]", evt);
              if (evt.kind === "focus" && Array.isArray(evt.ids)) {
                // Accumulate ids but DON'T replace `focused` yet — if
                // the previous turn had detail blocks visible, blowing
                // them away the moment a new focus arrives makes the
                // panel flash empty. Wait for the first detail_block
                // (or stream end) to commit the swap.
                newFocusedIds.push(...evt.ids);
              } else if (evt.kind === "detail_block" && evt.data) {
                newDetailBlocks.push(evt.data as DiagramBlock);
                setFocused({
                  ids: [...newFocusedIds],
                  blocks: [...newDetailBlocks],
                  arrows: [...newDetailArrows],
                });
                setRegenerating(false);
              } else if (evt.kind === "detail_arrow" && evt.data) {
                newDetailArrows.push(evt.data as DiagramArrow);
                setFocused({
                  ids: [...newFocusedIds],
                  blocks: [...newDetailBlocks],
                  arrows: [...newDetailArrows],
                });
              }
            }
          }
          if (controller.signal.aborted) return;
          // Edge: focus event arrived but no detail_block ever did.
          // Commit at least the new ids so the panel reflects the new
          // turn rather than appearing stuck on the previous topic.
          if (newDetailBlocks.length === 0 && newFocusedIds.length > 0) {
            setFocused({
              ids: [...newFocusedIds],
              blocks: [],
              arrows: [],
            });
          }
          setRegenerating(false);
        } catch {
          if (controller.signal.aborted) return;
          setRegenerating(false);
        }
      })();
    }, 1200);

    return () => {
      window.clearTimeout(debounceTimer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userMessageCount, view, files.length]);

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
        {regenerating && (
          <div className="pointer-events-none absolute right-3 top-3 z-50 flex items-center gap-2 rounded-full border border-[#3B5BD9]/30 bg-white/95 px-3 py-1.5 text-xs text-[#3B5BD9] shadow-md">
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            <span>Refocusing on the conversation…</span>
          </div>
        )}
        {view === "focus" &&
          nodes.length > 0 &&
          chatMessages.length === 0 &&
          !regenerating && (
            <div className="pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded-full border border-[#3B5BD9]/30 bg-[#F4F7FF] px-3 py-1 text-[11px] font-medium text-[#3B5BD9] shadow-sm">
              Adaptive focus mode · diagram will refocus when you chat
            </div>
          )}
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
          <button
            type="button"
            onClick={handleAddNewBlock}
            title="Add a new module (or double-click empty canvas)"
            className="absolute bottom-4 right-4 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-[#3B5BD9]/30 bg-white text-[#3B5BD9] shadow-lg transition-colors hover:bg-[#F4F7FF]"
          >
            <Plus className="h-5 w-5" strokeWidth={2} />
          </button>
        )}
        {editSummary && (
          <div className="pointer-events-auto absolute bottom-4 left-1/2 z-40 w-[min(560px,calc(100%-32px))] -translate-x-1/2 rounded-xl border border-[#3B5BD9]/30 bg-white p-3 shadow-xl">
            <div className="mb-1.5 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-[#3B5BD9]">
                <Check className="h-3 w-3" strokeWidth={2.5} />
                Just edited
              </div>
              <button
                type="button"
                onClick={() => setEditSummary(null)}
                title="Dismiss"
                className="rounded-md px-1 text-[12px] text-[#666666] hover:bg-[#FAFAFA]"
              >
                ✕
              </button>
            </div>
            <div className="mb-1.5 flex flex-wrap gap-1">
              {editSummary.files.slice(0, 6).map((f) => (
                <span
                  key={f}
                  title={f}
                  className="max-w-[200px] truncate rounded border border-[#D4D4D4] bg-[#FAFAFA] px-1.5 py-0.5 font-mono text-[10px] text-[#444444]"
                >
                  {f.split("/").pop() ?? f}
                </span>
              ))}
              {editSummary.files.length > 6 && (
                <span className="text-[10px] text-[#999999]">
                  +{editSummary.files.length - 6} more
                </span>
              )}
            </div>
            {editSummary.text && (
              <div className="text-[12px] leading-snug text-[#444444]">
                {editSummary.text}
              </div>
            )}
          </div>
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

// PANEL_MIN / PANEL_MAX moved to @/features/diagram/layout/constants (imported above).

function DiagramFocusPanel({
  baseBlocks,
  focused,
  promotedIds,
  width,
  onWidthChange,
  onClose,
  onPromote,
  onUnpromote,
}: {
  baseBlocks: DiagramBlock[];
  focused: {
    ids: string[];
    blocks: DiagramBlock[];
    arrows: DiagramArrow[];
  };
  promotedIds: Set<string>;
  width: number;
  onWidthChange: (w: number) => void;
  onClose: () => void;
  onPromote: (b: DiagramBlock) => void;
  onUnpromote: (b: DiagramBlock) => void;
}) {
  const focusedLabels = focused.ids
    .map((id) => baseBlocks.find((b) => b.id === id)?.label)
    .filter((x): x is string => Boolean(x));
  const isStreaming =
    focused.blocks.length === 0 && focused.arrows.length === 0;

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = width;
      const onMove = (ev: MouseEvent) => {
        const dx = startX - ev.clientX; // dragging left grows panel
        const next = Math.min(PANEL_MAX, Math.max(PANEL_MIN, startW + dx));
        onWidthChange(next);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width, onWidthChange],
  );

  return (
    <aside
      className="panel-slide-in relative flex h-full shrink-0 flex-col border-l border-[#E0E0E0] bg-white shadow-[-6px_0_18px_rgba(0,0,0,0.04)]"
      style={{ width }}
    >
      {/* Drag handle on the left edge — wider invisible hit-area, thin
          visible bar that lights up on hover. */}
      <div
        onMouseDown={onResizeStart}
        className="group absolute left-0 top-0 z-20 h-full w-2 -translate-x-1/2 cursor-col-resize"
        aria-label="Resize focus panel"
        role="separator"
      >
        <div className="mx-auto h-full w-px bg-[#E8E8E8] transition-colors group-hover:bg-[#3B5BD9]/40" />
      </div>

      <header className="flex items-start justify-between gap-2 border-b border-[#E8E8E8] px-4 py-3">
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[#999999]">
            Focusing
          </div>
          <div className="mt-0.5 truncate text-sm font-semibold text-[#222222]">
            {focusedLabels.length > 0 ? focusedLabels.join(", ") : "—"}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close focus panel"
          className="rounded-md p-1 text-[#999999] transition-colors hover:bg-[#F4F4F4] hover:text-[#484848]"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </header>

      <div className="relative flex-1 overflow-hidden">
        {isStreaming ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-[#999999]">
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            <span>Composing the detail view…</span>
          </div>
        ) : (
          <ReactFlowProvider>
            <FocusMiniGraph
              focused={focused}
              baseBlocks={baseBlocks}
              promotedIds={promotedIds}
              onPromote={onPromote}
              onUnpromote={onUnpromote}
            />
          </ReactFlowProvider>
        )}
      </div>
      <footer className="border-t border-[#E8E8E8] px-4 py-2 text-[10px] leading-snug text-[#999999]">
        Click <span className="font-medium text-[#3B5BD9]">+</span> on any
        sub-piece to add it to the main diagram.
      </footer>
    </aside>
  );
}

// MiniNodeData moved to @/features/diagram/types.ts.

function MiniBlockNode({ data }: NodeProps<Node<MiniNodeData>>) {
  if (data.isGhost) {
    return (
      <div
        className="rounded-md border border-dashed border-[#F59E0B]/60 bg-[#FFF8EC] px-2.5 py-1.5 text-[11px] font-semibold text-[#A1610B] shadow-sm"
        style={{ width: 150 }}
      >
        <Handle
          type="target"
          position={Position.Top}
          className="!h-1.5 !w-1.5 !border-0 !bg-transparent"
        />
        <div className="truncate">{data.label}</div>
        <div className="mt-0.5 text-[9px] font-medium uppercase tracking-wider text-[#A1610B]/70">
          on canvas
        </div>
        <Handle
          type="source"
          position={Position.Bottom}
          className="!h-1.5 !w-1.5 !border-0 !bg-[#F59E0B]"
        />
      </div>
    );
  }
  const fileCount = data.files.length;
  const fnCount = data.functions.length;
  return (
    <div
      className={`block-node-grow group relative rounded-md border bg-white px-2.5 py-1.5 shadow-sm transition-all ${
        data.isSelected
          ? "ring-2 ring-[#3B5BD9]/50 shadow-lg z-10"
          : ""
      } ${
        data.isPromoted
          ? "border-[#3B5BD9]/50 bg-[#F4F7FF]"
          : "border-[#D4D4D4] hover:shadow-md"
      }`}
      style={{ width: data.isSelected ? 220 : 160 }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !border-0 !bg-[#999999]"
      />
      <div className="pr-5 text-[12px] font-semibold leading-tight text-[#222222]">
        {data.label}
      </div>
      {data.caption && (
        <div
          className={`mt-0.5 text-[10px] leading-snug text-[#666666] ${
            data.isSelected ? "" : "line-clamp-2"
          }`}
        >
          {data.caption}
        </div>
      )}
      {!data.isSelected && (fileCount > 0 || fnCount > 0) && (
        <div className="mt-1 text-[9px] uppercase tracking-wide text-[#999999]">
          {fileCount > 0 && `${fileCount} ${fileCount === 1 ? "file" : "files"}`}
          {fileCount > 0 && fnCount > 0 && " · "}
          {fnCount > 0 && `${fnCount} ${fnCount === 1 ? "fn" : "fns"}`}
        </div>
      )}
      {data.isSelected && fileCount > 0 && (
        <div className="mt-2">
          <div className="mb-0.5 text-[8px] font-medium uppercase tracking-wider text-[#999999]">
            Files
          </div>
          <ul className="space-y-0.5 text-[10px] text-[#444444]">
            {data.files.map((f) => (
              <li key={f} className="truncate font-mono" title={f}>
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.isSelected && fnCount > 0 && (
        <div className="mt-1.5">
          <div className="mb-0.5 text-[8px] font-medium uppercase tracking-wider text-[#999999]">
            Functions
          </div>
          <ul className="flex flex-wrap gap-1 text-[9px] text-[#444444]">
            {data.functions.map((fn) => (
              <li
                key={fn}
                className="rounded bg-[#F0F0F0] px-1.5 py-0.5 font-mono"
              >
                {fn}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.block && data.onPromote && data.onUnpromote && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (data.isPromoted) data.onUnpromote!(data.block!);
            else data.onPromote!(data.block!);
          }}
          aria-label={
            data.isPromoted
              ? "Remove from main diagram"
              : "Add to main diagram"
          }
          className={`group/btn absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border transition-all ${
            data.isPromoted
              ? "border-[#3B5BD9]/40 bg-[#3B5BD9] text-white hover:border-red-400 hover:bg-red-500"
              : "border-[#D4D4D4] bg-white text-[#666666] opacity-0 group-hover:opacity-100 hover:border-[#3B5BD9] hover:text-[#3B5BD9]"
          }`}
        >
          {data.isPromoted ? (
            <>
              <Check
                className="h-3 w-3 group-hover/btn:hidden"
                strokeWidth={3}
              />
              <X
                className="hidden h-3 w-3 group-hover/btn:block"
                strokeWidth={3}
              />
            </>
          ) : (
            <Plus className="h-3 w-3" strokeWidth={2.5} />
          )}
        </button>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-1.5 !w-1.5 !border-0 !bg-[#999999]"
      />
    </div>
  );
}

// estimateMiniExpandedHeight moved to @/features/diagram/layout/layoutSchema (imported above).

const miniNodeTypes = { mini: MiniBlockNode };

function MiniLabeledEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  style,
  markerEnd,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded-[4px] border border-[#3B5BD9]/30 bg-white px-1.5 py-px text-[10px] font-medium text-[#3B5BD9] shadow-sm"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const miniEdgeTypes = { miniLabeled: MiniLabeledEdge };

function FocusMiniGraph({
  focused,
  baseBlocks,
  promotedIds,
  onPromote,
  onUnpromote,
}: {
  focused: {
    ids: string[];
    blocks: DiagramBlock[];
    arrows: DiagramArrow[];
  };
  baseBlocks: DiagramBlock[];
  promotedIds: Set<string>;
  onPromote: (b: DiagramBlock) => void;
  onUnpromote: (b: DiagramBlock) => void;
}) {
  const { fitView } = useReactFlow();
  const [selectedMiniId, setSelectedMiniId] = useState<string | null>(null);
  const onMiniNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      // Ghost nodes (focused base re-stamped at the top) aren't
      // expandable here — they belong to the main canvas.
      if (node.id.startsWith("ghost-")) return;
      setSelectedMiniId((prev) => (prev === node.id ? null : node.id));
    },
    [],
  );
  const onMiniPaneClick = useCallback(() => {
    setSelectedMiniId(null);
  }, []);

  // Build mini-layout: ghost focused base blocks at top, detail
  // blocks below, dagre TB. Arrow set spans both layers so the
  // viewer can see where each detail attaches.
  const { nodes, edges } = (() => {
    const ghostNodes = focused.ids
      .map((id) => baseBlocks.find((b) => b.id === id))
      .filter((b): b is DiagramBlock => Boolean(b));

    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: "TB",
      nodesep: 26,
      ranksep: 44,
      marginx: 16,
      marginy: 16,
    });
    g.setDefaultEdgeLabel(() => ({}));

    for (const b of ghostNodes) g.setNode(b.id, { width: 150, height: 44 });
    for (const b of focused.blocks) {
      const isSel = b.id === selectedMiniId;
      g.setNode(b.id, {
        width: isSel ? 220 : 160,
        height: isSel ? estimateMiniExpandedHeight(b) : 56,
      });
    }

    const allIds = new Set<string>([
      ...ghostNodes.map((b) => b.id),
      ...focused.blocks.map((b) => b.id),
    ]);
    for (const a of focused.arrows) {
      if (allIds.has(a.from) && allIds.has(a.to)) g.setEdge(a.from, a.to);
    }
    // If a detail block declares a parent that's a focused base, draw
    // an implicit containment edge so dagre lays it underneath.
    for (const b of focused.blocks) {
      if (b.parent && allIds.has(b.parent)) {
        g.setEdge(b.parent, b.id);
      }
    }
    dagre.layout(g);

    const nodes: Node<MiniNodeData>[] = [
      ...ghostNodes.map<Node<MiniNodeData>>((b) => {
        const pos = g.node(b.id);
        return {
          id: `ghost-${b.id}`,
          type: "mini",
          position: { x: pos.x - 75, y: pos.y - 22 },
          draggable: false,
          data: {
            label: b.label,
            caption: "",
            files: [],
            functions: [],
            isGhost: true,
            isPromoted: false,
            isSelected: false,
            block: null,
            onPromote: null,
            onUnpromote: null,
          },
        };
      }),
      ...focused.blocks.map<Node<MiniNodeData>>((b) => {
        const pos = g.node(b.id);
        const isSel = b.id === selectedMiniId;
        const w = isSel ? 220 : 160;
        const h = isSel ? estimateMiniExpandedHeight(b) : 56;
        return {
          id: b.id,
          type: "mini",
          position: { x: pos.x - w / 2, y: pos.y - h / 2 },
          data: {
            label: b.label,
            caption: b.caption,
            files: b.provenance?.files ?? [],
            functions: b.provenance?.functions ?? [],
            isGhost: false,
            isPromoted: promotedIds.has(b.id),
            isSelected: isSel,
            block: b,
            onPromote,
            onUnpromote,
          },
        };
      }),
    ];

    const idMap = new Map<string, string>();
    for (const b of ghostNodes) idMap.set(b.id, `ghost-${b.id}`);
    for (const b of focused.blocks) idMap.set(b.id, b.id);

    const edges: Edge[] = focused.arrows
      .filter((a) => idMap.has(a.from) && idMap.has(a.to))
      .map((a, i) => ({
        id: `mini-arrow-${a.from}-${a.to}-${i}`,
        source: idMap.get(a.from)!,
        target: idMap.get(a.to)!,
        type: "miniLabeled",
        label: a.label || undefined,
        style: { stroke: "#7B96E8", strokeWidth: 1.25, strokeDasharray: "4,3" },
      }));
    // Containment edges (parent → detail) when no explicit arrow.
    const arrowKey = new Set(
      focused.arrows.map((a) => `${a.from}->${a.to}`),
    );
    for (const b of focused.blocks) {
      if (!b.parent || !idMap.has(b.parent)) continue;
      if (arrowKey.has(`${b.parent}->${b.id}`)) continue;
      edges.push({
        id: `mini-contain-${b.parent}-${b.id}`,
        source: idMap.get(b.parent)!,
        target: b.id,
        type: "smoothstep",
        style: {
          stroke: "#CCCCCC",
          strokeWidth: 1,
          strokeDasharray: "2,3",
        },
      });
    }
    return { nodes, edges };
  })();

  // Fit on every layout change (new detail blocks streaming in,
  // panel resize, promotion removing nodes, click-to-expand).
  useEffect(() => {
    const t = window.setTimeout(() => {
      fitView({ padding: 0.18, duration: 350, maxZoom: 1.3 });
    }, 80);
    return () => window.clearTimeout(t);
  }, [nodes.length, edges.length, selectedMiniId, fitView]);

  // Refit the mini-graph whenever its container size changes, so when
  // the user drags the panel handle the focused subflow stays
  // proportionally scaled and centered instead of clipping at one edge.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    let timer: number | undefined;
    let isFirst = true;
    const ro = new ResizeObserver(() => {
      if (isFirst) {
        isFirst = false;
        return;
      }
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        fitView({ padding: 0.18, duration: 220, maxZoom: 1.3 });
      }, 80);
    });
    ro.observe(el);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      ro.disconnect();
    };
  }, [fitView]);

  return (
    <div ref={wrapperRef} className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={miniNodeTypes}
        edgeTypes={miniEdgeTypes}
        onNodeClick={onMiniNodeClick}
        onPaneClick={onMiniPaneClick}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 1.3 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.4}
        maxZoom={1.6}
        nodesDraggable
        nodesConnectable={false}
        nodesFocusable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
      >
        <Background color="#EFEFEF" gap={14} />
      </ReactFlow>
    </div>
  );
}

export function DiagramViewSwitcher({
  view,
  onChange,
}: {
  view: DiagramView;
  onChange: (v: DiagramView) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as globalThis.Node | null;
      if (ref.current && target && !ref.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md border border-[#484848]/15 bg-white/70 px-2.5 py-1 text-xs font-medium tracking-tight text-[#484848] shadow-sm transition-colors hover:bg-white"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{DIAGRAM_VIEW_LABELS[view]}</span>
        <ChevronDown
          className={`h-3 w-3 text-[#484848]/60 transition-transform ${
            open ? "rotate-180" : ""
          }`}
          strokeWidth={2}
        />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full z-10 mt-1.5 w-48 overflow-hidden rounded-md border border-[#484848]/10 bg-white shadow-lg"
        >
          {(Object.keys(DIAGRAM_VIEW_LABELS) as DiagramView[]).map((v) => {
            const selected = v === view;
            return (
              <button
                key={v}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(v);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-[#F4F4F4] ${
                  selected
                    ? "font-medium text-[#484848]"
                    : "text-[#484848]/80"
                }`}
              >
                <span>{DIAGRAM_VIEW_LABELS[v]}</span>
                {selected && (
                  <Check
                    className="h-3 w-3 text-[#484848]"
                    strokeWidth={2.5}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DiagramFetchOverlay({
  state,
  hasFiles,
  nodeCount,
  onRetry,
}: {
  state: FetchState;
  hasFiles: boolean;
  nodeCount: number;
  onRetry: () => void;
}) {
  if (!hasFiles) return null;

  if (state.kind === "loading") {
    // Once any blocks have arrived, drop the full-canvas blur so the
    // user can actually see what's been generated. Replace it with a
    // small bottom-right chip indicating Claude is still streaming.
    if (nodeCount > 0) {
      return (
        <div className="pointer-events-none absolute bottom-3 right-3 z-50 flex items-center gap-2 rounded-full border border-[#D4D4D4] bg-white/95 px-3 py-1.5 text-xs text-[#484848] shadow-md">
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
          <span>Generating more — {nodeCount} so far</span>
          <ElapsedClock startedAt={state.startedAt} />
        </div>
      );
    }
    return (
      <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-white/40 backdrop-blur-[1px]">
        <DiagramLoadingCard startedAt={state.startedAt} />
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center px-4">
        <div className="flex max-w-md flex-col items-center gap-3 rounded-lg border border-red-200 bg-white px-6 py-4 shadow-md">
          <AlertCircle className="h-5 w-5 text-red-500" strokeWidth={2} />
          <span className="text-center text-sm text-[#484848]">
            {state.message}
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md bg-[#484848] px-3 py-1 text-xs font-medium text-white hover:bg-[#222]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return null;
}

function ElapsedClock({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const sec = Math.floor((now - startedAt) / 1000);
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  const time = mm > 0 ? `${mm}:${String(ss).padStart(2, "0")}` : `${ss}s`;
  return (
    <span className="tabular-nums text-[#484848]/70">{time}</span>
  );
}

function DiagramLoadingCard({ startedAt }: { startedAt: number }) {
  return (
    <div className="flex w-72 flex-col items-center gap-3 rounded-lg bg-white px-6 py-4 text-[#484848] shadow-lg">
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
        <span className="font-medium">Claude is drawing the diagram…</span>
      </div>
      <div className="flex w-full items-center justify-between text-xs text-[#484848]/70">
        <span>Reading project — first block usually in 5 seconds</span>
        <ElapsedClock startedAt={startedAt} />
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-[#EAEAEA]">
        <div className="h-full w-1/3 animate-[loading-bar_1.4s_ease-in-out_infinite] rounded-full bg-[#484848]/60" />
      </div>
    </div>
  );
}

/**
 * Floating panel pinned to the bottom-center of the diagram canvas
 * once Claude has proposed options for a freshly-pulled arrow. The
 * user picks one (block_level / detail / no change) or types a free-
 * form description into the "Others" card; both paths feed back into
 * `onPick(option)` so the parent can fire the round-2 execute prompt.
 *
 * Floating overlay over the canvas (not anchored at the arrow midpoint)
 * — keeps clear of overlapping blocks and stays predictable while the
 * marching-ants arrow visually links it to the diagram.
 */
function ConnectionOptionsOverlay({
  target,
  options,
  blocks,
  onPick,
  onCancel,
}: {
  target: EditTarget;
  options: ConnectionOption[];
  blocks: DiagramBlock[];
  onPick: (option: ConnectionOption) => void;
  onCancel: () => void;
}) {
  const [otherText, setOtherText] = useState("");
  const [othersExpanded, setOthersExpanded] = useState(false);

  const submitOthers = () => {
    const trimmed = otherText.trim();
    if (trimmed.length === 0) return;
    // We don't know the kind yet — let Claude decide what fits.
    // Default to "detail" so any pending arrow gets removed; if Claude
    // actually adds a block-level link, the auto-regen after Claude's
    // turn will surface it again.
    onPick({
      title: trimmed,
      detail: "User-described change.",
      kind: "detail",
    });
  };

  // Build the contextual header based on target kind.
  let headerEyebrow: string;
  let headerLine: ReactNode;
  if (target.kind === "arrow") {
    const fromBlock = blocks.find((b) => b.id === target.from);
    const toBlock = blocks.find((b) => b.id === target.to);
    headerEyebrow = "Pick a change";
    headerLine = (
      <>
        for connection{" "}
        <span className="font-semibold">
          {fromBlock?.label ?? target.from}
        </span>{" "}
        →{" "}
        <span className="font-semibold">{toBlock?.label ?? target.to}</span>
      </>
    );
  } else if (target.kind === "block") {
    const block = blocks.find((b) => b.id === target.id);
    headerEyebrow = "Pick a block action";
    headerLine = (
      <>
        for block{" "}
        <span className="font-semibold">{block?.label ?? target.id}</span>
      </>
    );
  } else {
    headerEyebrow = "Pick a new module";
    headerLine = <>to add to the project</>;
  }

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-[#0F172A]/30 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        // Clicking the backdrop cancels (only when the click landed
        // on the backdrop itself, not inside the panel).
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="w-[min(760px,calc(100%-48px))] rounded-2xl border border-[#3B5BD9]/30 bg-white p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[#3B5BD9]">
              {headerEyebrow}
            </div>
            <div className="mt-0.5 text-[14px] text-[#222222]">
              {headerLine}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            title="Cancel (remove arrow)"
            className="rounded-md border border-[#D4D4D4] bg-white px-2 py-1 text-[12px] text-[#666666] hover:bg-[#FAFAFA]"
          >
            ✕
          </button>
        </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((opt, i) => (
          <OptionCardButton key={i} option={opt} onClick={() => onPick(opt)} />
        ))}
        {/* "Others" card: expand to text input, submit free-form intent. */}
        <div
          className={`flex flex-col items-start gap-1.5 rounded-lg border border-dashed border-[#D4D4D4] bg-[#FAFAFA] px-3 py-2 ${
            othersExpanded ? "" : "cursor-pointer hover:bg-[#F4F7FF]"
          }`}
          onClick={() => {
            if (!othersExpanded) setOthersExpanded(true);
          }}
        >
          <div className="flex w-full items-center gap-2">
            <span className="shrink-0 rounded border border-[#D4D4D4] px-1 py-px font-mono text-[9px] uppercase tracking-wider text-[#666666]">
              others
            </span>
            <span className="text-sm font-medium text-[#222222]">
              Something else…
            </span>
          </div>
          {othersExpanded ? (
            <>
              <input
                autoFocus
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitOthers();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setOthersExpanded(false);
                    setOtherText("");
                  }
                }}
                placeholder="Describe what you want Claude to do for this arrow"
                className="w-full rounded-md border border-[#D4D4D4] bg-white px-2 py-1 text-[12px] text-[#222222] outline-none focus:border-[#3B5BD9]"
              />
              <div className="flex w-full items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setOthersExpanded(false);
                    setOtherText("");
                  }}
                  className="rounded-md border border-[#D4D4D4] bg-white px-2 py-0.5 text-[11px] text-[#666666] hover:bg-[#FAFAFA]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitOthers}
                  disabled={otherText.trim().length === 0}
                  className="rounded-md bg-[#3B5BD9] px-2.5 py-0.5 text-[11px] font-medium text-white shadow-sm hover:bg-[#2E48B3] disabled:cursor-not-allowed disabled:bg-[#9CA3AF]"
                >
                  Send ↵
                </button>
              </div>
            </>
          ) : (
            <div className="text-xs text-[#666666]">
              Describe a custom change in your own words.
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

/**
 * Pre-suggestions gate: pops the moment a user action lands on the
 * canvas (arrow drop, block ⋯, "+" / dbl-click pane). Two paths:
 *
 *   - "Describe yourself" expands into a text input. Submitting jumps
 *     straight to round-2 execute (skips the suggestions round-trip,
 *     fastest path for users who already know what they want).
 *   - "Ask Claude for suggestions" dispatches round-1; cards land in
 *     the cards overlay when Claude responds.
 *
 * Backdrop click cancels (and removes any pending placeholder via the
 * parent's removeTargetVisual). Centered modal so it doesn't fight
 * with overlapping blocks like the older arrow-midpoint popover did.
 */
function IntentGate({
  target,
  blocks,
  onAskSuggestions,
  onDescribe,
  onCancel,
}: {
  target: EditTarget;
  blocks: DiagramBlock[];
  onAskSuggestions: () => void;
  onDescribe: (text: string) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"choose" | "describe">("choose");
  const [text, setText] = useState("");

  let eyebrow: string;
  let line: ReactNode;
  if (target.kind === "arrow") {
    const from = blocks.find((b) => b.id === target.from);
    const to = blocks.find((b) => b.id === target.to);
    eyebrow = "New connection";
    line = (
      <>
        <span className="font-semibold">{from?.label ?? target.from}</span>
        {" → "}
        <span className="font-semibold">{to?.label ?? target.to}</span>
      </>
    );
  } else if (target.kind === "block") {
    const b = blocks.find((bk) => bk.id === target.id);
    eyebrow = "Block action";
    line = (
      <>
        on{" "}
        <span className="font-semibold">{b?.label ?? target.id}</span>
      </>
    );
  } else {
    eyebrow = "New module";
    line = <>add something to the project</>;
  }

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-[#0F172A]/30 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="w-[min(480px,calc(100%-48px))] rounded-2xl border border-[#3B5BD9]/30 bg-white p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[#3B5BD9]">
              {eyebrow}
            </div>
            <div className="mt-0.5 text-[14px] text-[#222222]">{line}</div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            title="Cancel"
            className="rounded-md border border-[#D4D4D4] bg-white px-2 py-1 text-[12px] text-[#666666] hover:bg-[#FAFAFA]"
          >
            ✕
          </button>
        </div>

        {mode === "choose" ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode("describe")}
              className="flex flex-col items-start gap-1 rounded-lg border border-[#D4D4D4] bg-white px-3 py-2.5 text-left hover:border-[#3B5BD9]/40 hover:bg-[#F4F7FF]"
            >
              <span className="text-sm font-semibold text-[#222222]">
                Describe it yourself
              </span>
              <span className="text-xs text-[#666666]">
                You already know what you want — type it.
              </span>
            </button>
            <button
              type="button"
              onClick={onAskSuggestions}
              className="flex flex-col items-start gap-1 rounded-lg border border-[#3B5BD9]/40 bg-[#F4F7FF] px-3 py-2.5 text-left hover:bg-[#E6EEFF]"
            >
              <span className="text-sm font-semibold text-[#3B5BD9]">
                Ask Claude for suggestions
              </span>
              <span className="text-xs text-[#3B5BD9]/80">
                Get a few options to pick from.
              </span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  onDescribe(text);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setMode("choose");
                  setText("");
                }
              }}
              placeholder="What do you want done? (⌘↩ to send)"
              rows={3}
              className="w-full resize-none rounded-md border border-[#D4D4D4] bg-white px-2.5 py-1.5 text-[13px] text-[#222222] outline-none focus:border-[#3B5BD9]"
            />
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setMode("choose");
                  setText("");
                }}
                className="rounded-md border border-[#D4D4D4] bg-white px-2.5 py-1 text-[12px] text-[#666666] hover:bg-[#FAFAFA]"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => onDescribe(text)}
                disabled={text.trim().length === 0}
                className="rounded-md bg-[#3B5BD9] px-3 py-1 text-[12px] font-medium text-white shadow-sm hover:bg-[#2E48B3] disabled:cursor-not-allowed disabled:bg-[#9CA3AF]"
              >
                Send ⌘↩
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function OptionCardButton({
  option,
  onClick,
}: {
  option: ConnectionOption;
  onClick: () => void;
}) {
  const kindStyles =
    option.kind === "block_level"
      ? "border-[#3B5BD9]/40 text-[#3B5BD9]"
      : option.kind === "detail"
        ? "border-[#A56C2E]/40 text-[#A56C2E]"
        : "border-[#666666]/40 text-[#666666]";
  const kindLabel =
    option.kind === "block_level"
      ? `link · ${option.label ?? "?"}`
      : option.kind === "detail"
        ? "detail"
        : "no change";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-1 rounded-lg border border-[#D4D4D4] bg-white px-3 py-2 text-left transition-colors hover:border-[#3B5BD9]/40 hover:bg-[#F4F7FF]"
    >
      <div className="flex w-full items-center gap-2">
        <span
          className={`shrink-0 rounded border px-1 py-px font-mono text-[9px] uppercase tracking-wider ${kindStyles}`}
        >
          {kindLabel}
        </span>
        <span className="text-sm font-medium text-[#222222]">
          {option.title}
        </span>
      </div>
      <div className="text-xs text-[#666666]">{option.detail}</div>
    </button>
  );
}
