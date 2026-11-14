// Each built-in kind's columns and rows: k9s's columns, made graphical where
// a picture reads faster (readiness as blocks, restarts as marks, CPU as a
// line). `COLUMNS[kind]` and the cells `rowOf` builds line up one to one.

import type { Builtin, KindRef } from "./kinds.ts";
import type { CronJob, DaemonSet, Deployment, Ingress, Job, KEvent, KNode, Namespace, Pod, Pvc, ReplicaSet, Service, StatefulSet, AnyObject, ConfigMap } from "./objects.ts";
import type { Cell, Row, Tone, PortFact } from "./rows.ts";
import { keyOf, labelsOf, podFacts, podState, replicaBlocks, restartsOf, text } from "./rows.ts";
import { instant, span } from "./time.ts";
import { bytes, millicores } from "./quantity.ts";

/** A column: its title, its width (null: takes the rest), right-aligned or not, and whether it's among the
 *  first to leave a narrow table (`low`: a detail the row reads without). */
export interface Column {
  readonly title: string;
  readonly w: number | null;
  readonly right?: boolean;
  readonly low?: boolean;
}

const c = (title: string, w: number | null, right = false): Column => ({ title, w, right });
const low = (title: string, w: number, right = false): Column => ({ title, w, right, low: true });
const NAME = c("name", null);
const AGE = c("age", 44, true);

/** CPU and memory: a line over the readings so far and the value now. */
const CPU = c("cpu", 92);
const MEM = c("mem", 92);

export const COLUMNS = {
  pods: [NAME, c("ready", 64), c("restarts", 64), c("status", 128), CPU, MEM, low("node", 80), AGE],
  deployments: [NAME, c("ready", 92), low("up-to-date", 70, true), low("available", 70, true), CPU, MEM, AGE],
  replicasets: [NAME, c("ready", 92), low("revision", 64, true), AGE],
  statefulsets: [NAME, c("ready", 92), low("service", 120), CPU, MEM, AGE],
  daemonsets: [NAME, c("ready", 92), low("desired", 60, true), low("up-to-date", 70, true), AGE],
  jobs: [NAME, c("completions", 92), c("status", 90), c("duration", 70, true), AGE],
  cronjobs: [NAME, c("schedule", 110), c("active", 50, true), c("last run", 70, true), AGE],
  services: [NAME, c("type", 92), c("cluster-ip", 110), c("ports", 150), AGE],
  ingresses: [NAME, c("class", 80), c("hosts", 180), c("paths", 60, true), AGE],
  configmaps: [NAME, c("keys", 260), AGE],
  secrets: [NAME, c("type", 170), c("keys", 200), AGE],
  pvcs: [NAME, c("status", 70), c("capacity", 70, true), c("class", 100), AGE],
  events: [c("type", 64), c("reason", 120), c("object", 200), c("message", null), c("count", 44, true), AGE],
  nodes: [NAME, c("status", 120), low("roles", 100), CPU, MEM, low("version", 120), AGE],
  namespaces: [NAME, c("status", 70), AGE],
  applications: [NAME, c("sync", 90), c("health", 100), c("revision", 80), c("destination", 160), AGE],
} as const satisfies { readonly [K in Builtin]: readonly Column[] };

/** A custom kind's columns: what every object has. */
export const CUSTOM_COLUMNS: readonly Column[] = [NAME, c("status", 140), AGE];

const age = (at: number | null): Cell => ({ t: "age", at });

/** Pods owned (through a replica set or directly) by an object: their names, for summing metrics. */
export type OwnedPods = (uid: string | null) => readonly string[];

/** What every row needs from the object's metadata. */
function base(kind: KindRef, o: { readonly metadata: Pod["metadata"] }) {
  return { key: keyOf(o.metadata, kind), uid: o.metadata.uid ?? null, ref: { kind, name: o.metadata.name, namespace: o.metadata.namespace ?? null }, created: instant(o.metadata.creationTimestamp), labels: labelsOf(o.metadata) };
}

