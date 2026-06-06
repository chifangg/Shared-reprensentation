import { memo, type CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { BubbleNodeData } from "../../types";
import { BUBBLE_HALF_SIZE } from "../../layout/bubbleNodes";

/**
 * One satellite in a block's drill-in fan: a round bubble surfacing a
 * single plain-language capability (e.g. "Render chat turns as HTML").
 *
 * Shape note: a circle is the intended look. To keep multi-word phrases
 * from wrapping to one or two words per line, the radius is generous and
 * the font small rather than reshaping the bubble. Diameter is fixed
 * (BUBBLE_HALF_SIZE * 2) so the fan geometry in `bubbleNodes` /
 * `bubbleLayout` stays a clean center-to-center spacing problem.
 *
 * Entry/exit animation uses CSS custom properties so each bubble can
 * tween FROM the parent block's center (the `--enter-dx, --enter-dy`
 * offset) to its own final position. See `.bubble-enter` / `.bubble-exit`
 * keyframes in styles.css.
 */
function FunctionBubbleImpl({ data }: NodeProps & { data: BubbleNodeData }) {
  const animStyle = {
    "--enter-dx": `${data.enterDx}px`,
    "--enter-dy": `${data.enterDy}px`,
    width: BUBBLE_HALF_SIZE * 2,
    height: BUBBLE_HALF_SIZE * 2,
  } as CSSProperties;
  return (
    <div
      className={`flex cursor-pointer items-center justify-center rounded-full border border-[#E8DDC4] bg-[#F5EFE0] text-center shadow-sm transition-colors hover:border-[#C9B58E] hover:bg-[#EFE5D0] ${
        data.isExiting ? "bubble-exit" : "bubble-enter"
      }`}
      style={animStyle}
      title={data.label}
    >
      <span className="line-clamp-4 break-words px-2 text-[10px] font-medium leading-[1.2] text-[#5C5040]">
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
