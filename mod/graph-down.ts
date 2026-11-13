// A workload graph top to bottom, for a panel taller than wide (the
// resources tab's detail column): a row per rank (the ingresses, the
// services, the workload, its replica sets, the pods at the bottom), each
// parent centred over the first row of what it owns, a row too long for the
// panel wrapped into further rows under it. The lines go down: out of a
// box's foot, along a lane over the row below, into each box's head; a
// wrapped row's lane hangs off a spine in the gutter left of the rows.
// Boxes are as wide as their names need, as far as the panel allows.

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

/** A subtree measured: its width and height, and its children in rows. */
interface Block {
  readonly node: GNode;
  readonly w: number;
  readonly h: number;
  readonly rows: readonly (readonly Block[])[];
}

const rowWidth = (d: Dims, r: readonly Block[]): number => r.reduce((acc, b) => acc + b.w, 0) + Math.max(0, r.length - 1) * d.gx;

/** Blocks packed into rows no wider than `room`. */
function pack(d: Dims, kids: readonly Block[], room: number): Block[][] {
  const rows: Block[][] = [];
  let row: Block[] = [];

  for (const k of kids) {
    if (row.length && rowWidth(d, [...row, k]) > room) {
      rows.push(row);
      row = [];
    }

    row.push(k);
  }

  if (row.length) rows.push(row);

  return rows;
}

/** Measures a subtree, its children packed into rows no wider than `room`. */
function measure(n: GNode, d: Dims, room: number): Block {
  const rows = pack(d, n.children.map((c) => measure(c, d, room)), room);
  const w = Math.max(d.w, ...rows.map((r) => rowWidth(d, r)));
  const h = d.h + rows.reduce((acc, r) => acc + d.gy + Math.max(...r.map((k) => k.h)), 0);

  return { node: n, w, h, rows };
}

/** A parent and the rows of boxes it leads to, from `left` to `right`. A wrapped group's spine runs in the
 *  gutter left of its rows, or right of them when a child's own rows wrap too (`outer`: that child's spine
 *  is on the left), so two spines never share a line. */
interface Group {
  readonly from: Placed;
  readonly rows: readonly (readonly Placed[])[];
  readonly left: number;
  readonly right: number;
  readonly outer: boolean;
}

/** Where a block's own box sits across it: centred over its first row. */
const selfX = (b: Block, d: Dims): number => Math.round(((b.rows[0] ? rowWidth(d, b.rows[0]) : d.w) - d.w) / 2);

function place(b: Block, x: number, y: number, d: Dims, boxes: Placed[], groups: Group[]): Placed {
  const self: Placed = { node: b.node, x: x + selfX(b, d), y };
  let ry = y + d.h + d.gy;

  boxes.push(self);

  const rows = b.rows.map((r) => {
    let rx = x;

    const placed = r.map((k) => {
      const p = place(k, rx, ry, d, boxes, groups);

      rx += k.w + d.gx;

      return p;
    });

    ry += Math.max(...r.map((k) => k.h)) + d.gy;

    return placed;
  });

  const outer = b.rows.some((r) => r.some((k) => k.rows.length > 1));

  if (rows.length) groups.push({ from: self, rows, left: x, right: x + Math.max(...b.rows.map((r) => rowWidth(d, r))), outer });

  return self;
}

const across = (x1: number, x2: number, y: number): Seg => ({ x: Math.min(x1, x2), y, w: Math.abs(x2 - x1) + 1, h: 1, live: false });
const down = (x: number, y1: number, y2: number, live = false): Seg => ({ x, y: y1, w: 1, h: Math.max(1, y2 - y1), live });

/** A parent's lines: down from its foot to the first row's lane, along each lane, down into each box. */
function groupLines(gr: Group, d: Dims, segs: Seg[]): void {
  const mid = (p: Placed) => p.x + Math.round(d.w / 2);
  const pcx = mid(gr.from);
  const spine = gr.outer ? gr.right + Math.round(d.gx / 2) : gr.left - Math.round(d.gx / 2);
  const lanes = gr.rows.map((r) => (r[0]?.y ?? 0) - Math.round(d.gy / 2));
  const wrapped = gr.rows.length > 1;

  segs.push(down(pcx, gr.from.y + d.h, lanes[0] ?? 0));

  gr.rows.forEach((r, i) => {
    const lane = lanes[i] ?? 0;
    const xs = r.map(mid);
    const ends = [...xs, ...(i === 0 ? [pcx] : []), ...(wrapped ? [spine] : [])];

    segs.push(across(Math.min(...ends), Math.max(...ends), lane));
    r.forEach((p, j) => segs.push(down(xs[j] ?? 0, lane, p.y, liveTone(p.node.tone))));
  });

  if (wrapped) segs.push(down(spine, lanes[0] ?? 0, (lanes[lanes.length - 1] ?? 0) + 1));
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

    if (from && to.length) groupLines({ from, rows: [to], left: Math.min(...to.map((p) => p.x)), right: 0, outer: false }, d, segs);
  }
}

/** Lays a graph out top to bottom in a panel `width` wide. */
export function layoutDown(g: Graph, width: number): Laid {
  const d = downDims(g, width);
  const block = measure(g.root, d, Math.max(d.w, width - 2 * d.pad));
  const deepest = Math.max(0, ...g.feeders.map((f) => f.depth));
  const widest = Math.max(0, ...Array.from({ length: deepest }, (_, i) => g.feeders.filter((f) => f.depth === i + 1).length));
  // Room left of the tree for a feeder row wider than the root's first row.
  const margin = Math.max(0, Math.ceil((widest * d.w + (widest - 1) * d.gx - d.w) / 2) - selfX(block, d));
  const boxes: Placed[] = [];
  const groups: Group[] = [];
  const segs: Seg[] = [];
  const root = place(block, d.pad + margin, d.pad + deepest * (d.h + d.gy), d, boxes, groups);
  const at = new Map(boxes.map((b) => [b.node.key, b] as const));

  feederRows(g, d, root, at, boxes, segs);
  groups.forEach((gr) => groupLines(gr, d, segs));

  const width_ = Math.max(0, ...boxes.map((b) => b.x + d.w)) + d.pad;
  const height = Math.max(0, ...boxes.map((b) => b.y + d.h)) + d.pad;

  return { dir: "down", boxes, segs, width: width_, height, d, top: 0 };
}
