/**
 * Orthogonal obstacle-avoiding edge router with global lane separation.
 *
 * React Flow's `getSmoothStepPath` ignores other blocks (lines run under
 * cards) and routes each edge independently (parallel edges stack on top
 * of each other). This module fixes both:
 *
 *   - `routeOrthogonal` routes ONE edge around the blocks: expand each
 *     obstacle by a margin, stub the endpoints out from their handle
 *     side, build a Hanan grid (gridlines at obstacle edges + lane lines
 *     just outside them), and A* across it with a BEND penalty so the
 *     path is short AND has few corners.
 *
 *   - `routeManyEdges` routes ALL edges together, in order, charging a
 *     USAGE penalty for grid segments already taken by an earlier edge.
 *     Later edges therefore prefer a parallel lane over overlapping, so
 *     edges sharing a corridor fan out instead of stacking.
 *
 * Pure geometry: no React / React Flow imports, fully unit-testable.
 */

export type Pt = { x: number; y: number };
export type RouteRect = { x: number; y: number; width: number; height: number };
export type RouteSide = "t" | "r" | "b" | "l";

const DIR: Record<RouteSide, Pt> = {
  t: { x: 0, y: -1 },
  b: { x: 0, y: 1 },
  l: { x: -1, y: 0 },
  r: { x: 1, y: 0 },
};

type Exp = { left: number; right: number; top: number; bottom: number };

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function expand(r: RouteRect, m: number): Exp {
  return { left: r.x - m, right: r.x + r.width + m, top: r.y - m, bottom: r.y + r.height + m };
}

function handlePoint(r: RouteRect, side: RouteSide): Pt {
  switch (side) {
    case "t":
      return { x: r.x + r.width / 2, y: r.y };
    case "b":
      return { x: r.x + r.width / 2, y: r.y + r.height };
    case "l":
      return { x: r.x, y: r.y + r.height / 2 };
    case "r":
      return { x: r.x + r.width, y: r.y + r.height / 2 };
  }
}

type Grid = {
  xs: number[];
  ys: number[];
  xIndex: Map<number, number>;
  yIndex: Map<number, number>;
};

function buildGrid(xCoords: number[], yCoords: number[]): Grid {
  const xs = uniqueSorted(xCoords);
  const ys = uniqueSorted(yCoords);
  return {
    xs,
    ys,
    xIndex: new Map(xs.map((v, i) => [v, i])),
    yIndex: new Map(ys.map((v, i) => [v, i])),
  };
}

const segKey = (i1: number, j1: number, i2: number, j2: number) =>
  i1 < i2 || (i1 === i2 && j1 < j2)
    ? `${i1},${j1},${i2},${j2}`
    : `${i2},${j2},${i1},${j1}`;

/**
 * A* over the grid from a start grid-point to a goal grid-point, avoiding
 * `exp` obstacles. Returns the grid cells of the path (for usage marking)
 * plus their points, or null if unreachable. `usage` (optional) charges
 * a penalty for segments other edges already used, separating lanes.
 */
