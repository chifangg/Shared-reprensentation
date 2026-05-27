/**
 * Type definitions for the diagram feature.
 *
 * Pure types only — no React imports, no runtime side effects. This
 * module is the leaf of the diagram feature's dependency graph, so it
 * can be imported from anywhere (chat-side bridge, layout engine,
 * prompt builders, components) without pulling in `@xyflow/react` or
 * `@dagrejs/dagre`. Keep it that way.
 *
 * The small `serializeTarget` helper and `DIAGRAM_VIEW_LABELS` const
 * live here because they're tightly bound to the type definitions
 * above them — moving them out would require importing a type just to
 * stringify it.
 */

// ---------------------------------------------------------------------------
// Diagram views
// ---------------------------------------------------------------------------

export type DiagramView = "overview" | "focus";

export const DIAGRAM_VIEW_LABELS: Record<DiagramView, string> = {
  overview: "Project overview",
  focus: "Adaptive focus",
};

// ---------------------------------------------------------------------------
// Diagram schema (the structure the canvas renders)
// ---------------------------------------------------------------------------

export type DiagramSchema = {
  blocks: DiagramBlock[];
  arrows: DiagramArrow[];
};

export type DiagramBlock = {
  id: string;
  label: string;
  caption: string;
  parent: string | null;
  provenance: { files: string[]; functions: string[] };
  /** Local-only marker for blocks the user just asked to create. Renders
   *  with a dashed blue border + marching-ants so it's obvious "this
   *  hasn't been scaffolded yet". Cleared once the auto-regen after
   *  Claude finishes replaces the placeholder with a real block. */
  pending?: boolean;
};

export type DiagramArrow = {
  from: string;
  to: string;
  label: string;
  /** Two-stage marker for arrows the user just pulled via hover-drag:
   *  - "intent": popover is open; user is describing what the arrow
   *    should mean (or hasn't clicked anything yet). Edge renders with
   *    the inline popover + marching-ants dashed blue stroke.
   *  - "claude": popover dismissed (submit/skip); Claude is reacting.
   *    Edge renders marching-ants dashed blue, no popover.
   *  - undefined: settled, regular arrow.
   *  Pending arrows survive focus dimming so the user's edit doesn't
   *  fade out while Claude is processing. Server never sets this. */
  pending?: "intent" | "claude";
};

// ---------------------------------------------------------------------------
// Fetch lifecycle (used by useDiagramStructureFetch + DiagramFetchOverlay)
// ---------------------------------------------------------------------------

export type FetchState =
  | { kind: "idle" }
  | { kind: "loading"; startedAt: number }
  | { kind: "ready"; schema: DiagramSchema }
  | { kind: "error"; message: string };

// ---------------------------------------------------------------------------
// Visual-edit targets and options (the chat ↔ diagram protocol payloads)
// ---------------------------------------------------------------------------

/**
 * What kind of diagram element this visual-edit round is targeting.
 * Three kinds share the same cards-and-execute pipeline:
 *   - arrow: user just pulled a new connection between two blocks
 *   - block: user clicked the "actions" affordance on an existing block
 *   - new-block: user asked to create a new module from blank canvas
 */
export type EditTarget =
  | { kind: "arrow"; from: string; to: string }
  | { kind: "block"; id: string }
  | { kind: "new-block" };

export function serializeTarget(t: EditTarget): string {
  switch (t.kind) {
    case "arrow":
      return `arrow:${t.from}->${t.to}`;
    case "block":
      return `block:${t.id}`;
    case "new-block":
      return `new-block`;
  }
}

export interface ConnectionOption {
  title: string;
  detail: string;
  kind: "block_level" | "detail" | "none";
  /** Arrow label to apply when kind="block_level". Only meaningful when
   *  target.kind === "arrow". Optional otherwise. */
  label?: string;
}

// ---------------------------------------------------------------------------
// Event detail payloads (carried by the four chat ↔ diagram events)
// ---------------------------------------------------------------------------

export interface VisualEditDetail {
  /** Pre-formatted user-message prompt ChatView will send verbatim. */
  prompt: string;
  /** Short label for UI (e.g. "Renamed block"). Currently unused but
   *  reserved for future styling of visual-edit bubbles. */
  kind: string;
}

export interface OptionsReadyDetail {
  target: EditTarget;
  options: ConnectionOption[];
}

export interface OptionExecutedDetail {
  target: EditTarget;
  option: ConnectionOption;
}

export interface ArrowsAddedDetail {
  arrows: Array<{ from: string; to: string; label: string }>;
}

// ---------------------------------------------------------------------------
// React Flow node data shapes (consumed by BlockNode + MiniBlockNode)
// ---------------------------------------------------------------------------

export type BlockNodeData = {
  label: string;
  caption: string;
  files: string[];
  functions: string[];
  isContainer: boolean;
  isFocused: boolean;
  isDimmed: boolean;
  /** User-asked-for placeholder waiting for Claude to scaffold. Renders
   *  with marching-ants dashed blue border instead of normal frame. */
  isPending: boolean;
  /** Block didn't exist before the most recent auto-regen — i.e. Claude
   *  just created it. Renders a one-shot blue glow that fades after
   *  ~3.5s so the user can see WHAT got added during the regen. */
  isRecentlyAdded: boolean;
  /** Commit a new label. Triggers local schema update + slow-path chat
   *  message so Claude rewrites the corresponding code. */
  onLabelChange?: (newLabel: string) => void;
  /** Open the block-level action menu (cards overlay) for this block.
   *  Wired on the canvas via attachInteractive. */
  onActions?: () => void;
};

export type MiniNodeData = {
  label: string;
  caption: string;
  files: string[];
  functions: string[];
  isGhost: boolean;
  isPromoted: boolean;
  isSelected: boolean;
  block: DiagramBlock | null;
  onPromote: ((b: DiagramBlock) => void) | null;
  onUnpromote: ((b: DiagramBlock) => void) | null;
};
