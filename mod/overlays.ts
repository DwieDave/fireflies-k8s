// What opens over the window's body: a menu (right-click, a picker), the ask
// card before a write (red, naming the context and namespace; a second step
// that wants the name typed), and the keys overview (?).

import { div } from "gpui-kit";
import type { Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { default as K8s } from "./main.ts";
import { popupScrim, stop } from "./kit.ts";
import { keysView } from "./keyhelp.ts";
import type { KeySection } from "./keyhelp.ts";
import { ARGO_KEYS, FORWARD_KEYS, GRAPH_KEYS, ROW_KEYS, WINDOW_KEYS } from "./keys.ts";
import { asksTwice, whereOf } from "./confirm.ts";
import { clusterOf, runAsk } from "./writes.ts";
import { looksProd } from "./contexts.ts";
import { pickMenu } from "./input.ts";

export function menuBox(v: K8s, t: Theme): Element | null {
  const m = v.menu;

  if (!m) return null;

  const rows = m.rows.map((r, i) => h_flex().id(`menu-${i}`).relative().h(r.sub ? 32 : 22).flex_none().px(10).gap(10).items_center().cursor_pointer()
    .hover((s) => s.bg(`${t.ansi0}66`))
    .when(i === m.at, (el) => el.bg(t.ansi0).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      pickMenu(v, i, cx);
      cx.notify();
    })
    .child(div().w(46).flex_none().text_color(t.accent).child(r.key ?? (i < 9 ? String(i + 1) : "")))
    .child(v_flex().flex_1().min_w(0)
      .child(div().truncate().text_color(r.danger ? t.blocked : i === m.at ? t.foreground : t.muted).child(r.label))
      .when(Boolean(r.sub), (el) => el.child(div().truncate().text_size(10).text_color(t.dim).child(r.sub ?? "")))));

  return div().id("k8s-menu").absolute().inset_0().flex().items_center().justify_center().text_size(11)
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();
      v.menu = null;
      cx.notify();
    })
    .child(popupScrim("k8s-menu-scrim"))
    .child(v_flex().id("k8s-menu-box").w(Math.min(460, v.size.width - 24)).max_h(Math.min(440, v.size.height - 60)).bg(t.background).border(1).border_color(t.accent).py(4).overflow_y_scroll()
      .on_mouse_down("left", stop)
      .child(div().px(10).pb(4).text_size(10).text_color(t.ansi8).child(m.title))
      .children(rows));
}

/** The card a write waits on. */
export function askCard(v: K8s, t: Theme): Element | null {
  const a = v.ask;

  if (!a) return null;

  const twice = asksTwice(a.kind, a.context, clusterOf(v), v.settings);
  const prod = looksProd({ name: a.context, cluster: clusterOf(v) }, v.settings.prod);
  const matches = a.typed === a.name;

  const first = v_flex().gap(8)
    .child(div().text_color(t.foreground).child(a.title))
    .child(h_flex().gap(6).child(div().text_color(t.dim).child("in")).child(div().text_color(t.ansi6).child(whereOf(a))).when(prod, (el) => el.child(div().px(4).h(14).text_size(10).bg(t.blocked).text_color(t.background).child("production"))))
    .children(a.detail.map((d, i) => div().id(`ask-d-${i}`).text_size(11).text_color(t.muted).child(d)))
    .when(a.args.length > 0, (el) => el.child(div().text_size(10).text_color(t.dim).child(`kubectl ${a.args.join(" ")}`)));

  const second = v_flex().gap(6)
    .child(div().text_color(t.blocked).child(`Type ${a.name} to ${a.kind}`))
    .child(h_flex().h(24).px(8).items_center().border(1).border_color(matches ? t.blocked : t.ansi0).child(div().text_color(t.foreground).child(a.typed)).child(div().w(6).h(12).bg(t.blocked).loop("opacity", { from: 0.2, to: 1, period: 900 })));

  const yes = a.step === 1 ? (twice ? "y  next" : "y  yes") : matches ? "enter  yes" : "type the name";

  return div().id("k8s-ask").absolute().inset_0().flex().items_center().justify_center().text_size(12)
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();
      v.ask = null;
      cx.notify();
    })
    .child(popupScrim("k8s-ask-scrim"))
    .child(v_flex().id("k8s-ask-box").w(Math.min(480, v.size.width - 24)).bg(t.background).border(1).border_color(t.blocked).p(16).gap(12)
      .on_mouse_down("left", stop)
      .child(a.step === 1 ? first : second)
      .child(h_flex().gap(14).justify_end().text_size(11)
        .child(div().id("ask-no").cursor_pointer().text_color(t.muted).on_click((_e, cx) => {
          v.ask = null;
          cx.notify();
        }).child("esc  no"))
        .child(div().id("ask-yes").cursor_pointer().text_color(t.blocked).on_click((_e, cx) => {
          if (a.step === 1 && twice) v.ask = { ...a, step: 2 };
          else if (a.step === 1 || matches) runAsk(v, a, cx);

          cx.notify();
        }).child(yes))));
}

/** ?: the keys of what's shown, and the window's. */
export function helpPanel(v: K8s, t: Theme): Element | null {
  if (!v.help) return null;

  const tab: KeySection = v.tab === "argo" ? { title: "argo cd", keys: ARGO_KEYS }
    : v.tab === "forwards" ? { title: "forwards", keys: FORWARD_KEYS }
    : { title: "the selected row", keys: ROW_KEYS.map(([k, , w]) => [k, w] as const) };

  const graph: readonly KeySection[] = v.tab === "forwards" ? [] : [{ title: "a graph", keys: v.tab === "argo" ? GRAPH_KEYS.filter(([k]) => k !== "O") : GRAPH_KEYS }];

  return div().id("k8s-help").absolute().inset_0().bg(t.background).child(keysView(t, {
    id: "k8s-keys-view", title: "Kubernetes", list: [tab, ...graph, { title: "window", keys: WINDOW_KEYS }], close: () => {
      v.help = false;
    },
  }));
}
