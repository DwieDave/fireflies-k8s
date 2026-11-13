// The keys of each tab and panel: the resources tab's rail, table and
// detail panel; the Argo tab's applications, tree and side panel; the
// forwards. input.ts hands a key here once no mode and no window key took it.

import type { Context } from "gpui-kit";
import { run } from "herdr";
import type { default as K8s } from "./main.ts";
import { rowActionFor } from "./keys.ts";
import { moveRow, selectAt, listRows, rowIndex, selectedRow, apps, shownApp, showRef } from "./nav.ts";
import { runRow, rowMenu } from "./actions.ts";
import { railItems, pickRail } from "./menus.ts";
import { appTree, detailWidth, rowGraph, sideBox, stepBox, treeWidth } from "./graph-shown.ts";
import type { Shown } from "./graph-shown.ts";
import { diffApp, pickedEntry, refreshApp, rollbackApp, syncApp } from "./argo-actions.ts";
import { historyOf, sourceOf } from "./argo.ts";
import { forwards, keepForward, openDatabases, openWeb, peekForward, stopForward } from "./integrate.ts";
import type { Forward } from "./forwards.ts";
import type { MenuRow, Panel } from "./state.ts";
import type { Placed } from "./graph-layout.ts";

const PANELS: readonly Panel[] = ["rail", "table", "detail"];

const step = (name: string): number | null => (name === "j" || name === "down" ? 1 : name === "k" || name === "up" ? -1 : name === "pagedown" ? 10 : name === "pageup" ? -10 : null);

export function resourcesKey(v: K8s, name: string, cx: Context): boolean {
  if (name === "tab" || name === "shift-tab") {
    v.panel = PANELS[(PANELS.indexOf(v.panel) + (name === "tab" ? 1 : 2)) % 3] ?? "table";

    return true;
  }

  if (name === "/") {
    v.typing = { what: "filter", text: v.filter };
    v.panel = "table";

    return true;
  }

  if (name === "r" && v.panel !== "detail") {
    v.data.refresh();
    v.say("reading again", "ok");

    return true;
  }

  if (v.panel === "rail") return railKey(v, name);

  if (v.panel === "detail" && detailKey(v, name, cx)) return true;

  return tableKey(v, name, cx);
}

function railKey(v: K8s, name: string): boolean {
  const items = railItems(v);
  const by = step(name);

  if (by !== null) v.railAt = Math.max(0, Math.min(items.length - 1, v.railAt + by));
  else if (name === "g" || name === "home") v.railAt = 0;
  else if (name === "G" || name === "end") v.railAt = items.length - 1;
  else if (name === "enter" || name === "l" || name === "right") {
    const item = items[v.railAt];

    if (item) pickRail(v, item);
  } else return false;

  return true;
}

function tableKey(v: K8s, name: string, cx: Context): boolean {
  const rows = listRows(v);
  const by = step(name);

  if (by !== null) moveRow(v, by);
  else if (name === "home" || name === "g" && v.panel === "table" && !rowActionFor("g", selectedRow(v))) selectAt(v, 0);
  else if (name === "G" || name === "end") selectAt(v, rows.length - 1);
  else if (name === "m" || name === "space") {
    const row = selectedRow(v);

    if (row) v.menu = { title: `${row.ref.name}`, at: 0, rows: rowMenu(v, row) };
  } else {
    const row = selectedRow(v);
    const a = rowActionFor(name, row);

    if (!a || !row) return false;

    runRow(v, a, row, cx);
  }

  return true;
}

/** The detail panel: arrows walk the graph's boxes (enter opens one), or scroll the text. */
function detailKey(v: K8s, name: string, cx: Context): boolean {
  if (v.detail === "graph") {
    const s = rowGraph(v, detailWidth(v));

    return s ? graphKey(v, s, name, cx, (b) => {
      const r = b.node.ref;

      if (r) showRef(v, r.kind, r.name, r.namespace);
    }) : false;
  }

  if (v.detail === "describe" || v.detail === "yaml") {
    const by = step(name);
    const top = v.text?.top_line() ?? 0;

    if (by === null) return false;

    v.text?.scroll_to_line(Math.max(0, top + by * 3));

    return true;
  }

  return false;
}

/** Arrows over a graph: j k walk the reading order, h l the next column. */
function graphKey(v: K8s, s: Shown, name: string, _cx: Context, open: (b: Placed) => void): boolean {
  const at = v.tab === "argo" ? v.argoNode : v.graphSel;
  let next: Placed | null = null;

  if (name === "j" || name === "down") next = stepBox(s, at, 1);
  else if (name === "k" || name === "up") next = stepBox(s, at, -1);
  else if (name === "l" || name === "right") next = sideBox(s, at, 1);
  else if (name === "h" || name === "left") next = sideBox(s, at, -1);
  else if (name === "enter") {
    const b = s.laid.boxes.find((x) => x.node.key === at);

    if (b) open(b);

    return Boolean(b);
  } else return false;

  if (next) {
    if (v.tab === "argo") v.argoNode = next.node.key;
    else v.graphSel = next.node.key;
  }

  return true;
}

