/**
 * Pure dagre layout pass for the diagram canvas.
 *
 * Given a DiagramSchema (blocks + arrows) and an optional selected /
 * focused set, returns React Flow nodes + edges with positions, focus
 * dimming applied, and label-clusters merged. No React, no hooks, no
 * side effects — easy to test and snapshot.
 *
 * The dagre instance is created fresh per call; the schema is small
 * enough (typically <50 blocks) that the layout cost is negligible
 * compared to the render cost of @xyflow/react.
 */

import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import type {
  BlockNodeData,
  DiagramArrow,
  DiagramBlock,
  DiagramSchema,
} from "../types";
import { NODE_H, NODE_W, PROX } from "./constants";

/**
 * Approximate the expanded height of a selected block so dagre can
 * reserve enough vertical room for the unclamped caption without
 * shifting neighbors mid-animation.
 *
 * Selected blocks now show the full caption (no line-clamp) but no
 * longer pop out full file / function lists — they were too small to
 * read and crowded the node. Height just accommodates the unclamped
 * caption.
 */
export function estimateExpandedHeight(b: DiagramBlock): number {
  const captionLines = Math.max(1, Math.ceil((b.caption?.length ?? 0) / 32));
  const captionExtra = Math.max(0, captionLines - 2) * 14;
  return NODE_H + captionExtra;
}

/**
 * Approximate the expanded height of a selected detail block in the
 * mini graph so dagre can carve out enough vertical room and avoid
 * overlapping neighbors when the user clicks to inspect.
 *
 * The mini-graph layout is denser than the main canvas (smaller nodes,
 * tighter ranks) so the constants differ from estimateExpandedHeight.
 */
export function estimateMiniExpandedHeight(b: DiagramBlock): number {
  let h = 44;
  const captionLines = Math.max(1, Math.ceil((b.caption?.length ?? 0) / 28));
  h += captionLines * 12;
  const fileCount = b.provenance?.files?.length ?? 0;
  if (fileCount > 0) h += 18 + fileCount * 14;
  const fnCount = b.provenance?.functions?.length ?? 0;
  if (fnCount > 0) h += 18 + Math.ceil(fnCount / 3) * 18;
  return Math.max(h + 12, 56);
}

