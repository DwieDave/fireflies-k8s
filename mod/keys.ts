// The keys: k9s's where they fit. One table for each scope, read by the key
// handler, the key bar, the right-click menu and the `?` overview, so the keys
// listed and the keys handled can't drift.

import type { KindRef } from "./kinds.ts";
import type { Row } from "./rows.ts";

/** A key press as the table names it: "d", "F" (shift-f), "ctrl-d", "enter", "?", ":". */
export interface Press {
  readonly key: string;
  readonly key_char?: string | undefined;
  readonly modifiers: { readonly control?: boolean; readonly platform?: boolean; readonly alt?: boolean; readonly shift?: boolean };
}

const NAMED = new Set(["enter", "escape", "tab", "backspace", "delete", "up", "down", "left", "right", "home", "end", "pageup", "pagedown", "space"]);

/** The table's name for a press, or null for one the window leaves (cmd chords go to the app). */
export function pressName(e: Press): string | null {
  const m = e.modifiers;
  const k = e.key.toLowerCase();

  if (m.platform || m.alt) return null;

  if (m.control) return `ctrl-${k}`;

  if (k === "tab") return m.shift ? "shift-tab" : "tab";

  if (NAMED.has(k)) return k;

  const ch = e.key_char ?? "";

  if (ch.length === 1 && ch >= " ") return ch === " " ? "space" : ch;

  return k.length === 1 ? (m.shift ? k.toUpperCase() : k) : null;
}

/** What can be done to a row. */
export type RowAction =
  | "open" | "describe" | "yaml" | "graph" | "events" | "logs" | "previous" | "shell" | "forward" | "edit"
  | "scale" | "restart" | "reveal" | "web" | "cordon" | "uncordon" | "drain" | "delete" | "kill";

/** [key, action, what the bar and menus say]. */
export const ROW_KEYS = [
  ["enter", "open", "open"],
  ["g", "graph", "graph"],
  ["d", "describe", "describe"],
  ["y", "yaml", "yaml"],
  ["v", "events", "events"],
  ["l", "logs", "logs in a pane"],
  ["p", "previous", "previous logs"],
  ["s", "shell", "shell in a pane"],
  ["F", "forward", "port-forward"],
  ["w", "web", "open in a web pane"],
  ["e", "edit", "edit in the editor"],
  ["S", "scale", "scale"],
  ["R", "restart", "restart"],
  ["x", "reveal", "show values"],
  ["c", "cordon", "cordon"],
  ["u", "uncordon", "uncordon"],
  ["D", "drain", "drain"],
  ["ctrl-k", "kill", "kill"],
  ["ctrl-d", "delete", "delete"],
] as const satisfies readonly (readonly [string, RowAction, string])[];

const WORKLOADS: ReadonlySet<KindRef> = new Set(["deployments", "statefulsets", "daemonsets", "replicasets", "jobs", "cronjobs"]);
const GRAPHED: ReadonlySet<KindRef> = new Set([...WORKLOADS, "pods", "services", "ingresses", "applications"]);
const FORWARDED: ReadonlySet<KindRef> = new Set(["pods", "services", "deployments", "statefulsets"]);

/** The writes: drawn in the blocked colour in menus, refused in a read-only context. */
export const WRITES: ReadonlySet<RowAction> = new Set(["edit", "scale", "restart", "cordon", "uncordon", "drain", "delete", "kill"]);

/** Whether an action applies to a row of this kind. */
export function applies(a: RowAction, row: Row): boolean {
  const k = row.ref.kind;

  switch (a) {
    case "open": case "describe": case "yaml": return true;
    case "graph": return GRAPHED.has(k);
    case "events": return row.uid !== null && k !== "events";
    case "logs": case "previous": return k === "pods" || WORKLOADS.has(k);
    case "shell": case "kill": return k === "pods";
    case "forward": return FORWARDED.has(k) && (row.ports?.length ?? 0) > 0;
    case "web": return k === "ingresses";
    case "edit": return k !== "events";
    case "scale": return k === "deployments" || k === "statefulsets" || k === "replicasets";
    case "restart": return k === "deployments" || k === "statefulsets" || k === "daemonsets";
    case "reveal": return k === "secrets";
    case "cordon": case "uncordon": case "drain": return k === "nodes";
    case "delete": return k !== "events";
    default: return false;
  }
}

/** The row action a key runs on a row, or null. */
export function rowActionFor(name: string, row: Row | null): RowAction | null {
  if (!row) return null;

  const hit = ROW_KEYS.find(([k, a]) => k === name && applies(a, row));

  return hit ? hit[1] : null;
}

/** The window's own keys (any panel). */
export const WINDOW_KEYS = [
  [":", "kind…"],
  ["/", "filter"],
  ["n", "namespace: a picker (type to narrow, 0 all, 1-9 the first shown, * a favourite)"],
  ["1 2 3 0 4", "the panels by number (resources: context, namespaces, kinds, the table, detail; argo cd: applications 1, tree 0, status 2)"],
  ["ctrl-a", "every kind"],
  ["[ ]", "resources / argo cd / forwards"],
  ["tab shift-tab", "next / previous panel"],
  ["+ -", "the panel with the keys wider or narrower (or drag the gap beside it; a double click resets it)"],
  ["j k ↑ ↓", "move"],
  ["g G", "first / last (in a list)"],
  ["f", "forwards"],
  ["r", "read again"],
  ["M", "metrics: read every 2s, 5s, 15s, 30s or paused (metrics-server measures about every 15s)"],
  ["ctrl-t", "into a pane / out to a window"],
  ["esc", "back"],
  ["?", "keys"],
] as const;

/** The kind's table's column keys (the table with the keys); the header takes the pointer the same way. */
export const TABLE_KEYS = [
  [", .", "the keys to the column left / right (its header underlined)"],
  ["o", "sort by that column: up, down, the default order (or click its header)"],
  ["{ }", "that column narrower / wider (or drag its header's edge; a double click fits it)"],
  ["H", "hide that column (O shows hidden ones again)"],
  ["O", "the columns menu: sort by any, the default order, hide, show hidden, fit, wider / narrower, widths back, copy its name (or right-click a header)"],
] as const;

/** A graph's keys (the detail panel's, the Argo tree's), with the keyboard there. */
export const GRAPH_KEYS = [
  ["j k h l", "walk the boxes (the way the graph reads)"],
  ["H J K L", "move the graph (or drag it, or the wheel)"],
  ["c", "centre the selected box (or double-click the empty graph)"],
  ["O", "turn the graph: top to bottom / left to right (kept)"],
  ["enter", "open the box's object (or double-click it)"],
] as const;

/** The Argo tab's keys. */
export const ARGO_KEYS = [
  ["S", "sync"],
  ["r", "refresh (R hard)"],
  ["D", "diff"],
  ["h", "history"],
  ["B", "roll back to the picked revision"],
  ["enter", "open the resource"],
  ["o", "open the repository"],
] as const;

/** The forwards tab's keys. */
export const FORWARD_KEYS = [
  ["enter", "where it leads"],
  ["w", "open in a web pane"],
  ["b", "open in Databases (its password's secret found in the cluster)"],
  ["B", "open in Databases, picking the secret"],
  ["p", "peek at its terminal"],
  ["t", "give it a pane"],
  ["x", "stop it"],
] as const;
