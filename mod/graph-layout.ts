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

/** A narrower box for narrow panels. */
export function dimsFor(width: number, columns: number): Dims {
  const fit = Math.floor((width - 2 * DIMS.pad - (columns - 1) * DIMS.gx) / Math.max(1, columns));

  return { ...DIMS, w: Math.max(118, Math.min(DIMS.w, fit)) };
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

/** The whole picture: boxes, lines, and its size. */
export interface Laid {
  readonly boxes: readonly Placed[];
  readonly segs: readonly Seg[];
  readonly width: number;
  readonly height: number;
}

const liveTone = (t: Tone): boolean => t === "wk" || t === "bad";

/** How many columns a graph takes (its feeders' plus its tree's depth). */
export function columnsOf(g: Graph): number {
  const depth = (n: GNode): number => 1 + Math.max(0, ...n.children.map(depth));

  return lead(g.feeders) + depth(g.root);
}

function lead(feeders: readonly Feeder[]): number {
  return Math.max(0, ...feeders.map((f) => f.depth));
}

/** Lays a graph out. */
export function layout(g: Graph, d: Dims = DIMS): Laid {
  const boxes: Placed[] = [];
  const segs: Seg[] = [];
  const at = new Map<string, Placed>();
  const first = lead(g.feeders);
  let row = 0;

  const place = (n: GNode, depth: number): number => {
    const x = d.pad + depth * (d.w + d.gx);
    let y: number;

    if (!n.children.length) {
      y = d.pad + row * (d.h + d.gy);
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

  treeLines(g.root, at, d, segs);

  for (const f of g.feeders) {
    const from = at.get(f.node.key);
    const to = f.to.flatMap((k) => at.get(k) ?? []);

    if (from && to.length) elbow(from, to, d, segs);
  }

  const width = Math.max(0, ...boxes.map((b) => b.x + d.w)) + d.pad;
  const height = Math.max(0, ...boxes.map((b) => b.y + d.h)) + d.pad;

  return { boxes, segs, width, height };
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

/** The boxes in reading order (column by column, top to bottom): what arrows walk. */
export function readingOrder(l: Laid): readonly Placed[] {
  return [...l.boxes].sort((a, b) => a.x - b.x || a.y - b.y);
}
