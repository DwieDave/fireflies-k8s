// Where the window's rows lead in the rest of the app: a pod's shell and logs
// as terminals in panes (not inside the window), port-forwards as terminals
// of their own, a forward's page in a web pane, a database forward in the
// Databases window (only when that mod is installed: its password's place
// found in the cluster first, creds.ts, and handed over, never its value), an
// ingress's host in a web pane. From a window, opening beside closes the window (the pane it
// opened is where the person goes next); from a pane, it opens beside it.

import type { AsyncContext, Context } from "gpui-kit";
import { closeOverlay, hc, openOverlay, run, shared } from "herdr";
import type { default as K8s } from "./main.ts";
import { isString, readShared, sharedKey } from "./guard.ts";
import type { PortFact, Row } from "./rows.ts";
import type { ConnectArgs, Forward, ForwardNote, Picked, PickedDraft } from "./forwards.ts";
import type { Found, SecretKeys } from "./creds.ts";
import { findCredentials } from "./creds.ts";
import type { MenuRow } from "./state.ts";
import { connectArgs, forwardsIn, localPort, noteFor, startArgs, urlOf } from "./forwards.ts";
import { ownPane, saveCopy } from "./host.ts";
import { resourceOf } from "./kinds.ts";
import { terminals } from "herdr";

/** Leaves the window for what it opened beside (a pane keeps its place). */
function leaveWindow(v: K8s, cx: AsyncContext): void {
  const id = v.props.overlay;

  if (!id) return;

  saveCopy(v);
  cx.timer.after(300, () => closeOverlay(id));
}

/** A terminal in a pane beside this one (or beside the focused pane, from a window). */
export function openTerminal(v: K8s, argv: readonly string[], name: string, place: "right" | "down", cx: Context): void {
  const pane = ownPane(v);
  run("terminal.open", pane ? { argv: [...argv], place, name, pane } : { argv: [...argv], place, name });
  leaveWindow(v, cx);
}

/** The kubectl words that place a call: context and namespace. */
function at(v: K8s, row: Row): string[] {
  return ["--context", v.context ?? "", "-n", row.ref.namespace ?? v.namespace ?? "default"];
}

/** A pod's (or a workload's) logs, followed, in a pane under; `previous`: the last run's, not followed. */
export function openLogs(v: K8s, row: Row, container: string | null, previous: boolean, cx: Context): void {
  const target = row.ref.kind === "pods" ? row.ref.name : `${resourceOf(row.ref.kind).split(".")[0] ?? ""}/${row.ref.name}`;
  const which = container ? ["-c", container] : row.ref.kind === "pods" ? [] : ["--all-containers", "--prefix"];
  const argv = [v.settings.kubectl, ...at(v, row), "logs", ...(previous ? ["-p"] : ["-f", "--tail", "500"]), target, ...which];

  openTerminal(v, argv, `logs ${row.ref.name}${previous ? " (previous)" : ""}`, "down", cx);
}

/** A shell in a pod's container, in a pane beside: bash where it's there, else sh. */
export function openShell(v: K8s, row: Row, container: string | null, cx: Context): void {
  const argv = [v.settings.kubectl, ...at(v, row), "exec", "-it", row.ref.name, ...(container ? ["-c", container] : []), "--", "sh", "-c", "command -v bash >/dev/null 2>&1 && exec bash || exec sh"];

  openTerminal(v, argv, `shell ${row.ref.name}`, "right", cx);
}

/** The forwards running now (and ended ones, until their terminal goes). */
export function forwards(): readonly Forward[] {
  return forwardsIn(terminals());
}

/** What kubectl port-forward targets for a row ("svc/lantern-db", "pod/x", "deploy/y"). */
export function forwardTarget(row: Row): string {
  const short = { pods: "pod", services: "svc", deployments: "deploy", statefulsets: "sts" } as const;
  const k = row.ref.kind === "pods" || row.ref.kind === "services" || row.ref.kind === "deployments" || row.ref.kind === "statefulsets" ? short[row.ref.kind] : "pod";

  return `${k}/${row.ref.name}`;
}

