// Writes the made-up cluster "nightjar" as kubectl would print it (`-o json`
// lists), under test/fixtures/nightjar/<context>/<namespace|_cluster>/<resource>.json,
// plus metrics (top-*.txt), contexts and api-resources. Run `bun test/fixtures/build.ts`
// after changing it; the JSON is committed (the fake kubectl reads it).
//
// Times are written against BASE; the fake shifts every timestamp by (now - BASE)
// when it answers, so ages stay as written here.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const BASE = Date.parse("2026-11-13T12:00:00Z");
const ROOT = join(import.meta.dir, "nightjar");

const ago = (s: number) => new Date(BASE - s * 1000).toISOString().replace(/\.\d+Z$/, "Z");
const M = 60, H = 3600, D = 86400;
let uidN = 0;
const uid = () => `00000000-0000-4000-8000-${String(++uidN).padStart(12, "0")}`;
let rv = 1000;

type Obj = Record<string, any>;
type Owner = { kind: string; name: string; uid: string };

function meta(name: string, ns: string | null, age: number, extra: Obj = {}): Obj {
  return { name, ...(ns ? { namespace: ns } : {}), uid: uid(), resourceVersion: String(++rv), creationTimestamp: ago(age), ...extra };
}

const own = (o: Obj): Owner[] => [{ apiVersion: "apps/v1", kind: o.kind, name: o.metadata.name, uid: o.metadata.uid, controller: true, blockOwnerDeletion: true } as any];

const list = (kind: string, items: Obj[]) => ({ apiVersion: "v1", kind: "List", items, metadata: { resourceVersion: "" } });

// ---- the cluster's contents, per context and namespace

interface Ns { pods: Obj[]; deployments: Obj[]; replicasets: Obj[]; statefulsets: Obj[]; daemonsets: Obj[]; jobs: Obj[]; cronjobs: Obj[]; services: Obj[]; ingresses: Obj[]; configmaps: Obj[]; secrets: Obj[]; persistentvolumeclaims: Obj[]; events: Obj[]; "applications.argoproj.io": Obj[]; "certificates.cert-manager.io": Obj[]; top: string[] }

const nss = new Map<string, Map<string, Ns>>();

function ns(ctx: string, name: string): Ns {
  let c = nss.get(ctx);
  if (!c) nss.set(ctx, (c = new Map()));
  let n = c.get(name);
  if (!n) c.set(name, (n = { pods: [], deployments: [], replicasets: [], statefulsets: [], daemonsets: [], jobs: [], cronjobs: [], services: [], ingresses: [], configmaps: [], secrets: [], persistentvolumeclaims: [], events: [], "applications.argoproj.io": [], "certificates.cert-manager.io": [], top: [] }));
  return n;
}

type PodState = "run" | "crash" | "pull" | "pending" | "done" | "failed" | "start";

/** What a database's container runs with (its env, a mounted secret): the credentials the mod finds. */
interface Runs { env?: Obj[]; envFrom?: Obj[]; volumeMounts?: Obj[]; volumes?: Obj[] }

interface PodSpec extends Runs { image: string; ports?: { containerPort: number; name?: string }[]; state?: PodState; restarts?: number; lastRestart?: number; node?: string; age?: number; cpu?: number; mem?: number; containers?: string[]; labels?: Obj }

/** A container's env and mounts, and the pod spec's volumes, from Runs (left out when empty). */
const runsOf = (r: Runs) => ({ ...(r.env ? { env: r.env } : {}), ...(r.envFrom ? { envFrom: r.envFrom } : {}), ...(r.volumeMounts ? { volumeMounts: r.volumeMounts } : {}) });

