import { memo, type CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Palette } from "lucide-react";
import type { BubbleNodeData } from "../../types";

/**
 * Fixed-size circular bubble surfacing one entry of a block's
 * `provenance.functions`. The displayed label is a humanized version
 * (e.g. "Download image"); the raw identifier lives on the tooltip
 * for the edit-flow that needs to match source code.
 *
 * The synthetic appearance bubble (`kind === "appearance"`) renders
 * distinctly (palette icon, gold ring) so it reads as "restyle this
 * surface", not as one of the function capabilities.
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
  const anim = data.isExiting ? "bubble-exit" : "bubble-enter";

  if (data.kind === "appearance") {
    return (
      <div
        className={`flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-full border border-[#C9B58E] bg-[#F7F2E6] text-center shadow-sm transition-colors hover:border-[#B8995A] hover:bg-[#F1E8D2] ${anim}`}
        style={animStyle}
        title="Edit appearance"
      >
        <Palette className="h-4 w-4 text-[#A0894F]" strokeWidth={2} />
        <span className="text-[11px] font-medium leading-tight text-[#A0894F]">
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

  return (
    <div
      className={`flex h-20 w-20 cursor-pointer items-center justify-center rounded-full border border-[#E8DDC4] bg-[#F5EFE0] text-center shadow-sm transition-colors hover:border-[#C9B58E] hover:bg-[#EFE5D0] ${anim}`}
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