/** Starts a forward of one of the row's ports: a terminal of its own, listed on the shelf. */
export function startForward(v: K8s, row: Row, port: PortFact, cx: Context): void {
  const taken = new Set(forwards().filter((f) => f.live).map((f) => f.local));
  const remote = port.port;
  const n = noteFor(v.context ?? "", row.ref.namespace ?? v.namespace ?? "default", forwardTarget(row), { ...port, port: remote }, localPort(remote, taken), row.images ?? []);

  cx.spawn(async (cx) => {
    const r = await hc(startArgs(v.settings.kubectl, n)).catch(() => null);

    if (r && r.code === 0) v.say(`forwarding ${n.target} :${n.remote} → localhost:${n.local}${n.db ? ` · b opens it in Databases` : n.web ? " · w opens it" : ""}`, "ok");
    else v.say(`couldn't start the forward: ${r?.stderr.trim() || "hc didn't answer"}`, "bad");

    cx.notify();
  });
}

/** A web forward's page in a web pane. */
export function openWeb(v: K8s, f: ForwardNote, cx: Context): void {
  run("app.open_url", { url: urlOf(f), in: "app" });
  leaveWindow(v, cx);
}

/** An ingress's host in a web pane (https when it has TLS for it). */
export function openIngress(v: K8s, row: Row, cx: Context): void {
  const host = row.status.split(" ")[0] ?? "";

  if (!host || host === "*") {
    v.say("this ingress has no host to open", "wk");

    return;
  }

  run("app.open_url", { url: `https://${host}`, in: "app" });
  leaveWindow(v, cx);
}

const LAYOUT = sharedKey("layout", isString);

/** Hands the Databases window a forward's database (the contract: its password's place, never a value). */
function sendDatabases(v: K8s, f: ForwardNote, kind: "postgres" | "mysql", picked: Picked | null, cx: AsyncContext): void {
  const args: ConnectArgs = connectArgs(f, kind, picked, v.settings.kubectl);

  if (readShared(shared, LAYOUT, "") === "nocturne") run(`nocturne.databases:${JSON.stringify(args)}`);
  else openOverlay({ mod: "databases", kind: "window", key: "databases", frame: "none", scrim: true, width: 0.88, height: 0.88, props: { connect: { ...args } } });

  leaveWindow(v, cx);
}

/** A picked secret's user and database, in words for the picker. */
function whoWords(p: Picked): string {
  const user = p.user ? `user ${p.user}` : p.userKey ? `user from ${p.userKey}` : "";
  const db = p.database ? `database ${p.database}` : p.databaseKey ? `database from ${p.databaseKey}` : "";

  return [user, db].filter(Boolean).join(" · ");
}

/** The picker: the candidates, Databases asking, another secret of the namespace by hand. */
export function credsMenu(v: K8s, f: ForwardNote, kind: "postgres" | "mysql", found: Found): MenuRow[] {
  const rows: MenuRow[] = found.candidates.map((c) => ({
    label: `secret ${c.secret} · ${c.key}`, sub: [c.why, whoWords(c)].filter(Boolean).join(" · "), go: (cx) => sendDatabases(v, f, kind, c, cx),
  }));

  rows.push({ label: "No secret: Databases asks for the password", sub: found.notes[0] ?? null, go: (cx) => sendDatabases(v, f, kind, null, cx) });

  const list = found.secrets;

  if (list?.length) rows.push({ label: "Another secret of the namespace…", sub: list.length === 1 ? "1 secret, by its key names" : `${list.length} secrets, by their key names`, go: () => {
    v.menu = { title: `the secret with ${f.name ?? f.target}'s password`, at: 0, rows: secretRows(v, f, kind, list) };
  } });

  return rows;
}

