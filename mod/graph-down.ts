// A workload graph top to bottom, for a panel taller than wide (the
// resources tab's detail column): a band per rank (the ingresses, the
// services, the workload, its replica sets, the pods at the bottom), every
// rank wholly under the one above, so siblings stay side by side (the live
// replica set first, the ones scaled to 0 beside it) and what they own
// hangs below all of them. A rank too long for the panel wraps into rows on
// a grid of columns; a rank of one row sits in the middle.
//
// The lines go down: out of a box's foot, along a lane over the row below,
// into each box's head. Where they'd have to pass a row (a parent in a
// wrapped row's upper line, children in more than one row), they run in the
// gutters between the grid's columns: out of the parent's side into the
// gutter right of it, or from the first lane down the gutter left of the
// first child. Lanes over a row are staggered per parent, so two parents'
// lines never run on one line. Boxes are as wide as their names need, as
// far as the panel allows.

import type { GNode, Graph } from "./graph.ts";
import type { Dims, Direction, Laid, Placed, Seg } from "./graph-layout.ts";
import { DIMS, liveTone } from "./graph-layout.ts";

/** The way a panel w × h reads a workload graph: top to bottom when it's about as tall as wide or taller
 *  (the detail column), left to right when wide and low (under the table, a wide pane). */
export function directionFor(w: number, h: number): Direction {
  return h >= w * 0.75 ? "down" : "right";
}

/** The gaps: narrower across than left to right, taller between rows (the lanes run there). */
const GX = 14;
const GY = 26;
const MIN_W = 150;
const MAX_W = 300;

/** About how wide a box must be for its whole name and kind (the app's mono font, with room: 0.66 em a character). */
export function boxWidth(n: GNode): number {
  return Math.ceil(9 + 11 + 6 + n.label.length * 7.3 + 6 + n.kind.length * 6 + 7 + 4);
}

function nodesOf(n: GNode): readonly GNode[] {
  return [n, ...n.children.flatMap(nodesOf)];
}

/** The box size for a panel `width` wide: the widest name's, no wider than the panel. */
export function downDims(g: Graph, width: number): Dims {
  const all = [...nodesOf(g.root), ...g.feeders.map((f) => f.node)];
  const want = Math.min(MAX_W, Math.max(MIN_W, ...all.map(boxWidth)));

  return { ...DIMS, w: Math.max(96, Math.min(want, width - 2 * DIMS.pad)), gx: GX, gy: GY };
}

/** A rank laid out: its rows of boxes, and whether they sit on the grid (wrapped) or in the middle. */
interface Rank {
  readonly rows: readonly (readonly Placed[])[];
  readonly grid: boolean;
}

/** The tree's ranks: the root, then each rank's children in their parents' order. */
function ranksOf(root: GNode): readonly (readonly GNode[])[] {
  const out: GNode[][] = [];

  for (let rank: readonly GNode[] = [root]; rank.length; rank = rank.flatMap((n) => n.children)) out.push([...rank]);

  return out;
}

/** Where things sit across: the grid's first column, the grid's width, a column's x and its gutters. */
interface Across {
  readonly x0: number;
  readonly width: number;
  readonly cols: number;
}

const colX = (a: Across, d: Dims, c: number): number => a.x0 + c * (d.w + d.gx);
const gutter = (a: Across, d: Dims, c: number): number => colX(a, d, c) - Math.round(d.gx / 2);

function placeRank(nodes: readonly GNode[], a: Across, d: Dims, top: number): Rank {
  const rows: Placed[][] = [];

  for (let i = 0; i < nodes.length; i += a.cols) rows.push([]);

  const grid = rows.length > 1;
  const lone = Math.round((a.width - (nodes.length * d.w + (nodes.length - 1) * d.gx)) / 2);

  nodes.forEach((node, i) => {
    const r = Math.floor(i / a.cols);
    const c = i % a.cols;
    const x = grid ? colX(a, d, c) : a.x0 + lone + c * (d.w + d.gx);

    rows[r]?.push({ node, x, y: top + r * (d.h + d.gy) });
  });

  return { rows, grid };
}

