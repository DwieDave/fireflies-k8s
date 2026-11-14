// The Argo CD tab: [1] the applications (sync and health as two marks, the
// revision, where each deploys), [2] the shown application's resource tree
// (Argo's own UI's: app → resources → what they own, coloured by health,
// out-of-sync and missing outlined and flagged), [3] its status, its history
// as a timeline (h picks an entry; B rolls back to it) and the diff (D).

import { div } from "gpui-kit";
import type { Color, Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { default as K8s } from "./main.ts";
import { band, chip, dither, icon, panel, stop, toneColor } from "./kit.ts";
import type { Application } from "./argo.ts";
import { autoSync, destinationOf, healthTone, historyOf, inThisCluster, sourceOf, syncTone } from "./argo.ts";
import { allApps, apps, shownApp, showRef } from "./nav.ts";
import { ARGO_FIELDS, filterMenu, setArgoFilter } from "./argo-filter.ts";
import { parseTerms, termText, withoutTerm } from "./filter-terms.ts";
import { APP_CANVAS, appTree, treeWidth } from "./graph-shown.ts";
import { canvas, rule } from "./graph-view.ts";
import { age, instant } from "./time.ts";
import { divider } from "./dividers.ts";
import { GAP, argoAppsDivider, argoSideDivider } from "./panels.ts";
import type { DiffLine } from "./diff.ts";
import { argoNum } from "./panel-keys.ts";
import { appMenu, nodeMenu } from "./node-menu.ts";

export function argoTab(v: K8s, t: Theme): Element {
  const a = shownApp(v);
  const narrow = v.narrow();

  if (!allApps(v).length) return div().size_full().p(20).text_size(11).text_color(v.data.apps.error ? t.blocked : t.dim)
    .child(v.data.apps.error ? `kubectl: ${v.data.apps.error}` : v.data.apps.at === 0 ? "reading applications…" : "no Argo CD applications in this cluster");

  if (narrow) {
    const shown = v.argoPanel === "apps" ? appList(v, t) : v.argoPanel === "tree" && a ? tree(v, t, a) : a ? side(v, t, a) : appList(v, t);

    return v_flex().size_full().p(8).child(shown);
  }

  const ds = v.dividers;
  const ad = argoAppsDivider(v);
  const sd = argoSideDivider(v);

  return h_flex().size_full().px(GAP).pt(12).pb(8)
    .child(v_flex().w(ds.size(ad)).flex_none().h_full().child(appList(v, t)))
    .child(divider(t, "argo-div-apps", ad, ds, GAP))
    .child(v_flex().flex_1().min_w(0).h_full().child(a ? tree(v, t, a) : div()))
    .child(divider(t, "argo-div-side", sd, ds, GAP))
    .child(v_flex().w(ds.size(sd)).flex_none().h_full().child(a ? side(v, t, a) : div()));
}

/** The filter's chips over the list: each term clicks off, "+ filter" opens what the applications have. */
function chips(v: K8s, t: Theme): Element {
  const terms = parseTerms(v.argoFilter, ARGO_FIELDS);

  return h_flex().id("argo-chips").flex_none().flex_wrap().px(6).py(3).gap(3).text_size(10)
    .children(terms.map((x, i) => chip(t, `argo-chip-${i}`, h_flex().gap(4).child(div().child(termText(x))).child(div().text_color(t.dim).child("×")), true, () => {
      setArgoFilter(v, withoutTerm(v.argoFilter, ARGO_FIELDS, i));
    })))
    .child(chip(t, "argo-chip-add", h_flex().gap(4).child(div().text_color(t.accent).child("F")).child(div().child(terms.length ? "+" : "+ filter")), false, () => {
      v.menu = filterMenu(v, allApps(v));
    }, t.dim))
    .when(!terms.length, (el) => el.child(div().pl(4).text_color(t.ansi8).child("/ types one: project: sync: health: cluster: ns: repo: k=v")));
}

function appList(v: K8s, t: Theme): Element {
  const list = apps(v);
  const all = allApps(v).length;
  const shown = shownApp(v)?.metadata.name;
  const active = v.argoPanel === "apps";

  const rows = list.map((a, i) => {
    const sync = a.status?.sync?.status ?? "Unknown";
    const health = a.status?.health?.status ?? "Unknown";
    const sel = a.metadata.name === shown;

    return v_flex().id(`app-${i}`).relative().h(34).flex_none().px(8).justify_center().gap(2).cursor_pointer().text_size(11)
      .hover((s) => s.bg(`${t.ansi0}44`))
      .when(sel, (el) => el.children(band(t, active)))
      .on_mouse_down("left", (e, cx) => {
        stop(e, cx);
        pickApp(v, a.metadata.name);
        v.argoPanel = e.click_count >= 2 ? "tree" : "apps";
        cx.notify();
      })
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        pickApp(v, a.metadata.name);
        v.argoPanel = "apps";
        v.menu = appMenu(v, a);
        cx.notify();
      })
      .child(h_flex().relative().gap(6).items_center()
        .child(icon("sync", toneColor(t, syncTone(sync)), 11)).child(icon("heart", toneColor(t, healthTone(health)), 11))
        .child(div().flex_1().min_w(0).truncate().text_color(sel ? t.foreground : t.muted).child(a.metadata.name))
        .when(a.status?.operationState?.phase === "Running", (el) => el.child(div().text_size(10).text_color(t.working).loop("opacity", { from: 0.3, to: 1, period: 1200 }).child("syncing")))
        .child(div().flex_none().text_size(10).text_color(t.dim).child((a.status?.sync?.revision ?? "").slice(0, 7))))
      .child(div().relative().pl(34).text_size(10).truncate().text_color(t.dim).child(`${sync} · ${health} · ${destinationOf(a)}`));
  });

  const body = v_flex().size_full()
    .child(chips(v, t))
    .child(v_flex().id("argo-app-list").flex_1().min_h(0).pt(4).overflow_y_scroll().children(rows)
      .when(!list.length, (el) => el.child(div().p(12).text_size(11).text_color(t.dim).child(`nothing matches ${v.argoFilter} (esc clears it, or click a chip off)`))));

  return panel(t, "argo-apps", "Applications", active, body, { num: argoNum("apps"), right: list.length === all ? String(all) : `${list.length} of ${all}` });
}

