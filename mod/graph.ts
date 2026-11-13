// The graphs' model: what a workload is made of, read the way traffic flows
// (ingress → service → workload → replica sets → pods), and what an Argo CD
// application manages (app → its resources → what they own). Built from
// ownerReferences (uids), services' selectors and ingresses' rules; laid out
// by graph-layout.ts, drawn by graph-view.ts.

import type { KindRef } from "./kinds.ts";
import type { Pod } from "./objects.ts";
import type { Ref, Tone } from "./rows.ts";
import { podState, restartsOf } from "./rows.ts";
import { deploymentRow, statefulSetRow, daemonSetRow, jobRow, cronJobRow, replicaSetRow } from "./rows-kinds.ts";
import type { Snapshot } from "./snapshot.ts";

/** One box of a graph. */
export interface GNode {
  readonly key: string;
  readonly label: string;
  /** The kind's short name drawn beside the label ("deploy", "rs", "pod" …). */
  readonly kind: string;
  readonly sub: string;
  readonly tone: Tone;
  readonly icon: string | null;
  /** What it points at (selecting it, acting on it); null for the Argo app itself. */
  readonly ref: Ref | null;
  /** An old replica set scaled away: drawn faded and dashed. */
  readonly ghost?: boolean;
  /** Argo: a flag over the box ("out of sync", "missing"), drawn dashed yellow. */
  readonly flag?: string | null;
  /** A pod's metrics key ("ns/name") for its CPU line. */
  readonly metric?: string | null;
  readonly restarts?: number;
  readonly children: readonly GNode[];
}

/** Boxes left of the tree's root (services, ingresses), each with the keys it leads to. */
export interface Feeder {
  readonly node: GNode;
  /** The column: 1 right before the root, 2 before that. */
  readonly depth: number;
  readonly to: readonly string[];
}

/** A graph: the tree, and what feeds its root. */
export interface Graph {
  readonly root: GNode;
  readonly feeders: readonly Feeder[];
}

const NOW = () => Date.now();

/** Everything that owns something, by uid → what it owns. */
export interface Owners {
  readonly pods: ReadonlyMap<string, readonly Pod[]>;
}

/** Pods by their controller's uid. */
export function ownersOf(pods: readonly Pod[]): Owners {
  const m = new Map<string, Pod[]>();

  for (const p of pods) {
    for (const o of p.metadata.ownerReferences ?? []) {
      if (!o.uid) continue;

      const list = m.get(o.uid) ?? [];

      list.push(p);
      m.set(o.uid, list);
    }
  }

  return { pods: m };
}

/** The pod names an object owns, directly or through its replica sets (for its metrics). */
export function podsOwned(uid: string | null, snap: Snapshot, owners: Owners): readonly string[] {
  if (uid === null) return [];

  const direct = owners.pods.get(uid) ?? [];
  const viaRs = snap.replicasets.filter((r) => r.metadata.ownerReferences?.some((o) => o.uid === uid)).flatMap((r) => owners.pods.get(r.metadata.uid ?? "") ?? []);

  return [...direct, ...viaRs].map((p) => `${p.metadata.namespace ?? ""}/${p.metadata.name}`);
}

/** A pod's box. */
export function podNode(p: Pod): GNode {
  const st = podState(p);
  const r = restartsOf(p.status?.containerStatuses ?? [], NOW());
  const ns = p.metadata.namespace ?? null;
  const short = p.metadata.name.length > 22 ? `…${p.metadata.name.slice(-12)}` : p.metadata.name;

  return {
    key: p.metadata.uid ?? `pod/${p.metadata.name}`, label: short, kind: "pod", tone: st.tone, icon: null,
    sub: st.word === "Running" ? p.spec?.nodeName ?? "Running" : st.word, ref: { kind: "pods", name: p.metadata.name, namespace: ns },
    metric: `${ns ?? ""}/${p.metadata.name}`, restarts: r.count, children: [],
  };
}

const ref = (kind: KindRef, name: string, namespace: string | null | undefined): Ref => ({ kind, name, namespace: namespace ?? null });

/** Pods owned by a uid, as boxes, failing ones first so they're seen. */
function podsOf(uid: string | null | undefined, owners: Owners): GNode[] {
  const rank: Readonly<Record<Tone, number>> = { bad: 0, wk: 1, miss: 2, ok: 3, done: 4, off: 5 };

  return (owners.pods.get(uid ?? "") ?? []).map(podNode).sort((a, b) => rank[a.tone] - rank[b.tone] || a.label.localeCompare(b.label));
}

