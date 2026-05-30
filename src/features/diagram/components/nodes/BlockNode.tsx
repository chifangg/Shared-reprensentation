import { useEffect, useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { MoreHorizontal } from "lucide-react";
import type { BlockNodeData } from "../../types";
import { NODE_H, NODE_W } from "../../layout/constants";
import { categoryStyle } from "../../util/blockCategory";

/**
 * Custom React Flow node renderer for a diagram block.
 *
 * Pulls its visual state from the typed `data` prop (label, caption,
 * provenance counts, focus / pending / recent-change flags) and renders
 * a card with inline rename, four connection handles, and a "⋯" action
 * affordance that appears on hover.
 *
 * Behavior surface owned by the caller and threaded through
 * `data.onLabelChange` / `data.onActions`:
 *  - onLabelChange: commits a rename (called on Enter or blur with a
 *    trimmed, non-empty, changed label). Triggers the slow-path chat
 *    flow that asks Claude to rewrite the corresponding identifier in
 *    source.
 *  - onActions: opens the block-level cards overlay.
 */
export function BlockNode({ data, selected }: NodeProps<Node<BlockNodeData>>) {
  const fileCount = data.files.length;
  const fnCount = data.functions.length;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);
  // Sync draft with external label updates (e.g. diagram regenerated)
  // when we're not actively editing.
  useEffect(() => {
    if (!editing) setDraft(data.label);
  }, [data.label, editing]);

  const commit = () => {
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === data.label) {
      setDraft(data.label);
      return;
    }
    data.onLabelChange?.(trimmed);
  };
  const cancel = () => {
    setDraft(data.label);
    setEditing(false);
  };

  const ring = data.isPending
    ? "pending-block-pulse"
    : data.isRecentlyAdded
      ? "recent-change-block"
      : data.isFocused
        ? "ring-[3px] ring-[#F59E0B] focus-pulse"
        : selected
          ? "ring-2 ring-[#78716C]/40 shadow-xl"
          : "shadow-sm hover:shadow-md";
  const borderColor = data.isPending
    ? "border-2 border-dashed border-[#78716C] bg-[#F5F5F4]"
    : data.isContainer
      ? "border-[#78716C]/40 bg-[#F5F5F4]"
      : "border-[#D4D4D4]";
  const dim = data.isDimmed
    ? "opacity-30 saturate-50 transition-opacity duration-300"
    : "opacity-100 transition-opacity duration-300";
  // Category color-coding applies only to ordinary blocks. Pending
  // placeholders and container frames keep their own distinct framing so
  // the tint doesn't muddy those states. Inline style so it overrides
  // the base `bg-white` + neutral border classes; the accent rides on
  // the left edge as a chunking cue.
  const cat =
    !data.isPending && !data.isContainer
      ? categoryStyle(data.category)
      : null;
  const catStyle = cat
    ? {
        backgroundColor: cat.tint,
        borderColor: cat.accent,
        borderLeftWidth: 4,
      }
    : undefined;
  return (
    <div
      className={`block-node-grow group/block relative rounded-lg border bg-white px-3 py-2 transition-all ${borderColor} ${ring} ${dim}`}
      style={{ width: NODE_W, minHeight: NODE_H, ...catStyle }}
    >
      {/* Per-block action affordance ("⋯") — appears at top-right on
       *  block hover, opens the cards overlay so the user can pick a
       *  Claude-proposed change scoped to this block. Stops click +
       *  mousedown propagation so React Flow doesn't treat it as a
       *  node drag / selection. */}
      {data.onActions && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            data.onActions?.();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          title="Block actions"
          className="absolute -right-2 -top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-[#D4D4D4] bg-white text-[#666666] opacity-0 shadow-sm transition-opacity hover:bg-[#F5F5F4] hover:text-[#78716C] group-hover/block:opacity-100"
        >
          <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      )}
      {/* Four connection handles, one per side. All declared as
       *  type="source" — combined with ConnectionMode.Loose on the
       *  parent ReactFlow, each handle can act as either source or
       *  target of a user-drawn connection. Programmatic edges from
       *  layoutSchema set sourceHandle="b" / targetHandle="t" so
       *  auto-laid arrows still flow top-to-bottom under the dagre TB
       *  layout. The visible dot is small at rest; on block hover all
       *  four sides grow + tint so users can see the affordance. */}
      <Handle
        id="t"
        type="source"
        position={Position.Top}
        className="!h-3 !w-3 !-translate-y-1/2 !border-2 !border-white !bg-[#999999] opacity-60 transition-all group-hover/block:!h-4 group-hover/block:!w-4 group-hover/block:!bg-[#78716C] group-hover/block:opacity-100"
      />
      <Handle
        id="r"
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !translate-x-1/2 !border-2 !border-white !bg-[#999999] opacity-60 transition-all group-hover/block:!h-4 group-hover/block:!w-4 group-hover/block:!bg-[#78716C] group-hover/block:opacity-100"
      />
      <Handle
        id="l"
        type="source"
        position={Position.Left}
        className="!h-3 !w-3 !-translate-x-1/2 !border-2 !border-white !bg-[#999999] opacity-60 transition-all group-hover/block:!h-4 group-hover/block:!w-4 group-hover/block:!bg-[#78716C] group-hover/block:opacity-100"
      />
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={commit}
          // Don't let React Flow grab the click and trigger selection.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="w-full rounded border border-[#78716C]/40 bg-white px-1.5 py-0.5 text-sm font-semibold leading-tight text-[#222222] outline-none focus:border-[#78716C]"
        />
      ) : (
        <div
          className="text-sm font-semibold leading-tight text-[#222222] cursor-text"
          title={data.onLabelChange ? "Double-click to rename" : undefined}
          onDoubleClick={(e) => {
            if (!data.onLabelChange) return;
            e.stopPropagation();
            setEditing(true);
          }}
        >
          {data.label}
        </div>
      )}
      {data.caption && (
        <div
          className={`mt-1 text-[11px] leading-snug text-[#666666] ${
            selected ? "" : "line-clamp-2"
          }`}
        >
          {data.caption}
        </div>
      )}
      {(fileCount > 0 || fnCount > 0) && (
        <div
          className="mt-1.5 text-[10px] uppercase tracking-wide text-[#999999]"
          // Hover-tooltip lists actual file names + first few functions.
          // We dropped the in-block expanded lists — they crowded the
          // node and were hard to read at this scale; the hover gives
          // the same info on demand without taking layout space.
          title={[
            fileCount > 0 ? `Files:\n${data.files.join("\n")}` : "",
            fnCount > 0
              ? `Functions:\n${data.functions.slice(0, 12).join(", ")}${
                  fnCount > 12 ? ` (+${fnCount - 12} more)` : ""
                }`
              : "",
          ]
            .filter(Boolean)
            .join("\n\n")}
        >
          {fileCount > 0 && (
            <>
              {fileCount} {fileCount === 1 ? "file" : "files"}
            </>
          )}
          {fileCount > 0 && fnCount > 0 && " · "}
          {fnCount > 0 && (
            <>
              {fnCount} {fnCount === 1 ? "fn" : "fns"}
            </>
          )}
        </div>
      )}
      <Handle
        id="b"
        type="source"
        position={Position.Bottom}
        className="!h-3 !w-3 !translate-y-1/2 !border-2 !border-white !bg-[#999999] opacity-60 transition-all group-hover/block:!h-4 group-hover/block:!w-4 group-hover/block:!bg-[#78716C] group-hover/block:opacity-100"
      />
    </div>
  );
}

import { FunctionBubble } from "./FunctionBubble";
import { BubbleSector } from "./BubbleSector";

/**
 * Stable nodeType registry passed to ReactFlow. Module-level so the
 * object identity doesn't change between renders — React Flow warns
 * about "It looks like you've created a new nodeTypes" otherwise.
 */
export const nodeTypes = {
  block: BlockNode,
  bubble: FunctionBubble,
  bubbleSector: BubbleSector,
};