/** Shows another application (its tree's cursor, diff and history pick start over). */
export function pickApp(v: K8s, name: string): void {
  if (v.app === name) return;

  v.app = name;
  v.argoNode = null;
  v.argoDiff = null;
  v.histAt = null;
}

function tree(v: K8s, t: Theme, a: Application): Element {
  const width = treeWidth(v);
  const s = appTree(v, width);
  const active = v.argoPanel === "tree";
  const elsewhere = !inThisCluster(a);

  const body = v_flex().size_full()
    .when(elsewhere, (el) => el.child(div().px(10).py(6).text_size(10).text_color(t.dim).child(`deploys to ${destinationOf(a)}: its resources as Argo reports them (what they own lives in that cluster)`)))
    .child(v_flex().flex_1().min_h(0).min_w(0).child(s ? canvas(v, t, s, width, v.argoNode, active, (b, how, cx) => {
      v.argoNode = b.node.key;
      v.argoPanel = "tree";

      const r = b.node.ref;

      if (how === "menu") v.menu = nodeMenu(v, b, a);
      else if (how === "open" && r && r.kind !== "applications") showRef(v, r.kind, r.name, r.namespace);

      cx.notify();
    }, APP_CANVAS) : div()))
    .child(legend(t));

  return panel(t, "argo-tree", a.metadata.name, active, body, { num: argoNum("tree"), right: "enter opens · tab panels" });
}

function legend(t: Theme): Element {
  const item = (id: string, color: Color, word: string, dashed = false) => h_flex().id(id).gap(5).items_center()
    .child(div().size(7).flex_none().when(!dashed, (el) => el.bg(color)).when(dashed, (el) => el.border(1).border_color(color))).child(div().child(word));

  return h_flex().h(20).flex_none().px(10).gap(12).items_center().text_size(10).text_color(t.dim)
    .child(item("lg-ok", t.done, "healthy")).child(item("lg-wk", t.working, "progressing")).child(item("lg-bad", t.blocked, "degraded"))
    .child(item("lg-miss", t.ansi5, "missing")).child(item("lg-sync", t.working, "out of sync", true));
}