export function layoutSchema(
  schema: DiagramSchema,
  selectedId: string | null = null,
  focusedIds?: string[] | null,
): {
  nodes: Node<BlockNodeData>[];
  edges: Edge[];
} {
  const focusedSet = new Set(focusedIds ?? []);
  const hasFocus = focusedSet.size > 0;
  const allBlockIds = new Set(schema.blocks.map((b) => b.id));
  const containerIds = new Set<string>();
  for (const b of schema.blocks) {
    if (b.parent && allBlockIds.has(b.parent)) containerIds.add(b.parent);
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "TB",
    // Bumped from 50 / 70 → 80 / 110 so edge labels sitting at the
    // path midpoint have visible whitespace around them instead of
    // crashing into adjacent blocks. Combined with zIndex:20 on the
    // label div (in LabeledEdge), this keeps "imports / fetches"
    // pills readable even when blocks are dense.
    nodesep: 80,
    ranksep: 110,
    marginx: 20,
    marginy: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const b of schema.blocks) {
    const h = b.id === selectedId ? estimateExpandedHeight(b) : NODE_H;
    g.setNode(b.id, { width: NODE_W, height: h });
  }
  for (const b of schema.blocks) {
    if (b.parent && allBlockIds.has(b.parent)) {
      g.setEdge(b.parent, b.id);
    }
  }
  for (const a of schema.arrows) {
    // Skip pending arrows from layout — adding an in-flight edge to
    // dagre can shuffle nodes around the moment the user pulls a new
    // arrow, which is jarring when the popover is supposed to land on
    // a stable midpoint. Pending arrows still render (see edges loop
    // below); they just don't influence the dagre rank/position pass.
    if (a.pending !== undefined) continue;
    if (allBlockIds.has(a.from) && allBlockIds.has(a.to)) {
      g.setEdge(a.from, a.to);
    }
  }

  dagre.layout(g);

  const nodes: Node<BlockNodeData>[] = schema.blocks.map((b) => {
    const pos = g.node(b.id);
    const h = b.id === selectedId ? estimateExpandedHeight(b) : NODE_H;
    return {
      id: b.id,
      type: "block",
      position: { x: pos.x - NODE_W / 2, y: pos.y - h / 2 },
      selected: b.id === selectedId,
      data: {
        label: b.label,
        caption: b.caption,
        files: b.provenance?.files ?? [],
        functions: b.provenance?.functions ?? [],
        isContainer: containerIds.has(b.id),
        isFocused: focusedSet.has(b.id),
        isDimmed: hasFocus && !focusedSet.has(b.id),
        isPending: b.pending === true,
        isRecentlyAdded: false, // injected by attachInteractive
      },
    };
  });

  const edges: Edge[] = [];

  // Note: parent → child structural edges used to be drawn here as
  // faint grey lines. Claude was emitting `parent` for blocks that
  // visually looked like clutter (e.g. linking unrelated services
  // through a meaningless containment), so we stopped rendering
  // them. The `parent` relationships still feed dagre above for
  // layout ranking — we just no longer paint the line on screen.

  // Cluster arrows whose approximate midpoints land near each other
  // (e.g. multiple arrows fanning into the same target node), then
  // merge their labels into a single combined label so we don't render
  // overlapping pills like "POSTs" stacked under "spawns". Secondary
  // arrows in a cluster keep their line but render with no label.
  const nodePos = new Map(nodes.map((n) => [n.id, n.position]));
  type ArrowInfo = {
    arrow: DiagramArrow;
    midX: number;
    midY: number;
  };
  const arrowInfos: ArrowInfo[] = [];
  for (const a of schema.arrows) {
    if (!allBlockIds.has(a.from) || !allBlockIds.has(a.to)) continue;
    const from = nodePos.get(a.from);
    const to = nodePos.get(a.to);
    if (!from || !to) continue;
    arrowInfos.push({
      arrow: a,
      midX: (from.x + to.x) / 2 + NODE_W / 2,
      midY: (from.y + to.y) / 2 + NODE_H / 2,
    });
  }
  const clusters: ArrowInfo[][] = [];
  for (const info of arrowInfos) {
    const found = clusters.find(
      (c) =>
        Math.abs(c[0].midX - info.midX) < PROX &&
        Math.abs(c[0].midY - info.midY) < PROX,
    );
    if (found) found.push(info);
    else clusters.push([info]);
  }
  const labelOverride = new Map<DiagramArrow, string>();
  for (const cluster of clusters) {
    if (cluster.length <= 1) continue;
    const merged = cluster
      .map((c) => c.arrow.label)
      .filter((l) => l && l.trim() !== "")
      .join(" / ");
    labelOverride.set(cluster[0].arrow, merged);
    for (let i = 1; i < cluster.length; i++) {
      labelOverride.set(cluster[i].arrow, "");
    }
  }

  for (const a of schema.arrows) {
    if (!allBlockIds.has(a.from) || !allBlockIds.has(a.to)) continue;
    const finalLabel = labelOverride.has(a)
      ? labelOverride.get(a)!
      : a.label;
    const dim = hasFocus && !(focusedSet.has(a.from) || focusedSet.has(a.to));
    const isPending = a.pending !== undefined;
    edges.push({
      id: `sem-${a.from}-${a.to}-${a.label}`,
      source: a.from,
      target: a.to,
      sourceHandle: "b",
      targetHandle: "t",
      type: "labeled",
      label: finalLabel || undefined,
      // Marching-ants while pending (any stage); settled arrows skip
      // the class so they render as a normal solid line.
      className: isPending ? "pending-edge" : undefined,
      style: isPending
        ? {
            stroke: "#3B5BD9",
            strokeWidth: 2,
            strokeDasharray: "8 6",
            opacity: 1,
          }
        : {
            stroke: "#666666",
            strokeWidth: 1.5,
            opacity: dim ? 0.2 : 1,
          },
    });
  }

  return { nodes, edges };
}
