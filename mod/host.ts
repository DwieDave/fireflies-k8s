// Window or pane (the pattern every window mod follows): the copy is a
// window when its props carry `overlay`, a pane otherwise (props `{ slot,
// ...opening args }`). This file holds what differs: the opening args and
// what a copy starts from (the move's handover note, a pane's own kept state,
// the last state), the window's beat note, the move between the two (ctrl-t,
// ◧ / ⧉), opening another copy (`k8s.open:{"as": …}`), and closing.

import type { AsyncContext, Context } from "gpui-kit";
import type { Props } from "gpui-shell";
import { closeOverlay, focused, openOverlay, panes, props, run, setShared, shared } from "herdr";
import type { default as K8s } from "./main.ts";
import { isBoolean, isString, literal, object, parseJson, readShared, writeShared } from "./guard.ts";
import type { Guarded } from "./guard.ts";
import { maybe } from "./guards.ts";
import { isBuiltin, kindFor } from "./kinds.ts";
import type { KindRef } from "./kinds.ts";
import type { Handover } from "./state.ts";
import { FRESH, HANDOVER, KEPT, WINDOW, isDetailView, isHandover } from "./state.ts";
import { listKey, selectedRow, setTab, showRef } from "./nav.ts";
import { pressKeys } from "./input.ts";

/** The opening args another mod or a person can give (props, `k8s.open`, `k8s.show`). */
export const isOpening = object({}, {
  context: maybe(isString), namespace: maybe(isString), kind: maybe(isString), name: maybe(isString),
  view: maybe(literal("graph", "describe", "yaml", "events", "logs", "argo", "forwards")),
  // The window over the whole app instead of 0.88 of it (pictures that show the mod alone).
  full: maybe(isBoolean),
});

export type Opening = Guarded<typeof isOpening>;

const isHostProps = object({}, { overlay: maybe(isString), slot: maybe(isString) });

/** What the host told this copy. */
export interface HostProps extends Opening {
  readonly overlay: string | null;
  readonly slot: string | null;
}

export function hostProps(p: Props | undefined): HostProps {
  const given: unknown = props() ?? p ?? {};
  const h = isHostProps(given) ? given : {};
  const o = isOpening(given) ? given : {};

  return { ...o, overlay: h.overlay ?? null, slot: h.slot ?? null };
}

/** The window's overlay spec (as mod.json's, which `mod.open:k8s` opens). */
export const WINDOW_SPEC = { mod: "k8s", kind: "window", key: "k8s", frame: "none", scrim: true, width: 0.88, height: 0.88, resizable: { min: [520, 360] } } as const;

const STORE = "k8s.copy";

/** Where a copy starts: the handover note (a move, under 5 s old), its opening args, a pane's
 *  own state (its slot's localStorage), the last state any copy kept. */
export function takeOpening(v: K8s): void {
  const kept = readShared(shared, KEPT, null);

  if (kept) {
    v.context = kept.context;
    v.namespace = kept.namespace;
    v.kind = asKind(kept.kind) ?? v.kind;
    v.tab = kept.tab ?? v.tab;
    v.detail = kept.detail ?? v.detail;
  }

  const own = v.props.slot ? parseJson(storeGet(), isHandover) : undefined;

  if (own) apply(v, own);

  const h = readShared(shared, HANDOVER, null);

  if (h && Date.now() - h.at < 5000) {
    apply(v, h);
    writeShared(setShared, HANDOVER, null);
  }

  const p = v.props;

  if (p.context) v.context = p.context;

  if (p.namespace) v.namespace = p.namespace;

  const k = p.kind ? asKind(p.kind) : null;

  if (k) v.kind = k;

  if (p.view === "argo" || p.view === "forwards") v.tab = p.view;
  else if (p.view && isDetailView(p.view)) v.detail = p.view;
}

const isCustomRef = (k: string): k is `custom:${string}` => k.startsWith("custom:");

function asKind(k: string): KindRef | null {
  return isBuiltin(k) ? k : isCustomRef(k) ? k : kindFor(k);
}

function apply(v: K8s, h: Handover): void {
  if (h.context) v.context = h.context;

  if (h.namespace) v.namespace = h.namespace === "*" ? null : h.namespace;

  v.kind = asKind(h.kind) ?? v.kind;

  if (h.tab) v.tab = h.tab;

  if (h.detail) v.detail = h.detail;

  if (h.filter) v.filter = h.filter;

  if (h.app) v.app = h.app;

  if (h.row) v.sel.set(listKey(v), h.row);
}

/** This copy as a handover note (no secret: names, a filter and a row key). */
function note(v: K8s): Handover {
  return { at: Date.now(), kind: v.kind, tab: v.tab, detail: v.detail, filter: v.filter, context: v.context, namespace: v.namespace ?? "*", row: selectedRow(v)?.key ?? null, app: v.app };
}

function storeGet(): string {
  try {
    return localStorage.getItem(STORE) ?? "";
  } catch {
    return "";
  }
}

