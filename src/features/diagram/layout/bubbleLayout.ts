/**
 * Pure layout helpers for the bubble-focus feature.
 *
 * Split from `useBubbleFocus.ts` so the hook stays small and the
 * geometry is unit-testable without a React tree. Two helpers live
 * here:
 *
 *   - `pickFanCenterAngle` — given the expanded block's center and the
 *     other blocks' positions, pick which cardinal side has the most
 *     clearance for the bubble fan. Avoids the user complaint of
 *     bubbles fanning into neighbouring blocks.
 *
 *   - `fanSpreadDeg` / `fanRadius` — the count-driven spread + radius
 *     the fan uses. Shared by `computeFanPositions` (bubble centers)
 *     and `bubbleNodes` (sector arc) so the two never desync.
 *
 *   - `computeFanPositions` — given a center, count, fan center angle
 *     and radius, return N evenly-spread radial positions.
 *
 * No React, no React Flow types. Pure math.
 */

import { NODE_H, NODE_W } from "./constants";

/** Soft cap on the fan's angular spread. Past this we widen the radius
 *  instead of the angle, so a big cluster doesn't wrap back behind the
 *  block (which would collide with the parent card / the rest of the
 *  fan). A bit over a half-circle still leaves a clear gap toward the
 *  parent's back. */
const FAN_MAX_SPREAD_DEG = 200;

/** Per-bubble angle in the fan, used to size the spread up to the cap.
 *  Keeps a 2-3 bubble fan from looking unnaturally wide. */
const FAN_PER_BUBBLE_DEG = 24;

/** Minimum center-to-center arc distance (px) between adjacent bubbles.
 *  Bubbles are an 80px circle (BUBBLE_HALF_SIZE * 2); this adds a small
 *  visual gap on top so they never kiss. `fanRadius` grows the radius
 *  until the chord between neighbours clears this. */
const MIN_BUBBLE_ARC_SPACING = 92;

/** Total angular spread (deg) for a fan of `count` bubbles. Grows with
 *  count up to FAN_MAX_SPREAD_DEG. Spread spans (count - 1) gaps. */
export function fanSpreadDeg(count: number): number {
  if (count <= 1) return 0;
  return Math.min(FAN_MAX_SPREAD_DEG, FAN_PER_BUBBLE_DEG * (count - 1));
}

/** Radial distance to use for a fan of `count` bubbles. Returns the
 *  base radius unless the (capped) spread would pack the bubbles closer
 *  than MIN_BUBBLE_ARC_SPACING — in which case it pushes them out far
 *  enough to clear. This is what keeps a large cluster (the user hit
 *  ~11 bubbles) from collapsing into an overlapping vertical column:
 *  once the angle caps, the radius takes over. */
export function fanRadius(count: number, baseRadius: number): number {
  if (count <= 1) return baseRadius;
  const stepRad = ((fanSpreadDeg(count) / (count - 1)) * Math.PI) / 180;
  const needed = MIN_BUBBLE_ARC_SPACING / (2 * Math.sin(stepRad / 2));
  return Math.max(baseRadius, needed);
}

type Side = { centerDeg: number; priority: number; label: string };

/** Four cardinal directions, ordered by tie-break preference: prefer
 *  right (most natural reading direction), then down, then left, then
 *  up. Each direction owns a ±45° "danger zone" around its center. */
const SIDES: Side[] = [
  { centerDeg: 0, priority: 0, label: "right" },
  { centerDeg: 90, priority: 1, label: "down" },
  { centerDeg: 180, priority: 2, label: "left" },
  { centerDeg: -90, priority: 3, label: "up" },
];

/**
 * Decide which cardinal side to fan the bubbles toward. Scores each
 * side by the distance to its CLOSEST neighbour: the side with the
 * largest min-distance wins (= the side with the most clearance).
 * Ties broken by SIDES' priority order (right > down > left > up).
 *
 * Previously this counted blockers in a fixed-range arc; that picked
 * the right side whenever it had one fewer blocker than left, even if
 * left's blockers were FAR and right's were close enough to collide.
 * Switching to max-min-distance fixes the "bubbles fan right into a
 * block sitting just barely past the threshold" case the user hit.
 *
 * `neighbours` is the list of OTHER block top-left positions (already
 * excludes the expanded block itself + any bubble nodes).
 */
export function pickFanCenterAngle(
  cx: number,
  cy: number,
  neighbours: Array<{ x: number; y: number }>,
): number {
  const minDistPerSide = new Map<number, number>();
  SIDES.forEach((s) => minDistPerSide.set(s.centerDeg, Infinity));

  for (const n of neighbours) {
    const ncx = n.x + NODE_W / 2;
    const ncy = n.y + NODE_H / 2;
    const dx = ncx - cx;
    const dy = ncy - cy;
    const dist = Math.hypot(dx, dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const side = sideForAngle(angle);
    const prev = minDistPerSide.get(side.centerDeg) ?? Infinity;
    if (dist < prev) minDistPerSide.set(side.centerDeg, dist);
  }

  return [...SIDES]
    .sort((a, b) => {
      const da = minDistPerSide.get(a.centerDeg) ?? Infinity;
      const db = minDistPerSide.get(b.centerDeg) ?? Infinity;
      // Larger min-distance first = more clearance.
      return db - da || a.priority - b.priority;
    })[0].centerDeg;
}

function sideForAngle(angleDeg: number): Side {
  if (angleDeg >= -45 && angleDeg <= 45) return SIDES[0]; // right
  if (angleDeg > 45 && angleDeg <= 135) return SIDES[1]; // down
  if (angleDeg > 135 || angleDeg <= -135) return SIDES[2]; // left
  return SIDES[3]; // up
}

/**
 * Compute N evenly-spread radial positions (centered at cx,cy) around
 * the chosen center angle. Returns absolute CENTER positions — the
 * caller offsets by half-bubble-extents to translate to top-left.
 */
export function computeFanPositions(
  cx: number,
  cy: number,
  count: number,
  centerAngleDeg: number,
  radius: number,
): Array<{ x: number; y: number }> {
  if (count === 0) return [];
  const spread = fanSpreadDeg(count);
  const startDeg = centerAngleDeg - spread / 2;
  const step = count > 1 ? spread / (count - 1) : 0;

  const positions: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    const deg = count === 1 ? centerAngleDeg : startDeg + step * i;
    const rad = (deg * Math.PI) / 180;
    positions.push({
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad),
    });
  }
  return positions;
}
