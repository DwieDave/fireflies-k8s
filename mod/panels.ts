// The window's panels resized: which dividers it has (dividers.ts, the
// Databases window's pattern copied as it is), their bounds and first sizes
// for the layout now, the edges + and - move for the panel with the
// keyboard, and the sizes kept across restarts in shared `k8s.sizes` as
// { window: {...}, pane: {...} } (the Databases window keeps its own the
// same way), so a window and a pane each keep theirs.
//
//   resources, wide    rail | table | detail     "rail", "detail" (x)
//   resources, middle  rail | table over detail  "rail" (x), "detail-h" (y)
//   argo cd            apps | tree | status      "argo-apps", "argo-side" (x)
//   narrow (one panel at a time): none

import { setShared, shared } from "herdr";
import type { default as K8s } from "./main.ts";
import { WIDE } from "./main.ts";
import type { Divider, Edge, Sizes } from "./dividers.ts";
import { isNumber, nullable, object, readShared, sharedKey, writeShared } from "./guard.ts";
import type { Guarded } from "./guard.ts";
import { mapOf, maybe } from "./guards.ts";

/** The kept sizes, a window's and a pane's apart. */
export const SIZES = sharedKey("k8s.sizes", nullable(object({}, { window: maybe(mapOf(isNumber)), pane: maybe(mapOf(isNumber)) })));

type KeptSizes = NonNullable<Guarded<typeof SIZES.guard>>;

/** The gap the panels leave between them (the divider's grab area). */
export const GAP = 10;

/** The least a panel keeps across. */
const MIN_RAIL = 150;
const MIN_TABLE = 260;
const MIN_DETAIL = 300;
const MIN_TREE = 260;

/** This copy's sizes as they were kept. */
export function keptSizes(inWindow: boolean): Sizes {
  const all = readShared(shared, SIZES, null);
  const mine = (inWindow ? all?.window : all?.pane) ?? {};
  const out: { [key: string]: number } = {};

  for (const [k, n] of Object.entries(mine)) if (n !== undefined) out[k] = n;

  return out;
}

/** Keeps this copy's sizes beside the other kind's. */
export function saveSizes(inWindow: boolean, sizes: Sizes): void {
  const all: KeptSizes = readShared(shared, SIZES, null) ?? {};

  writeShared(setShared, SIZES, inWindow ? { ...all, window: sizes } : { ...all, pane: sizes });
}

const wide = (v: K8s): boolean => v.size.width >= WIDE;

/** Left of the table: the rail. */
export function railDivider(v: K8s): Divider {
  const w = v.size.width;
  const right = wide(v) ? v.dividers.size(detailBase(v)) + MIN_TABLE : MIN_TABLE;

  return { key: "rail", axis: "x", side: 1, min: MIN_RAIL, max: w - 2 * GAP - GAP * 2 - right, start: wide(v) ? 210 : 190 };
}

/** The detail column's divider without the rail's size in its bound (what the rail's bound reads). */
function detailBase(v: K8s): Divider {
  const w = v.size.width;

  return { key: "detail", axis: "x", side: -1, min: MIN_DETAIL, max: w - 4 * GAP - MIN_RAIL - MIN_TABLE, start: Math.min(560, Math.round(w * 0.42)) };
}

/** Right of the table, wide: the detail column. */
export function detailDivider(v: K8s): Divider {
  const base = detailBase(v);

  return { ...base, max: v.size.width - 4 * GAP - v.dividers.size(railDivider(v)) - MIN_TABLE };
}

/** Under the table, middle width: the detail panel's height. */
export function detailHeightDivider(v: K8s): Divider {
  const h = v.size.height - 90;

  return { key: "detail-h", axis: "y", side: -1, min: 160, max: h - 120 - 12, start: Math.round(h * 0.48) };
}

/** The Argo tab: the applications on the left, the status on the right. */
export function argoAppsDivider(v: K8s): Divider {
  return { key: "argo-apps", axis: "x", side: 1, min: 160, max: v.size.width - 4 * GAP - MIN_TREE - v.dividers.size(argoSideBase(v)), start: 230 };
}

function argoSideBase(v: K8s): Divider {
  return { key: "argo-side", axis: "x", side: -1, min: 220, max: v.size.width - 4 * GAP - MIN_TREE - 160, start: 300 };
}

export function argoSideDivider(v: K8s): Divider {
  return { ...argoSideBase(v), max: v.size.width - 4 * GAP - MIN_TREE - v.dividers.size(argoAppsDivider(v)) };
}

/** The edges + and - move for the panel with the keyboard (none when narrow: one panel shows). */
export function panelEdges(v: K8s): readonly Edge[] {
  if (v.narrow() || v.tab === "forwards") return [];

  if (v.tab === "argo") {
    const apps = argoAppsDivider(v);
    const side = argoSideDivider(v);

    if (v.argoPanel === "apps") return [{ divider: apps, sign: 1 }];

    return v.argoPanel === "side" ? [{ divider: side, sign: 1 }] : [{ divider: apps, sign: -1 }, { divider: side, sign: -1 }];
  }

  const rail = railDivider(v);
  const other = wide(v) ? detailDivider(v) : detailHeightDivider(v);

  if (v.panel === "rail") return [{ divider: rail, sign: 1 }];

  return v.panel === "detail" ? [{ divider: other, sign: 1 }] : [{ divider: rail, sign: -1 }, { divider: other, sign: -1 }];
}
