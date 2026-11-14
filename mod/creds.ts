// Where a forwarded database's credentials are in the cluster, so the
// Databases window can read them itself (the contract: the Databases mod's
// kube.ts; this mod sends where the password is, never the value, and never
// reads a value for it). Found from what the database's pod runs with and
// from the operators' own conventions:
//
//   - the pod's env (the service's pods, a workload's pod template): the
//     images' variables (POSTGRES_PASSWORD / POSTGRES_USER / POSTGRES_DB,
//     PGPASSWORD, Bitnami's POSTGRES_POSTGRES_PASSWORD, spilo's
//     PGPASSWORD_SUPERUSER, MYSQL_ROOT_PASSWORD, MYSQL_USER / MYSQL_PASSWORD,
//     the MARIADB_ ones) as a secretKeyRef, an envFrom secretRef (with its
//     prefix), or a *_FILE pointing into a mounted secret volume (Bitnami's
//     password files). A plain `value` (the password written in the pod's
//     spec) or a configMapKeyRef password isn't passed on: it is named, and
//     Databases asks. A user or database as a plain value, a config map's or
//     the password's secret's key goes along.
//   - CloudNativePG (`cnpg.io/cluster`): <cluster>-app (username, password,
//     dbname) and <cluster>-superuser; Crunchy PGO v5 and Percona's PG
//     operator (`postgres-operator.crunchydata.com/cluster`): each
//     <cluster>-pguser-<user> (user, password, dbname); Zalando's operator
//     (`cluster-name` with `application: spilo`): each
//     <user>.<cluster>.credentials.postgresql.acid.zalan.do (username, password).
//
// The secrets are listed by key names only (kubectl.ts's template) to check
// that a candidate's secret and key are there.

import type { Guard, Guarded } from "./guard.ts";
import { isBoolean, isString, object, parseJson } from "./guard.ts";
import { isList, mapOf, maybe, toMap } from "./guards.ts";
import type { Exec, Where } from "./kubectl.ts";
import { readText, scope, secretListArgs } from "./kubectl.ts";

// ---- what the pod runs with (only what this reads)

const isKeyRef = object({ name: isString, key: isString }, { optional: maybe(isBoolean) });
const isEnvSource = object({}, { secretKeyRef: maybe(isKeyRef), configMapKeyRef: maybe(isKeyRef) });
const isEnvVar = object({ name: isString }, { value: maybe(isString), valueFrom: maybe(isEnvSource) });
const isNamed = object({ name: isString });
const isEnvFrom = object({}, { prefix: maybe(isString), secretRef: maybe(isNamed), configMapRef: maybe(isNamed) });
const isMount = object({ name: isString, mountPath: isString }, { subPath: maybe(isString) });
const isCredContainer = object({ name: isString }, { image: maybe(isString), env: maybe(isList), envFrom: maybe(isList), volumeMounts: maybe(isList) });
const isItem = object({ key: isString, path: isString });
const isSecretVolume = object({}, { secretName: maybe(isString), items: maybe(isList) });
const isVolume = object({ name: isString }, { secret: maybe(isSecretVolume) });
const isCredSpec = object({}, { containers: maybe(isList), volumes: maybe(isList) });
const isLabels = maybe(mapOf(isString));
const isCredMeta = object({ name: isString }, { labels: isLabels });
const isCredPod = object({ metadata: isCredMeta }, { spec: maybe(isCredSpec), status: maybe(object({}, { phase: maybe(isString) })) });
const isTemplate = object({}, { metadata: maybe(object({}, { labels: isLabels })), spec: maybe(isCredSpec) });
const isWorkload = object({ metadata: isCredMeta, spec: object({}, { template: maybe(isTemplate) }) });
const isService = object({ metadata: isCredMeta, spec: object({}, { selector: isLabels }) });
const isPodList = object({ items: isList });
const isConfigMap = object({ metadata: isCredMeta }, { data: maybe(mapOf(isString)) });

