// The graphs on screen now: the selected row's (resources tab) and the shown
// application's tree (Argo tab), built from what was read and laid out;
// cached per data version, so the view and the keys (arrows walk the boxes)
// read the same layout.

import type { default as K8s } from "./main.ts";
import type { Graph } from "./graph.ts";
import { workloadGraph } from "./graph.ts";
import type { Laid, Placed } from "./graph-layout.ts";
import { fit, layout, readingOrder } from "./graph-layout.ts";
import { appGraph } from "./argo.ts";
import { EMPTY } from "./snapshot.ts";
import { selectedRow, shownApp } from "./nav.ts";
import { Memo } from "./derive.ts";

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

const laidOut = (g: Graph, width: number): Shown => ({ graph: g, laid: layout(g, fit(g, width)) });

/** The selected row's workload graph, laid out for `width`. */
export function rowGraph(v: K8s, width: number): Shown | null {
  const row = selectedRow(v);

  if (!row) return null;

  return memo(rowMemo, v).get(v.data.version, `${row.key}|${Math.round(width / 40)}`, () => {
    const g = workloadGraph(row.ref, row.uid, v.data.snap.value ?? EMPTY, v.data.pods.value ?? []);

    return g ? laidOut(g, width) : null;
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

/** The box beside the cursor's: the nearest one in the next column left or right. */
export function sideBox(s: Shown, at: string | null, dir: -1 | 1): Placed | null {
  const from = s.laid.boxes.find((b) => b.node.key === at) ?? null;

  if (!from) return readingOrder(s.laid)[0] ?? null;

  const col = s.laid.boxes.filter((b) => (dir > 0 ? b.x > from.x : b.x < from.x));
  const nx = dir > 0 ? Math.min(...col.map((b) => b.x)) : Math.max(...col.map((b) => b.x));

  return col.filter((b) => b.x === nx).sort((a, b) => Math.abs(a.y - from.y) - Math.abs(b.y - from.y))[0] ?? null;
}

/** Width the detail panel's graph is laid out for. */
export function detailWidth(v: K8s): number {
  const w = v.size.width;

  return v.narrow() ? w - 16 : w >= 1100 ? Math.min(560, Math.round(w * 0.42)) : w - 220;
}

/** Width the Argo tree is laid out for. */
export function treeWidth(v: K8s): number {
  const w = v.size.width;

  return v.narrow() ? w - 16 : Math.max(360, w - 230 - 300 - 40);
}
