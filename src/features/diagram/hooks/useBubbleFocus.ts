import { useEffect, useMemo, useState } from "react";
import { useReactFlow, type Node } from "@xyflow/react";
import type { DiagramBlock } from "../types";
import { NODE_H, NODE_W } from "../layout/constants";
import { buildBubbleAndSectorNodes } from "../layout/bubbleNodes";

/**
 * Owns the click-block → fan-out-bubbles state machine. The actual
 * node construction (positions, sector geometry, humanized labels)
 * lives in `layout/bubbleNodes.ts`; this hook orchestrates state +
 * viewport animation.
 *
 * Two states cooperate to drive pop-in / pop-out animations:
 *   - `expandedBlockId` — what the user intends (null = collapsed)
 *   - `activeBlockId`   — what's rendered (lags expandedBlockId on
 *     collapse by ANIM_MS so the exit animation gets to play before
 *     the bubbles unmount)
 *
 * Blocks with no `provenance.functions` are skipped entirely: clicking
 * them just toggles selection, no viewport zoom into an empty cluster.
 */

/** Zoom level while the cluster is the visual focus. */
const FOCUS_ZOOM = 1.25;

/** Bubble pop animation timing — kept in sync with the CSS keyframes
 *  in styles.css. Slower than the previous 250ms so the radial motion
 *  has room to register before the cluster settles. */
const ANIM_MS = 480;

/** Viewport restore takes a bit longer than the bubble animation so
 *  the zoom-out feels less abrupt. */
const VIEWPORT_MS = 600;

type Viewport = { x: number; y: number; zoom: number };

export function useBubbleFocus({
  projectKey,
  blocks,
  nodes,
}: {
  projectKey: number;
  blocks: DiagramBlock[];
  nodes: Node[];
}): {
  expandedBlockId: string | null;
  bubbleNodes: Node[];
  /** While a cluster is expanded, the new top-left positions neighbour
   *  blocks should animate to so the fan doesn't cover them. Empty while
   *  collapsed or exiting (blocks animate back to their layout spots). */
  borrowOffsets: Map<string, { x: number; y: number }>;
  toggleBlock: (id: string) => void;
  clear: () => void;
} {
  const reactFlow = useReactFlow();
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [savedViewport, setSavedViewport] = useState<Viewport | null>(null);

  // Reset everything on USER-initiated project change.
  useEffect(() => {
    setExpandedBlockId(null);
    setActiveBlockId(null);
    setSavedViewport(null);
  }, [projectKey]);

  // Drive activeBlockId from expandedBlockId with an ANIM_MS lag on
  // collapse so the exit animation plays before bubbles unmount.
  useEffect(() => {
    if (expandedBlockId !== null) {
      setActiveBlockId(expandedBlockId);
      return;
    }
    if (activeBlockId === null) return;
    const t = window.setTimeout(() => setActiveBlockId(null), ANIM_MS);
    return () => window.clearTimeout(t);
  }, [expandedBlockId, activeBlockId]);

  const { bubbleNodes, borrowOffsets } = useMemo<{
    bubbleNodes: Node[];
    borrowOffsets: Map<string, { x: number; y: number }>;
  }>(() => {
    const empty = { bubbleNodes: [], borrowOffsets: new Map() };
    if (activeBlockId === null) return empty;
    const block = blocks.find((b) => b.id === activeBlockId);
    if (!block) return empty;
    const blockNode = nodes.find((n) => n.id === activeBlockId);
    if (!blockNode) return empty;
    const otherBlocks = nodes
      .filter(
        (n) =>
          n.id !== activeBlockId &&
          n.type !== "bubble" &&
          n.type !== "bubbleSector",
      )
      .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));
    const isExiting = expandedBlockId === null;
    const built = buildBubbleAndSectorNodes({
      activeBlockId,
      block,
      blockPosition: blockNode.position,
      otherBlocks,
      isExiting,
    });
    // Drop the make-way offsets the moment a collapse starts so blocks
    // glide back to their layout spots while the bubbles shrink out.
    return {
      bubbleNodes: built.nodes,
      borrowOffsets: isExiting ? new Map() : built.borrow,
    };
  }, [activeBlockId, expandedBlockId, blocks, nodes]);

  // Pan/zoom into the cluster on expand; restore previous viewport on
  // collapse. Doesn't re-fire on `nodes` change so dragging an expanded
  // block doesn't yank the viewport along with it.
  useEffect(() => {
    if (expandedBlockId === null) {
      if (savedViewport) {
        reactFlow.setViewport(savedViewport, { duration: VIEWPORT_MS });
        setSavedViewport(null);
      }
      return;
    }
    const blockNode = nodes.find((n) => n.id === expandedBlockId);
    if (!blockNode) return;
    setSavedViewport((prev) => prev ?? reactFlow.getViewport());
    const cx = blockNode.position.x + NODE_W / 2;
    const cy = blockNode.position.y + NODE_H / 2;
    reactFlow.setCenter(cx, cy, { zoom: FOCUS_ZOOM, duration: VIEWPORT_MS });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedBlockId]);

  const toggleBlock = (id: string) => {
    // Block with no functions has nothing to expand into. Don't pan
    // viewport into a phantom cluster; the user complained about
    // clicking a block and getting "zoom in, nothing happens".
    const block = blocks.find((b) => b.id === id);
    if (!block || (block.provenance?.functions ?? []).length === 0) {
      // Still collapse if this block is the one currently expanded.
      if (expandedBlockId === id) setExpandedBlockId(null);
      return;
    }
    setExpandedBlockId((prev) => (prev === id ? null : id));
  };

  const clear = () => setExpandedBlockId(null);

  return { expandedBlockId, bubbleNodes, borrowOffsets, toggleBlock, clear };
}