function pod(ctx: string, n: string, name: string, owner: Obj | null, p: PodSpec): Obj {
  const state = p.state ?? "run";
  const age = p.age ?? 3 * D;
  const names = p.containers ?? [name.split("-").slice(0, 2).join("-")];
  const statuses = names.map((c, i) => {
    const main = i === 0;
    const s = main ? state : "run";
    const st = s === "run" ? { running: { startedAt: ago(Math.min(age, p.lastRestart ?? age)) } }
      : s === "crash" ? { waiting: { reason: "CrashLoopBackOff", message: `back-off 5m0s restarting failed container=${c}` } }
      : s === "pull" ? { waiting: { reason: "ImagePullBackOff", message: `Back-off pulling image "${p.image}"` } }
      : s === "start" ? { waiting: { reason: "ContainerCreating" } }
      : s === "pending" ? { waiting: { reason: "Pending" } }
      : s === "done" ? { terminated: { reason: "Completed", exitCode: 0, finishedAt: ago(age - 60) } }
      : { terminated: { reason: "Error", exitCode: 1, finishedAt: ago(age - 90) } };
    const restarts = main ? p.restarts ?? 0 : 0;
    return {
      name: c, image: i === 0 ? p.image : "nightjar/sidecar:1.2", ready: s === "run", restartCount: restarts, started: s === "run",
      state: st,
      lastState: restarts ? { terminated: { reason: s === "crash" ? "Error" : "OOMKilled", exitCode: s === "crash" ? 1 : 137, finishedAt: ago(p.lastRestart ?? 600) } } : {},
    };
  });
  const phase = state === "done" ? "Succeeded" : state === "failed" ? "Failed" : state === "pending" ? "Pending" : "Running";
  const o = {
    apiVersion: "v1", kind: "Pod",
    metadata: meta(name, n, age, { labels: p.labels ?? { app: name.replace(/-[a-z0-9]{4,5}(-[a-z0-9]{4,5})?$/, "").replace(/-\d+$/, "") }, ...(owner ? { ownerReferences: own(owner) } : {}) }),
    spec: { nodeName: p.node ?? "lumen-a", containers: names.map((c, i) => ({ name: c, image: i === 0 ? p.image : "nightjar/sidecar:1.2", ...(i === 0 && p.ports ? { ports: p.ports.map((x) => ({ ...x, protocol: "TCP" })) } : {}), ...(i === 0 ? runsOf(p) : {}), resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "512Mi" } } })), ...(p.volumes ? { volumes: p.volumes } : {}) },
    status: { phase, podIP: `10.42.${uidN % 3}.${(uidN * 7) % 250}`, startTime: ago(age), containerStatuses: statuses, conditions: [{ type: "Ready", status: state === "run" ? "True" : "False" }] },
  };
  ns(ctx, n).pods.push(o);
  if (p.cpu !== undefined && state === "run") ns(ctx, n).top.push(`${n}\t${name}\t${p.cpu}m\t${p.mem ?? 64}Mi`);
  return o;
}

const hash = (s: string, len: number) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h.toString(36).padStart(len, "x").slice(-len);
};

interface DeploySpec { image: string; replicas: number; ports?: { containerPort: number; name?: string }[]; rev?: number; age?: number; pods?: Partial<PodSpec>[]; old?: number; rolling?: boolean; cpu?: number; mem?: number; containers?: string[] }

function deployment(ctx: string, n: string, name: string, d: DeploySpec): Obj {
  const rev = d.rev ?? 1;
  const states = d.pods ?? Array.from({ length: d.replicas }, () => ({}));
  const ready = states.filter((s) => (s.state ?? "run") === "run").length;
  const dep = {
    apiVersion: "apps/v1", kind: "Deployment",
    metadata: meta(name, n, d.age ?? 18 * D, { generation: rev, labels: { app: name }, annotations: { "deployment.kubernetes.io/revision": String(rev) } }),
    spec: { replicas: d.replicas, selector: { matchLabels: { app: name } }, strategy: { type: "RollingUpdate" }, template: { metadata: { labels: { app: name } }, spec: { containers: [{ name, image: d.image }] } } },
    status: { observedGeneration: rev, replicas: states.length, updatedReplicas: states.length, readyReplicas: ready, availableReplicas: ready, ...(ready < d.replicas ? { unavailableReplicas: d.replicas - ready } : {}),
      conditions: [{ type: "Available", status: ready >= d.replicas ? "True" : "False", reason: ready >= d.replicas ? "MinimumReplicasAvailable" : "MinimumReplicasUnavailable" }, { type: "Progressing", status: "True", reason: d.rolling ? "ReplicaSetUpdated" : "NewReplicaSetAvailable" }] },
  };
  ns(ctx, n).deployments.push(dep);
  const rsName = `${name}-${hash(name + rev, 4)}`;
  const rs = {
    apiVersion: "apps/v1", kind: "ReplicaSet",
    metadata: meta(rsName, n, d.rolling ? 40 * M : d.age ?? 18 * D, { labels: { app: name }, annotations: { "deployment.kubernetes.io/revision": String(rev) }, ownerReferences: own(dep) }),
    spec: { replicas: d.replicas, selector: { matchLabels: { app: name } } },
    status: { replicas: states.length, readyReplicas: ready, availableReplicas: ready },
  };
  ns(ctx, n).replicasets.push(rs);
  for (let i = 0; i < (d.old ?? 0); i++) {
    const r = rev - 1 - i;
    ns(ctx, n).replicasets.push({ apiVersion: "apps/v1", kind: "ReplicaSet", metadata: meta(`${name}-${hash(name + r, 4)}`, n, (d.age ?? 18 * D) - i * D, { labels: { app: name }, annotations: { "deployment.kubernetes.io/revision": String(r) }, ownerReferences: own(dep) }), spec: { replicas: 0 }, status: { replicas: 0 } });
  }
  states.forEach((s, i) => pod(ctx, n, `${rsName}-${hash(name + rev + i, 5)}`, rs, { image: d.image, ...(d.ports ? { ports: d.ports } : {}), node: ["lumen-a", "lumen-b", "lumen-c"][i % 3], cpu: (d.cpu ?? 20) + i * 7, mem: (d.mem ?? 90) + i * 11, age: d.rolling ? 30 * M : 3 * D, ...(d.containers ? { containers: d.containers } : {}), ...s }));
  return dep;
}

