import { useEffect, useRef, useState } from "react";
import { useReactFlow, type Node } from "@xyflow/react";
import type { ConnectionLensDetail } from "../types";
import { useDiagramBusSubscribe } from "../protocol/bus";
import { NODE_H, NODE_W } from "../layout/constants";

/**
 * Connection-lens state (arrow-label pill drill-in) plus the viewport
 * focus that goes with it. Opening the lenses zooms the canvas to center
 * that edge (like clicking a block zooms into its bubbles); the overlay
 * itself floats next to the clicked pill. Closing restores the previous
 * viewport. Extracted from DiagramCanvas so the orchestrator does not
 * carry this feature inline.
 */

const FOCUS_ZOOM = 1.4;
const VIEWPORT_MS = 420;

export function useConnectionLens(projectKey: number, nodes: Node[]) {
  const reactFlow = useReactFlow();
  const [lens, setLens] = useState<ConnectionLensDetail | null>(null);
  // Card drag offset, kept here (not in the overlay) so it survives the
  // overlay unmounting on close: the card reopens where the user left it.
  // Since every edge zooms to the pane center, "center + offset" is the
  // same screen spot for every edge, so one shared offset reads as a
  // remembered position.
  const [cardOffset, setCardOffset] = useState({ dx: 0, dy: 0 });

  useDiagramBusSubscribe("connection-lens", (detail) => {
    if (detail) setLens(detail);
  });

  // Close + reset the remembered position on USER-initiated project change.
  useEffect(() => {
    setLens(null);
    setCardOffset({ dx: 0, dy: 0 });
  }, [projectKey]);

  // Read nodes through a ref so the zoom effect finds positions without
  // re-firing when a block is dragged.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const savedViewport = useRef<{ x: number; y: number; zoom: number } | null>(
    null,
  );

  useEffect(() => {
    if (!lens) {
      if (savedViewport.current) {
        reactFlow.setViewport(savedViewport.current, { duration: VIEWPORT_MS });
        savedViewport.current = null;
      }
      return;
    }
    const from = nodesRef.current.find((n) => n.id === lens.from);
    const to = nodesRef.current.find((n) => n.id === lens.to);
    if (!from || !to) return;
    const cx = (from.position.x + to.position.x) / 2 + NODE_W / 2;
    const cy = (from.position.y + to.position.y) / 2 + NODE_H / 2;
    savedViewport.current = savedViewport.current ?? reactFlow.getViewport();
    reactFlow.setCenter(cx, cy, { zoom: FOCUS_ZOOM, duration: VIEWPORT_MS });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lens]);

  return { lens, close: () => setLens(null), cardOffset, setCardOffset };
}