type CredContainer = Guarded<typeof isCredContainer>;

type CredSpec = Guarded<typeof isCredSpec>;

/** The items of a list a guard proves (the odd ones left out, not the whole list). */
const kept = <T>(list: readonly unknown[] | null | undefined, guard: Guard<T>): T[] => (list ?? []).filter((x): x is T => guard(x));

/** A pod as the finder reads it: its name, labels and spec (a workload's template stands in). */
export interface PodView {
  readonly name: string;
  readonly labels: ReadonlyMap<string, string>;
  readonly spec: CredSpec;
}

/** A secret by its key names (never its values). */
export interface SecretKeys {
  readonly name: string;
  readonly keys: readonly string[];
}

/** What an env variable holds: a secret's key, a plain value (also a config map's), or nothing known. */
type Ref = { readonly secret: string; readonly key: string } | { readonly value: string; readonly where: "spec" | "configmap" };

/** One place the password may be: a secret's key, with its user and database (plain, or keys of the same secret). */
export interface Candidate {
  readonly secret: string;
  readonly key: string;
  readonly userKey?: string;
  readonly databaseKey?: string;
  readonly user?: string;
  readonly database?: string;
  /** Where it was found, in words ("POSTGRES_PASSWORD of lantern-db-0", "CloudNativePG's app user"). */
  readonly why: string;
}

type Draft = { -readonly [K in keyof Candidate]: Candidate[K] };

// ---- the env

/** The pod's variables of one container, resolved as far as the secrets' key names and config maps allow. */
export function envOf(c: CredContainer, spec: CredSpec, secrets: readonly SecretKeys[] | null, maps: ReadonlyMap<string, ReadonlyMap<string, string>>): Map<string, Ref> {
  const out = new Map<string, Ref>();

  for (const f of kept(c.envFrom, isEnvFrom)) {
    const p = f.prefix ?? "";

    if (f.secretRef) for (const key of secrets?.find((s) => s.name === f.secretRef?.name)?.keys ?? []) out.set(p + key, { secret: f.secretRef.name, key });

    if (f.configMapRef) for (const [key, value] of maps.get(f.configMapRef.name) ?? []) out.set(p + key, { value, where: "configmap" });
  }

  for (const e of kept(c.env, isEnvVar)) {
    const from = e.valueFrom;

    if (from?.secretKeyRef) out.set(e.name, { secret: from.secretKeyRef.name, key: from.secretKeyRef.key });
    else if (from?.configMapKeyRef) {
      const value = maps.get(from.configMapKeyRef.name)?.get(from.configMapKeyRef.key);

      if (value !== undefined) out.set(e.name, { value, where: "configmap" });
    } else if (isString(e.value)) out.set(e.name, { value: e.value, where: "spec" });
  }

  // A *_FILE pointing into a mounted secret: the variable is that secret's key.
  for (const [name, ref] of out) {
    if (!name.endsWith("_FILE") || !("value" in ref)) continue;

    const file = fileRef(c, spec, ref.value);

    if (file && !out.has(name.slice(0, -5))) out.set(name.slice(0, -5), file);
  }

  return out;
}

/** The secret's key a file path in the container reads, when a secret volume is mounted there. */
export function fileRef(c: CredContainer, spec: CredSpec, path: string): Ref | null {
  for (const m of kept(c.volumeMounts, isMount)) {
    const base = m.mountPath.replace(/\/$/, "");
    const rel = m.subPath && path === base ? m.subPath : path.startsWith(`${base}/`) ? path.slice(base.length + 1) : null;

    if (!rel) continue;

    const vol = kept(spec.volumes, isVolume).find((x) => x.name === m.name)?.secret;

    if (!vol?.secretName) continue;

    const item = kept(vol.items, isItem).find((x) => x.path === rel);

    if (item) return { secret: vol.secretName, key: item.key };

    if (!vol.items?.length && !rel.includes("/")) return { secret: vol.secretName, key: rel };
  }

  return null;
}

