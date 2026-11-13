// Every kubectl call the window makes: the arguments (always with
// --context, and -n where the kind lives in a namespace: the window never
// switches the kubeconfig's current context), and reading the answers
// through the guards. `Exec` is the seam: herdr's exec in the app, the fake
// kubectl in the tests.

import type { Guard } from "./guard.ts";
import { parseJson } from "./guard.ts";
import type { KindRef } from "./kinds.ts";
import { namespaced, resourceOf } from "./kinds.ts";
import { isKList } from "./objects.ts";

/** What exec answers. */
export interface ExecResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs kubectl with these arguments (herdr's exec, or a test's). */
export type Exec = (args: readonly string[], timeout: number) => Promise<ExecResult>;

/** A read's answer: the value, or why there is none. */
export type Answer<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

/** How long a read may take before it's given up (a slow cluster backs off in store.ts). */
export const READ_TIMEOUT = 15000;

/** Where a call goes: a context, and a namespace (null: all of them). */
export interface Where {
  readonly context: string;
  readonly namespace: string | null;
}

/** --context, and -n for one namespace: kubectl's own flags, which may stand before the verb. */
export function scope(where: Where, kind: KindRef | null = null): string[] {
  const ns = (kind !== null && !namespaced(kind)) || where.namespace === null ? [] : ["-n", where.namespace];

  return ["--context", where.context, ...ns];
}

/** -A for every namespace. It is a flag of `get` and `top`, not of kubectl itself: before the verb
 *  kubectl takes the verb for the flag's value and then looks for a plugin ("flags cannot be placed
 *  before plugin name: --context"). So it stands at the end of a call that lists. */
export function across(where: Where, kind: KindRef | null = null): string[] {
  return where.namespace === null && (kind === null || namespaced(kind)) ? ["-A"] : [];
}

/** `get <kind> -o json` for a list. */
export function listArgs(where: Where, kind: KindRef): string[] {
  return [...scope(where, kind), "get", resourceOf(kind), "-o", "json", "--request-timeout=10s", ...across(where, kind)];
}

/** The template that lists secrets by name, type, age and key names: values never leave kubectl. */
export const SECRET_TEMPLATE = '{{range .items}}{{.metadata.namespace}}{{"\\t"}}{{.metadata.name}}{{"\\t"}}{{.type}}{{"\\t"}}{{.metadata.creationTimestamp}}{{"\\t"}}{{range $k, $v := .data}}{{$k}},{{end}}{{"\\n"}}{{end}}';

export function secretListArgs(where: Where): string[] {
  return [...scope(where, "secrets"), "get", "secrets", "-o", `go-template=${SECRET_TEMPLATE}`, "--request-timeout=10s", ...across(where, "secrets")];
}

/** One object's YAML, describe, or events. */
export function yamlArgs(where: Where, kind: KindRef, name: string): string[] {
  return [...scope(where, kind), "get", resourceOf(kind), name, "-o", "yaml"];
}

export function describeArgs(where: Where, kind: KindRef, name: string): string[] {
  return [...scope(where, kind), "describe", resourceOf(kind), name];
}

export function eventArgs(where: Where, uid: string): string[] {
  return [...scope(where, "events"), "get", "events", "--field-selector", `involvedObject.uid=${uid}`, "-o", "json", "--request-timeout=10s", ...across(where, "events")];
}

export function topPodsArgs(where: Where): string[] {
  return ["--context", where.context, "top", "pods", ...(where.namespace === null ? ["-A"] : ["-n", where.namespace]), "--no-headers"];
}

export function topNodesArgs(context: string): string[] {
  return ["--context", context, "top", "nodes", "--no-headers"];
}

export const CONTEXTS_ARGS = ["config", "get-contexts", "--no-headers"] as const;

export function apiResourcesArgs(context: string): string[] {
  return ["--context", context, "api-resources", "--verbs=list", "-o", "name"];
}

/** The first line of kubectl's complaint, without its "error: " prefix. */
export function errorOf(r: ExecResult): string {
  const line = r.stderr.split("\n").map((l) => l.trim()).find(Boolean) ?? `kubectl exited ${r.code}`;

  return line.replace(/^error:\s*/i, "");
}

/** Runs a read and hands back its text, or kubectl's complaint. */
export async function readText(exec: Exec, args: readonly string[], timeout = READ_TIMEOUT): Promise<Answer<string>> {
  try {
    const r = await exec(args, timeout);

    return r.code === 0 ? { ok: true, value: r.stdout } : { ok: false, error: errorOf(r) };
  } catch (cause: unknown) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** A list read: each item proven on its own, the odd ones left out. */
export async function readList<T>(exec: Exec, args: readonly string[], item: Guard<T>): Promise<Answer<readonly T[]>> {
  const r = await readText(exec, args);

  if (!r.ok) return r;

  const list = parseJson(r.value, isKList);

  if (!list) return { ok: false, error: "kubectl's answer wasn't a list" };

  return { ok: true, value: list.items.filter((x) => item(x)) };
}
