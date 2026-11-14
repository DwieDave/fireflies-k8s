// The kind's table: a header and a row per object, drawn graphically where a
// picture reads faster (readiness blocks, restart marks, CPU lines), the
// selected row banded. Columns that don't fit leave from the right before
// the name truncates. Click selects, a double click opens, a right click
// lists the row's actions. The header sorts (a click), resizes (its edges)
// and opens the columns menu (a right click): columns.ts holds what's set.

import { div } from "gpui-kit";
import type { Element } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar } from "gpui-base";
import type { Theme } from "herdr";
import type { default as K8s } from "./main.ts";
import type { Cell, Row } from "./rows.ts";
import { band, panel, pip, spark, stop, toneColor } from "./kit.ts";
import { titleOf } from "./kinds.ts";
import { ROW_H, listRows, revealRow, rowIndex, selectAt } from "./nav.ts";
import { rowMenu, runRow } from "./actions.ts";
import { age } from "./time.ts";
import { cpuText, memText } from "./quantity.ts";
import { HIDDEN } from "./secrets.ts";
import { isString } from "./guard.ts";
import { panelNum } from "./panel-keys.ts";
import type { Shown } from "./columns.ts";
import { NAME_MIN, cycleSort, fitColumn, focusedColumn, metricLine, saveColumns, setWidth, shownColumns } from "./columns.ts";
import { columnsMenu } from "./columns-menu.ts";
import { unzoom } from "./kit.ts";
import type { Also } from "./dividers.ts";

/** Two clicks on one row this close together open it (a virtual list reports clicks, not their count). */
const DOUBLE_MS = 450;

/** The px a row spends besides its columns: padding, the pip, the gaps. */
const chrome = (n: number): number => 16 + 8 + 10 * n;

/** How wide the column taking the rest draws in a table `width` wide. */
export function restWidth(shown: readonly Shown[], width: number): number {
  return Math.max(NAME_MIN, width - 2 - chrome(shown.length) - shown.reduce((n, s) => n + (s.w ?? 0), 0));
}

export function table(v: K8s, t: Theme, width: number): Element {
  const shown = shownColumns(v, width);
  const rows = listRows(v);
  const at = rowIndex(v, rows);
  const active = v.panel === "table";
  const title = v.drill ? `${titleOf(v.kind)} of ${v.drill.label}` : titleOf(v.kind);
  const right = `${rows.length ? at + 1 : 0} of ${rows.length}${v.filter ? ` · /${v.filter}` : ""}`;
  const feed = v.data.pods.error ?? v.data.snap.error;
  const rest = restWidth(shown, width);

  const body = v_flex().size_full()
    .child(header(v, t, shown, active, rest))
    .child(rows.length ? rowList(v, t, rows, at, active, shown) : empty(v, t, feed));

  return panel(t, "k8s-table", title, active, body, { num: panelNum("table"), right });
}

/** A column's box: its width as set, or the rest. */
const colBox = (el: Element, s: Shown): Element => (s.w === null ? el.flex_1().min_w(0) : el.w(s.w).flex_none());

/** The header: a click sorts by the column (again: the other way; a third time: the default order), a right
 *  click opens the columns menu, the right edge drags the width (a double click fits it). The column with the
 *  keys (`,` `.`) is underlined while the table has them. */
function header(v: K8s, t: Theme, shown: readonly Shown[], active: boolean, rest: number): Element {
  const by = v.columns.sorts.get(v.kind) ?? null;
  const focus = focusedColumn(v, shown);

  return h_flex().id("k8s-thead").h(18).flex_none().px(8).gap(10).items_center().text_size(10).text_color(t.dim)
    .child(div().w(8).flex_none())
    .children(shown.map((s, i) => {
      const sorted = by?.col === s.col.title;
      const label = `${s.col.title.toUpperCase()}${sorted ? (by?.desc ? " ↓" : " ↑") : ""}`;
      const lit = active && focus === s;
      const metric = (s.col.title === "cpu" || s.col.title === "mem") && v.data.metricsMissing;

      return colBox(h_flex().id(`th-${i}`).relative().h_full().items_center().cursor_pointer(), s)
        .when(Boolean(s.col.right), (el) => el.justify_end())
        .hover((st) => st.text_color(t.foreground))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => {
          cycleSort(v, s.col.title);
          v.panel = "table";
          keepInView(v);
          cx.notify();
        })
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          v.columns.at.set(v.kind, s.col.title);
          v.menu = columnsMenu(v, rest);
          cx.notify();
        })
        .when(metric, (el) => el.tooltip("metrics-server isn't answering kubectl top: no readings"))
        .child(div().truncate().text_color(sorted ? t.accent : lit ? t.foreground : t.dim).child(label))
        .when(lit, (el) => el.child(div().absolute().left(0).right(0).bottom(0).h(1).bg(t.accent)))
        .child(edge(v, t, s, rest));
    }));
}

