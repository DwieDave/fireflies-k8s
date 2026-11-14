// The kind's table's columns as the person set them: each column's width
// (dragged at its header's right edge, `{` `}` on the focused column, a
// double click or the menu fits it to what it holds), the column the keys
// are on (`,` `.`, a header click), the sort (a header click or `o`: up,
// down, back to the default order). Widths and sorts are kept per kind in
// shared `k8s.columns`, across restarts and for every copy:
//
//   { "widths": { "<kind>": { "<column title>": <px> } }, "sort": { "<kind>": { "col": "<title>", "desc": <bool> } } }

import { setShared, shared } from "herdr";
import type { default as K8s } from "./main.ts";
import type { Column } from "./rows-kinds.ts";
import { COLUMNS, CUSTOM_COLUMNS } from "./rows-kinds.ts";
import type { Cell, Row } from "./rows.ts";
import type { SortBy } from "./sort.ts";
import { nextSort } from "./sort.ts";
import { isBuiltin } from "./kinds.ts";
import { isBoolean, isNumber, isString, nullable, object, readShared, sharedKey, writeShared } from "./guard.ts";
import { mapOf, maybe } from "./guards.ts";
import { age } from "./time.ts";
import { cpuText, memText } from "./quantity.ts";

export const COLUMN_STATE = sharedKey("k8s.columns", nullable(object({}, {
  widths: maybe(mapOf(mapOf(isNumber))),
  sort: maybe(mapOf(object({ col: isString, desc: isBoolean }))),
})));

/** A column's narrowest and widest, and how far `{` `}` move it. */
export const MIN_W = 36;
export const MAX_W = 640;
export const W_STEP = 16;

/** The name keeps at least this much when it takes the rest. */
export const NAME_MIN = 140;

/** A drag on a header's edge: the column, where it started, its width then. */
export interface ColumnDrag {
  readonly kind: string;
  readonly col: string;
  readonly x: number;
  readonly w: number;
}

/** The table's columns as set: widths and sorts per kind (kept), the column with the keys per kind, a drag. */
export class ColumnState {
  widths = new Map<string, Map<string, number>>();
  sorts = new Map<string, SortBy>();
  at = new Map<string, string>();
  drag: ColumnDrag | null = null;
}

/** The kept widths and sorts. */
export function loadColumns(): ColumnState {
  const kept = readShared(shared, COLUMN_STATE, null);
  const s = new ColumnState();

  for (const [kind, ws] of Object.entries(kept?.widths ?? {})) {
    const m = new Map<string, number>();

    for (const [col, w] of Object.entries(ws ?? {})) if (w !== undefined) m.set(col, w);

    s.widths.set(kind, m);
  }

  for (const [kind, by] of Object.entries(kept?.sort ?? {})) if (by) s.sorts.set(kind, { col: by.col, desc: by.desc });

  return s;
}

export function saveColumns(s: ColumnState): void {
  const widths: { [kind: string]: { [col: string]: number } } = {};
  const sort: { [kind: string]: SortBy } = {};

  for (const [kind, m] of s.widths) if (m.size) widths[kind] = Object.fromEntries(m);

  for (const [kind, by] of s.sorts) sort[kind] = by;

  writeShared(setShared, COLUMN_STATE, { widths, sort });
}

/** The shown kind's columns, as the kind defines them. */
export function kindColumns(v: K8s): readonly Column[] {
  return isBuiltin(v.kind) ? COLUMNS[v.kind] : CUSTOM_COLUMNS;
}

/** A column with its width as set (null: it takes the rest), and its index in the row's cells. */
export interface Shown {
  readonly col: Column;
  readonly index: number;
  readonly w: number | null;
}

/** A column's width as set, else the kind's. */
export function widthOf(v: K8s, col: Column): number | null {
  return v.columns.widths.get(v.kind)?.get(col.title) ?? col.w;
}

/** The columns that fit `width`, as set, in their order: the one taking the rest keeps NAME_MIN; the details
 *  (`low`) leave first, then columns from the right. */
export function shownColumns(v: K8s, width: number): readonly Shown[] {
  const all = kindColumns(v).map((col, index): Shown => ({ col, index, w: widthOf(v, col) }));
  const keep = new Set<number>();
  let used = 26 + (all.some((s) => s.w === null) ? NAME_MIN : 0);

  for (const pass of [false, true]) for (const s of all) {
    if (Boolean(s.col.low) !== pass) continue;

    if (s.w === null) keep.add(s.index);
    else if (used + s.w + 10 <= width || keep.size === 0) {
      used += s.w + 10;
      keep.add(s.index);
    }
  }

  return all.filter((s) => keep.has(s.index));
}

