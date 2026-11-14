// A graph drawn: boxes as the GitHub window's Actions graph draws its jobs
// (a coloured edge, the status pip, the name and its kind, a sub line), the
// lines as dithered elbows (yellow into something on its way or failing, a
// pulse running along them), old replica sets faded and dashed, Argo's
// out-of-sync and missing resources outlined dashed yellow with a flag. A pod
// carries its CPU line and its restart marks. Click selects, a double click
// opens the object; a drag moves the picture (graph-pan.ts). A loop's values
// aren't zoomed as lengths are (gpui-kit applies them as they come): the
// pulses' are multiplied by the zoom here.

import { div, Background } from "gpui-kit";
import type { Context, Element, MouseButtonEvent } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { default as K8s } from "./main.ts";
import type { Shown } from "./graph-shown.ts";
import type { Dims, Placed } from "./graph-layout.ts";
import { chip, dither, dotCell, icon, layer, pip, spark, stop, toneColor, unzoom, zoom } from "./kit.ts";
import { cancel, centreOn, dragTo, newView, offset, panBy, press, release, roomy } from "./graph-pan.ts";
import type { View } from "./graph-pan.ts";
import { ZOOM, lookAt, scaled, toggleFit, zoomAt, zoomStep } from "./graph-zoom.ts";
import { marks } from "./table.ts";
import { atPress } from "./menu-anchor.ts";

/** What a box press does: pick it (a click), open it (a double click, enter), or its menu (a right click). */
export type BoxAct = "pick" | "open" | "menu";

export type OnBox = (b: Placed, how: BoxAct, cx: Context) => void;

type MouseHandler = (e: MouseButtonEvent, cx: Context) => void;

/** The graph's canvas: the picture moved to keep the selected box in view; dragged (a press on a box that
 *  doesn't move selects it), the wheel and H J K L pan it, cmd- or ctrl-scroll zooms around the pointer, a
 *  double click on the empty canvas centres the selected box again; a right click on a box opens its menu.
 *  The zoom's chips sit at the foot: − the zoom + and fit. */
export function canvas(v: K8s, t: Theme, s: Shown, _width: number, sel: string | null, active: boolean, onBox: OnBox, id: string): Element {
  const view = v.canvases.get(id) ?? newView();
  const l = scaled(s.laid, view.z);
  const d = l.d;
  const shown = sel ?? s.graph.root.key;

  v.canvases.set(id, view);

  const at = offset(l, shown, view);
  const grab = roomy(l, view);
  // Only what's in sight (and a margin) is built: a graph of sixty pods costs what the panel shows.
  const seen = inSight(at, view);
  const boxes = l.boxes.filter((b) => seen(b.x, b.y, d.w, d.h));
  const segs = l.segs.map((g, i) => ({ g, i })).filter(({ g }) => seen(g.x, g.y, g.w, g.h));
  const line = (live: boolean) => layer(segs.filter(({ g }) => g.live === live).map(({ g }) => ({ x: g.x, y: g.y, w: Math.max(1, g.w), h: Math.max(1, g.h) })), Background.checkerboard(live ? t.working : t.ansi8, dotCell()), l.width, l.height);
  const pointer = (e: { readonly position: { readonly x: number; readonly y: number } }) => [unzoom(e.position.x), unzoom(e.position.y)] as const;

  const pressBox = (b: Placed): MouseHandler => (e, cx) => {
    stop(e, cx);

    if (e.click_count >= 2) {
      cancel(view);
      onBox(b, "open", cx);
    } else press(view, ...pointer(e), b.node.key);

    cx.notify();
  };

  const menuBox = (b: Placed): MouseHandler => (e, cx) => {
    cx.stop_propagation();
    cancel(view);
    atPress(v, e, () => onBox(b, "menu", cx));
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
      // cmd- or ctrl-scroll (a pinch, where the system sends one) zooms around the pointer; plain scroll pans.
      if (e.modifiers.platform || e.modifiers.control) {
        const p = e.local_position ?? { x: view.w / 2, y: view.h / 2 };

        zoomAt(view, view.z * Math.pow(ZOOM.step, -e.delta.y / 40), unzoom(p.x), unzoom(p.y));
      } else panBy(view, unzoom(-e.delta.x), unzoom(-e.delta.y));

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

      if (b) onBox(b, "pick", cx);

      cx.notify();
    })
    .on_hover((h, cx) => {
      if (!h && cancel(view)) cx.notify();
    })
    .child(div().absolute().left(-at.x).top(-at.y).w(l.width).h(l.height)
      // The lines as two painted layers (still and live), not an element each.
      .children(line(false)).children(line(true))
      .children(segs.filter(({ g }) => g.live && g.h === 1 && g.w > 8).map(({ g, i }) => div().id(`${id}-p${i}`).absolute().top(g.y - 1).w(5).h(3).bg(t.working).loop("left", { from: g.x * zoom(), to: (g.x + g.w - 5) * zoom(), period: 1100, easing: "linear" })))
      .children(segs.filter(({ g }) => g.live && g.w === 1 && g.h > 8).map(({ g, i }) => div().id(`${id}-q${i}`).absolute().left(g.x - 1).w(3).h(5).bg(t.working).loop("top", { from: g.y * zoom(), to: (g.y + g.h - 5) * zoom(), period: 900, easing: "linear" })))
      .children(boxes.map((b) => box(v, t, b, { d, z: view.z, sel: b.node.key === sel, active }, pressBox(b), menuBox(b), id))))
    .child(zoomChips(v, t, s, view, id));
}

