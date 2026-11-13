// A namespace at once: every workload, network and config kind in one
// `kubectl get deployments.apps,replicasets.apps,… -o json` (kubectl mixes
// the kinds in one list), sorted into buckets by each item's `kind`. The
// tables of those kinds, the rail's counts and the graphs all read it, so
// one call every few seconds keeps them all live.

import { isString, object } from "./guard.ts";
import type { Where } from "./kubectl.ts";
import { across, scope } from "./kubectl.ts";
import type { ConfigMap, CronJob, DaemonSet, Deployment, Ingress, Job, Pvc, ReplicaSet, Service, StatefulSet } from "./objects.ts";
import { isConfigMap, isCronJob, isDaemonSet, isDeployment, isIngress, isJob, isPvc, isReplicaSet, isService, isStatefulSet } from "./objects.ts";
import { maybe } from "./guards.ts";

/** The kinds in a snapshot. */
export interface Snapshot {
  readonly deployments: readonly Deployment[];
  readonly replicasets: readonly ReplicaSet[];
  readonly statefulsets: readonly StatefulSet[];
  readonly daemonsets: readonly DaemonSet[];
  readonly jobs: readonly Job[];
  readonly cronjobs: readonly CronJob[];
  readonly services: readonly Service[];
  readonly ingresses: readonly Ingress[];
  readonly configmaps: readonly ConfigMap[];
  readonly pvcs: readonly Pvc[];
}

export const EMPTY: Snapshot = { deployments: [], replicasets: [], statefulsets: [], daemonsets: [], jobs: [], cronjobs: [], services: [], ingresses: [], configmaps: [], pvcs: [] };

const RESOURCES = "deployments.apps,replicasets.apps,statefulsets.apps,daemonsets.apps,jobs.batch,cronjobs.batch,services,ingresses.networking.k8s.io,configmaps,persistentvolumeclaims";

export function snapshotArgs(where: Where): string[] {
  return [...scope(where, "deployments"), "get", RESOURCES, "-o", "json", "--request-timeout=10s", ...across(where, "deployments")];
}

const isKinded = object({}, { kind: maybe(isString) });

/** Puts each item proven by its kind's guard into its bucket. */
export function sortSnapshot(items: readonly unknown[]): Snapshot {
  const deployments: Deployment[] = [], replicasets: ReplicaSet[] = [], statefulsets: StatefulSet[] = [], daemonsets: DaemonSet[] = [], jobs: Job[] = [];
  const cronjobs: CronJob[] = [], services: Service[] = [], ingresses: Ingress[] = [], configmaps: ConfigMap[] = [], pvcs: Pvc[] = [];

  for (const x of items) {
    if (!isKinded(x)) continue;

    const k = x.kind;

    if (k === "Deployment" && isDeployment(x)) deployments.push(x);
    else if (k === "ReplicaSet" && isReplicaSet(x)) replicasets.push(x);
    else if (k === "StatefulSet" && isStatefulSet(x)) statefulsets.push(x);
    else if (k === "DaemonSet" && isDaemonSet(x)) daemonsets.push(x);
    else if (k === "Job" && isJob(x)) jobs.push(x);
    else if (k === "CronJob" && isCronJob(x)) cronjobs.push(x);
    else if (k === "Service" && isService(x)) services.push(x);
    else if (k === "Ingress" && isIngress(x)) ingresses.push(x);
    else if (k === "ConfigMap" && isConfigMap(x)) configmaps.push(x);
    else if (k === "PersistentVolumeClaim" && isPvc(x)) pvcs.push(x);
  }

  return { deployments, replicasets, statefulsets, daemonsets, jobs, cronjobs, services, ingresses, configmaps, pvcs };
}
