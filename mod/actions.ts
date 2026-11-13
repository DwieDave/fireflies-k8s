// What each row action does (keys.ts names them): showing, drilling in,
// opening logs / a shell / a forward (with a picker when there's a choice:
// a container, a port), editing, and the writes, which ask first (writes.ts).
// The right-click menu is the same table.

import type { Context } from "gpui-kit";
import type { default as K8s } from "./main.ts";
import type { RowAction } from "./keys.ts";
import { ROW_KEYS, WRITES, applies } from "./keys.ts";
import type { PortFact, Row } from "./rows.ts";
import type { MenuRow } from "./state.ts";
import { drillInto, setNamespace, setKind, setTab, hasGraph } from "./nav.ts";
import { openIngress, openLogs, openShell, startForward } from "./integrate.ts";
import { deleteSpec, killSpec, nodeSpec, request, restartSpec } from "./writes.ts";
import { editRow } from "./edit.ts";
import { revealSecret } from "./secrets.ts";
import { forwardTarget } from "./integrate.ts";
import { podsOwned, ownersOf } from "./graph.ts";
import { EMPTY } from "./snapshot.ts";
import { inNs } from "./derive.ts";

/** Runs a row action. */
export function runRow(v: K8s, a: RowAction, row: Row, cx: Context): void {
  switch (a) {
    case "open": return openRow(v, row);
    case "graph": case "describe": case "yaml": case "events":
      v.detail = a;
      v.panel = v.narrow() ? "detail" : v.panel;

      return;
    case "logs": case "previous": return pickContainer(v, row, a === "previous" ? "previous logs of" : "logs of", (c, cx) => openLogs(v, row, c, a === "previous", cx), cx);
    case "shell": return pickContainer(v, row, "a shell in", (c, cx) => openShell(v, row, c, cx), cx);
    case "forward": return pickPort(v, row, cx);
    case "web": return openIngress(v, row, cx);
    case "edit": return editRow(v, row, cx);
    case "scale":
      v.typing = { what: "scale", text: replicasOf(row) };

      return;
    case "restart": return request(v, restartSpec(v, row), cx);
    case "reveal": return reveal(v, row, cx);
    case "cordon": case "uncordon": case "drain": return request(v, nodeSpec(v, row, a), cx);
    case "delete": return request(v, deleteSpec(v, row, ownedCount(v, row)), cx);
    case "kill": return request(v, killSpec(v, row), cx);
    default: return undefined;
  }
}

/** enter: k9s's drill-in for workloads, the namespace for a namespace, the app's tree for an app. */
function openRow(v: K8s, row: Row): void {
  const k = row.ref.kind;

  if (k === "deployments" || k === "statefulsets" || k === "daemonsets" || k === "replicasets" || k === "jobs") {
    drillInto(v, row);

    return;
  }

  if (k === "namespaces") {
    setNamespace(v, row.ref.name);
    setKind(v, "pods");

    return;
  }

  if (k === "applications") {
    v.app = row.ref.name;
    setTab(v, "argo");
    v.argoPanel = "tree";

    return;
  }

  v.detail = hasGraph(k) ? "graph" : "describe";
  v.panel = "detail";
}

const replicasOf = (row: Row): string => /\/(\d+)$/.exec(row.status)?.[1] ?? "1";

function ownedCount(v: K8s, row: Row): number {
  return podsOwned(row.uid, v.data.snap.value ?? EMPTY, ownersOf(inNs(v.data.pods.value ?? [], row.ref.namespace))).length;
}

/** One container: straight on; several: a picker (the failing one first). */
function pickContainer(v: K8s, row: Row, what: string, go: (container: string | null, cx: Context) => void, cx: Context): void {
  const cs = row.pod?.containers ?? [];

  if (cs.length <= 1) {
    go(cs[0]?.name ?? null, cx);

    return;
  }

  const sorted = [...cs].sort((a, b) => Number(a.ready) - Number(b.ready));

  v.menu = { title: `${what} which container of ${row.ref.name}?`, at: 0, rows: sorted.map((c): MenuRow => ({ label: c.name, sub: `${c.state}${c.restarts ? ` · ${c.restarts} restarts` : ""} · ${c.image}`, go: (cx) => go(c.name, cx) })) };
}

/** One port: forwarded straight on (asking only in a production-looking context); several: a picker. */
function pickPort(v: K8s, row: Row, cx: Context): void {
  const ports = row.ports ?? [];
  const go = (p: PortFact, cx: Context) => request(v, { kind: "forward", title: `Forward ${forwardTarget(row)} :${p.port} to this machine`, name: row.ref.name, namespace: row.ref.namespace, args: [], go: (cx) => startForward(v, row, p, cx) }, cx);

  if (ports.length === 1 && ports[0]) {
    go(ports[0], cx);

    return;
  }

  v.menu = { title: `forward which port of ${row.ref.name}?`, at: 0, rows: ports.map((p): MenuRow => ({ label: `:${p.port}`, sub: p.name ?? null, go: (cx) => go(p, cx) })) };
}

/** x: the secret's values on its row (again: hidden). */
function reveal(v: K8s, row: Row, cx: Context): void {
  if (v.secret?.key === row.key) {
    v.secret = null;

    return;
  }

  cx.spawn(async (cx) => {
    const values = await revealSecret(v.data.exec, { context: v.context ?? "", namespace: row.ref.namespace }, row.ref.name);

    v.secret = { key: row.key, values };
    v.detail = "describe";
    cx.notify();
  });
}

/** The right-click menu of a row: every action that applies, writes last and red. */
export function rowMenu(v: K8s, row: Row): MenuRow[] {
  const shown = ROW_KEYS.filter(([, a]) => applies(a, row));
  const sorted = [...shown.filter(([, a]) => !WRITES.has(a)), ...shown.filter(([, a]) => WRITES.has(a))];

  return sorted.map(([key, a, what]): MenuRow => ({ label: what, key, danger: WRITES.has(a), go: (cx) => runRow(v, a, row, cx) }));
}
