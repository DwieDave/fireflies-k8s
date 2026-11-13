// The key handler: the modes first (the keys overview, the ask card, a menu,
// a line being typed), then the window's own keys, then the shown tab's and
// panel's (input-tabs.ts). Every key the window takes stops there; cmd chords
// go on to the app.

import type { Context, KeyEvent } from "gpui-kit";
import type { default as K8s } from "./main.ts";
import { keysKey } from "./keyhelp.ts";
import { askKey, asksTwice } from "./confirm.ts";
import { pressName } from "./keys.ts";
import { kindCompletions, kindFor } from "./kinds.ts";
import { customOfCluster } from "./derive.ts";
import { drillBack, namespaceByNumber, selectedRow, setKind, setNamespace, setTab, stepTab } from "./nav.ts";
import { closeCopy, closeWindow, move } from "./host.ts";
import { clusterOf, request, runAsk, scaleSpec } from "./writes.ts";
import { contextMenu, kindMenu } from "./menus.ts";
import { paceMenu } from "./metrics-pace.ts";
import { argoKey, forwardsKey, resourcesKey } from "./input-tabs.ts";

export function onKey(v: K8s, e: KeyEvent, cx: Context): void {
  const name = pressName(e);

  if (name === null) return;

  if (handled(v, e, name, cx)) {
    cx.stop_propagation();
    cx.notify();
  }
}

/** Names for characters a command line can't carry well (`k8s.press:colon d e p l o y enter`). */
const SPELLED: ReadonlyMap<string, string> = new Map([["colon", ":"], ["slash", "/"], ["question", "?"], ["bracketleft", "["], ["bracketright", "]"]]);

/** Keys by name, one after another (`k8s.press:j j enter`, `k8s.press:ctrl-d`): what a script or a demo types.
 *  A single character stands for itself; `space` is a space; `colon`, `slash`, `question`,
 *  `bracketleft`, `bracketright` are : / ? [ ]. */
export function pressKeys(v: K8s, names: readonly string[], cx: Context): void {
  for (const spelled of names) {
    const name = SPELLED.get(spelled) ?? spelled;
    const ch = name === "space" ? " " : name.length === 1 ? name : undefined;
    const modifiers = { control: name.startsWith("ctrl-"), alt: false, shift: name.length === 1 && name !== name.toLowerCase(), platform: false, function: false };
    const key = name.replace(/^ctrl-/, "");
    const e: KeyEvent = ch === undefined ? { key, keystroke: name, modifiers } : { key, keystroke: name, modifiers, key_char: ch };

    handled(v, e, name, cx);
  }
}

/** Whether the window took the key. */
function handled(v: K8s, e: KeyEvent, name: string, cx: Context): boolean {
  if (v.help) {
    const k = keysKey(e, true);

    if (k || name === "enter") v.help = false;

    return true;
  }

  if (v.ask) return askStep(v, name, e.key_char ?? null, cx);

  if (v.menu) return menuKey(v, name, cx);

  if (v.typing) return typingKey(v, name, e.key_char ?? null, cx);

  if (windowKey(v, name, cx)) return true;

  switch (v.tab) {
    case "resources": return resourcesKey(v, name, cx);
    case "argo": return argoKey(v, name, cx);
    case "forwards": return forwardsKey(v, name, cx);
    default: return false;
  }
}

function askStep(v: K8s, name: string, ch: string | null, cx: Context): boolean {
  const a = v.ask;

  if (!a) return false;

  const step = askKey(a, asksTwice(a.kind, a.context, clusterOf(v), v.settings), name, ch);

  if (step.act === "run") runAsk(v, a, cx);
  else if (step.act === "next") v.ask = { ...a, step: 2 };
  else if (step.act === "cancel") v.ask = null;
  else if (step.act === "typed") v.ask = { ...a, typed: step.typed };

  return true;
}

