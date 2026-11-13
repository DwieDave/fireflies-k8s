// A table row: what one object shows in the kind's table, its colour, and
// what the window needs to act on it. rows-kinds.ts builds them per kind;
// this file holds the shared parts (tones, cells, pods' state words).

import type { KindRef } from "./kinds.ts";
import type { ContainerState, ContainerStatus, Meta, Pod } from "./objects.ts";
import { instant, RECENT } from "./time.ts";

/** A colour by meaning: running / healthy, on its way, failing, scaled away or neutral,
 *  finished, missing (Argo's). */
export type Tone = "ok" | "wk" | "bad" | "off" | "done" | "miss";

/** What a row points at: enough to name it to kubectl. */
export interface Ref {
  readonly kind: KindRef;
  readonly name: string;
  readonly namespace: string | null;
}

/** One table cell. */
export type Cell =
  | { readonly t: "text"; readonly text: string; readonly tone?: Tone | null; readonly dim?: boolean }
  | { readonly t: "ready"; readonly blocks: readonly Tone[]; readonly text: string }
  | { readonly t: "marks"; readonly count: number; readonly recent: boolean }
  | { readonly t: "metric"; readonly what: "cpu" | "mem"; readonly pods: readonly string[] }
  | { readonly t: "age"; readonly at: number | null };

/** A container as the pod row knows it. */
export interface ContainerFact {
  readonly name: string;
  readonly image: string;
  readonly ready: boolean;
  readonly restarts: number;
  readonly state: string;
  readonly tone: Tone;
  readonly ports: readonly PortFact[];
}

/** A port a pod's container or a service offers. */
export interface PortFact {
  readonly port: number;
  readonly name: string | null;
  /** A service port's target, when it differs. */
  readonly target?: number | string | null;
}

/** What a pod row carries for logs, shells and forwards. */
export interface PodFacts {
  readonly node: string | null;
  readonly containers: readonly ContainerFact[];
  readonly owner: { readonly kind: string; readonly name: string; readonly uid: string | null } | null;
  readonly ip: string | null;
}

/** One row of a kind's table. */
export interface Row {
  /** Stable across polls: the object's uid, else namespace/name. */
  readonly key: string;
  readonly ref: Ref;
  readonly uid: string | null;
  readonly tone: Tone;
  readonly status: string;
  readonly created: number | null;
  readonly cells: readonly Cell[];
  readonly labels: ReadonlyMap<string, string>;
  readonly pod?: PodFacts;
  /** Ports a forward can reach (a service's or a pod's). */
  readonly ports?: readonly PortFact[];
  /** Images, for guessing a database from a forward. */
  readonly images?: readonly string[];
}

/** A row's stable key. */
export function keyOf(meta: Meta, kind: KindRef): string {
  return meta.uid ?? `${kind}/${meta.namespace ?? ""}/${meta.name}`;
}

/** The labels as a Map. */
export function labelsOf(meta: Meta): ReadonlyMap<string, string> {
  return new Map(Object.entries(meta.labels ?? {}).flatMap(([k, v]) => (v === undefined ? [] : [[k, v]])));
}

const BAD_WAITING = new Set(["CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull", "CreateContainerConfigError", "CreateContainerError", "InvalidImageName", "RunContainerError", "OOMKilled", "Error"]);

/** A status word (kubectl's STATUS column) and its colour. */
export interface StateWord {
  readonly word: string;
  readonly tone: Tone;
}

/** A pod's restarts: how many, and whether the last was within the hour. */
export interface Restarts {
  readonly count: number;
  readonly recent: boolean;
}

/** A container state's word (kubectl's STATUS) and colour. */
export function stateWord(state: ContainerState | null | undefined): StateWord {
  if (state?.waiting) {
    const reason = state.waiting.reason ?? "Waiting";

    return { word: reason, tone: BAD_WAITING.has(reason) ? "bad" : "wk" };
  }

  if (state?.terminated) {
    const reason = state.terminated.reason ?? "Terminated";

    return { word: reason, tone: reason === "Completed" || state.terminated.exitCode === 0 ? "done" : "bad" };
  }

  if (state?.running) return { word: "Running", tone: "ok" };

  return { word: "Unknown", tone: "off" };
}

/** A pod's word and colour, as kubectl's STATUS column reads them. */
export function podState(p: Pod): StateWord {
  if (p.metadata.deletionTimestamp) return { word: "Terminating", tone: "wk" };

  const statuses = p.status?.containerStatuses ?? [];
  const inits = p.status?.initContainerStatuses ?? [];
  const initBad = inits.map((s) => stateWord(s.state)).find((s) => s.tone === "bad" || s.tone === "wk");

  if (initBad) return { word: `Init:${initBad.word}`, tone: initBad.tone };

  const worst = statuses.map((s) => stateWord(s.state)).find((s) => s.tone === "bad")
    ?? statuses.map((s) => stateWord(s.state)).find((s) => s.tone === "wk");

  if (worst) return worst;

  const phase = p.status?.phase ?? "Unknown";

  if (phase === "Succeeded") return { word: "Completed", tone: "done" };

  if (phase === "Failed") return { word: p.status?.reason ?? "Failed", tone: "bad" };

  if (phase === "Pending") return { word: "Pending", tone: "wk" };

  if (phase === "Running") return statuses.every((s) => s.ready) ? { word: "Running", tone: "ok" } : { word: "Running", tone: "wk" };

  return { word: phase, tone: "off" };
}

/** The pod's restarts: their count and whether the last was within the hour. */
export function restartsOf(statuses: readonly ContainerStatus[], now: number): Restarts {
  const count = statuses.reduce((n, s) => n + (s.restartCount ?? 0), 0);
  const last = Math.max(0, ...statuses.map((s) => instant(s.lastState?.terminated?.finishedAt) ?? 0));

  return { count, recent: count > 0 && now - last < RECENT };
}

/** The pod's containers, each with its state, ports and restarts. */
export function containersOf(p: Pod): readonly ContainerFact[] {
  const statuses = new Map((p.status?.containerStatuses ?? []).map((s) => [s.name, s]));

  return (p.spec?.containers ?? []).map((c) => {
    const s = statuses.get(c.name);
    const st = stateWord(s?.state);

    return {
      name: c.name, image: c.image ?? s?.image ?? "", ready: s?.ready ?? false, restarts: s?.restartCount ?? 0, state: st.word, tone: st.tone,
      ports: (c.ports ?? []).map((x) => ({ port: x.containerPort, name: x.name ?? null })),
    };
  });
}

/** A pod's facts for its row. */
export function podFacts(p: Pod): PodFacts {
  const owner = (p.metadata.ownerReferences ?? []).find((o) => o.controller) ?? p.metadata.ownerReferences?.[0] ?? null;

  return {
    node: p.spec?.nodeName ?? null,
    containers: containersOf(p),
    owner: owner ? { kind: owner.kind, name: owner.name, uid: owner.uid ?? null } : null,
    ip: p.status?.podIP ?? null,
  };
}

/** n blocks of `tone`, then the rest up to `of` hollow: a workload's replicas. */
export function replicaBlocks(ready: number, of: number, wanting: Tone = "bad"): readonly Tone[] {
  const shown = Math.min(Math.max(of, ready), 12);

  return Array.from({ length: shown }, (_, i): Tone => (i < ready ? "ok" : wanting));
}

/** A text cell. */
export const text = (value: string, tone: Tone | null = null, dim = false): Cell => ({ t: "text", text: value, tone, dim });
