import type { Node } from "@xyflow/react";
import type {
  BubbleNodeData,
  BubbleSectorNodeData,
  DiagramBlock,
} from "../types";
import { NODE_H, NODE_W } from "./constants";
import {
  computeFanPositions,
  fanRadius,
  fanSpreadDeg,
  pickFanCenterAngle,
} from "./bubbleLayout";
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

/** Extra angular slack (deg) past the sector arc when deciding whether a
 *  neighbour block is "in the way" of the fan, so a block grazing the
 *  edge still gets nudged rather than half-covered. */
const BORROW_ARC_MARGIN_DEG = 16;

/** Gap (px) left between the sector's outer edge and a borrowed block's
 *  center after it's pushed out, so the block clears the cluster with
 *  visible breathing room. */
const BORROW_GAP = 28;

/** Synthetic label for the appearance bubble. Not a real function; the
 *  click handler branches on `kind === "appearance"`, not this string. */
const APPEARANCE_LABEL = "__appearance__";

/**
 * Whether a block gets an appearance bubble. Only interface surfaces
 * have a "look" worth restyling; logic / data / integration / config
 * blocks (and backend-only projects, which have no interface blocks at
 * all) get no appearance bubble, so the affordance appears exactly where
 * it makes sense and nowhere else.
 */
export function blockHasAppearance(block: DiagramBlock): boolean {
  return block.category === "interface";
}

type BubbleItem = {
  label: string;
  displayLabel: string;
  kind: "function" | "appearance";
};

/** The ordered bubble items for a block: its functions, then (for
 *  interface surfaces) a trailing appearance bubble. */
export function bubbleItemsForBlock(block: DiagramBlock): BubbleItem[] {
  const fns = block.provenance?.functions ?? [];
  const items: BubbleItem[] = fns.map((fn) => ({
    label: fn,
    displayLabel: humanizeFunctionName(fn),
    kind: "function",
  }));
  if (blockHasAppearance(block)) {
    items.push({
      label: APPEARANCE_LABEL,
      displayLabel: "Appearance",
      kind: "appearance",
    });
  }
  return items;
}

/**
 * For each neighbour block sitting inside the bubble fan's sector,
 * compute the top-left position it should move to so the fan doesn't
 * cover it ("borrow" / make-way). Blocks outside the sector are absent
 * from the map (left where they are). The caller animates blocks to
 * these positions on expand and back to their layout positions on
 * collapse.
 */
function computeBorrowOffsets(args: {
  cx: number;
  cy: number;
  centerAngleDeg: number;
  sectorHalfArc: number;
  sectorOuterR: number;
  otherBlocks: Array<{ id: string; x: number; y: number }>;
}): Map<string, { x: number; y: number }> {
  const { cx, cy, centerAngleDeg, sectorHalfArc, sectorOuterR, otherBlocks } =
    args;
  const offsets = new Map<string, { x: number; y: number }>();
  const clearDist = sectorOuterR + NODE_W / 2 + BORROW_GAP;
  for (const b of otherBlocks) {
    const bcx = b.x + NODE_W / 2;
    const bcy = b.y + NODE_H / 2;
    const dx = bcx - cx;
    const dy = bcy - cy;
    const dist = Math.hypot(dx, dy);
    if (dist === 0 || dist >= clearDist) continue;
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    // Signed angular distance to the fan center, normalized to [-180,180].
    const da = ((ang - centerAngleDeg + 540) % 360) - 180;
    if (Math.abs(da) > sectorHalfArc + BORROW_ARC_MARGIN_DEG) continue;
    // Push the block straight out along its own bearing until it clears.
    const ux = dx / dist;
    const uy = dy / dist;
    offsets.set(b.id, {
      x: cx + ux * clearDist - NODE_W / 2,
      y: cy + uy * clearDist - NODE_H / 2,
    });
  }
  return offsets;
}

export function buildBubbleAndSectorNodes(args: {
  activeBlockId: string;
  block: DiagramBlock;
  blockPosition: { x: number; y: number };
  otherBlocks: Array<{ id: string; x: number; y: number }>;
  isExiting: boolean;
}): { nodes: Node[]; borrow: Map<string, { x: number; y: number }> } {
  const { activeBlockId, block, blockPosition, otherBlocks, isExiting } = args;
  const items = bubbleItemsForBlock(block);
  if (items.length === 0) return { nodes: [], borrow: new Map() };

  const cx = blockPosition.x + NODE_W / 2;
  const cy = blockPosition.y + NODE_H / 2;

  const centerAngleDeg = pickFanCenterAngle(cx, cy, otherBlocks);
  const baseRadius = items.length === 1 ? RADIUS_SINGLE : RADIUS_MULTI;
  const radius = fanRadius(items.length, baseRadius);
  const positions = computeFanPositions(
    cx,
    cy,
    items.length,
    centerAngleDeg,
    radius,
  );

  const sectorOuterR = radius + BUBBLE_HALF_SIZE + SECTOR_OUTER_PAD;
  const fanSpread = fanSpreadDeg(items.length);
  const sectorHalfArc =
    items.length === 1
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

  const bubbles: Node<BubbleNodeData>[] = items.map((item, i) => {
    const posX = positions[i].x - BUBBLE_HALF_SIZE;
    const posY = positions[i].y - BUBBLE_HALF_SIZE;
    // Offset from bubble center to block center: the radial-outward
    // animation starts at the block center (transform = this delta)
    // and tweens to (0,0).
    const bubbleCenterX = posX + BUBBLE_HALF_SIZE;
    const bubbleCenterY = posY + BUBBLE_HALF_SIZE;
    return {
      id: `__bubble_${activeBlockId}_${i}`,
      type: "bubble",
      position: { x: posX, y: posY },
      data: {
        kind: item.kind,
        label: item.label,
        displayLabel: item.displayLabel,
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

  const borrow = computeBorrowOffsets({
    cx,
    cy,
    centerAngleDeg,
    sectorHalfArc,
    sectorOuterR,
    otherBlocks,
  });

  return { nodes: [sectorNode, ...bubbles], borrow };
}