function menuKey(v: K8s, name: string, cx: Context): boolean {
  const m = v.menu;

  if (!m) return false;

  if (name === "escape" || name === "q") v.menu = null;
  else if (name === "j" || name === "down" || name === "ctrl-n") m.at = Math.min(m.rows.length - 1, m.at + 1);
  else if (name === "k" || name === "up" || name === "ctrl-p") m.at = Math.max(0, m.at - 1);
  else if (name === "enter") pickMenu(v, m.at, cx);
  else if (/^[1-9]$/.test(name)) pickMenu(v, Number(name) - 1, cx);
  else {
    // A row's own key (the right-click menu lists them) runs it.
    const i = m.rows.findIndex((r) => r.key === name);

    if (i >= 0) pickMenu(v, i, cx);
  }

  return true;
}

export function pickMenu(v: K8s, i: number, cx: Context): void {
  const row = v.menu?.rows[i];

  v.menu = null;
  row?.go(cx);
}

function typingKey(v: K8s, name: string, ch: string | null, cx: Context): boolean {
  const t = v.typing;

  if (!t) return false;

  if (name === "escape") {
    if (t.what === "filter") v.filter = "";

    v.typing = null;

    return true;
  }

  if (name === "enter") {
    v.typing = null;
    submitTyped(v, t.what, t.text, cx);

    return true;
  }

  if (name === "tab" && t.what === "kind") {
    const first = kindCompletions(t.text, customOfCluster(v.data))[0];

    if (first) v.typing = { what: "kind", text: first.replace(/^custom:/, "") };

    return true;
  }

  const text = name === "backspace" ? t.text.slice(0, -1) : ch && ch.length === 1 && ch >= " " ? t.text + ch : null;

  if (text === null) return true;

  if (t.what === "scale" && !/^\d{0,4}$/.test(text)) return true;

  v.typing = { what: t.what, text };

  if (t.what === "filter") v.filter = text;

  return true;
}

/** What a finished line does: a kind for `:`, a filter for `/` (kept), a scale. */
function submitTyped(v: K8s, what: "kind" | "filter" | "scale", text: string, cx: Context): void {
  if (what === "filter") return;

  if (what === "scale") {
    const row = selectedRow(v);
    const n = Number(text);

    if (row && text !== "" && Number.isInteger(n)) request(v, scaleSpec(v, row, n), cx);

    return;
  }

  colonCommand(v, text.trim().toLowerCase());
}

/** `:` takes a kind, and k9s's few views: ctx, ns, pf (forwards), argo, q. */
export function colonCommand(v: K8s, word: string): void {
  if (word === "ctx" || word === "context" || word === "contexts") v.menu = contextMenu(v);
  else if (word === "pf" || word === "forwards" || word === "portforwards") setTab(v, "forwards");
  else if (word === "argo" || word === "argocd") setTab(v, "argo");
  else if (word === "q" || word === "quit") closeWindow(v);
  else {
    const k = kindFor(word, customOfCluster(v.data));

    if (k) {
      setTab(v, "resources");
      setKind(v, k);
      v.panel = "table";
    } else v.say(`no kind called "${word}" (tab completes)`, "wk");
  }
}

/** The keys that work in every tab. */
function windowKey(v: K8s, name: string, cx: Context): boolean {
  switch (name) {
    case ":": v.typing = { what: "kind", text: "" };

 return true;
    case "?": v.help = true;

 return true;
    case "[": stepTab(v, -1);

 return true;
    case "]": stepTab(v, 1);

 return true;
    case "M": v.menu = paceMenu(v);

 return true;
    case "ctrl-a": v.menu = kindMenu(v);

 return true;
    case "ctrl-t": move(v, cx);

 return true;
    case "f": if (v.tab === "forwards") return false; setTab(v, "forwards");

 return true;
    case "escape": return escape(v);
    case "q": closeCopy(v);

 return true;
    default: break;
  }

  if (/^[0-9]$/.test(name) && v.tab !== "forwards") {
    const ns = namespaceByNumber(v, Number(name));

    if (ns !== undefined) {
      setNamespace(v, ns);
      setTab(v, "resources");
    }

    return true;
  }

  return false;
}

/** esc backs out one step: a filter, a drill-in, the detail panel, another tab; at the top a window closes (a pane never). */
function escape(v: K8s): boolean {
  if (v.filter) v.filter = "";
  else if (drillBack(v)) return true;
  else if (v.tab === "resources" && v.panel !== "table") v.panel = "table";
  else if (v.tab !== "resources") setTab(v, "resources");
  else if (v.inWindow()) closeWindow(v);

  return true;
}
