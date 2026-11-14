// The window's chrome: the top bar (mark, where it is, the tabs, how fresh
// the reads are, the forwards' count, the move button, a window's ✕), the key
// bar at the foot (or the line being typed, or a note), and the narrow
// layout's fold row. What's window-only (✕, the drag) is decided here and
// nowhere else.

import { div } from "gpui-kit";
import type { Element } from "gpui-kit";
import { h_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { default as K8s } from "./main.ts";
import { chip, dither, icon, pip, stop, toneColor } from "./kit.ts";
import { titleOf } from "./kinds.ts";
import { TABS } from "./state.ts";
import type { Panel } from "./state.ts";
import { closeWindow, move } from "./host.ts";
import { hasGraph, setTab, selectedRow } from "./nav.ts";
import type { Row } from "./rows.ts";
import { contextMenu } from "./menus.ts";
import { forwards } from "./integrate.ts";
import { hint, keysHint } from "./keyhelp.ts";
import { ROW_KEYS, applies } from "./keys.ts";
import { looksProd } from "./contexts.ts";
import { clusterOf } from "./writes.ts";
import { hasArgo } from "./derive.ts";
import { paceText } from "./metrics.ts";
import { complete } from "./filter-terms.ts";
import { argoCandidates } from "./input.ts";

/** The top bar. In a window it's where the window drags from: presses on it aren't stopped. */
export function header(v: K8s, t: Theme): Element {
  const live = forwards().filter((f) => f.live).length;
  const prod = v.context !== null && looksProd({ name: v.context, cluster: clusterOf(v) }, v.settings.prod);
  const narrow = v.narrow();
  const tabs = TABS.filter(([id]) => id !== "argo" || hasArgo(v.data) || v.tab === "argo");

  return h_flex().id("k8s-head").relative().h(34).flex_none().pl(12).pr(6).gap(10).items_center().text_size(11).overflow_hidden()
    .child(div().absolute().inset_0().opacity(0.5).child(dither(t.ansi0, 2)))
    .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi8, 1)))
    .child(h_flex().relative().flex_none().gap(8).items_center().child(icon("hex", t.ansi6, 15)).when(!narrow, (el) => el.child(div().text_color(t.foreground).child("KUBERNETES"))))
    .child(h_flex().id("k8s-where").relative().flex_shrink(1).min_w(0).gap(5).items_center().cursor_pointer()
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => {
        v.menu = contextMenu(v);
        cx.notify();
      })
      .child(div().flex_none().text_color(t.ansi6).child(v.context ?? "…"))
      .when(prod, (el) => el.child(div().flex_none().px(4).h(14).text_size(10).bg(t.blocked).text_color(t.background).child("prod")))
      .when(v.context !== null && v.settings.readonly.has(v.context), (el) => el.child(div().flex_none().px(3).h(14).text_size(10).border(1).border_color(t.working).text_color(t.working).child("ro")))
      .child(div().flex_none().text_color(t.ansi0).child("/"))
      .child(div().flex_none().text_color(t.ansi5).child(v.namespace ?? "all"))
      .when(!narrow && v.tab === "resources", (el) => el.child(div().flex_none().text_color(t.ansi0).child("/")).child(div().truncate().text_color(t.muted).child(titleOf(v.kind).toLowerCase()))))
    .child(h_flex().relative().flex_none().gap(2).children(tabs.map(([id, label]) => chip(t, `tab-${id}`, narrow ? label.split(" ")[0] ?? label : label, v.tab === id, () => setTab(v, id)))))
    .child(div().flex_1())
    .child(status(v, t))
    .when(live > 0, (el) => el.child(chip(t, "k8s-fw", h_flex().gap(5).items_center().child(icon("plug", t.ansi6, 11)).child(String(live)), false, () => setTab(v, "forwards"))))
    .child(chip(t, "k8s-move", v.inWindow() ? "◧" : "⧉", false, (cx) => move(v, cx)))
    .when(v.inWindow(), (el) => el.child(chip(t, "k8s-close", "✕", false, () => closeWindow(v))));
}

/** How fresh the reads are: watching, slow, or the error kubectl gave. */
function status(v: K8s, t: Theme): Element {
  const f = v.data.pods;
  const err = f.error ?? v.data.contexts.error;
  const word = (tone: "ok" | "wk" | "bad", text: string) => h_flex().relative().flex_shrink(1).min_w(0).max_w(320).gap(6).items_center().child(pip(t, tone, 6)).child(div().truncate().text_color(tone === "ok" ? t.done : toneColor(t, tone)).child(text));

  if (err) return word("bad", err);

  if (f.failures === 0 && f.at === 0) return word("wk", "reading…");

  return word("ok", f.wait() > 10000 ? "watching (slow cluster)" : "watching");
}

