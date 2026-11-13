// Argo CD without its CLI: applications are the cluster's
// `applications.argoproj.io` objects. Their status says how each is synced
// and how healthy, which resources it manages (each with its own sync and
// health), its history and the sync running now. The actions are what Argo's
// own UI does through its API server, done on the object:
//
//   refresh   annotate argocd.argoproj.io/refresh=normal (hard: =hard)
//   sync      patch .operation.sync (the controller runs it, then clears it)
//   rollback  the same, with a history entry's revision (refused while auto-sync is on)
//
// The diff of what a sync would change needs the rendered manifests, which
// live in Argo's repo-server, not in the cluster: the `argocd` CLI gives them
// when it's installed and logged in; without it the window compares the live
// object with its last-applied configuration (diff.ts) and says so.

import type { Guarded } from "./guard.ts";
import { arrayOf, isBoolean, isNumber, isString, object } from "./guard.ts";
import { maybe, isRecord } from "./guards.ts";
import { isMeta } from "./objects.ts";
import type { Pod } from "./objects.ts";
import type { GNode, Graph } from "./graph.ts";
import { ownersOf, workloadTree } from "./graph.ts";
import type { KindRef } from "./kinds.ts";
import { builtinOfKind } from "./kinds.ts";
import type { Row, Tone } from "./rows.ts";
import { keyOf, labelsOf, text } from "./rows.ts";
import type { Snapshot } from "./snapshot.ts";
import { instant } from "./time.ts";

const str = maybe(isString);

const isSource = object({}, { repoURL: str, path: str, targetRevision: str, chart: str });
const isDestination = object({}, { server: str, name: str, namespace: str });
const isManaged = object({ kind: isString, name: isString }, { group: str, version: str, namespace: str, status: str, health: maybe(object({}, { status: str, message: str })), requiresPruning: maybe(isBoolean) });

export type Managed = Guarded<typeof isManaged>;

const isHistory = object({ id: isNumber }, { revision: str, deployedAt: str, source: maybe(isSource) });

export type HistoryEntry = Guarded<typeof isHistory>;

const isOperation = object({}, { phase: str, message: str, startedAt: str, finishedAt: str });

export const isApplication = object({ metadata: isMeta }, {
  spec: maybe(object({}, { project: str, source: maybe(isSource), sources: maybe(arrayOf(isSource)), destination: maybe(isDestination), syncPolicy: maybe(object({}, { automated: maybe(isRecord) })) })),
  status: maybe(object({}, {
    sync: maybe(object({}, { status: str, revision: str })), health: maybe(object({}, { status: str, message: str })),
    resources: maybe(arrayOf(isManaged)), history: maybe(arrayOf(isHistory)), operationState: maybe(isOperation), reconciledAt: str,
  })),
});

export type Application = Guarded<typeof isApplication>;

/** The cluster Argo itself runs in. */
export const IN_CLUSTER = "https://kubernetes.default.svc";

/** A health word's colour. */
export function healthTone(h: string | null | undefined): Tone {
  switch (h) {
    case "Healthy": return "ok";
    case "Progressing": return "wk";
    case "Degraded": return "bad";
    case "Missing": return "miss";
    case "Suspended": return "off";
    default: return "off";
  }
}

/** A sync word's colour. */
export function syncTone(s: string | null | undefined): Tone {
  return s === "Synced" ? "ok" : s === "OutOfSync" ? "wk" : "off";
}

/** The application's source (the first of several). */
export function sourceOf(a: Application): Guarded<typeof isSource> | null {
  return a.spec?.source ?? a.spec?.sources?.[0] ?? null;
}