function statefulset(ctx: string, n: string, name: string, image: string, replicas: number, port: { containerPort: number; name?: string }, cpu = 40, mem = 300, runs: Runs & { labels?: Obj } = {}): Obj {
  const labels = runs.labels ?? { app: name };
  const sts = {
    apiVersion: "apps/v1", kind: "StatefulSet",
    metadata: meta(name, n, 40 * D, { labels }),
    spec: { replicas, serviceName: name, selector: { matchLabels: labels }, template: { metadata: { labels }, spec: { containers: [{ name, image, ...runsOf(runs) }], ...(runs.volumes ? { volumes: runs.volumes } : {}) } } },
    status: { replicas, readyReplicas: replicas, currentReplicas: replicas, currentRevision: `${name}-${hash(name, 10)}` },
  };
  ns(ctx, n).statefulsets.push(sts);
  for (let i = 0; i < replicas; i++) {
    pod(ctx, n, `${name}-${i}`, sts, { image, ports: [port], cpu, mem, age: 12 * D, node: "lumen-c", labels, ...runs });
    pvc(ctx, n, `data-${name}-${i}`, "10Gi");
  }
  return sts;
}

function pvc(ctx: string, n: string, name: string, size: string) {
  ns(ctx, n).persistentvolumeclaims.push({ apiVersion: "v1", kind: "PersistentVolumeClaim", metadata: meta(name, n, 40 * D), spec: { accessModes: ["ReadWriteOnce"], storageClassName: "local-path", resources: { requests: { storage: size } }, volumeName: `pvc-${hash(name, 8)}` }, status: { phase: "Bound", capacity: { storage: size } } });
}

function daemonset(ctx: string, n: string, name: string, image: string, nodes: string[]) {
  const ds = { apiVersion: "apps/v1", kind: "DaemonSet", metadata: meta(name, n, 60 * D, { labels: { "k8s-app": name } }), spec: { selector: { matchLabels: { "k8s-app": name } } }, status: { desiredNumberScheduled: nodes.length, currentNumberScheduled: nodes.length, numberReady: nodes.length, numberAvailable: nodes.length, updatedNumberScheduled: nodes.length } };
  ns(ctx, n).daemonsets.push(ds);
  nodes.forEach((node) => pod(ctx, n, `${name}-${hash(name + node, 5)}`, ds, { image, node, cpu: 3, mem: 20, age: 60 * D, labels: { "k8s-app": name } }));
}

function service(ctx: string, n: string, name: string, ports: { port: number; targetPort: number | string; name?: string }[], selector: Obj, type = "ClusterIP") {
  ns(ctx, n).services.push({ apiVersion: "v1", kind: "Service", metadata: meta(name, n, 18 * D, { labels: { app: name } }), spec: { type, clusterIP: `10.43.${uidN % 9}.${(uidN * 13) % 250}`, ports: ports.map((p) => ({ protocol: "TCP", ...p })), selector } });
}

function ingress(ctx: string, n: string, name: string, host: string, paths: [string, string, number][]) {
  ns(ctx, n).ingresses.push({ apiVersion: "networking.k8s.io/v1", kind: "Ingress", metadata: meta(name, n, 18 * D), spec: { ingressClassName: "traefik", tls: [{ hosts: [host], secretName: `${name}-tls` }], rules: [{ host, http: { paths: paths.map(([path, svc, port]) => ({ path, pathType: "Prefix", backend: { service: { name: svc, port: { number: port } } } })) } }] }, status: { loadBalancer: { ingress: [{ ip: "192.0.2.10" }] } } });
}

function configmap(ctx: string, n: string, name: string, data: Obj) {
  ns(ctx, n).configmaps.push({ apiVersion: "v1", kind: "ConfigMap", metadata: meta(name, n, 18 * D), data });
}

// Secrets hold made-up values only; the mod never lists them (a go-template prints key names).
function secret(ctx: string, n: string, name: string, type: string, data: Obj) {
  ns(ctx, n).secrets.push({ apiVersion: "v1", kind: "Secret", type, metadata: meta(name, n, 18 * D), data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Buffer.from(String(v)).toString("base64")])) });
}

function job(ctx: string, n: string, name: string, state: "done" | "failed" | "run", owner: Obj | null = null, age = 2 * D) {
  const j = { apiVersion: "batch/v1", kind: "Job", metadata: meta(name, n, age, { labels: { "job-name": name }, ...(owner ? { ownerReferences: [{ apiVersion: "batch/v1", kind: "CronJob", name: owner.metadata.name, uid: owner.metadata.uid, controller: true }] } : {}) }),
    spec: { completions: 1, backoffLimit: 3, template: { spec: { containers: [{ name, image: "nightjar/tools:3" }] } } },
    status: { startTime: ago(age), ...(state === "done" ? { succeeded: 1, completionTime: ago(age - 95) } : state === "failed" ? { failed: 4 } : { active: 1 }) } };
  ns(ctx, n).jobs.push(j);
  pod(ctx, n, `${name}-${hash(name, 5)}`, j, { image: "nightjar/tools:3", state: state === "run" ? "run" : state, age, cpu: state === "run" ? 180 : undefined as any, mem: 200, labels: { "job-name": name } });
  return j;
}

