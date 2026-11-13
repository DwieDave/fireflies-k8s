// The graphs on screen now: the selected row's (resources tab) and the shown
// application's tree (Argo tab), built from what was read and laid out;
// cached per data version, so the view and the keys (arrows walk the boxes)
// read the same layout.

import type { default as K8s } from "./main.ts";
import type { Graph } from "./graph.ts";
import { workloadGraph } from "./graph.ts";
import type { Direction, Laid, Placed } from "./graph-layout.ts";
import { fit, layout, readingOrder } from "./graph-layout.ts";
import { directionFor, layoutDown } from "./graph-down.ts";
import { appGraph } from "./argo.ts";
import { EMPTY } from "./snapshot.ts";
import { selectedRow, shownApp } from "./nav.ts";
import { Memo } from "./derive.ts";
import { WIDE } from "./main.ts";
import { GAP, argoAppsDivider, argoSideDivider, detailDivider, railDivider } from "./panels.ts";

/** A graph laid out for a panel width. */
export interface Shown {
  readonly graph: Graph;
  readonly laid: Laid;
}

const rowMemo = new WeakMap<K8s, Memo<Shown | null>>();
const appMemo = new WeakMap<K8s, Memo<Shown | null>>();

function memo(map: WeakMap<K8s, Memo<Shown | null>>, v: K8s): Memo<Shown | null> {
  const m = map.get(v) ?? new Memo<Shown | null>();

  map.set(v, m);

  return m;
}

const laidOut = (g: Graph, width: number, dir: Direction = "right"): Shown => ({ graph: g, laid: dir === "down" ? layoutDown(g, width) : layout(g, fit(g, width)) });

/** The workload graph's canvas id (its measured size picks the direction). */
export const ROW_CANVAS = "g-row";

/** The Argo application tree's canvas id. */
export const APP_CANVAS = "g-app";

/** A panel's size in px. */
interface Size {
  readonly w: number;
  readonly h: number;
}

/** The detail graph's size before it's measured, from the layout frame.ts picks. */
function guessedSize(v: K8s): Size {
  const { width, height } = v.size;
  const low = !v.narrow() && width < WIDE;

  return { w: detailWidth(v), h: low ? Math.round((height - 90) * 0.48) - 170 : height - 260 };
}

/** The direction the detail panel's shape gives the workload graph (its canvas as measured, else as guessed). */
function panelDirection(v: K8s): Direction {
  const c = v.canvases.get(ROW_CANVAS);
  const s = c?.measured ? c : guessedSize(v);

  return directionFor(s.w, s.h);
}

/** The workload graph's direction: the one `O` picked, else the panel's shape's. */
export function rowDirection(v: K8s): Direction {
  return v.graphDir === "auto" ? panelDirection(v) : v.graphDir;
}

/** `O`: the workload graph the other way; back to following the panel's shape when that's the way it reads. */
export function flipDirection(v: K8s): void {
  const next: Direction = rowDirection(v) === "down" ? "right" : "down";

  v.graphDir = panelDirection(v) === next ? "auto" : next;
}

/** The selected row's workload graph, laid out for `width`. */
export function rowGraph(v: K8s, width: number): Shown | null {
  const row = selectedRow(v);

  if (!row) return null;

  const dir = rowDirection(v);

  return memo(rowMemo, v).get(v.data.version, `${row.key}|${Math.round(width / 40)}|${dir}`, () => {
    const g = workloadGraph(row.ref, row.uid, v.data.snap.value ?? EMPTY, v.data.pods.value ?? []);

    return g ? laidOut(g, width, dir) : null;
  });
}

/** The shown Argo application's tree, laid out for `width`. */
export function appTree(v: K8s, width: number): Shown | null {
  const a = shownApp(v);

  if (!a) return null;

  return memo(appMemo, v).get(v.data.version, `${a.metadata.name}|${Math.round(width / 40)}`, () => laidOut(appGraph(a, v.data.argoSnap.value ?? v.data.snap.value ?? EMPTY, v.data.pods.value ?? []), width));
}

/** The box `by` steps from the one with the cursor, in reading order (column by column). */
export function stepBox(s: Shown, at: string | null, by: number): Placed | null {
  const order = readingOrder(s.laid);
  const i = order.findIndex((b) => b.node.key === at);

  return order[Math.max(0, Math.min(order.length - 1, (i < 0 ? 0 : i + by)))] ?? null;
}

/** The box beside the cursor's: the nearest one in the next column left or right (`axis` "x"), or in the
 *  next row up or down ("y"). */
export function sideBox(s: Shown, at: string | null, dir: -1 | 1, axis: "x" | "y" = "x"): Placed | null {
  const from = s.laid.boxes.find((b) => b.node.key === at) ?? null;

  if (!from) return readingOrder(s.laid)[0] ?? null;

  const other = axis === "x" ? "y" : "x";
  const line = s.laid.boxes.filter((b) => (dir > 0 ? b[axis] > from[axis] : b[axis] < from[axis]));
  const next = dir > 0 ? Math.min(...line.map((b) => b[axis])) : Math.max(...line.map((b) => b[axis]));

  return line.filter((b) => b[axis] === next).sort((a, b) => Math.abs(a[other] - from[other]) - Math.abs(b[other] - from[other]))[0] ?? null;
}

/** Width the detail panel's graph is laid out for (its divider's size when wide). */
export function detailWidth(v: K8s): number {
  const w = v.size.width;

  if (v.narrow()) return w - 16;

  return w >= WIDE ? v.dividers.size(detailDivider(v)) : w - v.dividers.size(railDivider(v)) - 3 * GAP;
}

/** Width the Argo tree is laid out for (what the applications and the status leave it). */
export function treeWidth(v: K8s): number {
  const w = v.size.width;

  return v.narrow() ? w - 16 : Math.max(260, w - v.dividers.size(argoAppsDivider(v)) - v.dividers.size(argoSideDivider(v)) - 4 * GAP);
}
