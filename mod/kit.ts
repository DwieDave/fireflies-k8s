// Nocturne's look for the k8s window (a mod can't import another mod's
// files, so the pieces are copied, as the GitHub and procs windows carry
// theirs): the dither, pips, the lazygit-style panel, chips, the selection
// band, the in-window scrim, tones as theme colours, and the dithered line
// graphs (as procs' system graphs: dithered columns with a 1 px head).

import { div, svg, PathBuilder, Background } from "gpui-kit";
import type { Color, Context, Element, MouseButtonEvent, Path } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { settings, window as appWindow } from "herdr";
import type { Theme } from "herdr";
import type { Tone } from "./rows.ts";

/** The mod's folder under the app's: its icons are drawn from there. */
export const HOME = "mods/k8s";

export const stop = (_e: MouseButtonEvent, cx: Context): void => cx.stop_propagation();

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

/** The app's zoom: lengths a script writes are drawn this much bigger. */
export function zoom(): number {
  const z = settings().zoom;

  return z > 0 ? z : 1;
}

/** A drawn length (a measured size, a pointer position) in the px scripts write. */
export const unzoom = (v: number): number => v / zoom();

/** The dither's cell in device px. */
export const dotCell = (): number => Math.max(1, Math.round(zoom() * (retina() ? 2 : 1)));

/** macOS draws at twice the pixels (no window yet, as in `herdr-app check`: taken as macOS). */
function retina(): boolean {
  const w: { readonly platform: string } | null = appWindow();

  return (w?.platform ?? "macos") === "macos";
}

/** A layer filling its parent with a 50% checker dither. */
export function dither(color: Color, cell = 1): Element {
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * dotCell())))).absolute().top(0).left(0).size_full();
}

/** The dim under a popup inside the window (as git's and github's). */
export const POPUP_SCRIM: Color = "#0000008c";

export function popupScrim(id: string): Element {
  return div().id(id).absolute().inset_0().child(dither(POPUP_SCRIM, 1));
}

/** A tone's theme colour. */
export function toneColor(t: Theme, tone: Tone | null | undefined): Color {
  switch (tone) {
    case "ok": return t.done;
    case "wk": return t.working;
    case "bad": return t.blocked;
    case "done": return t.dim;
    case "miss": return t.ansi5;
    default: return t.ansi8;
  }
}

/** One of the mod's icons, tinted. */
export function icon(name: string, color: Color, size = 13): Element {
  return svg(`${HOME}/icons/${name}.svg`).size(size).flex_none().text_color(color);
}

/** A status pip: on its way breathes, failing blinks now and then. */
export function pip(t: Theme, tone: Tone | null, size = 7): Element {
  if (tone === null) return div().size(size).flex_none();

  if (tone === "off" || tone === "done") return div().size(size - 1).flex_none().border(1).border_color(toneColor(t, tone));

  const el = svg(`${HOME}/icons/pip.svg`).size(size).flex_none().text_color(toneColor(t, tone));

  if (tone === "wk") return el.loop("opacity", { from: 0.3, to: 1, period: 1400 });

  if (tone === "bad") return el.loop("opacity", { from: 0.5, to: 1, period: 2600 });

  return el;
}

/** The selected row's band: a dithered ground and an accent edge (dimmer when the panel hasn't the keyboard). */
export function band(t: Theme, active: boolean): Element[] {
  return [
    div().absolute().inset_0().opacity(active ? 1 : 0.55).child(dither(t.ansi0, 1)),
    div().absolute().left(0).top(0).bottom(0).w(2).bg(active ? t.accent : t.ansi8),
  ];
}

/** A panel's title extras. */
export interface PanelOptions {
  readonly num?: string | null;
  readonly right?: string | Element | null;
  readonly onTitle?: ((cx: Context) => void) | null;
}

/** A lazygit panel: a 1-bit frame, its title cut into the top edge (with its number), accent when it has the keyboard. */
export function panel(t: Theme, id: string, title: string | Element, active: boolean, body: Element, { num = null, right = null, onTitle = null }: PanelOptions = {}): Element {
  const edge = active ? t.accent : t.ansi0;

  return v_flex().id(id).relative().size_full().min_h(0).min_w(0).border(1).border_color(edge)
    .child(h_flex().id(`${id}-title`).relative().h(20).flex_none().min_w(0).px(8).gap(7).items_center().text_size(11).overflow_hidden()
      .when(Boolean(onTitle), (el) => el.cursor_pointer().on_click((_e, cx) => onTitle?.(cx)))
      .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(edge, 1)))
      .when(num !== null, (el) => el.child(div().relative().flex_none().text_color(active ? t.accent : t.dim).child(`[${num ?? ""}]`)))
      .child(div().relative().flex_shrink(1).min_w(0).truncate().text_color(active ? t.foreground : t.muted).child(title))
      .child(div().flex_1())
      .when(right !== null, (el) => el.child(div().relative().flex_none().text_color(t.dim).child(right ?? ""))))
    .child(v_flex().relative().flex_1().min_h(0).min_w(0).child(body));
}