function runAStar(
  grid: Grid,
  exp: Exp[],
  start: Pt,
  goal: Pt,
  bend: number,
  usage?: Map<string, number>,
  usagePenalty = 0,
): { cells: Array<{ i: number; j: number }>; points: Pt[] } | null {
  const { xs, ys, xIndex, yIndex } = grid;
  const startI = xIndex.get(start.x);
  const startJ = yIndex.get(start.y);
  const goalI = xIndex.get(goal.x);
  const goalJ = yIndex.get(goal.y);
  if (
    startI === undefined ||
    startJ === undefined ||
    goalI === undefined ||
    goalJ === undefined
  ) {
    return null;
  }

  const insidePoint = (x: number, y: number) =>
    exp.some((e) => x > e.left && x < e.right && y > e.top && y < e.bottom);
  const segBlocked = (ax: number, ay: number, bx: number, by: number) => {
    if (ax === bx) {
      const y0 = Math.min(ay, by);
      const y1 = Math.max(ay, by);
      return exp.some((e) => ax > e.left && ax < e.right && y0 < e.bottom && y1 > e.top);
    }
    const x0 = Math.min(ax, bx);
    const x1 = Math.max(ax, bx);
    return exp.some((e) => ay > e.top && ay < e.bottom && x0 < e.right && x1 > e.left);
  };

  const key = (i: number, j: number, d: number) => (j * xs.length + i) * 3 + d;
  const best = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  type N = { i: number; j: number; d: number; g: number; f: number };
  const heap: N[] = [];
  const push = (n: N) => {
    heap.push(n);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p].f <= heap[c].f) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = (): N | undefined => {
    if (heap.length === 0) return undefined;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        const r = c * 2 + 2;
        let s = c;
        if (l < heap.length && heap[l].f < heap[s].f) s = l;
        if (r < heap.length && heap[r].f < heap[s].f) s = r;
        if (s === c) break;
        [heap[s], heap[c]] = [heap[c], heap[s]];
        c = s;
      }
    }
    return top;
  };
  const h = (i: number, j: number) =>
    Math.abs(xs[i] - xs[goalI]) + Math.abs(ys[j] - ys[goalJ]);

  push({ i: startI, j: startJ, d: 0, g: 0, f: h(startI, startJ) });
  let goalKey = -1;
  while (heap.length > 0) {
    const cur = pop()!;
    const ck = key(cur.i, cur.j, cur.d);
    if ((best.get(ck) ?? Infinity) < cur.g) continue;
    if (cur.i === goalI && cur.j === goalJ) {
      goalKey = ck;
      break;
    }
    const moves = [
      { di: 1, dj: 0, axis: 1 },
      { di: -1, dj: 0, axis: 1 },
      { di: 0, dj: 1, axis: 2 },
      { di: 0, dj: -1, axis: 2 },
    ];
    for (const mv of moves) {
      const ni = cur.i + mv.di;
      const nj = cur.j + mv.dj;
      if (ni < 0 || ni >= xs.length || nj < 0 || nj >= ys.length) continue;
      const ax = xs[cur.i];
      const ay = ys[cur.j];
      const bx = xs[ni];
      const by = ys[nj];
      if (insidePoint(bx, by)) continue;
      if (segBlocked(ax, ay, bx, by)) continue;
      const step = Math.abs(bx - ax) + Math.abs(by - ay);
      const turn = cur.d !== 0 && cur.d !== mv.axis ? bend : 0;
      const reuse =
        usage && usagePenalty
          ? usagePenalty * (usage.get(segKey(cur.i, cur.j, ni, nj)) ?? 0)
          : 0;
      const ng = cur.g + step + turn + reuse;
      const nk = key(ni, nj, mv.axis);
      if (ng < (best.get(nk) ?? Infinity)) {
        best.set(nk, ng);
        cameFrom.set(nk, ck);
        push({ i: ni, j: nj, d: mv.axis, g: ng, f: ng + h(ni, nj) });
      }
    }
  }
  if (goalKey === -1) return null;

  const cells: Array<{ i: number; j: number }> = [];
  let k: number | undefined = goalKey;
  while (k !== undefined) {
    const cell = Math.floor(k / 3);
    const i = cell % xs.length;
    const j = Math.floor(cell / xs.length);
    cells.push({ i, j });
    k = cameFrom.get(k);
  }
  cells.reverse();
  return { cells, points: cells.map((c) => ({ x: xs[c.i], y: ys[c.j] })) };
}

/** Route a single edge around `obstacles` (must EXCLUDE the edge's own
 *  endpoints). Returns waypoints incl. endpoints, or null if no route. */
export function routeOrthogonal(args: {
  source: Pt;
  target: Pt;
  sourceSide: RouteSide;
  targetSide: RouteSide;
  obstacles: RouteRect[];
  margin?: number;
  stub?: number;
  bendPenalty?: number;
}): Pt[] | null {
  const M = args.margin ?? 14;
  const S = args.stub ?? 16;
  const bend = args.bendPenalty ?? 30;
  const exp = args.obstacles.map((r) => expand(r, M));
  const sStub: Pt = {
    x: args.source.x + DIR[args.sourceSide].x * S,
    y: args.source.y + DIR[args.sourceSide].y * S,
  };
  const tStub: Pt = {
    x: args.target.x + DIR[args.targetSide].x * S,
    y: args.target.y + DIR[args.targetSide].y * S,
  };
  const grid = buildGrid(
    [sStub.x, tStub.x, ...exp.flatMap((e) => [e.left, e.right])],
    [sStub.y, tStub.y, ...exp.flatMap((e) => [e.top, e.bottom])],
  );
  const res = runAStar(grid, exp, sStub, tStub, bend);
  if (!res) return null;
  return simplify([args.source, ...res.points, args.target]);
}

/**
 * Route ALL edges together with lane separation. `rects` maps block id to
 * its rect; each edge gives the side its handle is on (from the layout's
 * handle assignment). Returns a map of edge id to waypoints. Edges that
 * fail to route are absent from the map (caller falls back to smoothstep).
 */
