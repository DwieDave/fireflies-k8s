// The kinds the window knows: what kubectl calls each, the short names `:`
// takes (k9s's aliases where it has them), whether it lives in a namespace,
// its icon and its place in the rail. A custom kind (a CRD) is a `KindRef`
// too, by its kubectl name ("certificates.cert-manager.io").

import type { Guarded } from "./guard.ts";
import { literal } from "./guard.ts";

export const isBuiltin = literal(
  "pods", "deployments", "replicasets", "statefulsets", "daemonsets", "jobs", "cronjobs",
  "services", "ingresses", "configmaps", "secrets", "pvcs", "events", "nodes", "namespaces", "applications",
);

/** A kind the window draws with columns of its own. */
export type Builtin = Guarded<typeof isBuiltin>;

/** A kind: a built-in one, or a custom one by its kubectl resource name. */
export type KindRef = Builtin | `custom:${string}`;

/** The rail's groups. */
export type KindGroup = "workloads" | "network" | "config" | "cluster" | "argo";

/** What the window knows of a built-in kind. */
export interface KindInfo {
  readonly id: Builtin;
  readonly title: string;
  /** kubectl's resource name. */
  readonly resource: string;
  /** The kind as objects name it (`kind: Deployment`). */
  readonly kind: string;
  readonly aliases: readonly string[];
  readonly namespaced: boolean;
  readonly icon: string;
  readonly group: KindGroup;
  /** Shown in the rail's list (replica sets and namespaces are reached otherwise). */
  readonly listed: boolean;
}

const k = (id: Builtin, title: string, resource: string, kind: string, aliases: readonly string[], icon: string, group: KindGroup, namespaced = true, listed = true): KindInfo =>
  ({ id, title, resource, kind, aliases, namespaced, icon, group, listed });

export const KINDS: readonly KindInfo[] = [
  k("pods", "Pods", "pods", "Pod", ["po", "pod"], "box", "workloads"),
  k("deployments", "Deployments", "deployments.apps", "Deployment", ["deploy", "dp", "deployment"], "layers", "workloads"),
  k("statefulsets", "StatefulSets", "statefulsets.apps", "StatefulSet", ["sts", "statefulset"], "database", "workloads"),
  k("daemonsets", "DaemonSets", "daemonsets.apps", "DaemonSet", ["ds", "daemonset"], "server", "workloads"),
  k("replicasets", "ReplicaSets", "replicasets.apps", "ReplicaSet", ["rs", "replicaset"], "layers", "workloads", true, false),
  k("jobs", "Jobs", "jobs.batch", "Job", ["job"], "clock", "workloads"),
  k("cronjobs", "CronJobs", "cronjobs.batch", "CronJob", ["cj", "cronjob"], "clock", "workloads"),
  k("services", "Services", "services", "Service", ["svc", "service"], "network", "network"),
  k("ingresses", "Ingresses", "ingresses.networking.k8s.io", "Ingress", ["ing", "ingress"], "globe", "network"),
  k("configmaps", "ConfigMaps", "configmaps", "ConfigMap", ["cm", "configmap"], "file", "config"),
  k("secrets", "Secrets", "secrets", "Secret", ["sec", "secret"], "key", "config"),
  k("pvcs", "PVCs", "persistentvolumeclaims", "PersistentVolumeClaim", ["pvc", "persistentvolumeclaims"], "database", "config"),
  k("events", "Events", "events", "Event", ["ev", "event"], "clock", "cluster"),
  k("nodes", "Nodes", "nodes", "Node", ["no", "node"], "server", "cluster", false),
  k("namespaces", "Namespaces", "namespaces", "Namespace", ["ns", "namespace"], "folder", "cluster", false, false),
  k("applications", "Applications", "applications.argoproj.io", "Application", ["app", "apps", "argo", "application"], "hex", "argo"),
];

const BY_ID = new Map(KINDS.map((x) => [x.id, x]));

/** A built-in kind's facts. */
export function kindInfo(id: Builtin): KindInfo {
  const info = BY_ID.get(id);

  if (!info) throw new Error(`unknown kind ${id}`);

  return info;
}

/** The custom kind's resource name, or null for a built-in one. */
export function customOf(ref: KindRef): string | null {
  return ref.startsWith("custom:") ? ref.slice(7) : null;
}

/** kubectl's name for a kind. */
export function resourceOf(ref: KindRef): string {
  const custom = customOf(ref);

  return custom ?? kindInfo(isBuiltin(ref) ? ref : "pods").resource;
}

/** A kind's title as the window shows it. */
export function titleOf(ref: KindRef): string {
  const custom = customOf(ref);

  if (custom === null) return isBuiltin(ref) ? kindInfo(ref).title : ref;

  const plural = custom.split(".")[0] ?? custom;

  return plural.charAt(0).toUpperCase() + plural.slice(1);
}

/** Whether a kind lives in a namespace (custom kinds are taken as namespaced). */
export function namespaced(ref: KindRef): boolean {
  return isBuiltin(ref) ? kindInfo(ref).namespaced : true;
}

/** The built-in kind an object's `kind` names (`Deployment` → deployments), or null. */
export function builtinOfKind(kind: string): Builtin | null {
  return KINDS.find((x) => x.kind === kind)?.id ?? null;
}

/** Resources kubectl lists that the built-in kinds already cover (api-resources' names). */
const COVERED = new Set([...KINDS.map((x) => x.resource), "pods", "events", "appprojects.argoproj.io", "events.events.k8s.io", "endpointslices.discovery.k8s.io", "endpoints", "leases.coordination.k8s.io", "controllerrevisions.apps", "serviceaccounts", "roles.rbac.authorization.k8s.io", "rolebindings.rbac.authorization.k8s.io", "poddisruptionbudgets.policy", "limitranges", "resourcequotas", "networkpolicies.networking.k8s.io", "horizontalpodautoscalers.autoscaling", "csistoragecapacities.storage.k8s.io", "podtemplates", "replicationcontrollers"]);

/** The custom kinds in `kubectl api-resources --verbs=list -o name`'s answer: the dotted names the built-ins don't cover. */
export function customKinds(apiResources: string): readonly KindRef[] {
  return apiResources.split("\n").map((l) => l.trim()).filter((l) => l.includes(".") && !COVERED.has(l)).map((l): KindRef => `custom:${l}`);
}

/** What `:` takes: a kind's alias, title, kubectl name or a custom kind's name; null when nothing matches. */
export function kindFor(word: string, custom: readonly KindRef[] = []): KindRef | null {
  const w = word.trim().toLowerCase();

  if (!w) return null;

  const hit = KINDS.find((x) => x.id === w || x.aliases.includes(w) || x.title.toLowerCase() === w || x.resource === w);

  if (hit) return hit.id;

  return custom.find((c) => {
    const name = customOf(c) ?? "";

    return name === w || name.split(".")[0] === w || name.split(".")[0]?.replace(/s$/, "") === w;
  }) ?? null;
}

/** The completions `:` offers for what's typed (aliases first, then titles and custom kinds). */
export function kindCompletions(word: string, custom: readonly KindRef[] = []): readonly KindRef[] {
  const w = word.trim().toLowerCase();
  const all: KindRef[] = [...KINDS.map((x) => x.id), ...custom];

  if (!w) return all;

  return all.filter((ref) => {
    const words = isBuiltin(ref) ? [ref, ...kindInfo(ref).aliases, kindInfo(ref).title.toLowerCase()] : [customOf(ref) ?? ""];

    return words.some((x) => x.startsWith(w));
  });
}
