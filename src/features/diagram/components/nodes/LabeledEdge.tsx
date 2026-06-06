import { useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useNodes,
  type EdgeProps,
} from "@xyflow/react";
import { useDiagramBus } from "../../protocol/bus";
import { NODE_W, NODE_H } from "../../layout/constants";

/**
 * Custom React Flow edge renderer for a labeled, smooth-stepped arrow.
 *
 * The label pill is placed BESIDE its line (to the side, not centered on
 * it) so it does not sit on top of the arrow. On hover it emphasizes its
 * own line (thicker, darker) so, when pills bunch up near a junction, you
 * can tell which line a pill belongs to and which way it points. A click
 * emits `connection-lens` so the canvas opens the connection lenses (the
 * edge only knows ids; the canvas resolves them to blocks + files).
 *
 * Pending arrows (marching-ants, mid-pull) are non-interactive.
 */
export function LabeledEdge({
  id,
  source,
  target,
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
  const bus = useDiagramBus();
  const nodes = useNodes();
  const [hover, setHover] = useState(false);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // A long edge spanning ranks runs straight through an intermediate
  // block; if the midpoint lands on a block, push the label below it.
  let lx = labelX;
  let ly = labelY;
  for (const n of nodes) {
    if (n.type !== "block") continue;
    const nx = n.position.x;
    const ny = n.position.y;
    const nh =
      (n as { measured?: { height?: number } }).measured?.height ?? NODE_H;
    if (lx > nx - 6 && lx < nx + NODE_W + 6 && ly > ny - 6 && ly < ny + nh + 6) {
      ly = ny + nh + 14;
      break;
    }
  }

  const className = (rest as { className?: string }).className;
  const recent = (data as { recent?: boolean } | undefined)?.recent === true;
  // Set by the canvas while a bubble fan is open: the whole edge (line +
  // label) fades back and goes non-interactive so nothing competes with
  // the cluster. Clears the moment the fan collapses.
  const dimmed = (data as { dimmed?: boolean } | undefined)?.dimmed === true;
  const pending = typeof className === "string" && className.includes("pending");
  const verb = typeof label === "string" ? label : "";
  const interactive = !!verb && !pending && !dimmed;

  // Place the pill BESIDE its line, not over it. For a vertical edge the
  // line is vertical at the midpoint, so anchor the pill's left edge just
  // to the right of it; for a horizontal edge, sit it just above the line.
  const vertical =
    Math.abs(targetY - sourceY) >= Math.abs(targetX - sourceX);
  const labelTransform = vertical
    ? `translate(8px, -50%) translate(${lx}px, ${ly}px)`
    : `translate(-50%, -118%) translate(${lx}px, ${ly}px)`;

  // Hover emphasizes this edge's own line so it stands out from any
  // overlapping neighbours.
  const pathStyle =
    hover && interactive
      ? { ...style, stroke: "#2A2622", strokeWidth: 2.5 }
      : style;

  const labelClass = `absolute select-none rounded-md border px-2 py-0.5 text-[11px] font-medium shadow-sm transition-colors ${
    recent
      ? "border-[#78716C] bg-[#F5F5F4] text-[#78716C]"
      : "border-[#D4D4D4] bg-white text-[#444444]"
  } ${
    interactive
      ? `pointer-events-auto cursor-pointer hover:bg-[#F7F9FB] ${hover ? "border-[#8A97A3]" : ""}`
      : "pointer-events-none"
  }`;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={pathStyle}
        markerEnd={markerEnd}
        className={className}
        interactionWidth={0}
      />
      {/* Invisible widened hit-area over the line, so hovering (or
       *  clicking) the LINE itself, not just the pill, highlights /
       *  opens the link. */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        style={{
          pointerEvents: interactive ? "stroke" : "none",
          cursor: interactive ? "pointer" : "default",
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={
          interactive
            ? (e) => {
                e.stopPropagation();
                bus.emit("connection-lens", {
                  from: source,
                  to: target,
                  verb,
                  x: e.clientX,
                  y: e.clientY,
                });
              }
            : undefined
        }
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            className={labelClass}
            style={{
              transform: labelTransform,
              // Pop above nodes (~10), a touch higher while hovered so the
              // emphasized pill sits over its neighbours. While dimmed the
              // pill recedes (faded + behind the open fan's bubbles).
              zIndex: dimmed ? 0 : hover ? 21 : 20,
              opacity: dimmed ? 0.12 : 1,
              transition: "opacity 200ms ease",
            }}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            onClick={
              interactive
                ? (e) => {
                    e.stopPropagation();
                    bus.emit("connection-lens", {
                      from: source,
                      to: target,
                      verb,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }
                : undefined
            }
            title={interactive ? "See how this link works" : undefined}
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
