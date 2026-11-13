// A graph's places: the tree left to right (a column per depth, leaves
// stacked, a parent centred on its children), the feeders in columns left of
// the root, centred on it; and the lines as elbows (out of a box's right
// edge, along a shared upright, into the next box's left edge), as the
// GitHub window's Actions graph draws them.

import type { Feeder, GNode, Graph } from "./graph.ts";
import type { Tone } from "./rows.ts";

/** Sizes in px at the window's scale. */
export interface Dims {
  readonly w: number;
  readonly h: number;
  readonly gx: number;
  readonly gy: number;
  readonly pad: number;
}

export const DIMS: Dims = { w: 168, h: 38, gx: 30, gy: 10, pad: 14 };

/** How a graph fits a width: its box size, and whether the feeders (ingress, service) go in a
 *  row above the tree instead of columns before it (a narrow panel: the pods stay in view). */
export interface Fit {
  readonly d: Dims;
  readonly stack: boolean;
}

/** The widest boxes that fit `width`: columns as drawn when they fit at 118 px, else the feeders
 *  stacked in a row over a tree of fewer columns, the boxes no narrower than 96 px. */
export function fit(g: Graph, width: number): Fit {
  const cols = columnsOf(g);
  const room = (n: number, gx: number) => Math.floor((width - 2 * DIMS.pad - (n - 1) * gx) / Math.max(1, n));
  const wide = room(cols, DIMS.gx);

  if (wide >= 118 || !g.feeders.length) return { d: { ...DIMS, w: Math.max(96, Math.min(DIMS.w, wide)) }, stack: false };

  const tree = cols - lead(g.feeders);
  const gx = 22;

  return { d: { ...DIMS, gx, w: Math.max(96, Math.min(DIMS.w, room(tree, gx))) }, stack: true };
}

/** A box placed. */
export interface Placed {
  readonly node: GNode;
  readonly x: number;
  readonly y: number;
}

/** A line piece: a 1 px horizontal or upright. `live`: it runs into something on its way. */
export interface Seg {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly live: boolean;
}

/** Which way a graph reads: left to right (a column per rank), or top to bottom (a row per rank: graph-down.ts). */
export type Direction = "right" | "down";

/** The whole picture: boxes, lines, its size, and the box size it was laid out with. */
export interface Laid {
  readonly dir: Direction;
  readonly boxes: readonly Placed[];
  readonly segs: readonly Seg[];
  readonly width: number;
  readonly height: number;
  readonly d: Dims;
  /** Where the tree starts when the feeders sit in a row over it (else 0). */
  readonly top: number;
}

export const liveTone = (t: Tone): boolean => t === "wk" || t === "bad";

/** How many columns a graph takes (its feeders' plus its tree's depth). */
export function columnsOf(g: Graph): number {
  const depth = (n: GNode): number => 1 + Math.max(0, ...n.children.map(depth));

  return lead(g.feeders) + depth(g.root);
}

function lead(feeders: readonly Feeder[]): number {
  return Math.max(0, ...feeders.map((f) => f.depth));
}

/** Lays a graph out (`f`: from fit; columns at full size by default). */
export function layout(g: Graph, f: Fit = { d: DIMS, stack: false }): Laid {
  const d = f.d;
  const boxes: Placed[] = [];
  const segs: Seg[] = [];
  const at = new Map<string, Placed>();
  const first = f.stack ? 0 : lead(g.feeders);
  // Stacked feeders take a row over the tree.
  const top = f.stack ? d.h + 3 * d.gy : 0;
  let row = 0;

  const place = (n: GNode, depth: number): number => {
    const x = d.pad + depth * (d.w + d.gx);
    let y: number;

    if (!n.children.length) {
      y = d.pad + top + row * (d.h + d.gy);
      row++;
    } else {
      const ys = n.children.map((c) => place(c, depth + 1));

      y = ((ys[0] ?? 0) + (ys[ys.length - 1] ?? 0)) / 2;
    }

    const p = { node: n, x, y };

    boxes.push(p);
    at.set(n.key, p);

    return y;
  };

  const rootY = place(g.root, first);

  if (f.stack) {
    feederRow(g, d, at, boxes, segs);

    return finish(g, d, at, boxes, segs, d.pad + top);
  }

  // Feeders: each column stacked, centred on the root.
  for (let depth = 1; depth <= first; depth++) {
    const col = g.feeders.filter((f) => f.depth === depth);
    const top = rootY - ((col.length - 1) * (d.h + d.gy)) / 2;

    col.forEach((f, i) => {
      const p = { node: f.node, x: d.pad + (first - depth) * (d.w + d.gx), y: Math.max(d.pad, top + i * (d.h + d.gy)) };

      boxes.push(p);
      at.set(f.node.key, p);
    });
  }

  for (const fd of g.feeders) {
    const from = at.get(fd.node.key);
    const to = fd.to.flatMap((k) => at.get(k) ?? []);

    if (from && to.length) elbow(from, to, d, segs);
  }

  return finish(g, d, at, boxes, segs);
}

