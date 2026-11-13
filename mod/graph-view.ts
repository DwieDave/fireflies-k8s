// A graph drawn: boxes as the GitHub window's Actions graph draws its jobs
// (a coloured edge, the status pip, the name and its kind, a sub line), the
// lines as dithered elbows (yellow into something on its way or failing, a
// pulse running along them), old replica sets faded and dashed, Argo's
// out-of-sync and missing resources outlined dashed yellow with a flag. A pod
// carries its CPU line and its restart marks. Click selects, a double click
// opens the object; a drag moves the picture (graph-pan.ts). A loop's values
// aren't zoomed as lengths are (gpui-kit applies them as they come): the
// pulses' are multiplied by the zoom here.

import { div } from "gpui-kit";
import type { Context, Element, MouseButtonEvent } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { default as K8s } from "./main.ts";
import type { Shown } from "./graph-shown.ts";
import type { Dims, Placed } from "./graph-layout.ts";
import { dither, icon, pip, spark, stop, toneColor, unzoom, zoom } from "./kit.ts";
import { cancel, centreOn, dragTo, newView, offset, panBy, press, release, roomy } from "./graph-pan.ts";
import { marks } from "./table.ts";

/** What a box press does: select (`open` false) or open (a double click, enter). */
export type OnBox = (b: Placed, open: boolean, cx: Context) => void;

type MouseHandler = (e: MouseButtonEvent, cx: Context) => void;

/** The graph's canvas: the picture moved to keep the selected box in view; dragged (a press on a box that
 *  doesn't move selects it), the wheel and H J K L pan it, a double click on the empty canvas centres the
 *  selected box again. */
export function canvas(v: K8s, t: Theme, s: Shown, _width: number, sel: string | null, active: boolean, onBox: OnBox, id: string): Element {
  const l = s.laid;
  const d = l.d;
  const view = v.canvases.get(id) ?? newView();
  const shown = sel ?? s.graph.root.key;

  v.canvases.set(id, view);

  const at = offset(l, shown, view);
  const grab = roomy(l, view);
  const pointer = (e: { readonly position: { readonly x: number; readonly y: number } }) => [unzoom(e.position.x), unzoom(e.position.y)] as const;

  const pressBox = (b: Placed): MouseHandler => (e, cx) => {
    stop(e, cx);

    if (e.click_count >= 2) {
      cancel(view);
      onBox(b, true, cx);
    } else press(view, ...pointer(e), b.node.key);

    cx.notify();
  };

  return div().id(id).relative().size_full().overflow_hidden()
    .when(grab, (el) => el.when(view.drag?.moved === true, (g) => g.cursor_grabbing()).when(view.drag?.moved !== true, (g) => g.cursor_grab()))
    .on_size_change((size, cx) => {
      const w = Math.round(unzoom(size.width));
      const h = Math.round(unzoom(size.height));

      if (w !== view.w || h !== view.h) {
        view.w = w;
        view.h = h;
        view.measured = true;
        view.follow = null;
        cx.notify();
      }
    })
    .on_scroll_wheel((e, cx) => {
      panBy(view, unzoom(-e.delta.x), unzoom(-e.delta.y));
      cx.notify();
    })
    .on_mouse_down("left", (e, cx) => {
      if (e.click_count >= 2) {
        cancel(view);
        centreOn(view, l, shown);
      } else press(view, ...pointer(e), null);

      cx.notify();
    })
    .on_mouse_move((e, cx) => {
      if (dragTo(view, ...pointer(e))) cx.notify();
    })
    .on_mouse_up("left", (_e, cx) => {
      const key = release(view);
      const b = key === null ? null : l.boxes.find((x) => x.node.key === key);

      if (b) onBox(b, false, cx);

      cx.notify();
    })
    .on_hover((h, cx) => {
      if (!h && cancel(view)) cx.notify();
    })
    .child(div().absolute().left(-at.x).top(-at.y).w(l.width).h(l.height)
      .children(l.segs.map((g, i) => div().id(`${id}-s${i}`).absolute().left(g.x).top(g.y).w(Math.max(1, g.w)).h(Math.max(1, g.h)).child(dither(g.live ? t.working : t.ansi8, 1))))
      .children(l.segs.filter((g) => g.live && g.h === 1 && g.w > 8).map((g, i) => div().id(`${id}-p${i}`).absolute().top(g.y - 1).w(5).h(3).bg(t.working).loop("left", { from: g.x * zoom(), to: (g.x + g.w - 5) * zoom(), period: 1100, easing: "linear" })))
      .children(l.segs.filter((g) => g.live && g.w === 1 && g.h > 8).map((g, i) => div().id(`${id}-q${i}`).absolute().left(g.x - 1).w(3).h(5).bg(t.working).loop("top", { from: g.y * zoom(), to: (g.y + g.h - 5) * zoom(), period: 900, easing: "linear" })))
      .children(l.boxes.map((b) => box(v, t, b, d, b.node.key === sel, active, pressBox(b), id))));
}

function box(v: K8s, t: Theme, b: Placed, d: Dims, sel: boolean, active: boolean, onPress: MouseHandler, id: string): Element {
  const n = b.node;
  const tone = toneColor(t, n.tone);
  const edge = sel ? (active ? t.accent : t.ansi8) : n.flag ? t.working : t.ansi0;
  const cpu = n.metric ? v.data.history.of(n.metric).map((x) => x.cpu) : [];

  return v_flex().id(`${id}-${n.key}`).absolute().left(b.x).top(b.y).w(d.w).h(d.h).pl(9).pr(7).pt(3).gap(2).bg(t.background).border(1).border_color(edge).cursor_pointer()
    .when(Boolean(n.ghost), (el) => el.opacity(0.45))
    .on_mouse_down("left", onPress)
    .child(div().absolute().left(-1).top(-1).bottom(-1).w(2).bg(tone))
    .when(Boolean(n.flag), (el) => el.child(div().absolute().right(-1).top(-10).h(11).px(3).text_size(9).bg(n.flag === "missing" ? t.ansi5 : t.working).text_color(t.background).child(n.flag ?? "")))
    .child(h_flex().gap(6).items_center().text_size(11).overflow_hidden()
      .child(n.icon ? icon(n.icon, tone, 11) : pip(t, n.tone, 7))
      .child(div().flex_1().min_w(0).truncate().text_color(sel ? t.foreground : t.muted).child(n.label))
      .child(div().flex_none().text_size(9).text_color(t.dim).child(n.kind)))
    .child(h_flex().gap(5).items_center().text_size(10).overflow_hidden()
      .child(div().flex_1().min_w(0).truncate().text_color(n.tone === "bad" ? t.blocked : t.dim).child(n.sub))
      .when((n.restarts ?? 0) > 0, (el) => el.child(marks(t, n.restarts ?? 0, n.tone === "bad", `${id}-${n.key}-r`)))
      .when(cpu.length > 1, (el) => el.child(spark(t, `${id}-${n.key}-c`, cpu, 28, 9, t.accent))));
}

/** A dithered rule with a word on it (a graph section's title). */
export function rule(t: Theme, text: string): Element {
  return h_flex().h(16).gap(8).items_center().px(8)
    .child(div().flex_none().text_size(10).text_color(t.ansi8).child(text.toUpperCase()))
    .child(div().flex_1().h(1).relative().opacity(0.6).child(dither(t.ansi8, 1)));
}
