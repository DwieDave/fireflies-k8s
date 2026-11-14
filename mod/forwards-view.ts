// Port-forwards drawn: the shelf over the key bar (each running forward, its
// ports, where it leads, as buttons), and the Forwards tab (every forward,
// running or ended, with its keys).

import { div } from "gpui-kit";
import type { Context, Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { default as K8s } from "./main.ts";
import { band, dither, icon, panel, pip, stop } from "./kit.ts";
import type { Forward } from "./forwards.ts";
import { forwards, openDatabases, openWeb, stopForward } from "./integrate.ts";
import { leadsMenu } from "./input-tabs.ts";
import { atPress } from "./menu-anchor.ts";

/** A forward's lead as a small button. */
function lead(t: Theme, id: string, ic: string, label: string, go: (cx: Context) => void): Element {
  return h_flex().id(id).relative().h(16).px(5).gap(4).items_center().border(1).border_color(t.ansi0).bg(t.background).text_color(t.accent).cursor_pointer()
    .hover((s) => s.border_color(t.accent))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      cx.stop_propagation();
      go(cx);
      cx.notify();
    })
    .child(icon(ic, t.accent, 10)).child(div().child(label));
}

/** Where a forward leads, as buttons (Databases only when that mod is installed). */
function leads(v: K8s, t: Theme, f: Forward, i: number): Element[] {
  const out: Element[] = [];

  if (f.web) out.push(lead(t, `fw-web-${i}`, "globe", v.narrow() ? "web" : "Open in a web pane", (cx) => openWeb(v, f, cx)));

  if (f.db && v.databases) out.push(lead(t, `fw-db-${i}`, "database", v.narrow() ? "db" : "Open in Databases", (cx) => openDatabases(v, f, f.db ?? "postgres", cx)));

  return out;
}

/** The shelf: the live forwards over the key bar (none: not drawn). */
export function shelf(v: K8s, t: Theme): Element | null {
  const live = forwards().filter((f) => f.live);

  if (!live.length) return null;

  return h_flex().id("k8s-shelf").relative().h(26).flex_none().px(10).gap(14).items_center().text_size(11).overflow_hidden()
    .child(div().absolute().inset_0().opacity(0.35).child(dither(t.ansi0, 1)))
    .child(div().relative().flex_none().text_size(10).text_color(t.ansi8).child("FORWARDS"))
    .children(live.slice(0, 4).map((f, i) => h_flex().id(`shelf-${i}`).relative().flex_none().gap(6).items_center().text_color(t.muted).cursor_pointer()
      .on_mouse_down("right", (e, cx) => {
        cx.stop_propagation();
        atPress(v, e, () => { v.menu = { title: `forward ${f.target}`, at: 0, rows: leadsMenu(v, f) }; });
        cx.notify();
      })
      .child(icon("plug", t.ansi6, 11))
      .child(div().child(f.target))
      .child(div().text_color(t.ansi6).child(`:${f.remote} → localhost:${f.local}`))
      .children(leads(v, t, f, i))))
    .child(div().flex_1())
    .when(live.length > 4, (el) => el.child(div().relative().text_color(t.dim).child(`+${live.length - 4}`)))
    .child(div().relative().flex_none().text_color(t.dim).child("f forwards"));
}

/** The Forwards tab. */
export function forwardsTab(v: K8s, t: Theme): Element {
  const list = forwards();
  const at = Math.min(v.forwardAt, list.length - 1);

  const rows = list.map((f, i) => h_flex().id(`fwd-${i}`).relative().h(30).flex_none().px(10).gap(12).items_center().text_size(11).cursor_pointer()
    .hover((s) => s.bg(`${t.ansi0}44`))
    .when(i === at, (el) => el.children(band(t, true)))
    .on_mouse_down("left", (e, cx) => {
      stop(e, cx);
      v.forwardAt = i;

      if (e.click_count >= 2) atPress(v, e, () => { v.menu = { title: `forward ${f.target}`, at: 0, rows: leadsMenu(v, f) }; });

      cx.notify();
    })
    .on_mouse_down("right", (e, cx) => {
      cx.stop_propagation();
      v.forwardAt = i;
      atPress(v, e, () => { v.menu = { title: `forward ${f.target}`, at: 0, rows: leadsMenu(v, f) }; });
      cx.notify();
    })
    .child(div().relative().child(pip(t, f.live ? "ok" : "off", 7)))
    .child(v_flex().relative().flex_1().min_w(0)
      .child(h_flex().gap(8).child(div().text_color(i === at ? t.foreground : t.muted).child(f.target)).child(div().text_color(t.ansi6).child(`:${f.remote} → localhost:${f.local}`)))
      .child(div().text_size(10).text_color(t.dim).child(`${f.context} / ${f.namespace} · ${f.live ? "running" : "ended"}${f.db ? ` · ${f.db}` : f.web ? ` · ${f.web}` : ""} · terminal ${f.address}`)))
    .children(leads(v, t, f, i).map((el) => el.relative()))
    .when(f.live, (el) => el.child(lead(t, `fw-x-${i}`, "trash", "stop", () => stopForward(f)))));

  const body = v_flex().id("fwd-list").size_full().pt(4).overflow_y_scroll().children(rows)
    .when(!list.length, (el) => el.child(div().p(16).text_size(11).text_color(t.dim).child("no port-forwards: F on a pod, service or deployment starts one (a terminal of its own, here until you stop it)")));

  return div().size_full().p(10).child(panel(t, "k8s-forwards", "Port-forwards", true, body, { right: "enter leads · p peek · t pane · x stop" }));
}