function cronjob(ctx: string, n: string, name: string, schedule: string, run: boolean) {
  const cj = { apiVersion: "batch/v1", kind: "CronJob", metadata: meta(name, n, 30 * D), spec: { schedule, suspend: false, jobTemplate: { spec: {} } }, status: { lastScheduleTime: ago(run ? 4 * M : 21 * H), ...(run ? { active: [{ kind: "Job", name: `${name}-29001`, namespace: n }] } : {}) } };
  ns(ctx, n).cronjobs.push(cj);
  job(ctx, n, `${name}-28999`, "done", cj, 2 * D + 21 * H);
  job(ctx, n, `${name}-29000`, "done", cj, D + 21 * H);
  if (run) job(ctx, n, `${name}-29001`, "run", cj, 4 * M);
  return cj;
}

function event(ctx: string, n: string, obj: Obj, type: "Normal" | "Warning", reason: string, message: string, age: number, count = 1) {
  ns(ctx, n).events.push({ apiVersion: "v1", kind: "Event", metadata: meta(`${obj.metadata.name}.${hash(reason + age, 16)}`, n, age), involvedObject: { kind: obj.kind, name: obj.metadata.name, namespace: n, uid: obj.metadata.uid }, reason, message, type, count, firstTimestamp: ago(age + (count - 1) * 30), lastTimestamp: ago(age), source: { component: "kubelet" } });
}

interface AppSpec { name: string; ns: string; dest: string; server?: string; path: string; sync: string; health: string; rev: string; resources: [string, string, string, string, string?][]; history: [string, number][]; auto?: boolean; op?: Obj }

function application(ctx: string, a: AppSpec) {
  ns(ctx, "argocd")["applications.argoproj.io"].push({
    apiVersion: "argoproj.io/v1alpha1", kind: "Application",
    metadata: meta(a.name, "argocd", 30 * D, { finalizers: ["resources-finalizer.argocd.argoproj.io"] }),
    spec: { project: "default", source: { repoURL: "https://git.nightjar.test/nightjar/deploy.git", path: a.path, targetRevision: "main" }, destination: { server: a.server ?? "https://kubernetes.default.svc", namespace: a.dest }, ...(a.auto ? { syncPolicy: { automated: { prune: true, selfHeal: true } } } : { syncPolicy: {} }) },
    status: {
      sync: { status: a.sync, revision: a.rev, comparedTo: { source: { repoURL: "https://git.nightjar.test/nightjar/deploy.git", path: a.path, targetRevision: "main" } } },
      health: { status: a.health },
      reconciledAt: ago(40),
      resources: a.resources.map(([kind, name, sync, health, group]) => ({ ...(group ? { group } : {}), version: "v1", kind, namespace: a.dest, name, status: sync, ...(health ? { health: { status: health } } : {}) })),
      history: a.history.map(([rev, age], i) => ({ id: i, revision: rev, deployedAt: ago(age), deployStartedAt: ago(age + 30), source: { repoURL: "https://git.nightjar.test/nightjar/deploy.git", path: a.path, targetRevision: "main" } })),
      ...(a.op ? { operationState: a.op } : { operationState: { phase: "Succeeded", message: "successfully synced (all tasks run)", startedAt: ago(a.history.at(-1)?.[1] ?? H), finishedAt: ago((a.history.at(-1)?.[1] ?? H) - 20), operation: { sync: { revision: a.rev } } } }),
      sourceType: "Kustomize", summary: {},
    },
  });
}

// ---- nightjar-dev

const DEV = "nightjar-dev";

const api = deployment(DEV, "lantern", "lantern-api", { image: "nightjar/lantern-api:7.0.3", replicas: 4, rev: 7, old: 2, rolling: true, ports: [{ containerPort: 8080, name: "http" }], cpu: 190, mem: 300,
  pods: [{}, {}, {}, { state: "crash", restarts: 5, lastRestart: 2 * M }] });
