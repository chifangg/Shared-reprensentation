import type { Node } from "@xyflow/react";
import type {
  BubbleNodeData,
  BubbleSectorNodeData,
  DiagramBlock,
} from "../types";
import { NODE_H, NODE_W } from "./constants";
import { computeFanPositions, pickFanCenterAngle } from "./bubbleLayout";
import { humanizeFunctionName } from "../util/humanize";

/**
 * Pure construction of the React Flow node array for a bubble cluster:
 * one sector backdrop followed by N bubbles, all positioned around the
 * expanded block.
 *
 * Extracted from `useBubbleFocus` so the hook stays focused on state +
 * viewport orchestration; this file owns the geometry → node mapping.
 * No React imports, no React Flow hooks — just `Node` type usage.
 *
 * Geometry constants live here (not in the hook) because they're
 * tightly coupled to the layout decisions made in this file:
 * tweaking any one of them without the others would desync the
 * sector arc from where the bubbles actually land.
 */

/** Bubble pill is a fixed 80px circle (h-20 w-20 in tailwind). */
export const BUBBLE_HALF_SIZE = 40;

/** Radial distance from block center to bubble center for N >= 2. */
const RADIUS_MULTI = 230;

/** Tighter radius for the single-bubble case so the lone bubble doesn't
 *  drift visually disconnected from its parent block. */
const RADIUS_SINGLE = 150;

/** Sector inner radius starts just past the block half-extents so the
 *  cream fill doesn't overlap the block card itself. */
const SECTOR_INNER_RADIUS = 100;

/** Sector outer radius pad past the outermost bubble center. */
const SECTOR_OUTER_PAD = 20;

/** Sector arc extends slightly past the fan's outermost angle so the
 *  cream backdrop visibly wraps the cluster rather than ending exactly
 *  at the bubbles. */
const SECTOR_ANGLE_PAD_DEG = 12;

export function buildBubbleAndSectorNodes(args: {
  activeBlockId: string;
  block: DiagramBlock;
  blockPosition: { x: number; y: number };
  otherBlocks: Array<{ x: number; y: number }>;
  isExiting: boolean;
}): Node[] {
  const { activeBlockId, block, blockPosition, otherBlocks, isExiting } = args;
  const fns = block.provenance?.functions ?? [];
  if (fns.length === 0) return [];

  const cx = blockPosition.x + NODE_W / 2;
  const cy = blockPosition.y + NODE_H / 2;

  const centerAngleDeg = pickFanCenterAngle(cx, cy, otherBlocks);
  const radius = fns.length === 1 ? RADIUS_SINGLE : RADIUS_MULTI;
  const positions = computeFanPositions(
    cx,
    cy,
    fns.length,
    centerAngleDeg,
    radius,
  );

  const sectorOuterR = radius + BUBBLE_HALF_SIZE + SECTOR_OUTER_PAD;
  const fanSpread =
    fns.length === 1 ? 0 : Math.min(90, 25 * fns.length);
  const sectorHalfArc =
    fns.length === 1
      ? SECTOR_ANGLE_PAD_DEG
      : fanSpread / 2 + SECTOR_ANGLE_PAD_DEG;
  const sectorNode: Node<BubbleSectorNodeData> = {
    id: `__sector_${activeBlockId}`,
    type: "bubbleSector",
    position: { x: cx - sectorOuterR, y: cy - sectorOuterR },
    data: {
      parentBlockId: activeBlockId,
      outerRadius: sectorOuterR,
      innerRadius: SECTOR_INNER_RADIUS,
      startDeg: centerAngleDeg - sectorHalfArc,
      endDeg: centerAngleDeg + sectorHalfArc,
      isExiting,
    },
    draggable: false,
    selectable: false,
    width: sectorOuterR * 2,
    height: sectorOuterR * 2,
    zIndex: -1,
  };

  const bubbles: Node<BubbleNodeData>[] = fns.map((fn, i) => {
    const posX = positions[i].x - BUBBLE_HALF_SIZE;
    const posY = positions[i].y - BUBBLE_HALF_SIZE;
    // Offset from bubble center to block center — the radial-outward
    // animation starts at the block center (transform = this delta)
    // and tweens to (0,0).
    const bubbleCenterX = posX + BUBBLE_HALF_SIZE;
    const bubbleCenterY = posY + BUBBLE_HALF_SIZE;
    return {
      id: `__bubble_${activeBlockId}_${i}`,
      type: "bubble",
      position: { x: posX, y: posY },
      data: {
        label: fn,
        displayLabel: humanizeFunctionName(fn),
        parentBlockId: activeBlockId,
        isExiting,
        enterDx: cx - bubbleCenterX,
        enterDy: cy - bubbleCenterY,
      },
      draggable: false,
      selectable: false,
      width: BUBBLE_HALF_SIZE * 2,
      height: BUBBLE_HALF_SIZE * 2,
      zIndex: 1,
    };
  });

  return [sectorNode, ...bubbles];
}