/** The column the keys are on (its title), one of those shown. */
export function focusedColumn(v: K8s, shown: readonly Shown[]): Shown | null {
  const title = v.columns.at.get(v.kind);

  return shown.find((s) => s.col.title === title) ?? shown[0] ?? null;
}

/** `,` `.`: the keys to the column left or right (of those shown). */
export function stepColumn(v: K8s, shown: readonly Shown[], by: number): void {
  const at = focusedColumn(v, shown);
  const i = at ? shown.indexOf(at) : 0;
  const next = shown[Math.max(0, Math.min(shown.length - 1, i + by))];

  if (next) v.columns.at.set(v.kind, next.col.title);
}

/** Sets a column's width (clamped) and keeps it (a drag keeps it when it ends). */
export function setWidth(v: K8s, col: string, w: number, keep = true): void {
  const m = v.columns.widths.get(v.kind) ?? new Map<string, number>();

  m.set(col, Math.round(Math.max(MIN_W, Math.min(MAX_W, w))));
  v.columns.widths.set(v.kind, m);

  if (keep) saveColumns(v.columns);
}

/** `{` `}`: the focused column narrower or wider by a step (the one taking the rest starts from its drawn width). */
export function stepWidth(v: K8s, s: Shown, by: number, drawn: number): void {
  setWidth(v, s.col.title, (s.w ?? drawn) + by * W_STEP);
}

/** Every width of the shown kind back to the kind's. */
export function resetWidths(v: K8s): void {
  v.columns.widths.delete(v.kind);
  saveColumns(v.columns);
}

/** A header click or `o`: sorted by the column up, then down, then the default order (kept). */
export function cycleSort(v: K8s, col: string): void {
  const next = nextSort(v.columns.sorts.get(v.kind) ?? null, col);

  if (next) v.columns.sorts.set(v.kind, next);
  else v.columns.sorts.delete(v.kind);

  v.columns.at.set(v.kind, col);
  saveColumns(v.columns);
}

/** A sort picked outright (the columns menu); null: the default order. */
export function setSort(v: K8s, by: SortBy | null): void {
  if (by) v.columns.sorts.set(v.kind, by);
  else v.columns.sorts.delete(v.kind);

  saveColumns(v.columns);
}

/** A CPU or memory cell's pods as the history keys them. */
function metricKeys(v: K8s, c: Extract<Cell, { t: "metric" }>): readonly string[] {
  return c.pods.map((p) => (p.startsWith("node:") || p.includes("/") ? p : `${v.namespace ?? ""}/${p}`));
}

/** A CPU or memory cell's readings so far (summed over its pods), oldest first. */
export function metricLine(v: K8s, c: Extract<Cell, { t: "metric" }>): readonly number[] {
  return v.data.history.sum(metricKeys(v, c)).map((s) => (c.what === "cpu" ? s.cpu : s.mem));
}

/** A CPU or memory cell's reading now (null: none yet). */
export function metricNow(v: K8s, c: Extract<Cell, { t: "metric" }>): number | null {
  const line = metricLine(v, c);

  return line[line.length - 1] ?? null;
}

/** How wide a cell draws, in px at the table's 11 px text. */
function cellWidth(v: K8s, c: Cell | undefined): number {
  const chars = (s: string) => Math.ceil([...s].length * 6.7);

  switch (c?.t) {
    case "text": return chars(c.text);
    case "age": return chars(age(c.at));
    case "ready": return c.blocks.length * 8 + 4 + chars(c.text);
    case "marks": return Math.min(c.count, 10) * 4 + (c.count > 10 ? 4 + chars(String(c.count)) : 0);
    case "metric": {
      const now = metricNow(v, c);

      return 48 + chars(now === null ? "" : c.what === "cpu" ? cpuText(now) : memText(now));
    }

    default: return 0;
  }
}

/** A double click on a header's edge, or the menu: the column as wide as its title and every cell need. */
export function fitColumn(v: K8s, rows: readonly Row[], s: Shown): void {
  const title = Math.ceil(s.col.title.length * 6.2) + 14;

  setWidth(v, s.col.title, Math.max(title, ...rows.map((r) => cellWidth(v, r.cells[s.index]) + 4)));
}
