// Moving about the window: which rows are listed, which one is selected (kept
// by key across polls, per list), the kind, namespace, context and tab, and
// walking a drill-in back. The view's state changes here; the views only read.

import type { default as K8s } from "./main.ts";
import type { KindRef } from "./kinds.ts";
import { isBuiltin, namespaced } from "./kinds.ts";
import type { Row } from "./rows.ts";
import type { Application } from "./argo.ts";
import { inThisCluster } from "./argo.ts";
import { drillRows, filterRows, rowsOf } from "./derive.ts";
import type { Tab } from "./state.ts";
import { TABS } from "./state.ts";
import { kindColumns, metricNow } from "./columns.ts";
import { sortRows } from "./sort.ts";

/** The key of the list shown now: a selection is kept per list. */
export function listKey(v: K8s): string {
  return `${v.context ?? ""}/${v.namespace ?? "*"}/${v.kind}/${v.drill?.uid ?? ""}`;
}

/** The rows shown: the kind's, drilled into, filtered, and sorted as the kind's sort says (columns.ts). */
export function listRows(v: K8s): readonly Row[] {
  const by = v.columns.sorts.get(v.kind) ?? null;

  return v.rowsMemo.get(v.data.version, `${listKey(v)}|${v.filter}|${by ? `${by.col}|${by.desc}` : ""}`, () => {
    const ns = namespaced(v.kind) ? v.namespace : null;
    const rows = filterRows(drillRows(v.data, rowsOf(v.data, v.kind, ns), v.drill, ns), v.filter);
    const index = by ? kindColumns(v).findIndex((c) => c.title === by.col) : -1;

    return by && index >= 0 ? sortRows(rows, index, by.desc, (c) => metricNow(v, c)) : rows;
  });
}

/** The selected row's index (its key's, else the first). */
export function rowIndex(v: K8s, rows: readonly Row[] = listRows(v)): number {
  const key = v.sel.get(listKey(v));
  const i = key === undefined ? -1 : rows.findIndex((r) => r.key === key);

  return i < 0 ? 0 : i;
}

export function selectedRow(v: K8s): Row | null {
  const rows = listRows(v);

  return rows[rowIndex(v, rows)] ?? null;
}

/** Selects the row at `i` (clamped). */
export function selectAt(v: K8s, i: number): void {
  const rows = listRows(v);
  const r = rows[Math.max(0, Math.min(rows.length - 1, i))];

  if (!r) return;

  if (v.secret && v.secret.key !== r.key) v.secret = null;

  v.sel.set(listKey(v), r.key);
  v.graphSel = null;
  v.tableScroll.scroll_to_item(Math.max(0, Math.min(rows.length - 1, i)));
}

export function moveRow(v: K8s, by: number): void {
  selectAt(v, rowIndex(v) + by);
}

/** Shows a kind (leaving any drill-in and filter). */
export function setKind(v: K8s, kind: KindRef): void {
  v.kind = kind;
  v.drill = null;
  v.filter = "";
  v.secret = null;

  if (kind === "applications") v.detail = "graph";
  else if (!graphed(kind) && v.detail === "graph") v.detail = "describe";
}

const graphed = (k: KindRef): boolean => isBuiltin(k) && ["pods", "deployments", "statefulsets", "daemonsets", "replicasets", "jobs", "cronjobs", "services", "ingresses"].includes(k);

/** Whether the detail panel can draw a graph for the kind. */
export const hasGraph = graphed;

/** Shows a namespace (null: all of them). */
export function setNamespace(v: K8s, ns: string | null): void {
  v.namespace = ns;
  v.drill = null;
  v.secret = null;
}

/** Switches the context: its own default namespace, nothing selected. */
export function setContext(v: K8s, name: string): void {
  const c = v.data.contexts.value?.find((x) => x.name === name);

  v.context = name;
  v.namespace = c?.namespace ?? "default";
  v.drill = null;
  v.filter = "";
  v.secret = null;
  v.app = null;
  v.data.history.clear();
}

export function setTab(v: K8s, tab: Tab): void {
  v.tab = tab;
  v.menu = null;
  v.typing = null;
}

/** The next or previous tab. */
export function stepTab(v: K8s, by: number): void {
  const i = TABS.findIndex(([t]) => t === v.tab);
  const next = TABS[(i + by + TABS.length) % TABS.length];

  if (next) setTab(v, next[0]);
}

/** The Argo applications listed, and the one shown. */
export function apps(v: K8s): readonly Application[] {
  return [...(v.data.apps.value ?? [])].sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
}

export function shownApp(v: K8s): Application | null {
  const list = apps(v);

  return list.find((a) => a.metadata.name === v.app) ?? list[0] ?? null;
}

/** The namespace the shown app deploys to in this cluster (null: none, or elsewhere). */
export function appNamespace(v: K8s): string | null {
  if (v.tab !== "argo") return null;

  const a = shownApp(v);

  return a && inThisCluster(a) ? a.spec?.destination?.namespace ?? null : null;
}

/** Drills from a workload into its pods (k9s's enter). */
export function drillInto(v: K8s, row: Row): void {
  if (!row.uid) return;

  v.drill = { kind: "pods", uid: row.uid, label: `${row.ref.kind.replace(/s$/, "")} ${row.ref.name}`, from: v.kind, fromRow: row.key };
  v.kind = "pods";
  v.filter = "";
}

/** Back out of a drill-in to the row it came from. */
export function drillBack(v: K8s): boolean {
  const d = v.drill;

  if (!d) return false;

  v.drill = null;
  v.kind = isBuiltin(d.from) ? d.from : v.kind;

  if (d.fromRow) v.sel.set(listKey(v), d.fromRow);

  return true;
}

/** Selects the object a graph box or an Argo resource points at, switching to its kind. */
export function showRef(v: K8s, kind: KindRef, name: string, namespace: string | null): void {
  setTab(v, "resources");
  setKind(v, kind);

  if (namespace !== null && namespaced(kind)) v.namespace = namespace;

  const row = listRows(v).find((r) => r.ref.name === name);

  if (row) v.sel.set(listKey(v), row.key);

  v.panel = "table";
}
