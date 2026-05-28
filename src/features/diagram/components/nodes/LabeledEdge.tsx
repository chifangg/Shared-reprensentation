import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";

/**
 * Custom React Flow edge renderer for a labeled, smooth-stepped arrow.
 *
 * Wraps BaseEdge with an EdgeLabelRenderer that places a rounded label
 * pill at the path midpoint. The label styling switches to a blue
 * variant when `data.recent === true` (used during the recent-change
 * glow after Claude adds new dependencies).
 *
 * Pending arrows (the marching-ants ones the user just pulled) are
 * styled via the `pending-edge` CSS class set by layoutSchema; this
 * component just forwards that className to BaseEdge so the keyframe
 * animation lands on the SVG path.
 */
export function LabeledEdge({
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
  data,
  ...rest
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  // ReactFlow puts the edge's `className` on `rest.className`-ish props;
  // pass it through to BaseEdge so a class like `pending-edge` lands on
  // the SVG path and the marching-ants keyframe animation applies.
  const className = (rest as { className?: string }).className;
  const recent = (data as { recent?: boolean } | undefined)?.recent === true;
  const labelClass = recent
    ? "pointer-events-none absolute rounded-md border border-[#78716C] bg-[#F5F5F4] px-2 py-0.5 text-[11px] font-medium text-[#78716C] shadow-sm"
    : "pointer-events-none absolute rounded-md border border-[#D4D4D4] bg-white px-2 py-0.5 text-[11px] font-medium text-[#444444] shadow-sm";

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={style}
        markerEnd={markerEnd}
        className={className}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            className={labelClass}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              // React Flow renders the edge layer below the node layer,
              // so labels positioned near blocks get visually swallowed.
              // Pop them above nodes (~10) but below modal overlays (1000).
              zIndex: 20,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/**
 * Stable edgeType registry passed to ReactFlow. Module-level so the
 * object identity doesn't change between renders.
 */
export const edgeTypes = { labeled: LabeledEdge };