/** The images' variables: each group a password, its user (or the image's own), the kind's database. */
interface Group {
  readonly kind: "postgres" | "mysql";
  readonly password: readonly string[];
  readonly user: readonly string[];
  readonly fallbackUser: string | null;
  readonly role: string;
}

const GROUPS: readonly Group[] = [
  { kind: "postgres", password: ["POSTGRES_PASSWORD", "POSTGRESQL_PASSWORD", "PGPASSWORD"], user: ["POSTGRES_USER", "POSTGRESQL_USERNAME", "POSTGRES_USERNAME", "PGUSER"], fallbackUser: "postgres", role: "" },
  { kind: "postgres", password: ["POSTGRES_POSTGRES_PASSWORD", "POSTGRESQL_POSTGRES_PASSWORD"], user: [], fallbackUser: "postgres", role: "superuser" },
  { kind: "postgres", password: ["PGPASSWORD_SUPERUSER"], user: ["PGUSER_SUPERUSER"], fallbackUser: "postgres", role: "superuser" },
  { kind: "mysql", password: ["MYSQL_ROOT_PASSWORD", "MARIADB_ROOT_PASSWORD"], user: [], fallbackUser: "root", role: "root" },
  { kind: "mysql", password: ["MYSQL_PASSWORD", "MARIADB_PASSWORD"], user: ["MYSQL_USER", "MARIADB_USER"], fallbackUser: null, role: "" },
];

const DATABASE_VARS = { postgres: ["POSTGRES_DB", "POSTGRESQL_DATABASE", "POSTGRES_DATABASE", "PGDATABASE"], mysql: ["MYSQL_DATABASE", "MARIADB_DATABASE"] } as const;

/** The first of these variables that's set. */
function first(env: ReadonlyMap<string, Ref>, names: readonly string[]): readonly [string, Ref] | null {
  for (const n of names) {
    const r = env.get(n);

    if (r) return [n, r];
  }

  return null;
}

/** A user or database variable on the candidate: a plain value, or a key of the password's secret. */
function put(d: Draft, what: "user" | "database", r: Ref | undefined, secret: string): void {
  if (!r) return;

  if ("value" in r) {
    if (r.value) d[what] = r.value;
  } else if (r.secret === secret) d[what === "user" ? "userKey" : "databaseKey"] = r.key;
}

/** Candidates (and notes) from one container's variables. */
/** Candidates found, and what was seen but can't be passed on (in words). */
export interface Finding {
  readonly candidates: Candidate[];
  readonly notes: string[];
}

export function fromEnv(kind: "postgres" | "mysql", env: ReadonlyMap<string, Ref>, pod: string): Finding {
  const candidates: Candidate[] = [];
  const notes: string[] = [];
  const db = first(env, DATABASE_VARS[kind])?.[1];

  for (const g of GROUPS.filter((x) => x.kind === kind)) {
    const pw = first(env, g.password);

    if (!pw) continue;

    const [name, ref] = pw;

    if ("value" in ref) {
      notes.push(ref.where === "spec" ? `${name} is written in ${pod}'s spec, not a secret: Databases asks (y on the pod shows it)` : `${name} comes from a config map, not a secret: Databases asks`);

      continue;
    }

    const user = first(env, g.user);

    if (!user && !g.fallbackUser) continue;

    const d: Draft = { secret: ref.secret, key: ref.key, why: `${name} of ${pod}${g.role ? ` (${g.role})` : ""}` };

    if (user) put(d, "user", user[1], ref.secret);
    else if (g.fallbackUser) d.user = g.fallbackUser;

    if (user && !("value" in user[1]) && user[1].secret !== ref.secret) notes.push(`${user[0]} is in another secret (${user[1].secret}): the user isn't filled in`);

    put(d, "database", db, ref.secret);
    candidates.push(d);
  }

  return { candidates, notes };
}