/** A small text button; `on`: the pressed look (dither and an accent underline). */
export function chip(t: Theme, id: string, label: string | Element, on: boolean, action: (cx: Context) => void, color: Color | null = null): Element {
  return h_flex().id(id).relative().h(20).px(7).flex_none().items_center().gap(6).text_size(11).cursor_pointer()
    .text_color(on ? t.foreground : color ?? t.muted).hover((s) => s.text_color(t.foreground))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      cx.stop_propagation();
      action(cx);
      cx.notify();
    })
    .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent)))
    .child(div().relative().child(label));
}

/** A rectangle in a graph's px. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Rectangles as one painted layer (percentages of the box, so the zoom never shifts them). */
export function layer(rects: readonly Rect[], fill: Background, w: number, h: number): Element[] {
  if (!rects.length) return [];

  const px = (v: number): `${number}%` => `${(v / w) * 100}%`;
  const py = (v: number): `${number}%` => `${(v / h) * 100}%`;
  const b = PathBuilder.fill();

  for (const r of rects) b.add_polygon([[px(r.x), py(r.y)], [px(r.x + r.w), py(r.y)], [px(r.x + r.w), py(r.y + r.h)], [px(r.x), py(r.y + r.h)]], true);

  return [window.paint_path(b.build(), fill).absolute().top(0).left(0).size_full()];
}

/** A spark's two shapes: the dithered area under the readings and their 1 px heads. */
interface SparkPaths {
  readonly area: Path;
  readonly head: Path;
}

/** Built shapes by what they draw (the readings, the size, the scale): a redraw with the same numbers
 *  builds none. Emptied when it grows past a few hundred (old readings scroll off). */
const sparkCache = new Map<string, SparkPaths>();

/** The area as one stepped polygon and the heads as one band along its top (two polygons, not one per
 *  column: each polygon is a call into the app). Percentages of the box, so the zoom never shifts them. */
function sparkPaths(shown: readonly number[], w: number, h: number, max: number, slot: number): SparkPaths {
  const key = `${w}x${h}/${max}/${shown.join(",")}`;
  const hit = sparkCache.get(key);

  if (hit) return hit;

  const px = (v: number): `${number}%` => `${(v / w) * 100}%`;
  const py = (v: number): `${number}%` => `${(v / h) * 100}%`;
  const x0 = w - shown.length * slot;
  const tops = shown.map((v) => h - Math.max(1, Math.round(Math.min(1, v / max) * (h - 1))));
  const steps = tops.flatMap((y, i): (readonly [number, number])[] => [[x0 + i * slot, y], [x0 + (i + 1) * slot, y]]);
  const area: (readonly [`${number}%`, `${number}%`])[] = [[px(x0), py(h)], ...steps.map(([x, y]) => [px(x), py(y)] as const), [px(w), py(h)]];
  const band = [...steps, ...[...steps].reverse().map(([x, y]) => [x, y + 1] as const)].map(([x, y]) => [px(x), py(y)] as const);
  const paths = { area: PathBuilder.fill().add_polygon(area, true).build(), head: PathBuilder.fill().add_polygon(band, true).build() };

  if (sparkCache.size > 600) sparkCache.clear();

  sparkCache.set(key, paths);

  return paths;
}

/** A small dithered line graph: `values` (any scale, scaled to `top` or their own max), the newest at
 *  the right, 2 px a reading; a 1 px head on each column. */
export function spark(t: Theme, id: string, values: readonly number[], w: number, h: number, color: Color, top: number | null = null): Element {
  const box = div().id(id).relative().w(w).h(h).flex_none()
    .child(div().absolute().left(0).right(0).bottom(0).h(1).opacity(0.7).bg(t.ansi0));

  if (!values.length) return box;

  const slot = 2;
  const shown = values.slice(-Math.floor(w / slot));
  const p = sparkPaths(shown, w, h, top ?? Math.max(1e-9, ...shown), slot);

  return box
    .child(window.paint_path(p.area, Background.checkerboard(color, dotCell())).absolute().top(0).left(0).size_full())
    .child(window.paint_path(p.head, Background.solid(color)).absolute().top(0).left(0).size_full());
}

/** A horizontal bar: `part` of `whole`, dithered in `color` over a dim track. */
export function meterBar(t: Theme, id: string, part: number, whole: number, w: number, color: Color): Element {
  const f = whole > 0 ? Math.max(0, Math.min(1, part / whole)) : 0;

  return div().id(id).relative().w(w).h(6).flex_none()
    .child(div().absolute().inset_0().opacity(0.6).child(dither(t.ansi0, 1)))
    .child(div().absolute().left(0).top(0).bottom(0).w(Math.round(f * w)).child(dither(color, 1)));
}
