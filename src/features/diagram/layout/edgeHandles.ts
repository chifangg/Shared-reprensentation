/**
 * Per-block edge handle distribution.
 *
 * React Flow blocks expose four handles (t / r / b / l), one anchor
 * point each. If several edges touch the same block they tend to want
 * the SAME geometrically-preferred side, so they stack on one anchor and
 * read as a single (often bidirectional-looking) line. The design rule
 * we keep hitting: distinct edges at one block must use distinct sides.
 *
 * This module assigns, for every arrow endpoint, a side at its block such
 * that no two endpoints at the same block share a side (until all four
 * are used, which only happens past four incident edges). Each endpoint
 * prefers the side facing the other block, then the perpendicular side
 * toward it, then the remaining two. Arrows are processed in array order,
 * so an arrow appended later (e.g. the user's freshly drawn pending one)
 * naturally avoids the sides already taken by existing arrows.
 *
 * Pure geometry, no React / React Flow imports, so it stays unit-testable.
 */

export type Side = "t" | "r" | "b" | "l";

const OPPOSITE: Record<Side, Side> = { t: "b", b: "t", l: "r", r: "l" };

/**
 * Fallback order of sides for an endpoint, given the vector (dx, dy) from
 * THIS block's center to the other block's center: the facing side first,
 * then the perpendicular side leaning toward the other block, then the
 * remaining two. All four sides appear exactly once.
 */
export function sidePreference(dx: number, dy: number): Side[] {
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const primary: Side = horizontal ? (dx > 0 ? "r" : "l") : dy > 0 ? "b" : "t";
  const secondary: Side = horizontal
    ? dy > 0
      ? "b"
      : "t"
    : dx > 0
      ? "r"
      : "l";
  return [primary, secondary, OPPOSITE[secondary], OPPOSITE[primary]];
}

type Pt = { x: number; y: number };

/**
 * Assign source/target handle sides for each arrow, avoiding two edges
 * sharing a side at the same block where possible. `centerOf` returns a
 * block's center (or undefined if it has no laid-out position).
 */
export function assignEdgeHandles(
  arrows: Array<{ from: string; to: string }>,
  centerOf: (id: string) => Pt | undefined,
): Array<{ sourceHandle: Side; targetHandle: Side }> {
  const used = new Map<string, Set<Side>>();
  const take = (blockId: string, order: Side[]): Side => {
    let set = used.get(blockId);
    if (!set) {
      set = new Set<Side>();
      used.set(blockId, set);
    }
    for (const s of order) {
      if (!set.has(s)) {
        set.add(s);
        return s;
      }
    }
    // More than four edges at this block: reuse the facing side. Sharing
    // is now unavoidable with only four handles.
    set.add(order[0]);
    return order[0];
  };

  return arrows.map((a) => {
    const c1 = centerOf(a.from);
    const c2 = centerOf(a.to);
    if (!c1 || !c2) {
      return { sourceHandle: "b" as Side, targetHandle: "t" as Side };
    }
    const dx = c2.x - c1.x;
    const dy = c2.y - c1.y;
    const sourceHandle = take(a.from, sidePreference(dx, dy));
    const targetHandle = take(a.to, sidePreference(-dx, -dy));
    return { sourceHandle, targetHandle };
  });
}
