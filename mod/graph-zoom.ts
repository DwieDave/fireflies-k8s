// A graph zoomed: the picture laid out once at full size and scaled for the
// canvas's zoom (positions, boxes, lines and the text in them), around the
// pointer for cmd- or ctrl-scroll (a trackpad's pinch, where the system sends
// one), around the middle for + and -, `z` fitting the whole graph (again:
// back to 100%). Below a size the boxes give up their words: one line, then
// only the kind's mark, the full name on hover.

import type { Laid, Placed, Seg } from "./graph-layout.ts";
import type { View } from "./graph-pan.ts";

/** The zoom's bounds and its step (a key, a wheel notch's worth). */
export const ZOOM = { min: 0.3, max: 2, step: 1.2 } as const;

/** How much a box shows at a zoom: everything, its name on one line, or its mark only. */
export type Look = "full" | "line" | "mark";

export function lookAt(z: number): Look {
  return z >= 0.8 ? "full" : z >= 0.5 ? "line" : "mark";
}

const cache = new WeakMap<Laid, Map<number, Laid>>();

/** The picture at zoom `z` (cached per layout and zoom). */
export function scaled(l: Laid, z: number): Laid {
  if (z === 1) return l;

  const byZ = cache.get(l) ?? new Map<number, Laid>();
  const hit = byZ.get(z);

  if (hit) return hit;

  const r = (n: number) => Math.round(n * z);
  const seg = (g: Seg): Seg => ({ ...g, x: r(g.x), y: r(g.y), w: g.w <= 1 ? 1 : Math.max(1, r(g.w)), h: g.h <= 1 ? 1 : Math.max(1, r(g.h)) });
  const box = (b: Placed): Placed => ({ ...b, x: r(b.x), y: r(b.y) });

  const out: Laid = {
    ...l, boxes: l.boxes.map(box), segs: l.segs.map(seg), width: r(l.width), height: r(l.height), top: r(l.top),
    d: { w: r(l.d.w), h: r(l.d.h), gx: r(l.d.gx), gy: r(l.d.gy), pad: r(l.d.pad) },
  };

  byZ.set(z, out);
  cache.set(l, byZ);

  return out;
}

/** A zoom kept inside its bounds, to two places. */
export const clampZoom = (z: number): number => Math.min(ZOOM.max, Math.max(ZOOM.min, Math.round(z * 100) / 100));

/** Zooms the view to `to` keeping the picture's point under (px, py) (canvas px) where it is. */
export function zoomAt(view: View, to: number, px: number, py: number): boolean {
  const z = clampZoom(to);

  if (z === view.z) return false;

  const k = z / view.z;

  view.x = (view.x + px) * k - px;
  view.y = (view.y + py) * k - py;
  view.z = z;

  return true;
}

/** + and -: a step in or out around the canvas's middle. */
export function zoomStep(view: View, by: 1 | -1): boolean {
  return zoomAt(view, by > 0 ? view.z * ZOOM.step : view.z / ZOOM.step, view.w / 2, view.h / 2);
}

/** The zoom that shows the whole picture (`l` at full size) in the canvas, never past 100%. */
export function fitZoom(view: View, l: Laid): number {
  const room = Math.min((view.w - 16) / Math.max(1, l.width), (view.h - 16) / Math.max(1, l.height));

  return clampZoom(Math.min(1, room));
}

/** z: the whole graph in sight; when it already is, back to 100%. True when the zoom changed. */
export function toggleFit(view: View, l: Laid): boolean {
  const fit = fitZoom(view, l);
  const to = Math.abs(view.z - fit) < 0.01 ? 1 : fit;

  if (to === view.z) return false;

  view.z = to;
  view.x = 0;
  view.y = 0;
  view.follow = null;

  return true;
}
