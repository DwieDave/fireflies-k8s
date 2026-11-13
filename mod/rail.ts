// The rail: [1] the contexts (a production-looking one tagged, a read-only
// one marked), [2] the namespaces, each with its pods as a strip of cells
// (failing first, so a broken namespace shows red before it's opened; 0 is
// every namespace), [3] the kinds with their counts (failing ones counted in
// red). One list for the keyboard (menus.ts railItems), three panels drawn.

import { div } from "gpui-kit";
import type { Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { default as K8s } from "./main.ts";
import { band, icon, panel, pip, stop, toneColor } from "./kit.ts";
import type { RailItem } from "./menus.ts";
import { railItems, pickRail } from "./menus.ts";
import { looksProd } from "./contexts.ts";
import { isBuiltin, kindInfo, titleOf } from "./kinds.ts";
import { customOfCluster } from "./derive.ts";
import type { Tone } from "./rows.ts";

/** The rail: the contexts as tall as their rows (at most five shown), the namespaces and the
 *  kinds sharing the rest, each scrolling, the cursor's row kept in sight. */
export function rail(v: K8s, t: Theme): Element {
  const items = railItems(v);
  const active = v.panel === "rail";
  const rows = items.map((item, i) => railRow(v, t, item, i, active && i === v.railAt));
  const of = (part: RailItem["part"]) => rows.filter((_, i) => items[i]?.part === part);
  const custom = customOfCluster(v.data).length;
  const cursor = items[v.railAt];
  const nContexts = items.filter((x) => x.part === "context").length;
  const firstOf = (part: RailItem["part"]) => items.findIndex((x) => x.part === part);

  if (active && cursor?.part === "namespace") v.nsScroll.scroll_to_item(v.railAt - firstOf("namespace"));

  if (active && cursor?.part === "kind") v.kindsScroll.scroll_to_item(v.railAt - firstOf("kind"));

  const kinds = v_flex().id("rail-kinds-list").size_full().pt(4).pb(2).overflow_y_scroll().track_scroll(v.kindsScroll).children(of("kind"))
    .when(custom > 0, (el) => el.child(div().id("rail-custom").h(20).flex_none().px(10).flex().items_center().text_size(11).text_color(t.dim).cursor_pointer()
      .on_click((_e, cx) => {
        v.typing = { what: "kind", text: "" };
        cx.notify();
      })
      .child(`+ ${custom} custom kinds (: or ctrl-a)`)));

  return v_flex().id("k8s-rail").size_full().gap(12)
    .child(v_flex().h(28 + Math.min(5, Math.max(1, nContexts)) * 20).flex_none()
      .child(panel(t, "rail-ctx", "Context", active && cursor?.part === "context", v_flex().id("rail-ctx-list").size_full().pt(4).overflow_y_scroll().children(of("context")), { num: "1" })))
    .child(v_flex().flex_1().min_h(0)
      .child(panel(t, "rail-ns", "Namespaces", active && cursor?.part === "namespace", v_flex().id("rail-ns-list").size_full().pt(4).pb(2).overflow_y_scroll().track_scroll(v.nsScroll).children(of("namespace")), { num: "2", right: v.namespace === null ? "all" : null })))
    .child(v_flex().flex_1().min_h(0)
      .child(panel(t, "rail-kinds", "Kinds", active && cursor?.part === "kind", kinds, { num: "3", right: ": jump" })));
}

function railRow(v: K8s, t: Theme, item: RailItem, i: number, cursor: boolean): Element {
  const chosen = item.part === "context" ? item.context.name === v.context : item.part === "namespace" ? item.strip.name === v.namespace : item.kind === v.kind;

  const row = div().id(`rail-${i}`).relative().flex_none().px(8).cursor_pointer().text_size(11)
    .hover((s) => s.bg(`${t.ansi0}55`))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      v.railAt = i;
      v.panel = "rail";
      pickRail(v, item);
      cx.notify();
    })
    .when(cursor || chosen, (el) => el.children(band(t, cursor)));

  if (item.part === "context") {
    const c = item.context;
    const prod = looksProd(c, v.settings.prod);

    return row.h(20).child(h_flex().relative().h_full().gap(7).items_center()
      .child(pip(t, chosen ? "ok" : "off", 6))
      .child(div().flex_1().min_w(0).truncate().text_color(chosen ? t.foreground : t.muted).child(c.name))
      .when(prod, (el) => el.child(div().flex_none().px(3).h(13).text_size(9).bg(t.blocked).text_color(t.background).child("prod")))
      .when(v.settings.readonly.has(c.name), (el) => el.child(div().flex_none().px(3).h(13).text_size(9).border(1).border_color(t.working).text_color(t.working).child("ro"))));
  }

  if (item.part === "namespace") {
    const s = item.strip;
    const key = item.n <= 9 ? String(item.n) : "";

    return row.h(30).child(v_flex().relative().h_full().justify_center().gap(3)
      .child(h_flex().gap(7).items_center()
        .child(div().w(8).flex_none().text_color(cursor ? t.accent : t.dim).child(key))
        .child(div().flex_1().min_w(0).truncate().text_color(chosen ? t.foreground : t.muted).child(s.name ?? "all"))
        .when(s.bad > 0, (el) => el.child(div().flex_none().text_color(t.blocked).child(`${s.bad}✕`)))
        .child(div().flex_none().text_color(t.dim).child(String(s.tones.length))))
      .child(cells(t, s.tones)));
  }

  const name = isBuiltin(item.kind) ? kindInfo(item.kind).icon : "file";

  return row.h(20).child(h_flex().relative().h_full().gap(7).items_center()
    .child(icon(name, chosen ? t.accent : t.dim, 11))
    .child(div().flex_1().min_w(0).truncate().text_color(chosen ? t.foreground : t.muted).child(titleOf(item.kind)))
    .when(item.bad > 0, (el) => el.child(div().flex_none().text_color(t.blocked).child(`${item.bad}✕`)))
    .child(div().flex_none().text_color(t.dim).child(item.count === null ? "" : String(item.count))));
}

/** A namespace's pods as 5 px cells (up to two rows; more are counted). */
export function cells(t: Theme, tones: readonly Tone[]): Element {
  const shown = tones.slice(0, 64);

  return h_flex().pl(15).gap(1).flex_wrap().max_h(11).overflow_hidden()
    .children(shown.map((tone, i) => div().id(`c-${i}`).size(5).flex_none().when(tone === "off", (el) => el.border(1).border_color(t.ansi0)).when(tone !== "off", (el) => el.bg(toneColor(t, tone)))));
}