deployment(DEV, "lantern", "lantern-web", { image: "nightjar/lantern-web:4.1.0", replicas: 2, rev: 4, old: 1, ports: [{ containerPort: 8080, name: "http" }], cpu: 12, mem: 70 });
deployment(DEV, "lantern", "lantern-worker", { image: "nightjar/lantern-worker:7.0.3", replicas: 1, rev: 9, containers: ["worker", "log-shipper"], cpu: 240, mem: 410, pods: [{ restarts: 1, lastRestart: 5 * H }] });
const mailer = deployment(DEV, "lantern", "lantern-mailer", { image: "nightjar/lantern-mailer:2.3.0-rc1", replicas: 1, rev: 3, age: 2 * H, pods: [{ state: "pull", age: 2 * H }] });
deployment(DEV, "lantern", "lantern-cron-ui", { image: "nightjar/cron-ui:1.0.4", replicas: 1, rev: 2, age: 40 * D, cpu: 3, mem: 30 });
deployment(DEV, "lantern", "lantern-legacy", { image: "nightjar/lantern-legacy:0.9", replicas: 0, rev: 12, age: 90 * D });
// The official postgres image's variables, from a secret: one clear candidate for the Databases window.
const secretRef = (name: string, key: string) => ({ valueFrom: { secretKeyRef: { name, key } } });
statefulset(DEV, "lantern", "lantern-db", "postgres:16.4", 1, { containerPort: 5432, name: "postgres" }, 35, 380, {
  env: [{ name: "POSTGRES_USER", ...secretRef("lantern-db-auth", "username") }, { name: "POSTGRES_PASSWORD", ...secretRef("lantern-db-auth", "password") }, { name: "POSTGRES_DB", value: "lantern" }, { name: "PGDATA", value: "/var/lib/postgresql/data/pgdata" }],
});
service(DEV, "lantern", "lantern-api", [{ name: "http", port: 8080, targetPort: "http" }], { app: "lantern-api" });
service(DEV, "lantern", "lantern-web", [{ name: "http", port: 80, targetPort: 8080 }], { app: "lantern-web" });
service(DEV, "lantern", "lantern-db", [{ name: "postgres", port: 5432, targetPort: 5432 }], { app: "lantern-db" });
ingress(DEV, "lantern", "lantern", "lantern.nightjar.test", [["/api", "lantern-api", 8080], ["/", "lantern-web", 80]]);
configmap(DEV, "lantern", "lantern-flags", { LOG_LEVEL: "info", NEW_CHECKOUT: "true", DARK_SKY: "on", REGION: "eu-north" });
configmap(DEV, "lantern", "lantern-config", { "app.yaml": "listen: :8080\ndatabase: postgres://lantern-db:5432/lantern\n" });
configmap(DEV, "lantern", "kube-root-ca.crt", { "ca.crt": "-----BEGIN CERTIFICATE-----\nMIIB (made up)\n-----END CERTIFICATE-----\n" });
secret(DEV, "lantern", "lantern-db-auth", "Opaque", { username: "lantern", password: "moth-lantern-42" });
secret(DEV, "lantern", "lantern-tls", "kubernetes.io/tls", { "tls.crt": "made-up-certificate", "tls.key": "made-up-key" });
secret(DEV, "lantern", "mailer-smtp", "Opaque", { host: "smtp.nightjar.test", user: "mailer", token: "glow-7731" });
cronjob(DEV, "lantern", "nightly-sweep", "0 3 * * *", true);
job(DEV, "lantern", "migrate-7", "done", null, 40 * M);
const crash = ns(DEV, "lantern").pods.find((p) => p.status.containerStatuses[0].state.waiting?.reason === "CrashLoopBackOff");
if (crash) {
  event(DEV, "lantern", crash, "Warning", "BackOff", "Back-off restarting failed container lantern-api in pod " + crash.metadata.name, 2 * M, 23);
  event(DEV, "lantern", crash, "Warning", "Unhealthy", "Readiness probe failed: HTTP probe failed with statuscode: 503", 4 * M, 9);
  event(DEV, "lantern", crash, "Normal", "Pulled", 'Container image "nightjar/lantern-api:7.0.3" already present on machine', 9 * M, 6);
}
event(DEV, "lantern", api, "Normal", "ScalingReplicaSet", "Scaled up replica set lantern-api-" + hash("lantern-api7", 4) + " to 4", 30 * M);
const mpod = ns(DEV, "lantern").pods.find((p) => p.metadata.name.startsWith("lantern-mailer"));
if (mpod) {
  event(DEV, "lantern", mpod, "Warning", "Failed", 'Failed to pull image "nightjar/lantern-mailer:2.3.0-rc1": not found', 3 * M, 31);
  event(DEV, "lantern", mpod, "Normal", "BackOff", 'Back-off pulling image "nightjar/lantern-mailer:2.3.0-rc1"', M, 40);
}
event(DEV, "lantern", mailer, "Normal", "ScalingReplicaSet", "Scaled up replica set to 1", 2 * H);

