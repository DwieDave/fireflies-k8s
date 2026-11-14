// Moving a graph inside its canvas: the pointer drags it (a press that moves
// less than SLOP px is a click: on a box it selects the box), the wheel and
// H J K L pan it, c (or a double click on the empty canvas) puts the
// selected box back in the middle. Where the picture sits is `View` (x and
// y: how far it's moved left and up); graph-view.ts clamps it to the
// picture when it draws. Positions are in the px scripts write (unzoomed).

import type { Laid } from "./graph-layout.ts";

/** A press being held: where it started, the pan then, the box it was on. */
export interface Drag {
  readonly x: number;
  readonly y: number;
  readonly from: { readonly x: number; readonly y: number };
  readonly box: string | null;
  moved: boolean;
}

/** A canvas's place: its size as drawn, how far the picture is moved, the box it last followed, a drag. */
export interface View {
  w: number;
  h: number;
  /** Its size came from a draw (not the first guess). */
  measured: boolean;
  x: number;
  y: number;
  follow: string | null;
  drag: Drag | null;
  /** The zoom (graph-zoom.ts): positions and sizes here are the zoomed picture's. */
  z: number;
}

/** How far a press may move and still be a click. */
export const SLOP = 4;

/** How far H J K L move the picture. */
export const PAN_STEP = 80;

export function newView(): View {
  return { w: 400, h: 300, measured: false, x: 0, y: 0, follow: null, drag: null, z: 1 };
}

/** The button went down at (x, y), on the box `box` (its key) or the empty canvas (null). */
export function press(view: View, x: number, y: number, box: string | null): void {
  view.drag = { x, y, from: { x: view.x, y: view.y }, box, moved: false };
}

/** The pointer moved with the button down: past the slop the picture follows it. True when it moved. */
export function dragTo(view: View, x: number, y: number): boolean {
  const d = view.drag;

  if (!d || (!d.moved && Math.hypot(x - d.x, y - d.y) < SLOP)) return false;

  d.moved = true;
  view.x = d.from.x - (x - d.x);
  view.y = d.from.y - (y - d.y);

  return true;
}

/** The button came up: the box a click (not a drag) was on, to select; else null. */
export function release(view: View): string | null {
  const d = view.drag;

  view.drag = null;

  return d && !d.moved ? d.box : null;
}

/** The pointer left the canvas: a drag ends where it is. */
export function cancel(view: View): boolean {
  const had = view.drag !== null;

  view.drag = null;

  return had;
}

/** H J K L, the wheel: the view moves by (dx, dy) over the picture. */
export function panBy(view: View, dx: number, dy: number): void {
  view.x += dx;
  view.y += dy;
}

/** How far a pan key moves the view over the picture (H J K L: left, down, up, right), or null. */
export function panKey(name: string): readonly [number, number] | null {
  switch (name) {
    case "H": return [-PAN_STEP, 0];
    case "L": return [PAN_STEP, 0];
    case "K": return [0, -PAN_STEP];
    case "J": return [0, PAN_STEP];
    default: return null;
  }
}

/** Whether the picture is larger than its canvas (there's somewhere to drag it). */
export function roomy(l: Laid, view: View): boolean {
  return l.width > view.w || l.height > view.h;
}

/** Puts the box `key` in the canvas's middle (c, a double click on the empty canvas). */
export function centreOn(view: View, l: Laid, key: string | null): void {
  const b = l.boxes.find((x) => x.node.key === key) ?? l.boxes[0];

  if (!b) return;

  view.x = b.x + l.d.w / 2 - view.w / 2;
  view.y = b.y + l.d.h / 2 - view.h / 2;
  view.follow = key;
}

/** How far the picture is moved left and up inside its canvas. */
export interface Offset {
  readonly x: number;
  readonly y: number;
}

/** The offset that shows the picture inside the canvas: when the selection moves to a box out of sight it's
 *  brought to the middle; the drag's, the wheel's and the keys' pan otherwise; always inside the picture. A
 *  top-to-bottom picture narrower than its canvas sits in the middle across. */
export function offset(l: Laid, sel: string | null, view: View): Offset {
  const d = l.d;
  const b = l.boxes.find((x) => x.node.key === sel) ?? null;

  const seen = b !== null && b.x >= view.x && b.x + d.w <= view.x + view.w && b.y >= view.y && b.y + d.h <= view.y + view.h;

  if (sel !== view.follow) {
    view.follow = sel;

    if (b && !seen) centreOn(view, l, sel);
  }

  view.x = Math.max(0, Math.min(Math.max(0, l.width - view.w), view.x));
  view.y = Math.max(0, Math.min(Math.max(0, l.height - view.h), view.y));

  const x = l.dir === "down" && l.width < view.w ? -Math.floor((view.w - l.width) / 2) : Math.round(view.x);

  return { x, y: Math.round(view.y) };
}