export function podRow(p: Pod, now: number): Row {
  const st = podState(p);
  const facts = podFacts(p);
  const r = restartsOf(p.status?.containerStatuses ?? [], now);
  const blocks = facts.containers.map((x): Tone => (x.ready ? "ok" : x.tone === "bad" ? "bad" : x.tone === "done" ? "done" : "wk"));

  return {
    ...base("pods", p), tone: st.tone, status: st.word, pod: facts,
    ports: facts.containers.flatMap((x) => x.ports), images: facts.containers.map((x) => x.image),
    cells: [text(p.metadata.name), { t: "ready", blocks, text: `${blocks.filter((b) => b === "ok").length}/${blocks.length}` }, { t: "marks", count: r.count, recent: r.recent },
      text(st.word, st.tone), { t: "metric", what: "cpu", pods: [p.metadata.name] }, { t: "metric", what: "mem", pods: [p.metadata.name] }, text(facts.node ?? "", null, true), age(instant(p.metadata.creationTimestamp))],
  };
}

/** A workload's tone from ready against wanted (scaled to nothing: off; on its way: wk). */
function workloadTone(ready: number, want: number, updating: boolean): Tone {
  if (want === 0) return "off";

  if (ready >= want && !updating) return "ok";

  return ready === 0 ? "bad" : "wk";
}

export function deploymentRow(d: Deployment, owned: OwnedPods): Row {
  const want = d.spec?.replicas ?? 1;
  const ready = d.status?.readyReplicas ?? 0;
  const updated = d.status?.updatedReplicas ?? 0;
  const tone = workloadTone(ready, want, updated < want || (d.status?.replicas ?? 0) > want);
  const pods = owned(d.metadata.uid ?? null);

  return {
    ...base("deployments", d), tone, status: tone === "off" ? "scaled to 0" : `${ready}/${want}`,
    cells: [text(d.metadata.name), { t: "ready", blocks: replicaBlocks(ready, want, tone === "wk" ? "wk" : "bad"), text: `${ready}/${want}` },
      text(String(updated)), text(String(d.status?.availableReplicas ?? 0)), { t: "metric", what: "cpu", pods }, { t: "metric", what: "mem", pods }, age(instant(d.metadata.creationTimestamp))],
  };
}

export function replicaSetRow(r: ReplicaSet): Row {
  const want = r.spec?.replicas ?? 0;
  const ready = r.status?.readyReplicas ?? 0;
  const tone = workloadTone(ready, want, false);
  const rev = r.metadata.annotations?.["deployment.kubernetes.io/revision"] ?? "";

  return {
    ...base("replicasets", r), tone, status: `${ready}/${want}`,
    cells: [text(r.metadata.name), { t: "ready", blocks: replicaBlocks(ready, want), text: `${ready}/${want}` }, text(rev), age(instant(r.metadata.creationTimestamp))],
  };
}

export function statefulSetRow(s: StatefulSet, owned: OwnedPods): Row {
  const want = s.spec?.replicas ?? 1;
  const ready = s.status?.readyReplicas ?? 0;
  const tone = workloadTone(ready, want, Boolean(s.status?.updateRevision && s.status.updateRevision !== s.status.currentRevision));
  const pods = owned(s.metadata.uid ?? null);

  return {
    ...base("statefulsets", s), tone, status: `${ready}/${want}`,
    cells: [text(s.metadata.name), { t: "ready", blocks: replicaBlocks(ready, want, tone === "wk" ? "wk" : "bad"), text: `${ready}/${want}` }, text(s.spec?.serviceName ?? "", null, true),
      { t: "metric", what: "cpu", pods }, { t: "metric", what: "mem", pods }, age(instant(s.metadata.creationTimestamp))],
  };
}

