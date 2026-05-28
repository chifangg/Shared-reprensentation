import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Check, Plus, X } from "lucide-react";
import type { MiniNodeData } from "../../types";

/**
 * Smaller variant of BlockNode for the focus side-panel's mini graph.
 *
 * Two render modes driven by `data.isGhost`:
 *  - ghost: dim re-stamp of a focused base block, sitting at the top
 *    of the mini graph; not selectable, not promotable.
 *  - detail: real focus-fetched block; click expands to show full file
 *    + function lists; promote/unpromote button at top-right.
 */
export function MiniBlockNode({ data }: NodeProps<Node<MiniNodeData>>) {
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
          ? "ring-2 ring-[#78716C]/50 shadow-lg z-10"
          : ""
      } ${
        data.isPromoted
          ? "border-[#78716C]/50 bg-[#F5F5F4]"
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
              ? "border-[#78716C]/40 bg-[#78716C] text-white hover:border-red-400 hover:bg-red-500"
              : "border-[#D4D4D4] bg-white text-[#666666] opacity-0 group-hover:opacity-100 hover:border-[#78716C] hover:text-[#78716C]"
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

/** Stable nodeType registry for the focus mini graph. */
export const miniNodeTypes = { mini: MiniBlockNode };
