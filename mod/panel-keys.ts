// The panels by number, as the Databases window's: the left column's panels
// 1, 2, 3, the big one in the middle 0, the one after it 4, the same in every
// tab. tab / shift-tab walk them in the order drawn (left column top to
// bottom, then the middle, then the right). One table, read by the key
// handler, the panels' titles, the fold row and `?`.
//
//   resources  [1] Context  [2] Namespaces  [3] Kinds  [0] the kind's table  [4] detail
//   argo cd    [1] Applications  [0] the application's tree  [2] Status
//   forwards   [0] Port-forwards

import type { default as K8s } from "./main.ts";
import type { RailItem } from "./menus.ts";
import { railItems } from "./menus.ts";
import type { ArgoPanel, Panel, Tab } from "./state.ts";

/** A panel stop: its number and where it is. */
export type Stop =
  | { readonly num: string; readonly tab: "resources"; readonly panel: Panel; readonly part?: RailItem["part"] }
  | { readonly num: string; readonly tab: "argo"; readonly panel: ArgoPanel }
  | { readonly num: string; readonly tab: "forwards"; readonly panel: "forwards" };

const RESOURCES: readonly Stop[] = [
  { num: "1", tab: "resources", panel: "rail", part: "context" },
  { num: "2", tab: "resources", panel: "rail", part: "namespace" },
  { num: "3", tab: "resources", panel: "rail", part: "kind" },
  { num: "0", tab: "resources", panel: "table" },
  { num: "4", tab: "resources", panel: "detail" },
];

const ARGO: readonly Stop[] = [
  { num: "1", tab: "argo", panel: "apps" },
  { num: "0", tab: "argo", panel: "tree" },
  { num: "2", tab: "argo", panel: "side" },
];

const FORWARDS: readonly Stop[] = [{ num: "0", tab: "forwards", panel: "forwards" }];

/** A tab's panels in the order tab walks them. */
export function stopsOf(tab: Tab): readonly Stop[] {
  return tab === "resources" ? RESOURCES : tab === "argo" ? ARGO : FORWARDS;
}

/** A resources panel's number (a rail part's for the rail). */
export function panelNum(panel: Panel, part: RailItem["part"] | null = null): string {
  return RESOURCES.find((s) => s.panel === panel && (panel !== "rail" || (s.tab === "resources" && s.part === part)))?.num ?? "";
}

/** An Argo panel's number. */
export function argoNum(panel: ArgoPanel): string {
  return ARGO.find((s) => s.panel === panel)?.num ?? "";
}

/** The stop that has the keyboard now. */
export function currentStop(v: K8s): Stop | null {
  const list = stopsOf(v.tab);

  if (v.tab === "argo") return list.find((s) => s.panel === v.argoPanel) ?? null;

  if (v.tab === "forwards") return list[0] ?? null;

  if (v.panel !== "rail") return list.find((s) => s.panel === v.panel) ?? null;

  const part = railItems(v)[v.railAt]?.part ?? "context";

  return list.find((s) => s.tab === "resources" && s.part === part) ?? null;
}

/** Gives the keyboard to a stop: a rail part's cursor goes to what's chosen there (the shown context,
 *  namespace or kind), else its first row. */
export function goStop(v: K8s, s: Stop): void {
  if (s.tab === "argo") {
    v.argoPanel = s.panel;

    return;
  }

  if (s.tab !== "resources") return;

  v.panel = s.panel;

  if (s.panel !== "rail" || !s.part) return;

  const items = railItems(v);

  const chosen = items.findIndex((i) => (i.part === "context" && s.part === "context" && i.context.name === v.context)
    || (i.part === "namespace" && s.part === "namespace" && i.strip.name === v.namespace)
    || (i.part === "kind" && s.part === "kind" && i.kind === v.kind));

  const first = items.findIndex((i) => i.part === s.part);

  v.railAt = Math.max(0, chosen >= 0 ? chosen : first);
}

/** A digit: the shown tab's panel with that number. False when the tab has none. */
export function panelByNumber(v: K8s, num: string): boolean {
  const s = stopsOf(v.tab).find((x) => x.num === num);

  if (!s) return false;

  goStop(v, s);

  return true;
}

/** tab / shift-tab: the next or previous panel, wrapping. */
export function stepPanel(v: K8s, by: 1 | -1): void {
  const list = stopsOf(v.tab);
  const cur = currentStop(v);
  const i = cur ? list.indexOf(cur) : 0;
  const next = list[(i + by + list.length) % list.length];

  if (next) goStop(v, next);
}
