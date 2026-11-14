// The menus of a graph's boxes and of an Argo CD application, built from the
// same sources as the table's row menu so they can't drift: a box whose
// object the window has read offers exactly its row's menu (actions.ts
// rowMenu: logs, shell, describe, YAML, edit, forward, scale, restart,
// delete with its ask, copy its name), the views among them showing it in
// the list first; then "show it in the list". An Argo box adds its
// application's menu (the one its row in the applications list opens: sync,
// refresh, diff, history, roll back, the repository). Every write keeps its
// ask. Opened by a right click on a box or `m` (space) on the selected one.

import { run } from "herdr";
import type { default as K8s } from "./main.ts";
import type { RowAction } from "./keys.ts";
import type { Menu, MenuRow } from "./state.ts";
import type { Ref, Row } from "./rows.ts";
import type { Placed } from "./graph-layout.ts";
import type { Application } from "./argo.ts";
import { historyOf, sourceOf } from "./argo.ts";
import { rowMenu } from "./actions.ts";
import { rowsOf } from "./derive.ts";
import { showRef, setTab } from "./nav.ts";
import { diffApp, pickedEntry, refreshApp, rollbackApp, syncApp } from "./argo-actions.ts";

/** The actions that show something in the window: they move to the object's row first. */
const VIEWS: ReadonlySet<RowAction> = new Set(["open", "graph", "describe", "yaml", "events"]);

/** The row the window has read for what a box points at, if any. */
export function rowOf(v: K8s, ref: Ref): Row | null {
  return rowsOf(v.data, ref.kind, ref.namespace).find((r) => r.ref.name === ref.name) ?? null;
}

/** What a box's menu offers beyond its row's: showing it in the list. */
function showRow(v: K8s, ref: Ref): MenuRow {
  return { label: "show it in the list", sub: `${ref.kind} ${ref.namespace ? `${ref.namespace}/` : ""}${ref.name}`, key: "L", go: () => showRef(v, ref.kind, ref.name, ref.namespace) };
}

/** The views by hand, for an object the window hasn't read (an Argo resource it doesn't list here). */
function unreadRows(v: K8s, ref: Ref): MenuRow[] {
  const view = (label: string, key: string, detail: "describe" | "yaml" | "events"): MenuRow => ({ label, key, go: () => {
    showRef(v, ref.kind, ref.name, ref.namespace);
    v.detail = detail;
  } });

  return [view("describe", "d", "describe"), view("yaml", "y", "yaml"), view("events", "v", "events"), { label: "copy its name", go: (cx) => cx.write_to_clipboard(ref.name) }];
}

/** A box's menu (the workload graph's, or the Argo tree's with its application). */
export function nodeMenu(v: K8s, b: Placed, app: Application | null): Menu {
  const ref = b.node.ref;

  if (!ref || ref.kind === "applications") return app ? appMenu(v, app) : { title: b.node.label, at: 0, rows: [] };

  const row = rowOf(v, ref);

  const own = row ? rowMenu(v, row, (a) => {
    if (VIEWS.has(a)) showRef(v, ref.kind, ref.name, ref.namespace);
  }) : unreadRows(v, ref);

  const argo = app ? appMenu(v, app).rows.map((r): MenuRow => ({ ...r, label: `${r.label} (application ${app.metadata.name})`, key: null })) : [];

  return { title: `${b.node.kind} ${ref.name}`, at: 0, rows: [...own, showRow(v, ref), ...argo] };
}

/** An application's menu: its row in the applications list, its tree's root, and `m` there. */
export function appMenu(v: K8s, a: Application): Menu {
  const name = a.metadata.name;
  const url = sourceOf(a)?.repoURL ?? null;

  const open = (panel: "tree" | "side") => () => {
    setTab(v, "argo");
    v.app = name;
    v.argoPanel = panel;
  };

  return {
    title: `application ${name}`, at: 0,
    rows: [
      { label: "open its tree", key: "enter", go: open("tree") },
      { label: "history", key: "h", go: () => {
        open("side")();
        v.histAt ??= historyOf(a).length - 1;
      } },
      { label: "diff", key: "D", go: (cx) => {
        open("side")();
        diffApp(v, a, cx);
      } },
      ...(url ? [{ label: "open the repository", sub: url, key: "o", go: () => run("app.open_url", { url: url.replace(/\.git$/, ""), in: "app" }) }] : []),
      { label: "show it in Resources", sub: "its object, describe and YAML", go: () => showRef(v, "applications", name, a.metadata.namespace ?? null) },
      { label: "copy its name", go: (cx) => cx.write_to_clipboard(name) },
      { label: "refresh", key: "r", danger: true, go: (cx) => refreshApp(v, a, false, cx) },
      { label: "hard refresh", key: "R", danger: true, go: (cx) => refreshApp(v, a, true, cx) },
      { label: "sync", key: "S", danger: true, go: (cx) => syncApp(v, a, cx) },
      { label: "roll back to the picked revision", sub: "h picks one in its history", key: "B", danger: true, go: (cx) => rollbackApp(v, a, pickedEntry(v, a), cx) },
    ],
  };
}