/** A column's right edge in the header: dragged, it sets the width; a double click fits it to what it holds. */
function edge(v: K8s, t: Theme, s: Shown, rest: number): Element {
  const held = v.columns.drag?.col === s.col.title;

  return div().id(`th-edge-${s.col.title}`).absolute().top(0).bottom(0).right(-8).w(6).cursor_col_resize()
    .hover((st) => st.bg(`${t.accent}55`))
    .when(held, (el) => el.bg(t.accent))
    .on_mouse_down("left", (e, cx) => {
      stop(e, cx);

      if (e.click_count >= 2) {
        v.columns.drag = null;
        fitColumn(v, listRows(v), s);
      } else v.columns.drag = { kind: v.kind, col: s.col.title, x: unzoom(e.position.x), w: s.w ?? rest };

      cx.notify();
    });
}

/** A header edge's drag, followed over the whole window (the pointer leaves the edge at once):
 *  handed to the root's `tracking` (dividers.ts), since gpui-kit keeps one move handler per
 *  element and a second would replace the dividers' own. The release or the pointer leaving the
 *  window ends it and keeps the widths. */
export function columnDrag(v: K8s): Also {
  const end = (): boolean => {
    if (!v.columns.drag) return false;

    v.columns.drag = null;
    saveColumns(v.columns);

    return true;
  };

  return {
    move: (e) => {
      const g = v.columns.drag;

      if (!g || g.kind !== v.kind) return false;

      setWidth(v, g.col, g.w + unzoom(e.position.x) - g.x, false);

      return true;
    },
    up: end,
    leave: end,
  };
}

/** The resize pointer on the root while a header edge is held. */
export const columnCursor = (el: Element, v: K8s): Element => el.when(v.columns.drag !== null, (e) => e.cursor_col_resize());

/** The selected row back in sight after the order changed. */
export function keepInView(v: K8s): void {
  revealRow(v, rowIndex(v));
}

/** The rows as a virtual list: only the rows in sight are built, each frame one call. A click selects (a
 *  second within the double-click time opens), a right press opens the row's menu. */
function rowList(v: K8s, t: Theme, rows: readonly Row[], at: number, active: boolean, shown: readonly Shown[]): Element {
  const list = v_virtual_list("k8s-rows", rows.length, ROW_H, (i) => rows[i]?.key ?? String(i),
    (range) => rows.slice(range.start, range.end).map((r, k) => tableRow(v, t, r, range.start + k, range.start + k === at, active, shown)))
    .on_item_click((key, cx) => {
      const i = rows.findIndex((r) => r.key === key);
      const r = rows[i];

      if (!r) return;

      const twice = v.lastClick?.key === key && Date.now() - v.lastClick.at < DOUBLE_MS;

      selectAt(v, i);
      v.panel = "table";
      v.lastClick = twice ? null : { key, at: Date.now() };

      if (twice) runRow(v, "open", r, cx);

      cx.notify();
    })
    .on_item_secondary_click((key, _e, cx) => {
      const i = rows.findIndex((r) => r.key === key);
      const r = rows[i];

      if (!r) return;

      cx.stop_propagation();
      selectAt(v, i);
      v.menu = { title: r.ref.name, at: 0, rows: rowMenu(v, r) };
      cx.notify();
    })
    .track_scroll(v.tableScroll)
    .size_full();

  return div().id("k8s-rows").relative().flex_1().min_h(0)
    .on_size_change((size, cx) => {
      const h = Math.round(unzoom(size.height));

      if (h !== v.rowsHeight) {
        v.rowsHeight = h;
        cx.notify();
      }
    })
    .child(list)
    .child(Scrollbar.vertical("k8s-rows").absolute().inset_0());
}

function empty(v: K8s, t: Theme, error: string | null): Element {
  const text = error ? `kubectl: ${error}` : v.data.snap.at === 0 && v.data.pods.at === 0 ? "reading…" : v.filter ? `nothing matches /${v.filter} (esc clears it)` : `no ${titleOf(v.kind).toLowerCase()} in ${v.namespace ?? "any namespace"}`;

  return div().p(16).text_size(11).text_color(error ? t.blocked : t.dim).child(text);
}