export function daemonSetRow(d: DaemonSet): Row {
  const want = d.status?.desiredNumberScheduled ?? 0;
  const ready = d.status?.numberReady ?? 0;
  const tone = workloadTone(ready, want, (d.status?.updatedNumberScheduled ?? want) < want);

  return {
    ...base("daemonsets", d), tone, status: `${ready}/${want}`,
    cells: [text(d.metadata.name), { t: "ready", blocks: replicaBlocks(ready, want), text: `${ready}/${want}` }, text(String(want)), text(String(d.status?.updatedNumberScheduled ?? 0)), age(instant(d.metadata.creationTimestamp))],
  };
}

export function jobRow(j: Job, now: number): Row {
  const want = j.spec?.completions ?? 1;
  const done = j.status?.succeeded ?? 0;
  const failed = j.status?.failed ?? 0;
  const active = j.status?.active ?? 0;
  const failedCond = (j.status?.conditions ?? []).some((x) => x.type === "Failed" && x.status === "True");
  const tone: Tone = done >= want ? "done" : failedCond || (failed > 0 && active === 0) ? "bad" : active > 0 ? "wk" : "off";
  const word = tone === "done" ? "Complete" : tone === "bad" ? "Failed" : tone === "wk" ? "Running" : "Pending";
  const start = instant(j.status?.startTime);
  const end = instant(j.status?.completionTime);
  const blocks = Array.from({ length: Math.min(want, 12) }, (_, i): Tone => (i < done ? "done" : i < done + active ? "wk" : tone === "bad" ? "bad" : "off"));

  return {
    ...base("jobs", j), tone, status: word,
    cells: [text(j.metadata.name), { t: "ready", blocks, text: `${done}/${want}` }, text(word, tone), text(start === null ? "" : span((end ?? now) - start)), age(instant(j.metadata.creationTimestamp))],
  };
}

export function cronJobRow(cj: CronJob, now: number): Row {
  const active = cj.status?.active?.length ?? 0;
  const last = instant(cj.status?.lastScheduleTime);
  const suspended = cj.spec?.suspend === true;

  return {
    ...base("cronjobs", cj), tone: suspended ? "off" : active ? "wk" : "ok", status: suspended ? "suspended" : active ? "running" : "scheduled",
    cells: [text(cj.metadata.name), text(cj.spec?.schedule ?? "", null, suspended), text(String(active), active ? "wk" : null), text(last === null ? "never" : span(now - last)), age(instant(cj.metadata.creationTimestamp))],
  };
}

export function serviceRow(s: Service): Row {
  const ports: PortFact[] = (s.spec?.ports ?? []).map((p) => ({ port: p.port, name: p.name ?? null, target: p.targetPort ?? null }));

  return {
    ...base("services", s), tone: "ok", status: s.spec?.type ?? "ClusterIP", ports,
    cells: [text(s.metadata.name), text(s.spec?.type ?? "ClusterIP", null, true), text(s.spec?.clusterIP ?? ""), text(ports.map((p) => `${p.port}${p.name ? `/${p.name}` : ""}`).join(" ")), age(instant(s.metadata.creationTimestamp))],
  };
}

export function ingressRow(i: Ingress): Row {
  const rules = i.spec?.rules ?? [];
  const hosts = rules.map((r) => r.host ?? "*");
  const paths = rules.reduce((n, r) => n + (r.http?.paths?.length ?? 0), 0);

  return {
    ...base("ingresses", i), tone: "ok", status: hosts.join(" "),
    cells: [text(i.metadata.name), text(i.spec?.ingressClassName ?? "", null, true), text(hosts.join(" ")), text(String(paths)), age(instant(i.metadata.creationTimestamp))],
  };
}

export function configMapRow(m: ConfigMap): Row {
  const keys = [...Object.keys(m.data ?? {}), ...Object.keys(m.binaryData ?? {})];

  return { ...base("configmaps", m), tone: "ok", status: `${keys.length} keys`, cells: [text(m.metadata.name), text(keys.join(" "), null, true), age(instant(m.metadata.creationTimestamp))] };
}