/** A deployment's tree: its replica sets (newest first; old ones scaled away as ghosts, at most two) and their pods. */
export function deploymentTree(uid: string, snap: Snapshot, owners: Owners): GNode | null {
  const d = snap.deployments.find((x) => x.metadata.uid === uid);

  if (!d) return null;

  const row = deploymentRow(d, () => []);
  const rev = (r: { readonly metadata: { readonly annotations?: { readonly [k: string]: string | undefined } | null | undefined } }) => Number(r.metadata.annotations?.["deployment.kubernetes.io/revision"] ?? 0);
  const sets = snap.replicasets.filter((r) => r.metadata.ownerReferences?.some((o) => o.uid === uid)).sort((a, b) => rev(b) - rev(a));
  const live = sets.filter((r) => (r.spec?.replicas ?? 0) > 0 || (r.status?.replicas ?? 0) > 0);
  const old = sets.filter((r) => !live.includes(r)).slice(0, 2);

  const children = [...live, ...old].map((r): GNode => {
    const rr = replicaSetRow(r);
    const ghost = !live.includes(r);

    return {
      key: rr.key, label: r.metadata.name, kind: "rs", tone: ghost ? "off" : rr.tone, icon: null, ghost,
      sub: `rev ${rev(r)} · ${ghost ? "scaled to 0" : rr.status}`, ref: ref("replicasets", r.metadata.name, r.metadata.namespace), children: ghost ? [] : podsOf(r.metadata.uid, owners),
    };
  });

  return { key: row.key, label: d.metadata.name, kind: "deploy", tone: row.tone, icon: "layers", sub: `rev ${rev(d)} · ${row.status}`, ref: row.ref, children };
}

/** The tree for any workload row: its controller and what it runs. */
export function workloadTree(target: Ref, uid: string | null, snap: Snapshot, owners: Owners, pods: readonly Pod[]): GNode | null {
  if (uid === null) return null;

  switch (target.kind) {
    case "deployments": return deploymentTree(uid, snap, owners);
    case "statefulsets": {
      const s = snap.statefulsets.find((x) => x.metadata.uid === uid);
      const r = s ? statefulSetRow(s, () => []) : null;

      return s && r ? { key: r.key, label: s.metadata.name, kind: "sts", tone: r.tone, icon: "database", sub: r.status, ref: r.ref, children: podsOf(uid, owners) } : null;
    }

    case "daemonsets": {
      const s = snap.daemonsets.find((x) => x.metadata.uid === uid);
      const r = s ? daemonSetRow(s) : null;

      return s && r ? { key: r.key, label: s.metadata.name, kind: "ds", tone: r.tone, icon: "server", sub: r.status, ref: r.ref, children: podsOf(uid, owners) } : null;
    }

    case "jobs": return jobTree(uid, snap, owners);
    case "cronjobs": {
      const cj = snap.cronjobs.find((x) => x.metadata.uid === uid);
      const r = cj ? cronJobRow(cj, NOW()) : null;

      const jobs = snap.jobs.filter((j) => j.metadata.ownerReferences?.some((o) => o.uid === uid)).slice(-4).flatMap((j) => {
        const t = jobTree(j.metadata.uid ?? "", snap, owners);

        return t ? [t] : [];
      });

      return cj && r ? { key: r.key, label: cj.metadata.name, kind: "cj", tone: r.tone, icon: "clock", sub: cj.spec?.schedule ?? "", ref: r.ref, children: jobs } : null;
    }

    case "replicasets":
    case "pods": return ownerTree(uid, snap, owners, pods);
    default: return null;
  }
}

function jobTree(uid: string, snap: Snapshot, owners: Owners): GNode | null {
  const j = snap.jobs.find((x) => x.metadata.uid === uid);
  const r = j ? jobRow(j, NOW()) : null;

  return j && r ? { key: r.key, label: j.metadata.name, kind: "job", tone: r.tone, icon: "clock", sub: r.status, ref: r.ref, children: podsOf(uid, owners) } : null;
}

