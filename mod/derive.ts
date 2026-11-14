// What the window draws from what it read: the selected kind's rows (with
// the filter and a drill-in applied), each namespace's pods as a strip of
// tones (a failing workload is seen before a word is read), the rail's
// counts. Cached on the data's version, so a frame without a change builds
// nothing again.

import type { Data } from "./data.ts";
import type { Owners } from "./graph.ts";
import { ownersOf, podsOwned } from "./graph.ts";
import type { Builtin, KindRef } from "./kinds.ts";
import { KINDS, customKinds, isBuiltin } from "./kinds.ts";
import type { Pod } from "./objects.ts";
import type { Row, Tone } from "./rows.ts";
import { podState } from "./rows.ts";
import { configMapRow, cronJobRow, customRow, daemonSetRow, deploymentRow, eventRow, ingressRow, jobRow, namespaceRow, nodeRow, podRow, pvcRow, replicaSetRow, serviceRow, statefulSetRow } from "./rows-kinds.ts";
import type { Snapshot } from "./snapshot.ts";
import { EMPTY } from "./snapshot.ts";
import { applicationRow } from "./argo.ts";
import { instant } from "./time.ts";
import type { Drill } from "./state.ts";
import { matches, parseTerms } from "./filter-terms.ts";

/** A namespace in the rail: its name and its pods' tones (failing first). */
export interface NsStrip {
  readonly name: string | null;
  readonly tones: readonly Tone[];
  readonly bad: number;
}

/** Rows of every kind for the shown namespace (null: all); `from` another snapshot (the Argo tab's). */
export function rowsOf(d: Data, kind: KindRef, ns: string | null, now = Date.now(), from: Snapshot | null = null): readonly Row[] {
  const snap = from ?? d.snap.value ?? EMPTY;
  const pods = inNs(d.pods.value ?? [], ns);
  const owners = ownersOf(pods);

  if (!isBuiltin(kind)) return (d.custom.value ?? []).map((o) => customRow(kind, o));

  return builtinRows(d, kind, snap, pods, owners, now);
}

function builtinRows(d: Data, kind: Builtin, snap: Snapshot, pods: readonly Pod[], owners: Owners, now: number): readonly Row[] {
  const owned = (uid: string | null) => podsOwned(uid, snap, owners);

  switch (kind) {
    case "pods": return pods.map((p) => podRow(p, now));
    case "deployments": return snap.deployments.map((x) => deploymentRow(x, owned));
    case "replicasets": return snap.replicasets.map(replicaSetRow);
    case "statefulsets": return snap.statefulsets.map((x) => statefulSetRow(x, owned));
    case "daemonsets": return snap.daemonsets.map(daemonSetRow);
    case "jobs": return snap.jobs.map((x) => jobRow(x, now));
    case "cronjobs": return snap.cronjobs.map((x) => cronJobRow(x, now));
    case "services": return snap.services.map(serviceRow);
    case "ingresses": return snap.ingresses.map(ingressRow);
    case "configmaps": return snap.configmaps.map(configMapRow);
    case "secrets": return d.secrets.value ?? [];
    case "pvcs": return snap.pvcs.map(pvcRow);
    case "events": return [...(d.events.value ?? [])].sort((a, b) => (instant(b.lastTimestamp ?? b.metadata.creationTimestamp) ?? 0) - (instant(a.lastTimestamp ?? a.metadata.creationTimestamp) ?? 0)).map(eventRow);
    case "nodes": return (d.nodes.value ?? []).map(nodeRow);
    case "namespaces": return (d.namespaces.value ?? []).map(namespaceRow);
    case "applications": return (d.apps.value ?? []).map(applicationRow);
    default: return [];
  }
}

export const inNs = (pods: readonly Pod[], ns: string | null): readonly Pod[] => (ns === null ? pods : pods.filter((p) => p.metadata.namespace === ns));

/** The `/` filter (filter-terms.ts, one syntax with the Argo tab): words in the name, `!x` not x, `k=v` and
 *  `-l k=v,k2,!k3` labels, `status:` `ns:` `node:`. */
