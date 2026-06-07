import { useMemo } from "react";
import type { Edge, Node } from "@xyflow/react";
import { NODE_W, NODE_H } from "../layout/constants";
import {
  routeManyEdges,
  type RouteRect,
  type RouteSide,
} from "../layout/orthogonalRoute";

/**
 * Attach a globally-routed, lane-separated path to each edge's
 * `data.routedPath`.
 *
 * Routes ALL edges together (routeManyEdges) so they avoid blocks AND fan
 * into separate lanes instead of stacking when they share a corridor.
 * Recomputes when nodes move (drag) or the edge set changes; the edge
 * component reads `data.routedPath` and draws it (falling back to
 * smoothstep when an edge could not be routed).
 */
export function useEdgeRouting(nodes: Node[], edges: Edge[]): Edge[] {
  return useMemo(() => {
    const rects = new Map<string, RouteRect>();
    for (const n of nodes) {
      if (n.type !== "block") continue;
      const m = (n as { measured?: { width?: number; height?: number } })
        .measured;
      rects.set(n.id, {
        x: n.position.x,
        y: n.position.y,
        width: m?.width ?? NODE_W,
        height: m?.height ?? NODE_H,
      });
    }
    const routeInputs = edges
      .filter((e) => rects.has(e.source) && rects.has(e.target))
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceSide: (e.sourceHandle ?? "b") as RouteSide,
        targetSide: (e.targetHandle ?? "t") as RouteSide,
      }));
    const paths = routeManyEdges(rects, routeInputs);
    return edges.map((e) => ({
      ...e,
      data: { ...e.data, routedPath: paths.get(e.id) ?? null },
    }));
  }, [edges, nodes]);
}