// ---- the operators

const has = (s: SecretKeys, key: string): boolean => s.keys.includes(key);

/** The operator-made secrets of the pod's cluster (labels on the pod or the service's selector). */
export function fromOperators(kind: "postgres" | "mysql", labels: ReadonlyMap<string, string>, secrets: readonly SecretKeys[]): Candidate[] {
  if (kind !== "postgres") return [];

  const out: Candidate[] = [];

  const add = (s: SecretKeys, why: string, user: string, db: string | null): void => {
    if (!has(s, "password")) return;

    const d: Draft = { secret: s.name, key: "password", why };

    if (has(s, user)) d.userKey = user;

    if (db && has(s, db)) d.databaseKey = db;

    out.push(d);
  };

  const cnpg = labels.get("cnpg.io/cluster");

  if (cnpg) {
    for (const [suffix, role, db] of [["app", "app user", "dbname"], ["superuser", "superuser", null]] as const) {
      const s = secrets.find((x) => x.name === `${cnpg}-${suffix}`);

      if (s) add(s, `CloudNativePG cluster ${cnpg}'s ${role}`, "username", db);
    }
  }

  const crunchy = labels.get("postgres-operator.crunchydata.com/cluster");

  if (crunchy) for (const s of secrets.filter((x) => x.name.startsWith(`${crunchy}-pguser-`))) add(s, `PGO cluster ${crunchy}'s user ${s.name.slice(crunchy.length + 8)}`, "user", "dbname");

  const zalando = labels.get("application") === "spilo" ? labels.get("cluster-name") : undefined;

  if (zalando) {
    const tail = `.${zalando}.credentials.postgresql.acid.zalan.do`;

    for (const s of secrets.filter((x) => x.name.endsWith(tail))) add(s, `postgres-operator cluster ${zalando}'s user ${s.name.slice(0, -tail.length).split(".").at(-1) ?? ""}`, "username", null);
  }

  return out;
}

// ---- together

/** What the finder found for a forward. */
export interface Found {
  readonly candidates: readonly Candidate[];
  /** What it saw but can't pass on, and what it couldn't read, in words. */
  readonly notes: readonly string[];
  /** The namespace's secrets by key names (the picker's "another secret"), or null when not listed. */
  readonly secrets: readonly SecretKeys[] | null;
}

/** The candidates for a pod: its containers' env first (what it really runs with), then the operators';
 *  each once, and only those whose secret and key are there (when the secrets could be listed). */
export function candidatesOf(kind: "postgres" | "mysql", pod: PodView, extraLabels: ReadonlyMap<string, string>, secrets: readonly SecretKeys[] | null, maps: ReadonlyMap<string, ReadonlyMap<string, string>>): Finding {
  const all: Candidate[] = [];
  const notes: string[] = [];

  for (const c of kept(pod.spec.containers, isCredContainer)) {
    const r = fromEnv(kind, envOf(c, pod.spec, secrets, maps), pod.name);

    all.push(...r.candidates);
    notes.push(...r.notes);
  }

  const labels = new Map([...extraLabels, ...pod.labels]);

  if (secrets) all.push(...fromOperators(kind, labels, secrets));

  const seen = new Set<string>();
  const out: Candidate[] = [];

  for (const c of all) {
    const id = `${c.secret}\n${c.key}`;

    if (seen.has(id)) continue;

    seen.add(id);

    const s = secrets?.find((x) => x.name === c.secret);

    if (secrets && !s) notes.push(`${c.why} names secret ${c.secret}, which isn't in the namespace`);
    else if (s && !has(s, c.key)) notes.push(`secret ${c.secret} has no key ${c.key}`);
    else out.push(c);
  }

  return { candidates: out, notes: [...new Set(notes)] };
}