export function filterRows(rows: readonly Row[], filter: string): readonly Row[] {
  const terms = parseTerms(filter, ROW_FIELDS);

  if (!terms.length) return rows;

  return rows.filter((r) => matches({ text: `${r.ref.name} ${r.status} ${r.ref.namespace ?? ""}`, labels: r.labels, fields: (f) => rowField(r, f) }, terms));
}

/** The fields the Resources filter knows (filter-terms.ts: the Argo tab's syntax). */
export const ROW_FIELDS: readonly string[] = ["status", "ns", "node"];

function rowField(r: Row, f: string): readonly string[] {
  if (f === "status") return [r.status];

  if (f === "ns") return [r.ref.namespace ?? ""];

  return f === "node" && r.pod?.node ? [r.pod.node] : [];
}

/** Rows narrowed to a drill-in's (a workload's pods). */
export function drillRows(d: Data, rows: readonly Row[], drill: Drill | null, ns: string | null): readonly Row[] {
  if (!drill) return rows;

  const names = new Set(podsOwned(drill.uid, d.snap.value ?? EMPTY, ownersOf(inNs(d.pods.value ?? [], ns))));

  return rows.filter((r) => names.has(`${r.ref.namespace ?? ""}/${r.ref.name}`));
}

const RANK: Readonly<Record<Tone, number>> = { bad: 0, wk: 1, miss: 2, ok: 3, done: 4, off: 5 };

/** Each namespace's pods as tones, failing first; the first entry is every namespace (`0`). */
export function strips(d: Data, favourites: readonly string[]): readonly NsStrip[] {
  const pods = d.pods.value ?? [];
  const by = new Map<string, Tone[]>();

  for (const p of pods) {
    const ns = p.metadata.namespace ?? "";
    const list = by.get(ns) ?? [];

    list.push(podState(p).tone);
    by.set(ns, list);
  }

  const names = (d.namespaces.value ?? []).map((n) => n.metadata.name);
  const known = names.length ? names : [...by.keys()];
  const order = [...favourites.filter((f) => known.includes(f)), ...known.filter((n) => !favourites.includes(n)).sort()];
  const strip = (name: string | null, tones: readonly Tone[]): NsStrip => ({ name, tones: [...tones].sort((a, b) => RANK[a] - RANK[b]), bad: tones.filter((t) => t === "bad").length });

  return [strip(null, pods.map((p) => podState(p).tone)), ...order.map((n) => strip(n, by.get(n) ?? []))];
}

/** A kind in the rail: how many there are, and how many are failing. */
export interface KindCount {
  readonly kind: KindRef;
  readonly n: number | null;
  readonly bad: number;
}

/** The rail's kinds with their counts in the shown namespace (null: not read). */
export function kindCounts(d: Data, ns: string | null, now = Date.now()): readonly KindCount[] {
  const listed = KINDS.filter((k) => k.listed && (k.id !== "applications" || hasArgo(d)));
  const known = new Set<KindRef>(["pods", "deployments", "statefulsets", "daemonsets", "jobs", "cronjobs", "services", "ingresses", "configmaps", "pvcs"]);

  return listed.map((k): KindCount => {
    if (!known.has(k.id) || d.snap.value === null) {
      const n = k.id === "secrets" ? d.secrets.value?.length ?? null : k.id === "applications" ? d.apps.value?.length ?? null : null;

      return { kind: k.id, n, bad: 0 };
    }

    const rows = rowsOf(d, k.id, ns, now);

    return { kind: k.id, n: rows.length, bad: rows.filter((r) => r.tone === "bad").length };
  });
}

/** Whether the cluster has Argo CD's Applications. */
export function hasArgo(d: Data): boolean {
  return (d.apiResources.value ?? "").split("\n").some((l) => l.trim() === "applications.argoproj.io");
}

/** The custom kinds the cluster lists. */
export function customOfCluster(d: Data): readonly KindRef[] {
  return customKinds(d.apiResources.value ?? "");
}

/** A cache of one derived value per data version and key. */
export class Memo<T> {
  private at = -1;
  private key = "";
  private value: T | null = null;

  get(version: number, key: string, make: () => T): T {
    if (this.value !== null && this.at === version && this.key === key) return this.value;

    this.value = make();
    this.at = version;
    this.key = key;

    return this.value;
  }
}