deployment(DEV, "moth", "moth-queue", { image: "redis:7.4", replicas: 1, rev: 3, ports: [{ containerPort: 6379, name: "redis" }], cpu: 8, mem: 40 });
deployment(DEV, "moth", "moth-ui", { image: "nightjar/moth-ui:2.0.1", replicas: 2, rev: 6, ports: [{ containerPort: 3000, name: "http" }], cpu: 6, mem: 60 });
// Bitnami's chart: the root password from the secret, the app user's as a password file in it (two candidates: a pick).
statefulset(DEV, "moth", "moth-mysql", "bitnami/mysql:8.4", 1, { containerPort: 3306, name: "mysql" }, 28, 420, {
  env: [{ name: "MYSQL_ROOT_PASSWORD", ...secretRef("moth-mysql", "mysql-root-password") }, { name: "MYSQL_USER", value: "moth" }, { name: "MYSQL_PASSWORD_FILE", value: "/opt/bitnami/mysql/secrets/mysql-password" }, { name: "MYSQL_DATABASE", value: "moth" }],
  volumeMounts: [{ name: "mysql-credentials", mountPath: "/opt/bitnami/mysql/secrets/" }],
  volumes: [{ name: "mysql-credentials", secret: { secretName: "moth-mysql", items: [{ key: "mysql-root-password", path: "mysql-root-password" }, { key: "mysql-password", path: "mysql-password" }] } }],
});
secret(DEV, "moth", "moth-mysql", "Opaque", { "mysql-root-password": "dusk-root-77", "mysql-password": "moth-lantern-42" });
service(DEV, "moth", "moth-queue", [{ name: "redis", port: 6379, targetPort: 6379 }], { app: "moth-queue" });
service(DEV, "moth", "moth-ui", [{ name: "http", port: 80, targetPort: 3000 }], { app: "moth-ui" });
service(DEV, "moth", "moth-mysql", [{ name: "mysql", port: 3306, targetPort: 3306 }], { app: "moth-mysql" });
ingress(DEV, "moth", "moth", "moth.nightjar.test", [["/", "moth-ui", 80]]);
configmap(DEV, "moth", "moth-settings", { QUEUE: "redis://moth-queue:6379" });

deployment(DEV, "glowworm", "glowworm-api", { image: "nightjar/glowworm:0.4.2", replicas: 2, rev: 4, ports: [{ containerPort: 8000, name: "http" }], cpu: 50, mem: 160, pods: [{}, { restarts: 2, lastRestart: 30 * M }] });
service(DEV, "glowworm", "glowworm-api", [{ name: "http", port: 8000, targetPort: 8000 }], { app: "glowworm-api" });
job(DEV, "glowworm", "glowworm-backfill", "failed", null, 6 * H);
job(DEV, "glowworm", "glowworm-seed", "done", null, 9 * D);
configmap(DEV, "glowworm", "glowworm-env", { MODE: "dev" });
// A CloudNativePG cluster: no password in the pods' env, the operator's <cluster>-app and -superuser secrets.
const CNPG = { "cnpg.io/cluster": "glowworm-pg", "cnpg.io/instanceRole": "primary", "cnpg.io/podRole": "instance" };
pod(DEV, "glowworm", "glowworm-pg-1", null, { image: "ghcr.io/cloudnative-pg/postgresql:16.4", ports: [{ containerPort: 5432, name: "postgresql" }], containers: ["postgres"], labels: CNPG, cpu: 30, mem: 260, age: 20 * D });
service(DEV, "glowworm", "glowworm-pg-rw", [{ name: "postgres", port: 5432, targetPort: 5432 }], { "cnpg.io/cluster": "glowworm-pg", "cnpg.io/instanceRole": "primary" });
secret(DEV, "glowworm", "glowworm-pg-app", "kubernetes.io/basic-auth", { username: "app", password: "glow-app-31", dbname: "app", host: "glowworm-pg-rw", port: "5432", uri: "postgresql://app:glow-app-31@glowworm-pg-rw.glowworm:5432/app" });
secret(DEV, "glowworm", "glowworm-pg-superuser", "kubernetes.io/basic-auth", { username: "postgres", password: "glow-root-12" });

deployment(DEV, "kube-system", "coredns", { image: "rancher/mirrored-coredns-coredns:1.12.0", replicas: 2, rev: 1, age: 60 * D, cpu: 4, mem: 22, ports: [{ containerPort: 53, name: "dns" }] });
deployment(DEV, "kube-system", "metrics-server", { image: "rancher/mirrored-metrics-server:v0.7.2", replicas: 1, rev: 1, age: 60 * D, cpu: 6, mem: 30 });
deployment(DEV, "kube-system", "traefik", { image: "rancher/mirrored-library-traefik:3.1.2", replicas: 1, rev: 2, age: 60 * D, cpu: 5, mem: 50, ports: [{ containerPort: 8000, name: "web" }] });
daemonset(DEV, "kube-system", "svclb-traefik", "rancher/klipper-lb:v0.4.9", ["lumen-a", "lumen-b", "lumen-c"]);
service(DEV, "kube-system", "kube-dns", [{ name: "dns", port: 53, targetPort: 53 }], { "k8s-app": "kube-dns" });
service(DEV, "kube-system", "traefik", [{ name: "web", port: 80, targetPort: "web" }], { app: "traefik" }, "LoadBalancer");

deployment(DEV, "argocd", "argocd-server", { image: "quay.io/argoproj/argocd:v2.13.1", replicas: 1, rev: 2, age: 30 * D, cpu: 9, mem: 80, ports: [{ containerPort: 8080, name: "server" }] });
deployment(DEV, "argocd", "argocd-repo-server", { image: "quay.io/argoproj/argocd:v2.13.1", replicas: 1, rev: 2, age: 30 * D, cpu: 15, mem: 110 });
statefulset(DEV, "argocd", "argocd-application-controller", "quay.io/argoproj/argocd:v2.13.1", 1, { containerPort: 8082, name: "metrics" }, 60, 260);
service(DEV, "argocd", "argocd-server", [{ name: "https", port: 443, targetPort: 8080 }], { app: "argocd-server" });

