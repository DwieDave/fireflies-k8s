// Where the window's menus stand (menu-place.ts places them): a menu a press
// opened at the press, a menu a key opened at what it belongs to where the
// window knows its place (the table's selected row), else in the middle.
//
// A press's place: its window position less the view's origin (the root
// learns it from the pointer's moves over it, frame.ts), over the zoom. A
// click (a chip, a title) carries no position: the pointer as the root last
// heard it.
//
// The selected row's place is the layout's own numbers, from the view's inner
// corner (inside a window's 1 px border: where its pointer events and the menu
// layer start): the top bar (chrome.ts k8s-head, 34), the body's padding (frame.ts
// resources: GAP across, 12 on top), the rail and its gap, the table panel's
// border and title (kit.ts panel: 1, 20), the column header (table.ts k8s-thead,
// 18), then its rows (ROW_H) from where the list is scrolled to.

import type { default as K8s } from "./main.ts";
import type { Pt, Rect } from "./menu-place.ts";
import { inView } from "./menu-place.ts";
import { zoom } from "./kit.ts";
import { ROW_H, listRows, rowIndex } from "./nav.ts";
import { GAP, railDivider, tableWidth } from "./panels.ts";

/** The top bar's height (chrome.ts k8s-head). */
export const TOP_BAR = 34;

/** What stands over the table's first row: the panel's border, its title, the column header. */
const OVER_ROWS = 1 + 20 + 18;

/** A press's place in the view (layout px); a click without a position: the pointer as last heard. */
export function pressPoint(v: K8s, e: { readonly position?: Pt } | null | undefined): Pt | null {
  const o = v.origin;

  return e?.position && o ? inView(e.position, o, zoom()) : v.pointer;
}

/** Runs `open` (a press's: it may open a menu) so the menu it opens stands at the press. */
export function atPress(v: K8s, e: { readonly position?: Pt } | null | undefined, open: () => void): void {
  const before = v.menu;

  open();

  const m = v.menu;

  if (m && m !== before) v.menu = { ...m, near: pressPoint(v, e) };
}

/** The selected row of the table (the resources tab, the table with the keys, side by side), in sight. */
export function keyedAnchor(v: K8s): Rect | null {
  if (v.tab !== "resources" || v.panel !== "table" || v.narrow()) return null;

  const rows = listRows(v);
  const i = rowIndex(v, rows);

  if (!rows.length || i < 0) return null;

  const x = GAP + v.dividers.size(railDivider(v)) + GAP + 1;
  const y = TOP_BAR + 12 + OVER_ROWS + i * ROW_H + v.tableScroll.offset().y / zoom();
  const bottom = v.size.height - 40;

  if (y < TOP_BAR + 12 + OVER_ROWS - 1 || y + ROW_H > bottom) return null;

  return { x, y, w: tableWidth(v) - 2, h: ROW_H };
}