/** A pod's or replica set's graph is its top controller's (a pod alone is its own). */
function ownerTree(uid: string, snap: Snapshot, owners: Owners, pods: readonly Pod[]): GNode | null {
  const pod = pods.find((p) => p.metadata.uid === uid);
  const rs = snap.replicasets.find((r) => r.metadata.uid === uid);
  const meta = pod?.metadata ?? rs?.metadata ?? null;
  const owner = meta?.ownerReferences?.find((o) => o.controller) ?? meta?.ownerReferences?.[0] ?? null;

  if (owner?.uid) {
    const rsOwner = owner.kind === "ReplicaSet" ? snap.replicasets.find((r) => r.metadata.uid === owner.uid) : null;
    const top = rsOwner?.metadata.ownerReferences?.find((o) => o.controller) ?? null;
    const kind: KindRef | null = top?.kind === "Deployment" ? "deployments" : owner.kind === "StatefulSet" ? "statefulsets" : owner.kind === "DaemonSet" ? "daemonsets" : owner.kind === "Job" ? "jobs" : null;
    const topUid = top?.uid ?? owner.uid;

    if (kind) return workloadTree({ kind, name: top?.name ?? owner.name, namespace: meta?.namespace ?? null }, topUid, snap, owners, pods);
  }

  return pod ? podNode(pod) : null;
}

/** The pods a service sends to: its selector within its namespace. */
export function selects(selector: { readonly [k: string]: string | undefined } | null | undefined, pod: Pod): boolean {
  const entries = Object.entries(selector ?? {});

  return entries.length > 0 && entries.every(([k, v]) => pod.metadata.labels?.[k] === v);
}

/** The services and ingresses that reach a tree's pods, as feeders of its root. */
export function feedersOf(root: GNode, snap: Snapshot, pods: readonly Pod[]): readonly Feeder[] {
  const keys = new Set<string>();

  const walk = (n: GNode) => {
    if (n.kind === "pod") keys.add(n.key);

    n.children.forEach(walk);
  };

  walk(root);

  const ns = root.ref?.namespace ?? null;
  const mine = pods.filter((p) => keys.has(p.metadata.uid ?? `pod/${p.metadata.name}`));
  const services = snap.services.filter((s) => (s.metadata.namespace ?? null) === ns && mine.some((p) => selects(s.spec?.selector, p)));
  const names = new Set(services.map((s) => s.metadata.name));

  const svcNodes = services.map((s): Feeder => ({
    depth: 1, to: [root.key],
    node: { key: s.metadata.uid ?? `svc/${s.metadata.name}`, label: s.metadata.name, kind: "svc", tone: "ok", icon: "network", ref: ref("services", s.metadata.name, s.metadata.namespace),
      sub: `${s.spec?.type ?? "ClusterIP"} ${(s.spec?.ports ?? []).map((p) => `:${p.port}`).join(" ")}`, children: [] },
  }));

  const ingNodes = snap.ingresses.filter((i) => (i.metadata.namespace ?? null) === ns).flatMap((i): Feeder[] => {
    const to = new Set((i.spec?.rules ?? []).flatMap((r) => (r.http?.paths ?? []).flatMap((p) => p.backend?.service?.name ?? [])).filter((n) => names.has(n)));

    if (!to.size) return [];

    const host = i.spec?.rules?.[0]?.host ?? "*";
    const paths = (i.spec?.rules ?? []).flatMap((r) => (r.http?.paths ?? []).filter((p) => to.has(p.backend?.service?.name ?? "")).map((p) => p.path ?? "/"));

    return [{
      depth: 2, to: services.filter((s) => to.has(s.metadata.name)).map((s) => s.metadata.uid ?? `svc/${s.metadata.name}`),
      node: { key: i.metadata.uid ?? `ing/${i.metadata.name}`, label: host, kind: "ing", tone: "ok", icon: "globe", ref: ref("ingresses", i.metadata.name, i.metadata.namespace), sub: paths.join(" "), children: [] },
    }];
  });

  return [...ingNodes, ...svcNodes];
}

/** The workload graph for a row: its tree and what feeds it. */
export function workloadGraph(target: Ref, uid: string | null, snap: Snapshot, pods: readonly Pod[]): Graph | null {
  const owners = ownersOf(pods);
  const root = workloadTree(target, uid, snap, owners, pods);

  return root ? { root, feeders: feedersOf(root, snap, pods) } : null;
}