ns(DEV, "default");

application(DEV, { name: "lantern", ns: "argocd", dest: "lantern", path: "lantern/overlays/dev", sync: "OutOfSync", health: "Progressing", rev: "e18b2c4f0a9d7e6b5c3a1f2e4d6b8a0c9e7f5d3b",
  resources: [["ConfigMap", "lantern-flags", "OutOfSync", ""], ["ConfigMap", "lantern-config", "Synced", ""], ["Service", "lantern-api", "Synced", "Healthy"], ["Service", "lantern-web", "Synced", "Healthy"], ["Service", "lantern-db", "Synced", "Healthy"],
    ["Deployment", "lantern-api", "Synced", "Progressing", "apps"], ["Deployment", "lantern-web", "Synced", "Healthy", "apps"], ["StatefulSet", "lantern-db", "Synced", "Healthy", "apps"], ["Ingress", "lantern", "Synced", "Healthy", "networking.k8s.io"], ["Ingress", "lantern-dark-sky", "OutOfSync", "Missing", "networking.k8s.io"]],
  history: [["a41c7d2e", 3 * D], ["5c10b3f9", 2 * D], ["9e02aa41", D], ["c7d3e810", 20 * H], ["e18b2c4f0a9d7e6b5c3a1f2e4d6b8a0c9e7f5d3b", 2 * H]],
  op: { phase: "Running", message: "waiting for healthy state of apps/Deployment/lantern-api", startedAt: ago(2 * H), operation: { sync: { revision: "e18b2c4f0a9d7e6b5c3a1f2e4d6b8a0c9e7f5d3b" } } } });
application(DEV, { name: "lantern-prod", ns: "argocd", dest: "lantern", server: "https://prod.nightjar.test:6443", path: "lantern/overlays/prod", sync: "Synced", health: "Healthy", rev: "c7d3e810", auto: true,
  resources: [["Service", "lantern-api", "Synced", "Healthy"], ["Deployment", "lantern-api", "Synced", "Healthy", "apps"], ["Deployment", "lantern-web", "Synced", "Healthy", "apps"]], history: [["5c10b3f9", 2 * D], ["c7d3e810", 20 * H]] });
application(DEV, { name: "moth", ns: "argocd", dest: "moth", path: "moth", sync: "Synced", health: "Healthy", rev: "77a0c1d2", auto: true,
  resources: [["Deployment", "moth-queue", "Synced", "Healthy", "apps"], ["Deployment", "moth-ui", "Synced", "Healthy", "apps"], ["StatefulSet", "moth-mysql", "Synced", "Healthy", "apps"], ["Service", "moth-ui", "Synced", "Healthy"], ["Service", "moth-queue", "Synced", "Healthy"], ["Service", "moth-mysql", "Synced", "Healthy"]], history: [["77a0c1d2", 5 * D]] });
application(DEV, { name: "glowworm", ns: "argocd", dest: "glowworm", path: "glowworm", sync: "Synced", health: "Degraded", rev: "1f9e0b33",
  resources: [["Deployment", "glowworm-api", "Synced", "Healthy", "apps"], ["Job", "glowworm-backfill", "Synced", "Degraded", "batch"], ["Service", "glowworm-api", "Synced", "Healthy"]], history: [["0b11c2aa", 9 * D], ["1f9e0b33", 6 * H]] });
application(DEV, { name: "kube-stars", ns: "argocd", dest: "stars", path: "stars", sync: "OutOfSync", health: "Missing", rev: "",
  resources: [["Namespace", "stars", "OutOfSync", "Missing"], ["Deployment", "stars-api", "OutOfSync", "Missing", "apps"]], history: [], op: { phase: "Failed", message: 'one or more objects failed to apply: namespaces "stars" is forbidden', startedAt: ago(H), finishedAt: ago(H - 5) } });
application(DEV, { name: "argo-self", ns: "argocd", dest: "argocd", path: "argocd", sync: "Synced", health: "Healthy", rev: "0a11fe90", auto: true,
  resources: [["Deployment", "argocd-server", "Synced", "Healthy", "apps"], ["Deployment", "argocd-repo-server", "Synced", "Healthy", "apps"], ["StatefulSet", "argocd-application-controller", "Synced", "Healthy", "apps"]], history: [["0a11fe90", 30 * D]] });

ns(DEV, "lantern")["certificates.cert-manager.io"].push({ apiVersion: "cert-manager.io/v1", kind: "Certificate", metadata: meta("lantern-tls", "lantern", 18 * D), spec: { secretName: "lantern-tls", dnsNames: ["lantern.nightjar.test"] }, status: { conditions: [{ type: "Ready", status: "True", reason: "Ready" }], notAfter: ago(-60 * D) } });

// ---- nightjar-prod (a production-looking context: the mod asks twice there)

