import { memo, type CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { BubbleNodeData } from "../../types";

/**
 * Fixed-size circular bubble surfacing one entry of a block's
 * `provenance.functions`. The displayed label is a humanized version
 * (e.g. "Download image"); the raw identifier lives on the tooltip
 * for the future edit-flow that needs to match source code.
 *
 * Entry/exit animation uses CSS custom properties so each bubble can
 * tween FROM the parent block's center (the `--enter-dx, --enter-dy`
 * offset) to its own final position. See `.bubble-enter` /
 * `.bubble-exit` keyframes in styles.css.
 */
function FunctionBubbleImpl({ data }: NodeProps & { data: BubbleNodeData }) {
  const animStyle = {
    "--enter-dx": `${data.enterDx}px`,
    "--enter-dy": `${data.enterDy}px`,
  } as CSSProperties;
  return (
    <div
      className={`flex h-20 w-20 cursor-pointer items-center justify-center rounded-full border border-[#E8DDC4] bg-[#F5EFE0] text-center shadow-sm transition-colors hover:border-[#C9B58E] hover:bg-[#EFE5D0] ${
        data.isExiting ? "bubble-exit" : "bubble-enter"
      }`}
      style={animStyle}
      title={data.label}
    >
      <span className="break-words px-1.5 text-[11px] font-medium leading-tight text-[#5C5040]">
        {data.displayLabel}
      </span>
      <Handle
        type="target"
        position={Position.Left}
        style={{ opacity: 0, pointerEvents: "none" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ opacity: 0, pointerEvents: "none" }}
      />
    </div>
  );
}

export const FunctionBubble = memo(FunctionBubbleImpl);