/** The template's lines (namespace, name, type, created, keys) as secrets by key names. */
export function secretKeysOf(out: string): SecretKeys[] {
  return out.split("\n").flatMap((line): SecretKeys[] => {
    const [, name, , , keys] = line.split("\t");

    return name ? [{ name, keys: (keys ?? "").split(",").filter(Boolean) }] : [];
  });
}

/** The pod the forward reaches: a pod itself, a service's pods (a running one first), a workload's template. */
async function podOf(exec: Exec, where: Where, target: string): Promise<{ pod: PodView; labels: Map<string, string> } | string> {
  const [kind = "", name = ""] = target.split("/");
  const resource = { pod: "pods", svc: "services", deploy: "deployments", sts: "statefulsets" }[kind] ?? "pods";
  const r = await readText(exec, [...scope(where), "get", resource, name, "-o", "json", "--request-timeout=10s"]);

  if (!r.ok) return r.error;

  const view = (o: Guarded<typeof isCredPod>): PodView => ({ name: o.metadata.name, labels: toMap(o.metadata.labels), spec: o.spec ?? {} });

  if (resource === "pods") {
    const p = parseJson(r.value, isCredPod);

    return p ? { pod: view(p), labels: new Map() } : "kubectl's answer wasn't a pod";
  }

  if (resource !== "services") {
    const w = parseJson(r.value, isWorkload);
    const t = w?.spec.template;

    return w && t ? { pod: { name: w.metadata.name, labels: toMap(t.metadata?.labels), spec: t.spec ?? {} }, labels: new Map() } : `kubectl's answer wasn't a ${kind}`;
  }

  const svc = parseJson(r.value, isService);
  const selector = toMap(svc?.spec.selector);

  if (!svc || !selector.size) return `service ${name} selects no pods`;

  const pods = await readText(exec, [...scope(where), "get", "pods", "-l", [...selector].map(([k, v]) => `${k}=${v}`).join(","), "-o", "json", "--request-timeout=10s"]);

  if (!pods.ok) return pods.error;

  const list = kept(parseJson(pods.value, isPodList)?.items, isCredPod);
  const p = list.find((x) => x.status?.phase === "Running") ?? list[0];

  return p ? { pod: view(p), labels: selector } : `service ${name} has no pods`;
}

/** The config maps the pod's env names (for a user or database kept in one). */
async function mapsOf(exec: Exec, where: Where, spec: CredSpec): Promise<Map<string, ReadonlyMap<string, string>>> {
  const names = new Set<string>();

  for (const c of kept(spec.containers, isCredContainer)) {
    for (const e of kept(c.env, isEnvVar)) if (e.valueFrom?.configMapKeyRef) names.add(e.valueFrom.configMapKeyRef.name);

    for (const f of kept(c.envFrom, isEnvFrom)) if (f.configMapRef) names.add(f.configMapRef.name);
  }

  const out = new Map<string, ReadonlyMap<string, string>>();

  for (const n of names) {
    const r = await readText(exec, [...scope(where), "get", "configmap", n, "-o", "json", "--request-timeout=10s"]);
    const m = r.ok ? parseJson(r.value, isConfigMap) : undefined;

    if (m) out.set(n, toMap(m.data));
  }

  return out;
}

/** Finds the candidates for a forward of `target` ("svc/lantern-db") in `where`. Reads no secret's value. */
export async function findCredentials(exec: Exec, where: Where, target: string, kind: "postgres" | "mysql"): Promise<Found> {
  const listed = await readText(exec, secretListArgs(where));
  const secrets = listed.ok ? secretKeysOf(listed.value) : null;
  const notes = listed.ok ? [] : [`couldn't list the secrets: ${listed.error}`];
  const pod = await podOf(exec, where, target);

  if (isString(pod)) return { candidates: [], notes: [...notes, `couldn't read ${target}: ${pod}`], secrets };

  const r = candidatesOf(kind, pod.pod, pod.labels, secrets, await mapsOf(exec, where, pod.pod.spec));

  return { candidates: r.candidates, notes: [...notes, ...r.notes], secrets };
}