/** The narrow layout's fold row: the panels as numbered tabs, the shown one lit. */
export function foldRow(v: K8s, t: Theme): Element {
  const names: readonly (readonly [Panel, string])[] = [["rail", "1-3 where"], ["table", `0 ${titleOf(v.kind).toLowerCase()}`], ["detail", "4 detail"]];

  return h_flex().id("k8s-fold").relative().h(24).flex_none().px(6).gap(2).items_center()
    .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(t.ansi0, 1)))
    .children(names.map(([p, label]) => chip(t, `fold-${p}`, label, v.panel === p, () => {
      v.panel = p;
    })));
}

/** The foot: a note when there is one, else the line being typed, else the keys of what has the keyboard. */
export function keyBar(v: K8s, t: Theme): Element {
  const bar = h_flex().id("k8s-keys").relative().h(22).flex_none().px(10).gap(12).items_center().text_size(11).overflow_hidden()
    .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)));

  if (v.typing) {
    const label = v.typing.what === "kind" ? ":" : v.typing.what === "filter" || v.typing.what === "argo" ? "/" : "scale to ";
    const hints = v.typing.what === "argo" ? complete(v.typing.text, argoCandidates(v)).slice(0, 4) : [];

    return bar.child(div().text_color(t.accent).child(label)).child(div().text_color(t.foreground).child(v.typing.text))
      .child(div().w(6).h(12).bg(t.accent).loop("opacity", { from: 0.2, to: 1, period: 900 }))
      .children(hints.map((h, i) => div().id(`k-hint-${i}`).flex_none().text_color(i === 0 ? t.muted : t.dim).child(h)))
      .child(div().flex_1())
      .child(hint(t, "k-enter", "enter", v.typing.what === "kind" ? "go" : "keep")).when(v.typing.what === "kind" || hints.length > 0, (el) => el.child(hint(t, "k-tab", "tab", "complete"))).child(hint(t, "k-esc", "esc", "cancel"));
  }

  if (v.note) return bar.child(pip(t, v.note.tone, 6)).child(div().flex_1().truncate().text_color(v.note.tone === "bad" ? t.blocked : t.foreground).child(v.note.text));

  const keys = barKeys(v);

  return bar.child(div().flex_none().text_size(10).text_color(t.ansi8).child(barTitle(v).toUpperCase()))
    .children(keys.map(([k, w], i) => hint(t, `kb-${i}`, k, w)))
    .child(div().flex_1())
    .when(!v.narrow() && v.tab === "resources" && !v.data.metricsMissing, (el) => el.child(hint(t, "kb-pace", "M", `metrics ${paceText(v.data.metricsEvery)}`)))
    .when(!v.narrow(), (el) => el.child(hint(t, "kb-colon", ":", "kind")).child(hint(t, "kb-slash", "/", "filter")))
    .child(keysHint(t, "kb-help", v.help, (cx) => {
      v.help = !v.help;
      cx.notify();
    }));
}

function barTitle(v: K8s): string {
  if (v.tab !== "resources") return v.tab === "argo" ? "argo cd" : "forwards";

  return v.panel === "rail" ? "where" : v.drill ? v.drill.label : titleOf(v.kind);
}

/** The keys the bar shows for what has the keyboard (the row's actions that apply, the first few). */
function barKeys(v: K8s): readonly (readonly [string, string])[] {
  const graph: readonly (readonly [string, string])[] = [["m", "menu"], ["+ -", "zoom"], ["z", "fit"], ["H J K L", "move"]];

  if (v.tab === "argo") return [...(v.argoPanel === "tree" ? graph : []), ["S", "sync"], ["r", "refresh"], ["D", "diff"], ["h", "history"], ["B", "rollback"], ["tab", "panel"]];

  if (v.tab === "forwards") return [["enter", "leads"], ["w", "web"], ["b", "databases"], ["B", "pick secret"], ["p", "peek"], ["x", "stop"]];

  if (v.panel === "rail") return [["enter", "pick"], ["n", "namespace"], ["0-4", "panel"]];

  const row = selectedRow(v);

  if (!row) return [["n", "namespace"], ["0-4", "panel"]];

  const max = v.narrow() ? 3 : v.size.width < 1000 ? 6 : 9;

  if (v.panel === "detail" && v.detail === "graph" && hasGraph(row.ref.kind)) return [...graph, ["O", "turn"], ...rowKeys(row, max - 5)];

  return rowKeys(row, max);
}

function rowKeys(row: Row, max: number): readonly (readonly [string, string])[] {
  return ROW_KEYS.filter(([, a]) => applies(a, row) && a !== "describe" && a !== "yaml").slice(0, max).map(([k, , w]) => [k, w] as const);
}
