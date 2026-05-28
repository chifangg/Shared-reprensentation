import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { BubbleSectorNodeData } from "../../types";

/**
 * Faint annular-sector fill drawn BEHIND the bubble cluster. Acts as a
 * visual "the bubbles came from here" hint so the user doesn't lose
 * track of which block the cluster attaches to after the viewport has
 * zoomed in.
 *
 * Sized so its bounding box (2*outerRadius square) is centered on the
 * parent block — the hook positions it accordingly. SVG path is drawn
 * with its origin at the SVG's center.
 *
 * Animation is a simple fade + scale, slower-paced than the bubble pop
 * so the sector reads as "ambient" rather than competing for attention.
 */
function buildAnnularSectorPath(
  cx: number,
  cy: number,
  rIn: number,
  rOut: number,
  startDeg: number,
  endDeg: number,
): string {
  const polar = (r: number, deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  const a = polar(rOut, startDeg);
  const b = polar(rOut, endDeg);
  const c = polar(rIn, endDeg);
  const d = polar(rIn, startDeg);
  return (
    `M ${a.x} ${a.y} ` +
    `A ${rOut} ${rOut} 0 ${largeArc} 1 ${b.x} ${b.y} ` +
    `L ${c.x} ${c.y} ` +
    `A ${rIn} ${rIn} 0 ${largeArc} 0 ${d.x} ${d.y} Z`
  );
}

function BubbleSectorImpl({
  data,
}: NodeProps & { data: BubbleSectorNodeData }) {
  const { outerRadius, innerRadius, startDeg, endDeg, isExiting } = data;
  const size = outerRadius * 2;
  const path = buildAnnularSectorPath(
    outerRadius,
    outerRadius,
    innerRadius,
    outerRadius,
    startDeg,
    endDeg,
  );

  // Gradient origin is the SVG center, which is also the block center
  // (the hook positions this node so its bounding box centers on the
  // block). Inner edge of the sector starts at innerRadius/outerRadius
  // along the radial axis — we drop the gradient to fully-transparent
  // at the outer edge so the sector feathers into the canvas instead
  // of ending in a hard line.
  const innerStop = innerRadius / outerRadius;
  const gradientId = `bubble-sector-grad-${data.parentBlockId}`;
  return (
    <svg
      width={size}
      height={size}
      className={`pointer-events-none ${
        isExiting ? "bubble-sector-exit" : "bubble-sector-enter"
      }`}
      style={{ overflow: "visible" }}
    >
      <defs>
        <radialGradient id={gradientId} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#F2E9D5" stopOpacity="0.9" />
          <stop
            offset={innerStop.toFixed(3)}
            stopColor="#F2E9D5"
            stopOpacity="0.85"
          />
          <stop offset="0.78" stopColor="#F5EFE0" stopOpacity="0.4" />
          <stop offset="1" stopColor="#F5EFE0" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d={path} fill={`url(#${gradientId})`} />
    </svg>
  );
}

export const BubbleSector = memo(BubbleSectorImpl);
