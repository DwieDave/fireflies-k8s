// Where the window's rows lead in the rest of the app: a pod's shell and logs
// as terminals in panes (not inside the window), port-forwards as terminals
// of their own, a forward's page in a web pane, a database forward in the
// Databases window (only when that mod is installed), an ingress's host in a
// web pane. From a window, opening beside closes the window (the pane it
// opened is where the person goes next); from a pane, it opens beside it.

import type { Context } from "gpui-kit";
import { closeOverlay, hc, openOverlay, run, shared } from "herdr";
import type { default as K8s } from "./main.ts";
import { isString, readShared, sharedKey } from "./guard.ts";
import type { PortFact, Row } from "./rows.ts";
import type { ConnectArgs, Forward, ForwardNote } from "./forwards.ts";
import { connectArgs, forwardsIn, localPort, noteFor, startArgs, urlOf } from "./forwards.ts";
import { ownPane, saveCopy } from "./host.ts";
import { resourceOf } from "./kinds.ts";
import { terminals } from "herdr";

/** Leaves the window for what it opened beside (a pane keeps its place). */
function leaveWindow(v: K8s, cx: Context): void {
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

/** Opens the Databases window on a forward's database (the contract: no secret in the args). */
export function openDatabases(v: K8s, f: ForwardNote, kind: "postgres" | "mysql", cx: Context): void {
  if (!v.databases) {
    v.say("the databases mod isn't installed", "wk");

    return;
  }

  const args: ConnectArgs = connectArgs(f, kind);

  if (readShared(shared, LAYOUT, "") === "nocturne") run(`nocturne.databases:${JSON.stringify(args)}`);
  else openOverlay({ mod: "databases", kind: "window", key: "databases", frame: "none", scrim: true, width: 0.88, height: 0.88, props: { connect: { ...args } } });

  leaveWindow(v, cx);
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
