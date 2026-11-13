// Port-forwards: each one a terminal of its own (`hc run --bg`, labelled
// `k8s.forward` with what it forwards), so it keeps running when the window
// closes, shows wherever the app lists terminals, and can be peeked at,
// given a pane or stopped. The window lists them from terminals() (the
// shelf), and offers where each leads: a web pane for an http port, the
// Databases window for a database's (only when the databases mod is there).

import type { Guarded } from "./guard.ts";
import { isNumber, isString, literal, object, parseJson } from "./guard.ts";
import { maybe, mapOf } from "./guards.ts";
import type { PortFact } from "./rows.ts";

/** The label a forward's terminal carries: its record, as JSON. */
export const LABEL = "k8s.forward";

/** What a forward forwards (its label's JSON). */
export const isForwardNote = object(
  { context: isString, namespace: isString, target: isString, local: isNumber, remote: isNumber },
  { db: maybe(literal("postgres", "mysql")), web: maybe(literal("http", "https")), name: maybe(isString) },
);

export type ForwardNote = Guarded<typeof isForwardNote>;

/** A forward as the shelf lists it. */
export interface Forward extends ForwardNote {
  readonly address: string;
  readonly live: boolean;
}

const isTerminalEntry = object({ address: isString }, { labels: maybe(mapOf(isString)), state: maybe(isString) });

/** The forwards among herdr-core's terminals (each entry proven on its own). */
export function forwardsIn(terminals: readonly unknown[]): readonly Forward[] {
  return terminals.flatMap((t): Forward[] => {
    if (!isTerminalEntry(t)) return [];

    const note = parseJson(t.labels?.[LABEL] ?? "", isForwardNote);

    return note ? [{ ...note, address: t.address, live: t.state !== "exited" && t.state !== "dead" }] : [];
  });
}

/** A local port for a remote one: the same when it's 1024 or more and free among our forwards,
 *  else 10000 above it (80 → 8080 as people expect), then the next free one. */
export function localPort(remote: number, taken: ReadonlySet<number>): number {
  let p = remote === 80 ? 8080 : remote === 443 ? 8443 : remote < 1024 ? 10000 + remote : remote + 10000 <= 65535 ? remote + 10000 : remote;

  while (taken.has(p) && p < 65535) p++;

  return p;
}

const WEB_PORTS = new Set([80, 443, 3000, 4000, 5000, 5173, 8000, 8008, 8080, 8081, 8443, 8888, 9000, 9090]);

/** Whether a port looks like a web server's, and which scheme. */
export function webOf(port: PortFact, target: string): "http" | "https" | null {
  const name = (port.name ?? "").toLowerCase();

  if (port.port === 443 || port.port === 8443 || name === "https") return "https";

  if (/^(http|web|ui|server|api|grpc-web|metrics)/.test(name) || WEB_PORTS.has(port.port)) return "http";

  return /(web|ui|api|http|frontend|server)/.test(target) && !DB_PORTS.has(port.port) ? "http" : null;
}

const DB_PORTS: ReadonlyMap<number, "postgres" | "mysql"> = new Map([[5432, "postgres"], [3306, "mysql"]]);

/** The database a port looks like (the port, its name, the target's name or its images), or null. */
export function dbOf(port: PortFact, target: string, images: readonly string[] = []): "postgres" | "mysql" | null {
  const words = [port.name ?? "", target, ...images].join(" ").toLowerCase();

  if (/postgres|postgis|timescale|pgbouncer|\bpg\b|cockroach|yugabyte/.test(words)) return "postgres";

  if (/mysql|mariadb|percona|vitess|tidb/.test(words)) return "mysql";

  return DB_PORTS.get(port.port) ?? null;
}

/** What a forward of `target`'s `port` is noted as. */
export function noteFor(context: string, namespace: string, target: string, port: PortFact, local: number, images: readonly string[] = []): ForwardNote {
  const db = dbOf(port, target, images);
  const web = db ? null : webOf(port, target);
  const name = target.replace(/^[a-z]+\//, "");

  return { context, namespace, target, local, remote: port.port, db, web, name };
}

/** The arguments to `hc` that start it: a terminal of its own, in the background, labelled. */
export function startArgs(kubectl: string, n: ForwardNote): string[] {
  return [
    "run", "--bg", "--no-parent", "--no-notify", "--json",
    "--label", `${LABEL}=${JSON.stringify(n)}`,
    "--label", `nocturne.name=forward ${n.name ?? n.target} :${n.local}`,
    "--", kubectl, "--context", n.context, "-n", n.namespace, "port-forward", n.target, `${n.local}:${n.remote}`, "--address", "127.0.0.1",
  ];
}

/** The page a web forward opens. */
export function urlOf(f: ForwardNote): string {
  return `${f.web === "https" ? "https" : "http"}://localhost:${f.local}`;
}

/** The databases mod's connection args for a forward (no secret: its window asks for the password). */
export interface ConnectArgs {
  readonly kind: "postgres" | "mysql";
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly from: string;
}

export function connectArgs(f: ForwardNote, kind: "postgres" | "mysql"): ConnectArgs {
  return { kind, name: `${f.name ?? f.target} (${f.context}/${f.namespace})`, host: "127.0.0.1", port: f.local, from: `port-forward ${f.target} in ${f.context}/${f.namespace}` };
}

/** The databases mod's folder file: it's installed when this exists. */
export const DATABASES_MOD = "mods/databases/mod.json";