/** Every secret of the namespace with keys: the first step of naming one by hand. */
function secretRows(v: K8s, f: ForwardNote, kind: "postgres" | "mysql", list: readonly SecretKeys[]): MenuRow[] {
  return list.flatMap((s): MenuRow[] => (s.keys.length ? [{ label: s.name, sub: s.keys.join(" "), go: () => {
    const at = Math.max(0, s.keys.findIndex((k) => /pass|pwd/i.test(k)));

    v.menu = { title: `${s.name}: the key with the password`, at, rows: s.keys.map((key) => ({ label: key, go: (cx) => pickUser(v, f, kind, s, key, cx) })) };
  } }] : []));
}

/** Then the key with the user name (or none); a database key goes along when one is named so. */
function pickUser(v: K8s, f: ForwardNote, kind: "postgres" | "mysql", s: SecretKeys, key: string, cx: AsyncContext): void {
  const rest = s.keys.filter((k) => k !== key);
  const db = rest.find((k) => /^(dbname|database|db)$/i.test(k));

  const base = (userKey: string | null): Picked => {
    const p: PickedDraft = { secret: s.name, key };

    if (userKey) p.userKey = userKey;

    if (db && db !== userKey) p.databaseKey = db;

    return p;
  };

  if (!rest.length) {
    sendDatabases(v, f, kind, base(null), cx);

    return;
  }

  const at = Math.max(0, rest.findIndex((k) => /^(user|username|user-name|login)$/i.test(k)));

  v.menu = {
    title: `${s.name}: the key with the user name`, at,
    rows: [...rest.map((k) => ({ label: `user from ${k}`, go: (cx: AsyncContext) => sendDatabases(v, f, kind, base(k), cx) })), { label: "No user: the client's own", go: (cx) => sendDatabases(v, f, kind, base(null), cx) }],
  };
}

/** Opens the Databases window on a forward's database. Its password's place is looked for in the
 *  cluster first (creds.ts): one clear secret goes along; several, or `pick` (B), open the picker;
 *  none: as before, Databases asks. */
export function openDatabases(v: K8s, f: ForwardNote, kind: "postgres" | "mysql", cx: Context, pick = false): void {
  if (!v.databases) {
    v.say("the databases mod isn't installed", "wk");

    return;
  }

  v.say(`looking for ${f.name ?? f.target}'s credentials in ${f.context}/${f.namespace}…`, "wk");
  cx.spawn(async (cx) => {
    const found = await findCredentials(v.data.exec, { context: f.context, namespace: f.namespace }, f.target, kind);
    const only = found.candidates.length === 1 ? found.candidates[0] : undefined;

    if (only && !pick) {
      v.say(`password from secret ${only.secret} · ${only.key}: Databases reads it`, "ok");
      sendDatabases(v, f, kind, only, cx);
    } else if (!found.candidates.length && !pick) {
      v.say(`no credentials found in the cluster${found.notes[0] ? ` (${found.notes[0]})` : ""}: Databases asks · B picks a secret`, "wk");
      sendDatabases(v, f, kind, null, cx);
    } else {
      const n = found.candidates.length;

      v.say(n ? `${n} found: pick the one with the password` : "none found: name a secret, or let Databases ask", "ok");
      v.menu = { title: `the password for ${f.name ?? f.target} · ${found.candidates.length} found in ${f.context}/${f.namespace}`, at: 0, rows: credsMenu(v, f, kind, found) };
    }

    cx.notify();
  });
}

/** A forward's terminal floated over the tab to look at it. */
export function peekForward(f: Forward): void {
  run("terminal.peek", { terminal: f.address, float: true });
}

/** A forward's terminal given a pane beside. */
export function keepForward(v: K8s, f: Forward, cx: Context): void {
  const pane = ownPane(v);

  run("terminal.keep", pane ? { terminal: f.address, place: "right", pane } : { terminal: f.address, place: "right" });
  leaveWindow(v, cx);
}

/** Stops a forward (its terminal ends). */
export function stopForward(f: Forward): void {
  run("terminal.kill", { terminal: f.address });
}