export function routeManyEdges(
  rects: Map<string, RouteRect>,
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceSide: RouteSide;
    targetSide: RouteSide;
  }>,
  opts?: {
    margin?: number;
    stub?: number;
    bendPenalty?: number;
    lane?: number;
    usagePenalty?: number;
  },
): Map<string, Pt[]> {
  const M = opts?.margin ?? 14;
  const S = opts?.stub ?? 16;
  const bend = opts?.bendPenalty ?? 30;
  const LANE = opts?.lane ?? 16;
  const usagePenalty = opts?.usagePenalty ?? 60;

  // Shared grid: each block contributes its expanded edges AND a lane line
  // just outside them, so parallel edges have a separate corridor to take.
  const xCoords: number[] = [];
  const yCoords: number[] = [];
  for (const r of rects.values()) {
    const e = expand(r, M);
    xCoords.push(e.left, e.right, e.left - LANE, e.right + LANE);
    yCoords.push(e.top, e.bottom, e.top - LANE, e.bottom + LANE);
  }

  const prepared = edges.map((edge) => {
    const sr = rects.get(edge.source);
    const tr = rects.get(edge.target);
    if (!sr || !tr) return null;
    const sp = handlePoint(sr, edge.sourceSide);
    const tp = handlePoint(tr, edge.targetSide);
    const ss: Pt = {
      x: sp.x + DIR[edge.sourceSide].x * S,
      y: sp.y + DIR[edge.sourceSide].y * S,
    };
    const ts: Pt = {
      x: tp.x + DIR[edge.targetSide].x * S,
      y: tp.y + DIR[edge.targetSide].y * S,
    };
    xCoords.push(ss.x, ts.x);
    yCoords.push(ss.y, ts.y);
    return { edge, sp, tp, ss, ts };
  });

  const grid = buildGrid(xCoords, yCoords);
  const usage = new Map<string, number>();
  const out = new Map<string, Pt[]>();

  for (const p of prepared) {
    if (!p) continue;
    const exp: Exp[] = [];
    for (const [id, r] of rects) {
      if (id === p.edge.source || id === p.edge.target) continue;
      exp.push(expand(r, M));
    }
    const res = runAStar(grid, exp, p.ss, p.ts, bend, usage, usagePenalty);
    if (!res) continue;
    for (let k = 0; k < res.cells.length - 1; k++) {
      const a = res.cells[k];
      const b = res.cells[k + 1];
      const key = segKey(a.i, a.j, b.i, b.j);
      usage.set(key, (usage.get(key) ?? 0) + 1);
    }
    out.set(p.edge.id, simplify([p.sp, ...res.points, p.tp]));
  }
  return out;
}

/** Drop intermediate points collinear with their neighbours. */
function simplify(points: Pt[]): Pt[] {
  if (points.length <= 2) return points;
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const collinear =
      (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
    if (!collinear && !(a.x === b.x && a.y === b.y)) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Anchor point for an edge's label: the midpoint of the LONGEST segment
 * of the routed polyline. The longest segment is the path's main open
 * corridor, so the label reads cleanly there; the plain arc-length
 * midpoint instead lands on tiny jogs or right against a block whenever
 * the route bends around obstacles. Returns whether that segment is
 * vertical, so the pill can sit beside the line.
 */
export function pathLabelAnchor(points: Pt[]): {
  x: number;
  y: number;
  vertical: boolean;
} {
  if (points.length === 0) return { x: 0, y: 0, vertical: true };
  if (points.length === 1) {
    return { x: points[0].x, y: points[0].y, vertical: true };
  }
  let best = { a: points[0], b: points[1], len: -1 };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > best.len) best = { a, b, len };
  }
  return {
    x: (best.a.x + best.b.x) / 2,
    y: (best.a.y + best.b.y) / 2,
    vertical: Math.abs(best.b.y - best.a.y) >= Math.abs(best.b.x - best.a.x),
  };
}

/** Turn a list of orthogonal waypoints into an SVG path with rounded
 *  corners (radius clamped to the shorter adjacent segment). */
export function pointsToPath(points: Pt[], radius = 8): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.max(0, Math.min(radius, inLen / 2, outLen / 2));
    if (r === 0) {
      d += ` L ${cur.x},${cur.y}`;
      continue;
    }
    const inUx = (cur.x - prev.x) / (inLen || 1);
    const inUy = (cur.y - prev.y) / (inLen || 1);
    const outUx = (next.x - cur.x) / (outLen || 1);
    const outUy = (next.y - cur.y) / (outLen || 1);
    const p1 = { x: cur.x - inUx * r, y: cur.y - inUy * r };
    const p2 = { x: cur.x + outUx * r, y: cur.y + outUy * r };
    d += ` L ${p1.x},${p1.y} Q ${cur.x},${cur.y} ${p2.x},${p2.y}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x},${last.y}`;
  return d;
}
