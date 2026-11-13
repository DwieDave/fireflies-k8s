// Asking before a write: every action that changes a cluster is an `Ask`,
// shown as a card naming the context and namespace; nothing runs until the
// person says yes. Deleting, draining, and anything in a production-looking
// context asks twice: the second time the person types the object's name. A
// context marked read-only (settings.ts) refuses writes outright.

import type { Context } from "gpui-kit";
import { looksProd } from "./contexts.ts";
import type { Settings } from "./settings.ts";

/** The writes the window can do. */
export type WriteKind = "delete" | "kill" | "scale" | "restart" | "apply" | "cordon" | "uncordon" | "drain" | "sync" | "refresh" | "rollback" | "forward";

/** A write asked about. */
export interface Ask {
  readonly kind: WriteKind;
  /** What the card says it does ("Delete pod lantern-api-…"). */
  readonly title: string;
  readonly context: string;
  readonly namespace: string | null;
  /** The object's name: typed to confirm the second step. */
  readonly name: string;
  /** Extra lines (what goes with it: a deployment's pods, a drain's evictions). */
  readonly detail: readonly string[];
  /** The kubectl arguments (and only these) it runs. */
  readonly args: readonly string[];
  /** 1: the first card; 2: the typed-name step. */
  readonly step: 1 | 2;
  /** What's typed so far at step 2. */
  readonly typed: string;
  /** What runs instead of kubectl (a forward starts its terminal). */
  readonly go: ((cx: Context) => void) | null;
}

const TWICE: ReadonlySet<WriteKind> = new Set(["delete", "kill", "drain"]);

/** A port-forward reads, it doesn't write: it asks only in a production-looking context. */
const READS: ReadonlySet<WriteKind> = new Set(["forward"]);

/** Why the write can't run here, or null. */
export function refusal(kind: WriteKind, context: string, s: Settings): string | null {
  if (READS.has(kind)) return null;

  return s.readonly.has(context) ? `${context} is read-only (k8s/settings.json): the window doesn't write to it` : null;
}

/** Whether a write asks a second time (typing the name). */
export function asksTwice(kind: WriteKind, context: string, cluster: string, s: Settings): boolean {
  return TWICE.has(kind) || looksProd({ name: context, cluster }, s.prod);
}

/** Whether a kind asks at all (a forward in a quiet context doesn't). */
export function asks(kind: WriteKind, context: string, cluster: string, s: Settings): boolean {
  return !READS.has(kind) || looksProd({ name: context, cluster }, s.prod);
}

/** What a key press does to the card: "yes" runs (or goes to step 2), "no" closes it, "type" edits the name. */
export type AskStep = { readonly act: "run" } | { readonly act: "next" } | { readonly act: "cancel" } | { readonly act: "typed"; readonly typed: string } | { readonly act: "none" };

/** A key on the card: y / enter yes, n / esc no; at step 2 the name is typed and enter runs only when it matches. */
export function askKey(a: Ask, twice: boolean, key: string, char: string | null): AskStep {
  if (key === "escape") return { act: "cancel" };

  if (a.step === 1) {
    if (key === "y" || key === "enter") return twice ? { act: "next" } : { act: "run" };

    if (key === "n") return { act: "cancel" };

    return { act: "none" };
  }

  if (key === "enter") return a.typed === a.name ? { act: "run" } : { act: "none" };

  if (key === "backspace") return { act: "typed", typed: a.typed.slice(0, -1) };

  if (char && char.length === 1 && char >= " ") return { act: "typed", typed: a.typed + char };

  return { act: "none" };
}

/** Where the card says it acts: "nightjar-dev / lantern". */
export function whereOf(a: Pick<Ask, "context" | "namespace">): string {
  return a.namespace ? `${a.context} / ${a.namespace}` : `${a.context} (cluster-wide)`;
}
