// The writes, each as the exact kubectl arguments it runs, asked about first
// (confirm.ts): what the card says, where, and the name typed at its second
// step. `request` refuses in a read-only context, asks, or (a forward in a
// quiet context) runs; `runAsk` runs what was said yes to.

import type { Context } from "gpui-kit";
import type { default as K8s } from "./main.ts";
import type { Ask, WriteKind } from "./confirm.ts";
import { asks, refusal } from "./confirm.ts";
import { errorOf } from "./kubectl.ts";
import { resourceOf, titleOf } from "./kinds.ts";
import type { Row } from "./rows.ts";

/** The context's cluster (the prod check reads both names). */
export function clusterOf(v: K8s): string {
  return v.data.contexts.value?.find((c) => c.name === v.context)?.cluster ?? v.context ?? "";
}

/** A write to ask about. */
export interface WriteSpec {
  readonly kind: WriteKind;
  readonly title: string;
  readonly name: string;
  readonly namespace: string | null;
  readonly args: readonly string[];
  readonly detail?: readonly string[];
  /** What runs instead of kubectl (a forward starts a terminal). */
  readonly go?: ((cx: Context) => void) | null;
  /** Another context than the shown one (an edit made earlier). */
  readonly context?: string;
}

/** Asks about a write (or refuses it, or runs a forward that needn't ask). */
export function request(v: K8s, w: WriteSpec, cx: Context): void {
  const context = w.context ?? v.context ?? "";
  const no = refusal(w.kind, context, v.settings);

  if (no) {
    v.say(no, "wk");

    return;
  }

  const ask: Ask = { kind: w.kind, title: w.title, context, namespace: w.namespace, name: w.name, detail: w.detail ?? [], args: w.args, step: 1, typed: "", go: w.go ?? null };

  if (asks(w.kind, context, clusterOf(v), v.settings)) v.ask = ask;
  else runAsk(v, ask, cx);
}

/** Runs a write said yes to, and says how it went. */
export function runAsk(v: K8s, a: Ask, cx: Context): void {
  v.ask = null;

  if (a.go) {
    a.go(cx);

    return;
  }

  v.say(`${a.title}…`, "wk");
  cx.spawn(async (cx) => {
    try {
      const r = await v.data.exec(a.args, 60000);

      v.say(r.code === 0 ? (r.stdout.trim().split("\n")[0] ?? "done") : `${a.title}: ${errorOf(r)}`, r.code === 0 ? "ok" : "bad");
    } catch (cause: unknown) {
      v.say(`${a.title}: ${cause instanceof Error ? cause.message : String(cause)}`, "bad");
    }

    v.data.refresh();
    cx.notify();
  });
}

/** --context and -n for a row. */
function where(v: K8s, row: Row): string[] {
  const ns = row.ref.namespace;

  return ["--context", v.context ?? "", ...(ns ? ["-n", ns] : [])];
}

const what = (row: Row): string => `${titleOf(row.ref.kind).replace(/s$/, "").toLowerCase()} ${row.ref.name}`;

export function deleteSpec(v: K8s, row: Row, owned: number): WriteSpec {
  const detail = owned ? [`its ${owned} pod${owned === 1 ? "" : "s"} go with it`] : [];

  return { kind: "delete", title: `Delete ${what(row)}`, name: row.ref.name, namespace: row.ref.namespace, args: [...where(v, row), "delete", resourceOf(row.ref.kind), row.ref.name], detail };
}

export function killSpec(v: K8s, row: Row): WriteSpec {
  return { kind: "kill", title: `Kill pod ${row.ref.name} now (no grace period)`, name: row.ref.name, namespace: row.ref.namespace, args: [...where(v, row), "delete", "pods", row.ref.name, "--grace-period=0", "--force"], detail: ["its controller starts a new one, if it has one"] };
}

export function scaleSpec(v: K8s, row: Row, replicas: number): WriteSpec {
  return { kind: "scale", title: `Scale ${what(row)} to ${replicas}`, name: row.ref.name, namespace: row.ref.namespace, args: [...where(v, row), "scale", `${resourceOf(row.ref.kind)}/${row.ref.name}`, `--replicas=${replicas}`] };
}

export function restartSpec(v: K8s, row: Row): WriteSpec {
  return { kind: "restart", title: `Restart ${what(row)}`, name: row.ref.name, namespace: row.ref.namespace, args: [...where(v, row), "rollout", "restart", `${resourceOf(row.ref.kind)}/${row.ref.name}`], detail: ["a rolling restart: new pods come up before the old ones go"] };
}

export function nodeSpec(v: K8s, row: Row, kind: "cordon" | "uncordon" | "drain"): WriteSpec {
  const extra = kind === "drain" ? ["--ignore-daemonsets", "--delete-emptydir-data", "--timeout=120s"] : [];
  const detail = kind === "drain" ? ["evicts every pod on it (daemon sets' stay); emptyDir data is lost"] : kind === "cordon" ? ["no new pods are scheduled on it"] : [];

  return { kind, title: `${kind.charAt(0).toUpperCase()}${kind.slice(1)} node ${row.ref.name}`, name: row.ref.name, namespace: null, args: ["--context", v.context ?? "", kind, row.ref.name, ...extra], detail };
}

export function applySpec(context: string, row: Row, path: string): WriteSpec {
  const ns = row.ref.namespace;

  return { kind: "apply", context, title: `Apply your edit of ${what(row)}`, name: row.ref.name, namespace: ns, args: ["--context", context, ...(ns ? ["-n", ns] : []), "replace", "-f", path], detail: ["kubectl replace: refused if it changed in the cluster since you opened it"] };
}