/** Where it deploys to, as people read it ("in-cluster/lantern"). */
export function destinationOf(a: Application): string {
  const d = a.spec?.destination;
  const server = d?.name ?? (d?.server === IN_CLUSTER || !d?.server ? "in-cluster" : d.server.replace(/^https?:\/\//, "").replace(/:\d+$/, ""));

  return `${server}/${d?.namespace ?? ""}`;
}

/** Whether its destination is the cluster this context reads (so its children can be shown). */
export function inThisCluster(a: Application): boolean {
  const d = a.spec?.destination;

  return !d?.server || d.server === IN_CLUSTER || d.name === "in-cluster";
}

export const autoSync = (a: Application): boolean => Boolean(a.spec?.syncPolicy?.automated);

const short = (rev: string | null | undefined): string => (rev ? rev.slice(0, 7) : "—");

/** An application as a row of the Applications table. */
export function applicationRow(a: Application): Row {
  const sync = a.status?.sync?.status ?? "Unknown";
  const health = a.status?.health?.status ?? "Unknown";
  const running = a.status?.operationState?.phase === "Running";
  const tone = health === "Healthy" && sync !== "Synced" ? "wk" : healthTone(health);

  return {
    key: keyOf(a.metadata, "applications"), uid: a.metadata.uid ?? null, ref: { kind: "applications", name: a.metadata.name, namespace: a.metadata.namespace ?? null },
    tone, status: `${sync} · ${health}${running ? " · syncing" : ""}`, created: instant(a.metadata.creationTimestamp), labels: labelsOf(a.metadata),
    cells: [text(a.metadata.name), text(sync, syncTone(sync)), text(health, healthTone(health)), text(short(a.status?.sync?.revision), null, true), text(destinationOf(a), null, true), { t: "age", at: instant(a.metadata.creationTimestamp) }],
  };
}

/** A managed resource's box: its sync and health; out of sync or missing flagged. */
function managedNode(a: Application, m: Managed, children: readonly GNode[]): GNode {
  const missing = m.health?.status === "Missing";
  const outOfSync = m.status === "OutOfSync";
  const kind: KindRef | null = builtinOfKind(m.kind);
  const tone: Tone = missing ? "miss" : m.health?.status ? healthTone(m.health.status) : "ok";

  return {
    key: `${a.metadata.name}/${m.kind}/${m.namespace ?? ""}/${m.name}`, label: m.name, kind: SHORT.get(m.kind) ?? m.kind.toLowerCase(), tone, icon: ICON.get(m.kind) ?? "file",
    sub: missing ? "missing in the cluster" : m.health?.status ?? m.kind, ref: kind ? { kind, name: m.name, namespace: m.namespace ?? null } : null,
    flag: missing ? "missing" : outOfSync ? "out of sync" : m.requiresPruning ? "prune" : null, children,
  };
}

const SHORT: ReadonlyMap<string, string> = new Map([["Deployment", "deploy"], ["StatefulSet", "sts"], ["DaemonSet", "ds"], ["ReplicaSet", "rs"], ["Service", "svc"], ["Ingress", "ing"], ["ConfigMap", "cm"], ["Secret", "secret"], ["Job", "job"], ["CronJob", "cj"], ["PersistentVolumeClaim", "pvc"], ["Namespace", "ns"]]);
const ICON: ReadonlyMap<string, string> = new Map([["Deployment", "layers"], ["StatefulSet", "database"], ["DaemonSet", "server"], ["Service", "network"], ["Ingress", "globe"], ["ConfigMap", "file"], ["Secret", "key"], ["Job", "clock"], ["CronJob", "clock"], ["PersistentVolumeClaim", "database"], ["Namespace", "folder"]]);

/** The order Argo's tree reads in: config first, then network, then workloads. */
const ORDER = ["Namespace", "ConfigMap", "Secret", "PersistentVolumeClaim", "Service", "Ingress", "Deployment", "StatefulSet", "DaemonSet", "CronJob", "Job"];

/** An application's tree: the app, its resources, and (in this cluster) what its workloads own. */
export function appGraph(a: Application, snap: Snapshot, pods: readonly Pod[]): Graph {
  const owners = ownersOf(pods);
  const local = inThisCluster(a);
  const rank = (k: string) => (ORDER.includes(k) ? ORDER.indexOf(k) : ORDER.length);

  const resources = [...(a.status?.resources ?? [])].sort((x, y) => rank(x.kind) - rank(y.kind) || x.name.localeCompare(y.name)).map((m) => {
    const kind = builtinOfKind(m.kind);
    const uid = local && kind ? uidOf(snap, kind, m.name, m.namespace ?? null) : null;
    const tree = uid !== null && kind ? workloadTree({ kind, name: m.name, namespace: m.namespace ?? null }, uid, snap, owners, pods) : null;

    return managedNode(a, m, tree?.children ?? []);
  });

  const sync = a.status?.sync?.status ?? "Unknown";
  const health = a.status?.health?.status ?? "Unknown";

  return {
    root: { key: keyOf(a.metadata, "applications"), label: a.metadata.name, kind: "app", tone: healthTone(health), icon: "hex", sub: `${sync} · ${health}`, ref: { kind: "applications", name: a.metadata.name, namespace: a.metadata.namespace ?? null }, flag: sync === "OutOfSync" ? "out of sync" : null, children: resources },
    feeders: [],
  };
}

function uidOf(snap: Snapshot, kind: KindRef, name: string, ns: string | null): string | null {
  const find = <T extends { readonly metadata: { readonly name: string; readonly namespace?: string | null | undefined; readonly uid?: string | null | undefined } }>(list: readonly T[]) =>
    list.find((o) => o.metadata.name === name && (o.metadata.namespace ?? null) === ns)?.metadata.uid ?? null;

  switch (kind) {
    case "deployments": return find(snap.deployments);
    case "statefulsets": return find(snap.statefulsets);
    case "daemonsets": return find(snap.daemonsets);
    case "jobs": return find(snap.jobs);
    case "cronjobs": return find(snap.cronjobs);
    default: return null;
  }
}

/** The resource name Argo's objects go by for kubectl. */
const APPS = "applications.argoproj.io";

/** The kubectl arguments of an Argo action on application `name` (in its namespace, usually argocd). */
export function refreshArgs(context: string, ns: string, name: string, hard = false): string[] {
  return ["--context", context, "-n", ns, "annotate", APPS, name, `argocd.argoproj.io/refresh=${hard ? "hard" : "normal"}`, "--overwrite"];
}

/** A sync to the app's target revision (or `revision`: a rollback's). */
export function syncArgs(context: string, ns: string, name: string, revision: string, prune = false): string[] {
  const op = { operation: { initiatedBy: { username: "fireflies" }, sync: { revision, prune } } };

  return ["--context", context, "-n", ns, "patch", APPS, name, "--type", "merge", "-p", JSON.stringify(op)];
}

/** What a sync of `a` syncs to. */
export function targetRevision(a: Application): string {
  return sourceOf(a)?.targetRevision ?? "HEAD";
}

/** Why a rollback can't run, or null. */
export function rollbackRefusal(a: Application, entry: HistoryEntry | null): string | null {
  if (autoSync(a)) return "auto-sync is on: Argo would sync it straight back (turn auto-sync off first)";

  if (!entry?.revision) return "pick a revision from the history";

  if (entry.revision === a.status?.sync?.revision) return "that's the revision running now";

  return null;
}

/** The history, newest last, as the timeline draws it. */
export function historyOf(a: Application): readonly HistoryEntry[] {
  return [...(a.status?.history ?? [])].sort((x, y) => x.id - y.id);
}
