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
import { APP_CANVAS, ROW_CANVAS, appTree, detailWidth, flipDirection, rowGraph, sideBox, stepBox, treeWidth } from "./graph-shown.ts";
import { centreOn, panBy, panKey } from "./graph-pan.ts";
import { saveCopy } from "./host.ts";
import type { Shown } from "./graph-shown.ts";
import { diffApp, pickedEntry, refreshApp, rollbackApp, syncApp } from "./argo-actions.ts";
import { historyOf, sourceOf } from "./argo.ts";
import { forwards, keepForward, openDatabases, openWeb, peekForward, stopForward } from "./integrate.ts";
import type { Forward } from "./forwards.ts";
import type { MenuRow } from "./state.ts";
import { stepPanel } from "./panel-keys.ts";
import { columnKey } from "./columns-menu.ts";
import { tableWidth } from "./panels.ts";
import type { Placed } from "./graph-layout.ts";

const step = (name: string): number | null => (name === "j" || name === "down" ? 1 : name === "k" || name === "up" ? -1 : name === "pagedown" ? 10 : name === "pageup" ? -10 : null);

export function resourcesKey(v: K8s, name: string, cx: Context): boolean {
  if (name === "tab" || name === "shift-tab") {
    stepPanel(v, name === "tab" ? 1 : -1);

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

  if (v.panel === "detail" && detailKey(v, name)) return true;

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
  else if (v.panel === "table" && columnKey(v, name, tableWidth(v))) return true;
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
function detailKey(v: K8s, name: string): boolean {
  if (v.detail === "graph") {
    const s = rowGraph(v, detailWidth(v));

    return s ? graphKey(v, s, name, ROW_CANVAS, (b) => {
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

/** Keys over a graph: the arrows (j k h l) walk its boxes the way it reads (left to right: j k down the
 *  reading order, h l to the next column; top to bottom: j k to the next row, h l along the rows), H J K L
 *  move the picture, c centres the cursor's box, O turns the workload graph, enter opens. */
function graphKey(v: K8s, s: Shown, name: string, canvasId: string, open: (b: Placed) => void): boolean {
  const at = v.tab === "argo" ? v.argoNode : v.graphSel;
  const view = v.canvases.get(canvasId);
  const pan = panKey(name);

  if (pan) {
    if (view) panBy(view, pan[0], pan[1]);

    return true;
  }

  if (name === "c") {
    if (view) centreOn(view, s.laid, at ?? s.graph.root.key);

    return true;
  }

  if (name === "O" && canvasId === ROW_CANVAS) {
    flipDirection(v);
    saveCopy(v);

    return true;
  }

  if (name === "enter") {
    const b = s.laid.boxes.find((x) => x.node.key === at);

    if (b) open(b);

    return Boolean(b);
  }

  const next = walk(s, at, name);

  if (next === undefined) return false;

  if (next) {
    if (v.tab === "argo") v.argoNode = next.node.key;
    else v.graphSel = next.node.key;
  }

  return true;
}

/** Where an arrow goes from the box `at` (null: nowhere further), or undefined for a key that isn't one. */
function walk(s: Shown, at: string | null, name: string): Placed | null | undefined {
  const down = s.laid.dir === "down";
  const fwd = name === "j" || name === "down" ? 1 : name === "k" || name === "up" ? -1 : 0;
  const side = name === "l" || name === "right" ? 1 : name === "h" || name === "left" ? -1 : 0;

  if (fwd) return down ? sideBox(s, at, fwd, "y") : stepBox(s, at, fwd);

  if (side) return down ? stepBox(s, at, side) : sideBox(s, at, side);

  return undefined;
}

export function argoKey(v: K8s, name: string, cx: Context): boolean {
  const a = shownApp(v);

  if (name === "tab" || name === "shift-tab") {
    stepPanel(v, name === "tab" ? 1 : -1);

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

  return argoPanelKey(v, name);
}

function argoPanelKey(v: K8s, name: string): boolean {
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

    return s ? graphKey(v, s, name, APP_CANVAS, (b) => {
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

    for (const k of kinds) rows.push({ label: `Open in Databases as ${k}`, sub: k === f.db ? "guessed from the port and the name · its password's secret found in the cluster" : null, key: k === kinds[0] ? "b" : null, go: (cx) => openDatabases(v, f, k, cx) });

    rows.push({ label: "Open in Databases with a secret you pick", sub: "the password's secret: found ones, or any of the namespace", key: "B", go: (cx) => openDatabases(v, f, f.db ?? "postgres", cx, true) });
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
    case "B": openDatabases(v, f, f.db ?? "postgres", cx, true);

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