/** Keeps this copy's state: the last state for the next opening, and a pane's own (per slot). */
export function saveCopy(v: K8s): void {
  writeShared(setShared, KEPT, { context: v.context, namespace: v.namespace, kind: v.kind, tab: v.tab, detail: v.detail });

  if (!v.props.slot) return;

  try {
    localStorage.setItem(STORE, JSON.stringify(note(v)));
  } catch {
    // A pane comes back without its selection; nothing else is lost.
  }
}

/** The window says it's open (commands go to it first). */
export function beat(v: K8s): void {
  if (v.props.overlay && !v.closed) writeShared(setShared, WINDOW, { id: v.props.overlay, beat: Date.now() });
}

/** The open window's id, if one is open. */
function windowOpen(): string | null {
  const w = readShared(shared, WINDOW, null);

  return w && Date.now() - w.beat < FRESH ? w.id : null;
}

/** This pane's id (a mod isn't told it: found by its slot). */
export function ownPane(v: K8s): string | null {
  const slot = v.props.slot;

  if (!slot) return null;

  const isSlot = object({ slot: isString });

  return panes().find((p) => p.mod === "k8s" && isSlot(p.props) && p.props.slot === slot)?.pane ?? null;
}

/** Whether this copy answers a command: the window when one is open, else the focused pane. */
export function answers(v: K8s): boolean {
  const w = windowOpen();

  if (w) return v.props.overlay === w;

  const own = ownPane(v);

  return own !== null && focused()?.pane === own;
}

export const newSlot = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Opens another copy: as a pane beside the focused one, a tab, or the window. */
export function openAs(as: "pane" | "tab" | "window", o: Opening, besidePane: string | null = null): void {
  const args: { [key: string]: string } = {};

  for (const k of ["context", "namespace", "kind", "name", "view"] as const) {
    const val = o[k];

    if (val) args[k] = val;
  }

  if (as === "window") {
    const open = windowOpen();

    if (open) closeOverlay(open);

    const size = o.full ? 1 : WINDOW_SPEC.width;

    openOverlay({ ...WINDOW_SPEC, width: size, height: size, resizable: { min: [520, 360] }, props: args });

    return;
  }

  const p = { slot: newSlot(), ...args };

  if (as === "tab") run("tab.new", { name: "Kubernetes", mod: "k8s", props: p });
  else run("pane.split", besidePane ? { direction: "auto", pane: besidePane, mod: "k8s", props: p } : { direction: "auto", mod: "k8s", props: p });
}

/** Moves this copy: a window into a pane, a pane out to the window. The old copy goes 300 ms
 *  later (closed in the same turn, the new copy's first tasks would go with it). */
export function move(v: K8s, cx: Context): void {
  saveCopy(v);
  writeShared(setShared, HANDOVER, note(v));

  if (v.inWindow()) {
    openAs("pane", {});
    cx.timer.after(300, () => closeWindow(v));

    return;
  }

  const pane = ownPane(v);

  openAs("window", {});

  if (pane) cx.timer.after(300, () => run("pane.close", { pane }));
}

/** Closes the window (a pane is closed by its own header, never by esc). */
export function closeWindow(v: K8s): void {
  if (!v.props.overlay) return;

  saveCopy(v);
  writeShared(setShared, WINDOW, null);
  closeOverlay(v.props.overlay);
}

/** q: closes this copy: the window, or its own pane (found by its slot). */
export function closeCopy(v: K8s): void {
  if (v.inWindow()) {
    closeWindow(v);

    return;
  }

  const pane = ownPane(v);

  saveCopy(v);

  if (pane) run("pane.close", { pane });
}

/** A command (`k8s.<name>[:arg]`): only the copy that answers acts. */
export function command(v: K8s, c: string, cx: AsyncContext): void {
  if (!answers(v)) return;

  const [name, ...rest] = c.split(":");
  const arg = rest.join(":");

  if (name === "to-pane" || name === "to-window") {
    if ((name === "to-pane") === v.inWindow()) move(v, cx);
  } else if (name === "keys") v.help = !v.help;
  else if (name === "refresh") v.data.refresh();
  else if (name === "open") openCommand(arg, v);
  else if (name === "show") showCommand(v, arg);
  else if (name === "press") pressKeys(v, arg.split(/\s+/).filter(Boolean), cx);
}

/** `k8s.open:pane|tab|window` or `k8s.open:{"as": …, …opening}`. */
function openCommand(arg: string, v: K8s): void {
  const isAs = literal("pane", "tab", "window");

  if (isAs(arg)) {
    openAs(arg, {}, ownPane(v));

    return;
  }

  const o = parseJson(arg, object({}, { as: maybe(isAs) }));
  const opening = parseJson(arg, isOpening) ?? {};

  openAs(o?.as ?? "pane", opening, ownPane(v));
}

/** `k8s.show:{context?, namespace?, kind?, name?, view?}`: this copy shows it. */
function showCommand(v: K8s, arg: string): void {
  const o = parseJson(arg, isOpening);

  if (!o) return;

  if (o.context) v.context = o.context;

  if (o.view === "argo" || o.view === "forwards") {
    setTab(v, o.view);

    if (o.name) v.app = o.name;

    return;
  }

  const k = o.kind ? asKind(o.kind) : null;

  if (k) showRef(v, k, o.name ?? "", o.namespace ?? v.namespace);
}
