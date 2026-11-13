// A graph drawn: boxes as the GitHub window's Actions graph draws its jobs
// (a coloured edge, the status pip, the name and its kind, a sub line), the
// lines as dithered elbows (yellow into something on its way or failing, a
// pulse running along them), old replica sets faded and dashed, Argo's
// out-of-sync and missing resources outlined dashed yellow with a flag. A pod
// carries its CPU line and its restart marks. Click selects, a double click
// opens the object.

import { div } from "gpui-kit";
import type { Context, Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { default as K8s } from "./main.ts";
import type { Shown } from "./graph-shown.ts";
import type { Dims, Placed } from "./graph-layout.ts";
import { dither, icon, pip, spark, stop, toneColor, unzoom } from "./kit.ts";
import { marks } from "./table.ts";

/** What a box press does: select (`open` false) or open (a double click, enter). */
export type OnBox = (b: Placed, open: boolean, cx: Context) => void;

/** A canvas's place: its size as drawn, the pan the wheel added, the box it last followed. */
export interface View {
  w: number;
  h: number;
  x: number;
  y: number;
  follow: string | null;
}

/** How far the picture is moved left and up inside its canvas. */
export interface Offset {
  readonly x: number;
  readonly y: number;
}

/** The offset that shows the picture inside the canvas: when the selection moves to a box out of
 *  sight it's brought to the middle; the wheel's pan otherwise; always inside the picture. */
export function offset(s: Shown, sel: string | null, view: View): Offset {
  const l = s.laid;
  const d = l.d;
  const b = l.boxes.find((x) => x.node.key === sel) ?? null;

  const seen = b !== null && b.x >= view.x && b.x + d.w <= view.x + view.w && b.y >= view.y && b.y + d.h <= view.y + view.h;

  if (sel !== view.follow) {
    view.follow = sel;

    if (b && !seen) {
      view.x = b.x + d.w / 2 - view.w / 2;
      view.y = b.y + d.h / 2 - view.h / 2;
    }
  }

  view.x = Math.max(0, Math.min(Math.max(0, l.width - view.w), view.x));
  view.y = Math.max(0, Math.min(Math.max(0, l.height - view.h), view.y));

  return { x: Math.round(view.x), y: Math.round(view.y) };
}

/** The graph's canvas: the picture moved to keep the selected box in view, the wheel pans it. */
export function canvas(v: K8s, t: Theme, s: Shown, _width: number, sel: string | null, active: boolean, onBox: OnBox, id: string): Element {
  const l = s.laid;
  const d = l.d;
  const view = v.canvases.get(id) ?? { w: 400, h: 300, x: 0, y: 0, follow: null };

  v.canvases.set(id, view);

  const at = offset(s, sel ?? s.graph.root.key, view);

  return div().id(id).relative().size_full().overflow_hidden()
    .on_size_change((size, cx) => {
      const w = Math.round(unzoom(size.width));
      const h = Math.round(unzoom(size.height));

      if (w !== view.w || h !== view.h) {
        view.w = w;
        view.h = h;
        view.follow = null;
        cx.notify();
      }
    })
    .on_scroll_wheel((e, cx) => {
      view.x += unzoom(-e.delta.x);
      view.y += unzoom(-e.delta.y);
      cx.notify();
    })
    .child(div().absolute().left(-at.x).top(-at.y).w(l.width).h(l.height)
      .children(l.segs.map((g, i) => div().id(`${id}-s${i}`).absolute().left(g.x).top(g.y).w(Math.max(1, g.w)).h(Math.max(1, g.h)).child(dither(g.live ? t.working : t.ansi8, 1))))
      .children(l.segs.filter((g) => g.live && g.h === 1 && g.w > 8).map((g, i) => div().id(`${id}-p${i}`).absolute().top(g.y - 1).w(5).h(3).bg(t.working).loop("left", { from: g.x, to: g.x + g.w - 5, period: 1100, easing: "linear" })))
      .children(l.boxes.map((b) => box(v, t, b, d, b.node.key === sel, active, onBox, id))));
}

function box(v: K8s, t: Theme, b: Placed, d: Dims, sel: boolean, active: boolean, onBox: OnBox, id: string): Element {
  const n = b.node;
  const tone = toneColor(t, n.tone);
  const edge = sel ? (active ? t.accent : t.ansi8) : n.flag ? t.working : t.ansi0;
  const cpu = n.metric ? v.data.history.of(n.metric).map((x) => x.cpu) : [];

  return v_flex().id(`${id}-${n.key}`).absolute().left(b.x).top(b.y).w(d.w).h(d.h).pl(9).pr(7).pt(3).gap(2).bg(t.background).border(1).border_color(edge).cursor_pointer()
    .when(Boolean(n.ghost), (el) => el.opacity(0.45))
    .on_mouse_down("left", (e, cx) => {
      stop(e, cx);
      onBox(b, e.click_count >= 2, cx);
      cx.notify();
    })
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