/** The zoom at the canvas's foot: − and + step it, the number goes back to 100%, fit shows the whole graph. */
function zoomChips(v: K8s, t: Theme, s: Shown, view: View, id: string): Element {
  const act = (f: () => void) => (cx: Context) => {
    f();
    cx.notify();
  };

  return h_flex().id(`${id}-zoom`).absolute().left(6).bottom(4).gap(1).bg(t.background)
    .on_mouse_down("left", stop)
    .child(chip(t, `${id}-zout`, "−", false, act(() => zoomStep(view, -1)), t.dim))
    .child(chip(t, `${id}-z100`, `${Math.round(view.z * 100)}%`, false, act(() => {
      view.z = 1;
      view.follow = null;
    }), view.z === 1 ? t.dim : t.muted))
    .child(chip(t, `${id}-zin`, "+", false, act(() => zoomStep(view, 1)), t.dim))
    .child(chip(t, `${id}-zfit`, "fit", false, act(() => toggleFit(view, s.laid)), t.dim))
    .when(v.narrow(), (el) => el.opacity(0.8));
}

/** Whether a rectangle of the picture shows in the canvas moved by `at` (with a margin for a quick pan). */
export function inSight(at: { readonly x: number; readonly y: number }, view: { readonly w: number; readonly h: number }, margin = 120): (x: number, y: number, w: number, h: number) => boolean {
  return (x, y, w, h) => x + w >= at.x - margin && x <= at.x + view.w + margin && y + h >= at.y - margin && y <= at.y + view.h + margin;
}

/** How a box is drawn: the scaled box size, the zoom, whether it's selected and its panel has the keys. */
interface BoxLook {
  readonly d: Dims;
  readonly z: number;
  readonly sel: boolean;
  readonly active: boolean;
}

/** A box: its edge in the tone, its name and kind, a sub line with restarts and a CPU line; zoomed out, its
 *  name on one line, then its mark only. Hover names it whole, with its state. */
function box(v: K8s, t: Theme, b: Placed, look: BoxLook, onPress: MouseHandler, onMenu: MouseHandler, id: string): Element {
  const { d, z, sel, active } = look;
  const n = b.node;
  const tone = toneColor(t, n.tone);
  const edge = sel ? (active ? t.accent : t.ansi8) : n.flag ? t.working : t.ansi0;
  const cpu = n.metric ? v.data.history.of(n.metric).map((x) => x.cpu) : [];
  const level = lookAt(z);

  const frame = v_flex().id(`${id}-${n.key}`).absolute().left(b.x).top(b.y).w(d.w).h(d.h).bg(t.background).border(1).border_color(edge).cursor_pointer()
    .tooltip(`${n.kind} ${n.label}${n.sub ? ` · ${n.sub}` : ""}${n.flag ? ` · ${n.flag}` : ""}`)
    .when(Boolean(n.ghost), (el) => el.opacity(0.45))
    .on_mouse_down("left", onPress)
    .on_mouse_down("right", onMenu)
    .child(div().absolute().left(-1).top(-1).bottom(-1).w(2).bg(tone));

  if (level === "mark") return frame.items_center().justify_center().child(n.icon ? icon(n.icon, tone, Math.max(7, Math.round(13 * z))) : pip(t, n.tone, 6));

  const fs = (px: number) => Math.max(7, Math.round(px * z * 10) / 10);

  if (level === "line") return frame.justify_center().pl(Math.round(9 * z)).pr(Math.round(5 * z))
    .child(h_flex().gap(4).items_center().text_size(fs(11)).overflow_hidden()
      .child(n.icon ? icon(n.icon, tone, fs(11)) : pip(t, n.tone, 6))
      .child(div().flex_1().min_w(0).truncate().text_color(sel ? t.foreground : t.muted).child(n.label)));

  return frame.pl(Math.round(9 * z)).pr(Math.round(7 * z)).pt(Math.round(3 * z)).gap(Math.round(2 * z))
    .when(Boolean(n.flag), (el) => el.child(div().absolute().right(-1).top(-10).h(11).px(3).text_size(9).bg(n.flag === "missing" ? t.ansi5 : t.working).text_color(t.background).child(n.flag ?? "")))
    .child(h_flex().gap(6).items_center().text_size(fs(11)).overflow_hidden()
      .child(n.icon ? icon(n.icon, tone, 11) : pip(t, n.tone, 7))
      .child(div().flex_1().min_w(0).truncate().text_color(sel ? t.foreground : t.muted).child(n.label))
      .child(div().flex_none().text_size(fs(9)).text_color(t.dim).child(n.kind)))
    .child(h_flex().gap(5).items_center().text_size(fs(10)).overflow_hidden()
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