/** The tree's lines, and the picture's size. */
function finish(g: Graph, d: Dims, at: ReadonlyMap<string, Placed>, boxes: readonly Placed[], segs: Seg[], top = 0): Laid {
  treeLines(g.root, at, d, segs);

  const width = Math.max(0, ...boxes.map((b) => b.x + d.w)) + d.pad;
  const height = Math.max(0, ...boxes.map((b) => b.y + d.h)) + d.pad;

  return { dir: "right", boxes, segs, width, height, d, top };
}

/** The feeders in one row over the tree, outermost first (ingress, then service), each line
 *  running right along the row, and down from a service into the tree's root. */
function feederRow(g: Graph, d: Dims, at: Map<string, Placed>, boxes: Placed[], segs: Seg[]): void {
  const order = [...g.feeders].sort((a, b) => b.depth - a.depth);

  order.forEach((fd, i) => {
    const p = { node: fd.node, x: d.pad + i * (d.w + d.gx), y: d.pad };

    boxes.push(p);
    at.set(fd.node.key, p);
  });

  for (const fd of order) {
    const from = at.get(fd.node.key);

    if (!from) continue;

    for (const k of fd.to) {
      const to = at.get(k);

      if (!to) continue;

      if (to.y === from.y) segs.push({ x: Math.min(from.x, to.x) + d.w, y: from.y + Math.round(d.h / 2), w: Math.abs(to.x - from.x) - d.w, h: 1, live: false });
      else drop(from, to, d, segs);
    }
  }
}

/** From under a box in the row down into a box of the tree (its top's middle). */
function drop(from: Placed, to: Placed, d: Dims, segs: Seg[]): void {
  const fx = Math.round(from.x + d.w / 2);
  const tx = Math.round(to.x + d.w / 2);
  const mid = Math.round(from.y + d.h + d.gy * 1.5);

  segs.push({ x: fx, y: from.y + d.h, w: 1, h: mid - (from.y + d.h), live: false });
  segs.push({ x: Math.min(fx, tx), y: mid, w: Math.abs(fx - tx) + 1, h: 1, live: false });
  segs.push({ x: tx, y: mid, w: 1, h: to.y - mid, live: false });
}

function treeLines(n: GNode, at: ReadonlyMap<string, Placed>, d: Dims, segs: Seg[]): void {
  const from = at.get(n.key);
  const kids = n.children.flatMap((c) => at.get(c.key) ?? []);

  if (from && kids.length) elbow(from, kids, d, segs);

  n.children.forEach((c) => treeLines(c, at, d, segs));
}

/** From one box's right edge to several boxes' left edges. */
function elbow(from: Placed, to: readonly Placed[], d: Dims, segs: Seg[]): void {
  const cy = Math.round(from.y + d.h / 2);
  const mid = Math.round(from.x + d.w + d.gx / 2);
  const ys = to.map((t) => Math.round(t.y + d.h / 2));
  const top = Math.min(cy, ...ys);
  const bottom = Math.max(cy, ...ys);

  segs.push({ x: from.x + d.w, y: cy, w: mid - (from.x + d.w), h: 1, live: false });

  if (bottom > top) segs.push({ x: mid, y: top, w: 1, h: bottom - top + 1, live: false });

  to.forEach((t, i) => segs.push({ x: mid, y: ys[i] ?? cy, w: t.x - mid, h: 1, live: liveTone(t.node.tone) }));
}

/** The box at a point (a click on the canvas), or null. */
export function boxAt(l: Laid, x: number, y: number, d: Dims = DIMS): Placed | null {
  return l.boxes.find((b) => x >= b.x && x <= b.x + d.w && y >= b.y && y <= b.y + d.h) ?? null;
}

/** The boxes in reading order (left to right: a row over the tree first, then column by column, top to
 *  bottom; top to bottom: row by row, left to right): what arrows walk. */
export function readingOrder(l: Laid): readonly Placed[] {
  if (l.dir === "down") return [...l.boxes].sort((a, b) => a.y - b.y || a.x - b.x);

  const band = (p: Placed) => (p.y < l.top ? 0 : 1);

  return [...l.boxes].sort((a, b) => band(a) - band(b) || a.x - b.x || a.y - b.y);
}
