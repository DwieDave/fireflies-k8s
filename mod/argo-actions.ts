// The Argo tab's actions: refresh, sync and rollback asked about first (the
// patches and annotations argo.ts builds), and the diff: `argocd app diff`
// when the CLI is installed and logged in, else each out-of-sync resource's
// live object against its last-applied configuration (said plainly: that's
// what was last applied, not what git holds now).

import type { Context } from "gpui-kit";
import { exec } from "herdr";
import type { default as K8s } from "./main.ts";
import type { Application, HistoryEntry, Managed } from "./argo.ts";
import { historyOf, refreshArgs, rollbackRefusal, syncArgs, targetRevision } from "./argo.ts";
import { request } from "./writes.ts";
import type { DiffLine, Yamlable } from "./diff.ts";
import { diffLines, hunks, isYamlable, toYaml } from "./diff.ts";
import { parseJson, isString, object } from "./guard.ts";
import { maybe, mapOf } from "./guards.ts";
import { readText, scope } from "./kubectl.ts";
import { builtinOfKind } from "./kinds.ts";

/** A diff shown in the side panel: of which app, how it was made, its lines. */
export interface Diffed {
  readonly app: string;
  readonly how: "argocd" | "last-applied";
  readonly sections: readonly { readonly title: string; readonly lines: readonly DiffLine[] }[];
  readonly error: string | null;
}

const nsOf = (a: Application): string => a.metadata.namespace ?? "argocd";

export function refreshApp(v: K8s, a: Application, hard: boolean, cx: Context): void {
  request(v, { kind: "refresh", title: `${hard ? "Hard-refresh" : "Refresh"} application ${a.metadata.name}`, name: a.metadata.name, namespace: nsOf(a), args: refreshArgs(v.context ?? "", nsOf(a), a.metadata.name, hard), detail: ["Argo compares it with git again (nothing is applied)"] }, cx);
}

export function syncApp(v: K8s, a: Application, cx: Context): void {
  const rev = targetRevision(a);
  const out = (a.status?.resources ?? []).filter((r) => r.status === "OutOfSync").length;

  request(v, { kind: "sync", title: `Sync application ${a.metadata.name} to ${rev}`, name: a.metadata.name, namespace: nsOf(a), args: syncArgs(v.context ?? "", nsOf(a), a.metadata.name, rev), detail: [`${out} resource${out === 1 ? "" : "s"} out of sync; nothing is pruned`] }, cx);
}

export function rollbackApp(v: K8s, a: Application, entry: HistoryEntry | null, cx: Context): void {
  const no = rollbackRefusal(a, entry);

  if (no || !entry?.revision) {
    v.say(`can't roll back: ${no ?? "no revision"}`, "wk");

    return;
  }

  request(v, { kind: "rollback", title: `Roll ${a.metadata.name} back to ${entry.revision.slice(0, 7)}`, name: a.metadata.name, namespace: nsOf(a), args: syncArgs(v.context ?? "", nsOf(a), a.metadata.name, entry.revision), detail: [`history entry ${entry.id}; until the next sync it runs that revision, not git's newest`] }, cx);
}

/** The history entry the cursor picks (the newest when none). */
export function pickedEntry(v: K8s, a: Application): HistoryEntry | null {
  const h = historyOf(a);

  return h[v.histAt ?? h.length - 1] ?? h[h.length - 1] ?? null;
}

let cli: boolean | null = null;

/** Builds the diff of an application (D). */
export function diffApp(v: K8s, a: Application, cx: Context): void {
  v.argoDiff = { app: a.metadata.name, how: "last-applied", sections: [], error: "comparing…" };
  cx.spawn(async (cx) => {
    if (cli === null) cli = await exec("sh", ["-c", "command -v argocd"]).then((r) => r.code === 0, () => false);

    v.argoDiff = cli ? await viaCli(a) : await viaLastApplied(v, a);
    cx.notify();
  });
}