export function argoKey(v: K8s, name: string, cx: Context): boolean {
  const a = shownApp(v);

  if (name === "tab" || name === "shift-tab") {
    const order = ["apps", "tree", "side"] as const;

    v.argoPanel = order[(order.indexOf(v.argoPanel) + (name === "tab" ? 1 : 2)) % 3] ?? "apps";

    return true;
  }

  if (!a) return false;

  switch (name) {
    case "S": syncApp(v, a, cx);

 return true;
    case "r": refreshApp(v, a, false, cx);

 return true;
    case "R": refreshApp(v, a, true, cx);

 return true;
    case "D": diffApp(v, a, cx); v.argoPanel = "side";

 return true;
    case "h": v.argoPanel = "side"; v.histAt ??= historyOf(a).length - 1;

 return true;
    case "B": rollbackApp(v, a, pickedEntry(v, a), cx);

 return true;
    case "o": {
      const url = sourceOf(a)?.repoURL;

      if (url) run("app.open_url", { url: url.replace(/\.git$/, ""), in: "app" });

      return true;
    }

    default: break;
  }

  return argoPanelKey(v, name, cx);
}

function argoPanelKey(v: K8s, name: string, cx: Context): boolean {
  const by = step(name);
  const a = shownApp(v);

  if (v.argoPanel === "apps") {
    const list = apps(v);
    const i = list.findIndex((x) => x.metadata.name === a?.metadata.name);

    if (by !== null) {
      v.app = list[Math.max(0, Math.min(list.length - 1, i + by))]?.metadata.name ?? v.app;
      v.argoNode = null;
      v.argoDiff = null;
      v.histAt = null;
    } else if (name === "enter" || name === "l") v.argoPanel = "tree";
    else return false;

    return true;
  }

  if (v.argoPanel === "tree") {
    const s = appTree(v, treeWidth(v));

    return s ? graphKey(v, s, name, cx, (b) => {
      const r = b.node.ref;

      if (r && r.kind !== "applications") showRef(v, r.kind, r.name, r.namespace);
    }) : false;
  }

  if (by !== null && a) {
    const n = historyOf(a).length;

    v.histAt = Math.max(0, Math.min(n - 1, (v.histAt ?? n - 1) + (name === "j" || name === "down" ? 1 : -1)));

    return true;
  }

  return false;
}

/** The leads of a forward, as a menu. */
export function leadsMenu(v: K8s, f: Forward): MenuRow[] {
  const rows: MenuRow[] = [];

  if (f.web) rows.push({ label: `Open http${f.web === "https" ? "s" : ""}://localhost:${f.local} in a web pane`, key: "w", go: (cx) => openWeb(v, f, cx) });

  if (v.databases) {
    const kinds: ("postgres" | "mysql")[] = f.db === "mysql" ? ["mysql", "postgres"] : ["postgres", "mysql"];

    for (const k of kinds) rows.push({ label: `Open in Databases as ${k}`, sub: k === f.db ? "guessed from the port and the name" : null, key: k === kinds[0] ? "b" : null, go: (cx) => openDatabases(v, f, k, cx) });
  }

  if (!f.web) rows.push({ label: `Open http://localhost:${f.local} in a web pane anyway`, go: (cx) => openWeb(v, { ...f, web: "http" }, cx) });

  rows.push({ label: "Peek at its terminal", key: "p", go: () => peekForward(f) }, { label: "Give it a pane", key: "t", go: (cx) => keepForward(v, f, cx) }, { label: "Stop it", key: "x", danger: true, go: () => stopForward(f) });

  return rows;
}

export function forwardsKey(v: K8s, name: string, cx: Context): boolean {
  const list = forwards();
  const by = step(name);

  if (by !== null) {
    v.forwardAt = Math.max(0, Math.min(list.length - 1, v.forwardAt + by));

    return true;
  }

  const f = list[Math.min(v.forwardAt, list.length - 1)];

  if (!f) return false;

  switch (name) {
    case "enter": v.menu = { title: `forward ${f.target} :${f.remote} → :${f.local}`, at: 0, rows: leadsMenu(v, f) };

 return true;
    case "w": openWeb(v, f.web ? f : { ...f, web: "http" }, cx);

 return true;
    case "b": if (f.db || v.databases) openDatabases(v, f, f.db ?? "postgres", cx);

 return true;
    case "p": peekForward(f);

 return true;
    case "t": keepForward(v, f, cx);

 return true;
    case "x": stopForward(f); v.say(`stopped the forward of ${f.target}`, "ok");

 return true;
    default: return false;
  }
}

/** The selected row's index for views. */
export const at = rowIndex;