const across = (x1: number, x2: number, y: number): Seg => ({ x: Math.min(x1, x2), y, w: Math.abs(x2 - x1) + 1, h: 1, live: false });
const down = (x: number, y1: number, y2: number, live = false): Seg => ({ x, y: y1, w: 1, h: Math.max(1, y2 - y1), live });

/** How one parent's lines reach its children: the rows of the rank below it needs a lane over, and the
 *  gutter its trunk runs down (null: straight down from its foot into one row). */
interface Route {
  readonly p: Placed;
  readonly kids: readonly Placed[];
  readonly kidRow: ReadonlyMap<Placed, number>;
  /** It leaves by its foot (it's in its rank's last row), else by its side. */
  readonly foot: boolean;
  readonly rows: readonly number[];
  readonly trunk: number | null;
  /** Its lane's y over each row it reaches (rankLines fills it in). */
  readonly lanes: Map<number, number>;
}

const mid = (d: Dims, b: Placed): number => b.x + Math.round(d.w / 2);

function route(p: Placed, pr: Rank, below: Rank, at: ReadonlyMap<string, Placed>, a: Across, d: Dims): Route {
  const kids = p.node.children.flatMap((c) => at.get(c.key) ?? []);
  const kidRow = new Map(kids.map((k) => [k, below.rows.findIndex((row) => row.includes(k))] as const));
  const rows = [...kidRow.values()];
  const first = Math.min(...rows);
  const last = Math.max(...rows);
  const foot = pr.rows[pr.rows.length - 1]?.includes(p) ?? true;
  const col = (b: Placed) => Math.round((b.x - a.x0) / (d.w + d.gx));
  // A row of its own rank under it: out by its side into the gutter right of it. Children past the
  // first row: down the gutter left of the first child.
  const trunk = !foot ? gutter(a, d, col(p) + 1) : last > 0 ? gutter(a, d, col(kids[0] ?? p)) : null;
  const from = foot ? 0 : first;

  return { p, kids, kidRow, foot, rows: Array.from({ length: last - from + 1 }, (_, i) => from + i), trunk, lanes: new Map() };
}

/** A route's lines, `lane(j)` the y of its lane over the row j below. */
function routeLines(r: Route, lane: (j: number) => number, d: Dims, segs: Seg[]): void {
  const p = r.p;
  const half = p.y + Math.round(d.h / 2);
  const end = lane(r.rows[r.rows.length - 1] ?? 0) + 1;

  if (r.foot) segs.push(down(mid(d, p), p.y + d.h, lane(0)));

  if (r.trunk !== null) segs.push(...(r.foot ? [down(r.trunk, lane(0), end)] : [across(p.x + d.w, r.trunk, half), down(r.trunk, half, end)]));

  for (const j of r.rows) {
    const xs = r.kids.filter((k) => r.kidRow.get(k) === j).map((k) => mid(d, k));
    const ends = [...xs, ...(r.foot && j === 0 ? [mid(d, p)] : []), ...(r.trunk === null ? [] : [r.trunk])];

    if (ends.length > 1) segs.push(across(Math.min(...ends), Math.max(...ends), lane(j)));
  }

  for (const k of r.kids) segs.push(down(mid(d, k), lane(r.kidRow.get(k) ?? 0), k.y, liveTone(k.node.tone)));
}

