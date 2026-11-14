// What opens over the window: a menu (right-click, a picker; over the whole
// view, at the press or at what the keys are on: menu-anchor.ts), the ask
// card before a write (red, naming the context and namespace; a second step
// that wants the name typed), and the keys overview (?).

import { div } from "gpui-kit";
import type { Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { default as K8s } from "./main.ts";
import { dither, popupScrim, stop } from "./kit.ts";
import { keysView } from "./keyhelp.ts";
import type { KeySection } from "./keyhelp.ts";
import { ARGO_KEYS, FORWARD_KEYS, GRAPH_KEYS, RAIL_KEYS, ROW_KEYS, TABLE_KEYS, WINDOW_KEYS } from "./keys.ts";
import { asksTwice, whereOf } from "./confirm.ts";
import { clusterOf, runAsk } from "./writes.ts";
import { looksProd } from "./contexts.ts";
import { pickMenu } from "./input.ts";
import { shownKey } from "./state.ts";
import { MARGIN, placeMenu } from "./menu-place.ts";
import { keyedAnchor } from "./menu-anchor.ts";

/** A menu's width: its longest line whole (label at 11 px, a second line at 10 px, the key column and
 *  padding beside them), at least 460, at most the window less a margin. */
export function menuWidth(m: { readonly title: string; readonly rows: readonly { readonly label: string; readonly sub?: string | null }[] }, room: number): number {
  const chars = (s: string, px: number): number => [...s].length * px * 0.68;
  const need = Math.max(chars(m.title, 10) + 20, ...m.rows.map((r) => 96 + Math.max(chars(r.label, 11), chars(r.sub ?? "", 10))));

  return Math.max(Math.min(460, room - 24), Math.min(Math.ceil(need), 820, room - 24));
}

/** A menu's height with every row whole: the title, the find line, each row (22, or 32 with a second line). */
export function menuHeight(m: { readonly rows: readonly { readonly sub?: string | null }[]; readonly find?: unknown }): number {
  return 8 + 18 + (m.find ? 26 : 0) + m.rows.reduce((n, r) => n + (r.sub ? 38 : 22), 0) + 2;
}

export function menuBox(v: K8s, t: Theme): Element | null {
  const m = v.menu;

  if (!m) return null;

  // Its room: the view less a margin; taller menus scroll with a mark at the foot.
  const room = Math.max(120, v.size.height - 2 * MARGIN - 4);
  const over = menuHeight(m) > room;
  const w = menuWidth(m, v.size.width);
  // At the press (a right click), at what the keys are on (the table's row), else in the middle.
  const at = placeMenu({ width: w, height: Math.min(room, menuHeight(m) + (over ? 16 : 0)) }, v.size, m.near ?? keyedAnchor(v));

  if (over) v.menuScroll.scroll_to_item(m.at);

  const rows = m.rows.map((r, i) => h_flex().id(`menu-${i}`).relative().when(!r.sub, (el) => el.h(22)).when(Boolean(r.sub), (el) => el.min_h(32).py(3)).flex_none().px(10).gap(10).items_center().cursor_pointer()
    .hover((s) => s.bg(`${t.ansi0}66`))
    .when(i === m.at, (el) => el.bg(t.ansi0).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      pickMenu(v, i, cx);
      cx.notify();
    })
    .child(div().w(46).flex_none().text_color(t.accent).child(shownKey(m, i) ?? ""))
    .child(v_flex().flex_1().min_w(0)
      .child(div().truncate().text_color(r.danger ? t.blocked : i === m.at ? t.foreground : t.muted).child(r.label))
      // The second line whole: the box is as wide as it needs (menuWidth); narrower than that, it wraps.
      .when(Boolean(r.sub), (el) => el.child(div().text_size(10).text_color(t.dim).child(r.sub ?? "")))));

  return div().id("k8s-menu").absolute().inset_0().text_size(11)
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();
      v.menu = null;
      cx.notify();
    })
    .child(popupScrim("k8s-menu-scrim"))
    .child(v_flex().id("k8s-menu-box").absolute().left(at.x).top(at.y).w(w).max_h(room).bg(t.background).border(1).border_color(t.accent).py(4)
      .on_mouse_down("left", stop)
      .child(div().flex_none().px(10).pb(4).text_size(10).text_color(t.ansi8).child(m.title))
      .when(Boolean(m.find), (el) => el.child(findLine(t, m.find?.text ?? "", m.find?.hint ?? "")))
      .child(v_flex().id("k8s-menu-rows").flex_1().min_h(0).overflow_y_scroll().track_scroll(v.menuScroll).children(rows)
        .when(Boolean(m.find) && !m.rows.length, (el) => el.child(div().px(10).py(4).text_color(t.dim).child(`nothing holds "${m.find?.text ?? ""}" (backspace)`))))
      // Taller than its room: it scrolls (the cursor's row kept in sight) and says there's more.
      .when(over, (el) => el.child(h_flex().flex_none().h(16).px(10).gap(6).items_center().text_size(10).text_color(t.dim)
        .child(div().flex_1().h(1).relative().child(dither(t.ansi8, 1))).child(div().child(`${m.rows.length} rows · ↑ ↓ or the wheel for more`)))));
}

/** A find menu's typed line: what's typed, a caret, what the keys do. */
function findLine(t: Theme, text: string, hint: string): Element {
  return h_flex().h(22).mx(10).mb(4).px(6).gap(4).items_center().border(1).border_color(t.ansi0)
    .child(div().text_color(t.accent).child("›"))
    .child(div().text_color(t.foreground).child(text))
    .child(div().w(6).h(12).bg(t.accent).loop("opacity", { from: 0.2, to: 1, period: 900 }))
    .child(div().flex_1())
    .child(div().text_size(10).text_color(t.dim).child(hint));
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
  const columns: readonly KeySection[] = v.tab === "resources" ? [{ title: "the table's columns", keys: TABLE_KEYS }, { title: "the rail", keys: RAIL_KEYS }] : [];

  return div().id("k8s-help").absolute().inset_0().bg(t.background).child(keysView(t, {
    id: "k8s-keys-view", title: "Kubernetes", list: [tab, ...columns, ...graph, { title: "window", keys: WINDOW_KEYS }], close: () => {
      v.help = false;
    },
  }));
}
