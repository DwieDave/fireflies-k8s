// The window's state types and its kept records: what a copy shows (tab,
// context, namespace, kind, panel, selection, filter), what it remembers for
// the next opening (`k8s.state`), and the one-shot note a move between window
// and pane carries (`k8s.handover`). No secret is ever in either.

import type { Guarded } from "./guard.ts";
import { isNumber, isString, literal, nullable, object, sharedKey } from "./guard.ts";
import { maybe } from "./guards.ts";
import type { Context } from "gpui-kit";
import type { Tone } from "./rows.ts";

export const isTab = literal("resources", "argo", "forwards");

export type Tab = Guarded<typeof isTab>;

export const TABS: readonly (readonly [Tab, string])[] = [["resources", "Resources"], ["argo", "Argo CD"], ["forwards", "Forwards"]];

/** The resources tab's panels, left to right. */
export type Panel = "rail" | "table" | "detail";

export const isDetailView = literal("graph", "describe", "yaml", "events");

/** What the detail panel shows of the selected row. */
export type DetailView = Guarded<typeof isDetailView>;

/** The Argo tab's panels. */
export type ArgoPanel = "apps" | "tree" | "side";

/** A line being typed at the foot: a kind for `:`, a filter for `/`, a number for scale. */
export interface Typing {
  readonly what: "kind" | "filter" | "scale";
  readonly text: string;
}

/** A menu over the window (right-click, a picker): rows, the cursor. */
export interface MenuRow {
  readonly label: string;
  readonly sub?: string | null;
  readonly key?: string | null;
  readonly danger?: boolean;
  readonly go: (cx: Context) => void;
}

export interface Menu {
  readonly title: string;
  readonly rows: readonly MenuRow[];
  at: number;
}

/** A word in the key bar for a few seconds (a write ran, a forward started). */
export interface Note {
  readonly text: string;
  readonly tone: Tone;
  readonly at: number;
}

/** k9s's drill-in: a kind's rows narrowed to what one object owns (a deployment's pods). */
export interface Drill {
  readonly kind: "pods";
  readonly uid: string;
  readonly label: string;
  /** The kind and row it was opened from (esc goes back there). */
  readonly from: string;
  readonly fromRow: string | null;
}

/** What the next opening starts from (shared: every copy writes it as it changes). */
export const isKept = object({ context: nullable(isString), namespace: nullable(isString), kind: isString }, { tab: maybe(isTab), detail: maybe(isDetailView) });

export type Kept = Guarded<typeof isKept>;

export const KEPT = sharedKey("k8s.state", nullable(isKept));

/** The one-shot note a move between window and pane carries (taken within 5 s). */
export const isHandover = object({ at: isNumber, kind: isString }, {
  context: maybe(isString), namespace: maybe(isString), tab: maybe(isTab), detail: maybe(isDetailView), row: maybe(isString), filter: maybe(isString), app: maybe(isString),
});

export type Handover = Guarded<typeof isHandover>;

export const HANDOVER = sharedKey("k8s.handover", nullable(isHandover));

/** The window's note that it's open, renewed every few seconds (commands go to it first). */
export const WINDOW = sharedKey("k8s.window", nullable(object({ id: isString, beat: isNumber })));

/** How fresh a window note must be to count. */
export const FRESH = 10000;