/** Every parent's lines into the rank below: lanes over each row staggered upwards, one per route. */
function rankLines(pr: Rank, below: Rank, at: ReadonlyMap<string, Placed>, a: Across, d: Dims, segs: Seg[]): void {
  const routes = pr.rows.flat().filter((p) => p.node.children.length).map((p) => route(p, pr, below, at, a, d));

  below.rows.forEach((row, j) => {
    const top = row[0]?.y ?? 0;
    const users = routes.filter((r) => r.rows.includes(j));

    users.forEach((r, i) => r.lanes.set(j, Math.max(top - d.gy + 3, top - 7 - 5 * i)));
  });

  routes.forEach((r) => routeLines(r, (j) => r.lanes.get(j) ?? 0, d, segs));
}

/** The feeders' rows over the tree (the outermost on top), each centred on the root, and their lines. */
function feederRows(g: Graph, d: Dims, root: Placed, at: Map<string, Placed>, boxes: Placed[], segs: Seg[]): void {
  const deepest = Math.max(0, ...g.feeders.map((f) => f.depth));
  const centre = root.x + d.w / 2;
  const meanX = (keys: readonly string[]) => keys.reduce((acc, k) => acc + (at.get(k)?.x ?? centre), 0) / Math.max(1, keys.length);

  for (let depth = 1; depth <= deepest; depth++) {
    const rank = g.feeders.filter((f) => f.depth === depth).sort((a, b) => meanX(a.to) - meanX(b.to));
    const left = Math.round(centre - (rank.length * d.w + (rank.length - 1) * d.gx) / 2);
    const y = root.y - depth * (d.h + d.gy);

    rank.forEach((f, i) => {
      const p = { node: f.node, x: left + i * (d.w + d.gx), y };

      boxes.push(p);
      at.set(f.node.key, p);
    });
  }

  for (const f of g.feeders) {
    const from = at.get(f.node.key);
    const to = f.to.flatMap((k) => at.get(k) ?? []);
    const lane = (to[0]?.y ?? 0) - Math.round(d.gy / 2);
    const xs = to.map((b) => mid(d, b));

    if (!from || !to.length) continue;

    segs.push(down(mid(d, from), from.y + d.h, lane), across(Math.min(mid(d, from), ...xs), Math.max(mid(d, from), ...xs), lane));
    to.forEach((b) => segs.push(down(mid(d, b), lane, b.y)));
  }
}

/** Lays a graph out top to bottom in a panel `width` wide. */
export function layoutDown(g: Graph, width: number): Laid {
  const d = downDims(g, width);
  const ranks = ranksOf(g.root);
  const cols = Math.max(1, Math.floor((width - 2 * d.pad + d.gx) / (d.w + d.gx)));
  const used = Math.min(cols, Math.max(...ranks.map((r) => r.length)));
  const deepest = Math.max(0, ...g.feeders.map((f) => f.depth));
  const feedWide = Math.max(0, ...Array.from({ length: deepest }, (_, i) => g.feeders.filter((f) => f.depth === i + 1).length));
  const gridW = used * (d.w + d.gx) - d.gx;
  const all = Math.max(gridW, feedWide * (d.w + d.gx) - d.gx);
  const a: Across = { x0: d.pad + Math.round((all - gridW) / 2), width: gridW, cols };
  const placed: Rank[] = [];
  let top = d.pad + deepest * (d.h + d.gy);

  for (const nodes of ranks) {
    const r = placeRank(nodes, a, d, top);

    placed.push(r);
    top += r.rows.length * (d.h + d.gy);
  }

  const boxes: Placed[] = placed.flatMap((r) => r.rows.flat());
  const at = new Map(boxes.map((b) => [b.node.key, b] as const));
  const segs: Seg[] = [];

  placed.forEach((pr, k) => {
    const below = placed[k + 1];

    if (below) rankLines(pr, below, at, a, d, segs);
  });

  const root = at.get(g.root.key);

  if (root) feederRows(g, d, root, at, boxes, segs);

  const w = Math.max(0, ...boxes.map((b) => b.x + d.w)) + d.pad;
  const height = Math.max(0, ...boxes.map((b) => b.y + d.h)) + d.pad;

  return { dir: "down", boxes, segs, width: w, height, d, top: 0 };
}