function side(v: K8s, t: Theme, a: Application): Element {
  const active = v.argoPanel === "side";
  const src = sourceOf(a);
  const sync = a.status?.sync?.status ?? "Unknown";
  const health = a.status?.health?.status ?? "Unknown";
  const op = a.status?.operationState;

  const word = (id: string, label: string, ic: string, value: string, color: Color) => v_flex().id(id).gap(2)
    .child(div().text_size(9).text_color(t.dim).child(label.toUpperCase())).child(h_flex().gap(5).items_center().child(icon(ic, color, 11)).child(div().text_color(color).child(value)));

  const status = v_flex().px(8).py(6).gap(6).text_size(11)
    .child(h_flex().gap(18).child(word("st-sync", "sync", "sync", sync, toneColor(t, syncTone(sync)))).child(word("st-health", "health", "heart", health, toneColor(t, healthTone(health)))))
    .child(div().text_size(10).truncate().text_color(t.muted).child(src?.repoURL ?? ""))
    .child(div().text_size(10).text_color(t.dim).child(`${src?.path ?? src?.chart ?? ""} @ ${src?.targetRevision ?? "HEAD"} · auto-sync ${autoSync(a) ? "on" : "off"}`))
    .when(Boolean(op?.message), (el) => el.child(div().text_size(10).text_color(op?.phase === "Failed" || op?.phase === "Error" ? t.blocked : op?.phase === "Running" ? t.working : t.dim).child(`${op?.phase ?? ""}: ${op?.message ?? ""}`)));

  return panel(t, "argo-side", "Status", active, v_flex().size_full()
    .child(status)
    .child(rule(t, "history"))
    .child(timeline(v, t, a))
    .child(rule(t, v.argoDiff?.app === a.metadata.name ? (v.argoDiff.how === "argocd" ? "diff · argocd" : "diff · live vs last applied") : "diff (D)"))
    .child(v_flex().flex_1().min_h(0).min_w(0).child(diffView(v, t, a))), { num: argoNum("side"), right: "S sync · B rollback" });
}

/** The history as a line of marks, oldest left: the running revision ringed, the picked one lit. */
function timeline(v: K8s, t: Theme, a: Application): Element {
  const h = historyOf(a);
  const running = a.status?.sync?.revision ?? "";
  const picked = v.histAt ?? h.length - 1;

  if (!h.length) return div().px(8).py(6).text_size(10).text_color(t.dim).child("never synced");

  return v_flex().id("argo-hist").px(8).py(4).gap(2).max_h(120).overflow_y_scroll()
    .children(h.map((e, i) => h_flex().id(`hist-${i}`).relative().h(18).gap(8).items_center().text_size(10).cursor_pointer()
      .when(i === picked, (el) => el.children(band(t, v.argoPanel === "side")))
      .on_mouse_down("left", (ev, cx) => {
        stop(ev, cx);
        v.histAt = i;
        v.argoPanel = "side";
        cx.notify();
      })
      .child(div().relative().size(8).flex_none().when(e.revision === running, (el) => el.bg(t.done).border(1).border_color(t.done)).when(e.revision !== running, (el) => el.bg(t.ansi8)))
      .child(div().relative().w(56).flex_none().text_color(e.revision === running ? t.foreground : t.muted).child((e.revision ?? "").slice(0, 7)))
      .child(div().relative().flex_1().text_color(t.dim).child(`${age(instant(e.deployedAt))} ago${e.revision === running ? " · running" : ""}`))));
}

function diffView(v: K8s, t: Theme, a: Application): Element {
  const d = v.argoDiff?.app === a.metadata.name ? v.argoDiff : null;

  if (!d) return div().px(8).py(6).text_size(10).text_color(t.dim).child("D compares it (argocd when installed, else each resource against its last-applied configuration)");

  return v_flex().id("argo-diff").size_full().overflow_y_scroll().pb(6)
    .when(d.error !== null, (el) => el.child(div().px(8).py(4).text_size(10).text_color(d.error === "comparing…" ? t.dim : t.muted).child(d.error ?? "")))
    .children(d.sections.map((s, i) => v_flex().id(`dsec-${i}`).child(div().px(8).pt(6).pb(2).text_size(10).text_color(t.accent).truncate().child(s.title)).children(s.lines.map((l, j) => diffLine(t, l, `${i}-${j}`)))));
}

function diffLine(t: Theme, l: DiffLine, id: string): Element {
  const color = l.op === "+" ? t.done : l.op === "-" ? t.ansi1 : t.muted;

  return h_flex().id(`dl-${id}`).relative().h(16).text_size(10).overflow_hidden()
    .when(l.op !== " ", (el) => el.bg(`${color}16`).child(div().absolute().left(0).top(0).bottom(0).w(2).child(dither(color, 1))))
    .child(div().w(14).flex_none().pl(4).text_color(color).child(l.op === " " ? "" : l.op))
    .child(div().flex_1().min_w(0).truncate().text_color(l.op === " " ? t.dim : t.foreground).child(l.text));
}