function tableRow(v: K8s, t: Theme, r: Row, i: number, sel: boolean, active: boolean, shown: readonly Shown[]): Element {
  return h_flex().id(`row-${r.key}`).relative().h(ROW_H).flex_none().px(8).gap(10).items_center().text_size(11).cursor_pointer()
    .hover((s) => s.bg(`${t.ansi0}44`))
    .when(sel, (el) => el.children(band(t, active)))
    .child(div().relative().w(8).flex_none().flex().items_center().child(pip(t, r.tone, 7)))
    .children(shown.map((s, ci) => {
      const cell = r.cells[s.index] ?? null;
      const box = colBox(div().relative().min_w(0), s).when(Boolean(s.col.right), (el) => el.flex().justify_end());

      return box.child(cell ? drawCell(v, t, cell, sel, `${r.key}-${ci}`, { w: s.w ?? 100, first: i === 0 }) : div());
    }));
}

/** Where a cell is drawn: its column's width, whether it's the first row's. */
interface CellAt {
  readonly w: number;
  readonly first: boolean;
}

/** One cell as it's drawn. */
export function drawCell(v: K8s, t: Theme, c: Cell, sel: boolean, id: string, at: CellAt): Element {
  switch (c.t) {
    case "text": return div().truncate().text_color(c.tone ? toneColor(t, c.tone) : c.dim ? t.dim : sel ? t.foreground : t.muted).child(c.text);
    case "age": return div().text_color(t.dim).child(age(c.at));
    case "ready": return h_flex().gap(2).items_center()
      .children(c.blocks.map((b, i) => div().id(`${id}-b${i}`).w(6).h(9).flex_none().when(b === "ok" || b === "wk" || b === "done", (el) => el.bg(toneColor(t, b))).when(b === "bad" || b === "off", (el) => el.border(1).border_color(b === "bad" ? t.blocked : t.ansi0))))
      .child(div().pl(4).text_size(10).text_color(t.dim).child(c.text));
    case "marks": return marks(t, c.count, c.recent, id);
    case "metric": return metric(v, t, c, id, at);
    default: return div();
  }
}

/** Restarts as marks: a bar each (ten at most, then the number), faded when the last was over an hour ago. */
export function marks(t: Theme, count: number, recent: boolean, id: string): Element {
  if (count === 0) return div();

  const color = recent ? t.blocked : t.ansi8;

  return h_flex().gap(2).items_center().opacity(recent ? 1 : 0.6)
    .children(Array.from({ length: Math.min(count, 10) }, (_, i) => div().id(`${id}-m${i}`).w(2).h(9).flex_none().bg(color)))
    .when(count > 10, (el) => el.child(div().pl(3).text_size(10).text_color(color).child(String(count))));
}

/** A CPU or memory line over the readings so far, as wide as the column lets it, and the value now. Without
 *  metrics-server the first row says so, once, and the rest stay empty. */
function metric(v: K8s, t: Theme, c: Extract<Cell, { t: "metric" }>, id: string, at: CellAt): Element {
  if (v.data.metricsMissing) return at.first ? div().truncate().text_size(10).text_color(t.dim).child("no metrics-server") : div();

  const line = metricLine(v, c);
  const now = line[line.length - 1];

  if (now === undefined) return div().text_color(t.ansi0).child("·");

  const color = c.what === "cpu" ? t.accent : t.ansi5;
  const value = c.what === "cpu" ? cpuText(now) : memText(now);
  const graph = Math.max(16, Math.min(160, at.w - 50));

  return h_flex().gap(5).items_center()
    .child(spark(t, `${id}-sp`, line, graph, 11, color))
    .child(div().flex_none().text_size(10).text_color(t.muted).child(value));
}

/** A revealed secret's values, or the hidden ones. */
export function secretValues(v: K8s, t: Theme, r: Row): Element {
  const shown = v.secret?.key === r.key ? v.secret.values : null;
  const keys = (r.cells[2]?.t === "text" ? r.cells[2].text : "").split(" ").filter(Boolean);

  if (isString(shown)) return div().p(8).text_size(11).text_color(t.blocked).child(shown);

  return v_flex().id("secret-values").px(8).py(6).gap(3).text_size(11)
    .child(div().text_color(t.dim).child(shown ? "x hides the values again" : "x shows the values (on this row only, never kept)"))
    .children(keys.map((k) => h_flex().id(`sv-${k}`).gap(10).child(div().w(120).flex_none().truncate().text_color(t.accent).child(k)).child(div().flex_1().min_w(0).truncate().text_color(shown ? t.foreground : t.dim).child(shown?.get(k) ?? HIDDEN))));
}