export function pvcRow(p: Pvc): Row {
  const phase = p.status?.phase ?? "Pending";
  const tone: Tone = phase === "Bound" ? "ok" : phase === "Lost" ? "bad" : "wk";

  return {
    ...base("pvcs", p), tone, status: phase,
    cells: [text(p.metadata.name), text(phase, tone), text(p.status?.capacity?.["storage"] ?? p.spec?.resources?.requests?.["storage"] ?? ""), text(p.spec?.storageClassName ?? "", null, true), age(instant(p.metadata.creationTimestamp))],
  };
}

export function eventRow(e: KEvent): Row {
  const warn = e.type === "Warning";
  const at = instant(e.lastTimestamp ?? e.eventTime ?? e.metadata.creationTimestamp);
  const kind = e.involvedObject.kind.toLowerCase();

  return {
    ...base("events", e), tone: warn ? "wk" : "off", status: e.reason ?? "",
    cells: [text(e.type ?? "", warn ? "wk" : null, !warn), text(e.reason ?? "", warn ? "bad" : null), text(`${kind}/${e.involvedObject.name}`), text(e.message ?? "", null, true), text(String(e.count ?? 1)), age(at)],
  };
}

/** A node's CPU and memory requests summed from its pods, against allocatable. */
export interface NodeLoad {
  readonly cpu: number;
  readonly mem: number;
}

export function nodeRow(n: KNode): Row {
  const ready = (n.status?.conditions ?? []).find((x) => x.type === "Ready");
  const pressure = (n.status?.conditions ?? []).filter((x) => x.type !== "Ready" && x.status === "True").map((x) => x.type);
  const cordoned = n.spec?.unschedulable === true;
  const ok = ready?.status === "True";
  const word = [ok ? "Ready" : "NotReady", ...(cordoned ? ["SchedulingDisabled"] : []), ...pressure].join(",");
  const tone: Tone = !ok ? "bad" : pressure.length ? "wk" : cordoned ? "off" : "ok";
  const roles = [...labelsOf(n.metadata).keys()].flatMap((k) => (k.startsWith("node-role.kubernetes.io/") ? [k.slice(24)] : []));

  return {
    ...base("nodes", n), tone, status: word,
    cells: [text(n.metadata.name), text(word, tone), text(roles.join(",") || "<none>", null, true), { t: "metric", what: "cpu", pods: [`node:${n.metadata.name}`] }, { t: "metric", what: "mem", pods: [`node:${n.metadata.name}`] },
      text(n.status?.nodeInfo?.kubeletVersion ?? "", null, true), age(instant(n.metadata.creationTimestamp))],
  };
}

/** A node's allocatable CPU (millicores) and memory (bytes), for its bars. */
export function allocatable(n: KNode): NodeLoad {
  return { cpu: millicores(n.status?.allocatable?.["cpu"]) ?? 0, mem: bytes(n.status?.allocatable?.["memory"]) ?? 0 };
}

export function namespaceRow(n: Namespace): Row {
  const phase = n.status?.phase ?? "Active";

  return { ...base("namespaces", n), tone: phase === "Active" ? "ok" : "wk", status: phase, cells: [text(n.metadata.name), text(phase), age(instant(n.metadata.creationTimestamp))] };
}

/** A custom kind's object: Ready condition or phase, else just there. */
export function customRow(kind: KindRef, o: AnyObject): Row {
  const ready = (o.status?.conditions ?? []).find((x) => x.type === "Ready");
  const word = ready ? (ready.status === "True" ? "Ready" : ready.reason ?? "NotReady") : o.status?.phase ?? "";
  const tone: Tone = ready ? (ready.status === "True" ? "ok" : "wk") : "off";

  return { ...base(kind, o), tone, status: word, cells: [text(o.metadata.name), text(word, tone), age(instant(o.metadata.creationTimestamp))] };
}