async function viaCli(a: Application): Promise<Diffed> {
  const r = await exec("argocd", ["app", "diff", a.metadata.name, "--app-namespace", nsOf(a)], { timeout: 60000 }).catch(() => null);

  // argocd app diff exits 1 when there is a difference, 2+ on errors.
  if (!r || r.code > 1) return { app: a.metadata.name, how: "argocd", sections: [], error: r?.stderr.trim() || "argocd didn't answer (logged in? `argocd login`)" };

  const sections = r.stdout.split(/\n(?====== )/).filter((s) => s.trim()).map((s) => {
    const [head, ...body] = s.split("\n");

    return { title: (head ?? "").replace(/^=+\s*|\s*=+$/g, ""), lines: body.map((l): DiffLine => ({ op: l.startsWith(">") ? "+" : l.startsWith("<") ? "-" : " ", text: l.replace(/^[<>]\s?/, ""), n: 0 })) };
  });

  return { app: a.metadata.name, how: "argocd", sections, error: sections.length ? null : "no difference" };
}

const isAnnotated = object({ metadata: object({}, { annotations: maybe(mapOf(isString)) }) });

const LAST = "kubectl.kubernetes.io/last-applied-configuration";

async function viaLastApplied(v: K8s, a: Application): Promise<Diffed> {
  const out = (a.status?.resources ?? []).filter((r) => r.status === "OutOfSync" && r.health?.status !== "Missing").slice(0, 8);
  const sections = await Promise.all(out.map((m) => sectionOf(v, m)));
  const missing = (a.status?.resources ?? []).filter((r) => r.health?.status === "Missing").map((r) => ({ title: `${r.kind}/${r.name}: not in the cluster (a sync creates it)`, lines: [] }));
  const all = [...missing, ...sections];

  return { app: a.metadata.name, how: "last-applied", sections: all, error: all.length ? null : "nothing out of sync" };
}

async function sectionOf(v: K8s, m: Managed): Promise<{ readonly title: string; readonly lines: readonly DiffLine[] }> {
  const kind = builtinOfKind(m.kind);
  const title = `${m.kind}/${m.name}`;

  if (!kind) return { title: `${title}: a kind the window doesn't read`, lines: [] };

  const r = await readText(v.data.exec, [...scope({ context: v.context ?? "", namespace: m.namespace ?? null }, kind), "get", kind === "secrets" ? "secret" : m.kind.toLowerCase(), m.name, "-o", "json"]);

  if (!r.ok) return { title: `${title}: ${r.error}`, lines: [] };

  const live = parseJson(r.value, isYamlable);
  const annotated = parseJson(r.value, isAnnotated);
  const last = annotated?.metadata.annotations?.[LAST];
  const applied = last ? parseJson(last, isYamlable) : undefined;

  if (live === undefined || applied === undefined) return { title: `${title}: no last-applied configuration to compare with`, lines: [] };

  // Secrets: compared by keys only, the values never shown.
  if (kind === "secrets") return { title: `${title} (values not shown)`, lines: [] };

  return { title, lines: hunks(diffLines(toYaml(applied), toYaml(project(applied, trimmed(live))))) };
}

/** The live value cut to the shape of the applied one: only the fields that were applied are
 *  compared (the server's defaults would drown the change otherwise). */
function project(applied: Yamlable, live: Yamlable | undefined): Yamlable {
  if (live === undefined) return null;

  if (isList(applied) && isList(live)) return live.map((x, i) => {
    const a = applied[i];

    return a === undefined ? x : project(a, x);
  });

  if (isObj(applied) && isObj(live)) {
    const out: { [key: string]: Yamlable } = {};

    for (const [k, a] of Object.entries(applied)) if (a !== undefined && live[k] !== undefined) out[k] = project(a, live[k]);

    return out;
  }

  return live;
}

const isList = (v: Yamlable): v is readonly Yamlable[] => Array.isArray(v);

/** The live object without what the server adds (status, managed fields, uid, timestamps). */
function trimmed(live: Yamlable): Yamlable {
  if (live === null || !isObj(live)) return live;

  const out: { [key: string]: Yamlable } = {};

  for (const [k, val] of Object.entries(live)) {
    if (k === "status" || val === undefined) continue;

    if (k === "metadata" && isObj(val)) {
      const meta: { [key: string]: Yamlable } = {};

      for (const [mk, mv] of Object.entries(val)) if (mv !== undefined && !["managedFields", "uid", "resourceVersion", "creationTimestamp", "generation", "annotations"].includes(mk)) meta[mk] = mv;

      out[k] = meta;
    } else out[k] = val;
  }

  return out;
}

const isObj = (v: Yamlable): v is { readonly [key: string]: Yamlable | undefined } => v !== null && typeof v === "object" && !Array.isArray(v);
