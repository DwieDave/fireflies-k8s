// The kind's table: a header and a row per object, drawn graphically where a
// picture reads faster (readiness blocks, restart marks, CPU lines), the
// selected row banded. Columns that don't fit leave from the right before
// the name truncates. Click selects, a double click opens, a right click
// lists the row's actions.

import { div } from "gpui-kit";
import type { Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { default as K8s } from "./main.ts";
import type { Column } from "./rows-kinds.ts";
import { COLUMNS, CUSTOM_COLUMNS } from "./rows-kinds.ts";
import type { Cell, Row } from "./rows.ts";
import { band, panel, pip, spark, stop, toneColor } from "./kit.ts";
import { isBuiltin, titleOf } from "./kinds.ts";
import { listRows, rowIndex, selectAt } from "./nav.ts";
import { rowMenu, runRow } from "./actions.ts";
import { age } from "./time.ts";
import { cpuText, memText } from "./quantity.ts";
import { HIDDEN } from "./secrets.ts";
import { isString } from "./guard.ts";
import { panelNum } from "./panel-keys.ts";

const ROW_H = 22;

/** The columns that fit `width` (the name keeps at least 140 px). */
export function fitColumns(cols: readonly Column[], width: number): readonly Column[] {
  const out: Column[] = [];
  let used = 140 + 26;

  for (const c of cols) {
    if (c.w === null) {
      out.push(c);
      continue;
    }

    if (used + c.w + 10 > width) continue;

    used += c.w + 10;
    out.push(c);
  }

  return out;
}

export function table(v: K8s, t: Theme, width: number): Element {
  const all = isBuiltin(v.kind) ? COLUMNS[v.kind] : CUSTOM_COLUMNS;
  const cols = fitColumns(all, width);
  const keep = cols.map((c) => all.indexOf(c));
  const rows = listRows(v);
  const at = rowIndex(v, rows);
  const active = v.panel === "table";
  const title = v.drill ? `${titleOf(v.kind)} of ${v.drill.label}` : titleOf(v.kind);
  const right = `${rows.length ? at + 1 : 0} of ${rows.length}${v.filter ? ` · /${v.filter}` : ""}`;
  const feed = v.data.pods.error ?? v.data.snap.error;

  const body = v_flex().size_full()
    .child(header(t, cols))
    .child(v_flex().id("k8s-rows").flex_1().min_h(0).overflow_y_scroll().track_scroll(v.tableScroll)
      .children(rows.map((r, i) => tableRow(v, t, r, i, i === at, active, cols, keep)))
      .when(!rows.length, (el) => el.child(empty(v, t, feed))));

  return panel(t, "k8s-table", title, active, body, { num: panelNum("table"), right });
}

function header(t: Theme, cols: readonly Column[]): Element {
  return h_flex().h(18).flex_none().px(8).gap(10).items_center().text_size(10).text_color(t.dim)
    .child(div().w(8).flex_none())
    .children(cols.map((c, i) => div().id(`th-${i}`).when(c.w === null, (el) => el.flex_1().min_w(0)).when(c.w !== null, (el) => el.w(c.w ?? 0).flex_none()).when(Boolean(c.right), (el) => el.text_right()).child(c.title.toUpperCase())));
}

function empty(v: K8s, t: Theme, error: string | null): Element {
  const text = error ? `kubectl: ${error}` : v.data.snap.at === 0 && v.data.pods.at === 0 ? "reading…" : v.filter ? `nothing matches /${v.filter} (esc clears it)` : `no ${titleOf(v.kind).toLowerCase()} in ${v.namespace ?? "any namespace"}`;

  return div().p(16).text_size(11).text_color(error ? t.blocked : t.dim).child(text);
}

function tableRow(v: K8s, t: Theme, r: Row, i: number, sel: boolean, active: boolean, cols: readonly Column[], keep: readonly number[]): Element {
  return h_flex().id(`row-${r.key}`).relative().h(ROW_H).flex_none().px(8).gap(10).items_center().text_size(11).cursor_pointer()
    .hover((s) => s.bg(`${t.ansi0}44`))
    .when(sel, (el) => el.children(band(t, active)))
    .on_mouse_down("left", (e, cx) => {
      stop(e, cx);
      selectAt(v, i);
      v.panel = "table";

      if (e.click_count >= 2) runRow(v, "open", r, cx);

      cx.notify();
    })
    .on_mouse_down("right", (_e, cx) => {
      cx.stop_propagation();
      selectAt(v, i);
      v.menu = { title: r.ref.name, at: 0, rows: rowMenu(v, r) };
      cx.notify();
    })
    .child(div().relative().w(8).flex_none().flex().items_center().child(pip(t, r.tone, 7)))
    .children(cols.map((c, ci) => {
      const cell = r.cells[keep[ci] ?? -1] ?? null;
      const box = div().relative().min_w(0).when(c.w === null, (el) => el.flex_1()).when(c.w !== null, (el) => el.w(c.w ?? 0).flex_none()).when(Boolean(c.right), (el) => el.flex().justify_end());

      return box.child(cell ? drawCell(v, t, cell, sel, `${r.key}-${ci}`) : div());
    }));
}

/** One cell as it's drawn. */
export function drawCell(v: K8s, t: Theme, c: Cell, sel: boolean, id: string): Element {
  switch (c.t) {
    case "text": return div().truncate().text_color(c.tone ? toneColor(t, c.tone) : c.dim ? t.dim : sel ? t.foreground : t.muted).child(c.text);
    case "age": return div().text_color(t.dim).child(age(c.at));
    case "ready": return h_flex().gap(2).items_center()
      .children(c.blocks.map((b, i) => div().id(`${id}-b${i}`).w(6).h(9).flex_none().when(b === "ok" || b === "wk" || b === "done", (el) => el.bg(toneColor(t, b))).when(b === "bad" || b === "off", (el) => el.border(1).border_color(b === "bad" ? t.blocked : t.ansi0))))
      .child(div().pl(4).text_size(10).text_color(t.dim).child(c.text));
    case "marks": return marks(t, c.count, c.recent, id);
    case "metric": return metric(v, t, c, id);
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

/** A CPU or memory line over the readings so far, and the value now. */
function metric(v: K8s, t: Theme, c: Extract<Cell, { t: "metric" }>, id: string): Element {
  if (v.data.metricsMissing) return div().text_color(t.ansi0).child("—");

  const keys = c.pods.map((p) => (p.startsWith("node:") ? p : p.includes("/") ? p : `${v.namespace ?? ""}/${p}`));
  const line = v.data.history.sum(keys).map((s) => (c.what === "cpu" ? s.cpu : s.mem));
  const now = line[line.length - 1];

  if (now === undefined) return div().text_color(t.ansi0).child("·");

  const color = c.what === "cpu" ? t.accent : t.ansi5;

  return h_flex().gap(4).items_center()
    .child(spark(t, `${id}-sp`, line, 30, 11, color))
    .child(div().text_size(10).text_color(t.muted).child(c.what === "cpu" ? cpuText(now) : memText(now)));
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