const PROD = "nightjar-prod";
deployment(PROD, "lantern", "lantern-api", { image: "nightjar/lantern-api:6.9.1", replicas: 6, rev: 31, ports: [{ containerPort: 8080, name: "http" }], cpu: 310, mem: 420 });
deployment(PROD, "lantern", "lantern-web", { image: "nightjar/lantern-web:4.0.7", replicas: 3, rev: 18, ports: [{ containerPort: 8080, name: "http" }], cpu: 22, mem: 80 });
statefulset(PROD, "lantern", "lantern-db", "postgres:16.4", 3, { containerPort: 5432, name: "postgres" }, 120, 1900);
service(PROD, "lantern", "lantern-api", [{ name: "http", port: 8080, targetPort: "http" }], { app: "lantern-api" });
service(PROD, "lantern", "lantern-db", [{ name: "postgres", port: 5432, targetPort: 5432 }], { app: "lantern-db" });
deployment(PROD, "kube-system", "coredns", { image: "rancher/mirrored-coredns-coredns:1.12.0", replicas: 2, rev: 1, age: 200 * D, cpu: 5, mem: 25 });
ns(PROD, "default");

// ---- a busy namespace: a long list, for the table's and the graphs' cost

deployment(DEV, "hive", "hive-drone", { image: "nightjar/hive-drone:2.3.0", replicas: 60, rev: 3, age: 12 * D, cpu: 8, mem: 40 });
service(DEV, "hive", "hive-drone", [{ name: "http", port: 8080, targetPort: 8080 }], { app: "hive-drone" });

// ---- nodes, namespaces, contexts

function nodes(ctx: string, names: string[]) {
  return names.map((n, i) => ({ apiVersion: "v1", kind: "Node", metadata: meta(n, null, 60 * D, { labels: { "kubernetes.io/hostname": n, ...(i === 0 ? { "node-role.kubernetes.io/control-plane": "true" } : {}) } }),
    spec: i === 2 && ctx === DEV ? { unschedulable: false } : {},
    status: { capacity: { cpu: "4", memory: "8028140Ki", pods: "110" }, allocatable: { cpu: "4", memory: "8028140Ki", pods: "110" }, conditions: [{ type: "MemoryPressure", status: "False" }, { type: "DiskPressure", status: "False" }, { type: "Ready", status: "True", reason: "KubeletReady" }], nodeInfo: { kubeletVersion: "v1.31.4+k3s1", osImage: "made-up Linux", architecture: "arm64", containerRuntimeVersion: "containerd://1.7.23" }, addresses: [{ type: "InternalIP", address: `192.0.2.${21 + i}` }] } }));
}

rmSync(ROOT, { recursive: true, force: true });

const write = (path: string, data: unknown) => {
  mkdirSync(join(ROOT, path, ".."), { recursive: true });
  writeFileSync(join(ROOT, path), typeof data === "string" ? data : JSON.stringify(data, null, 1) + "\n");
};

for (const [ctx, spaces] of nss) {
  const nodeNames = ctx === DEV ? ["lumen-a", "lumen-b", "lumen-c"] : ["prod-1", "prod-2", "prod-3", "prod-4"];
  write(`${ctx}/_cluster/nodes.json`, list("Node", nodes(ctx, nodeNames)));
  write(`${ctx}/_cluster/namespaces.json`, list("Namespace", [...spaces.keys()].map((n) => ({ apiVersion: "v1", kind: "Namespace", metadata: meta(n, null, 60 * D, { labels: { "kubernetes.io/metadata.name": n } }), status: { phase: "Active" } }))));
  const top: string[] = [];
  for (const [n, s] of spaces) {
    for (const [res, items] of Object.entries(s)) {
      if (res === "top") continue;
      write(`${ctx}/${n}/${res}.json`, list("List", items as Obj[]));
    }
    top.push(...s.top);
  }
  write(`${ctx}/_cluster/top-pods.txt`, top.join("\n") + "\n");
  write(`${ctx}/_cluster/top-nodes.txt`, nodeNames.map((n, i) => `${n}\t${[620, 410, 880, 300][i]}m\t${[15, 10, 22, 7][i]}%\t${[3100, 2400, 4900, 1800][i]}Mi\t${[40, 31, 63, 23][i]}%`).join("\n") + "\n");
}

write("contexts.txt", "*\tnightjar-dev\tnightjar-dev\tnightjar-dev-admin\tlantern\n\tnightjar-prod\tnightjar-prod\tnightjar-prod-reader\tlantern\n");
write("api-resources.txt", ["pods", "deployments.apps", "replicasets.apps", "statefulsets.apps", "daemonsets.apps", "jobs.batch", "cronjobs.batch", "services", "ingresses.networking.k8s.io", "configmaps", "secrets", "persistentvolumeclaims", "events", "applications.argoproj.io", "appprojects.argoproj.io", "certificates.cert-manager.io", "issuers.cert-manager.io"].join("\n") + "\n");
console.log("wrote", ROOT);
