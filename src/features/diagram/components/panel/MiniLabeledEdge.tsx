import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";

/**
 * Mini-graph variant of LabeledEdge — smaller pill, blue-on-white
 * styling for the focus side-panel context.
 */
export function MiniLabeledEdge({
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

/** Stable edgeType registry for the focus mini graph. */
export const miniEdgeTypes = { miniLabeled: MiniLabeledEdge };
