// The window's pickers: contexts (`:ctx`, the rail), every kind (ctrl-a, k9s's
// aliases view), and the rail's items as one list the arrows walk.

import type { default as K8s } from "./main.ts";
import type { KindRef } from "./kinds.ts";
import { KINDS, titleOf } from "./kinds.ts";
import type { Menu, MenuRow } from "./state.ts";
import { customOfCluster, kindCounts, strips } from "./derive.ts";
import type { NsStrip } from "./derive.ts";
import { setContext, setKind, setNamespace, setTab } from "./nav.ts";
import { looksProd } from "./contexts.ts";
import type { Context as KubeContext } from "./contexts.ts";

export function contextMenu(v: K8s): Menu {
  const ctxs = v.data.contexts.value ?? [];

  return {
    title: "context", at: Math.max(0, ctxs.findIndex((c) => c.name === v.context)),
    rows: ctxs.map((c): MenuRow => ({ label: c.name, sub: contextSub(v, c), go: () => setContext(v, c.name) })),
  };
}

function contextSub(v: K8s, c: KubeContext): string {
  const tags = [c.cluster, ...(c.current ? ["kubeconfig's current"] : []), ...(looksProd(c, v.settings.prod) ? ["production: asks twice"] : []), ...(v.settings.readonly.has(c.name) ? ["read-only"] : [])];

  return tags.join(" · ");
}

export function kindMenu(v: K8s): Menu {
  const kinds: KindRef[] = [...KINDS.map((k) => k.id), ...customOfCluster(v.data)];

  return {
    title: "every kind", at: Math.max(0, kinds.indexOf(v.kind)),
    rows: kinds.map((k): MenuRow => ({ label: titleOf(k), sub: k.startsWith("custom:") ? k.slice(7) : KINDS.find((x) => x.id === k)?.aliases.join(" ") ?? null, go: () => {
      setTab(v, "resources");
      setKind(v, k);
    } })),
  };
}

/** One item of the rail. */
export type RailItem =
  | { readonly part: "context"; readonly context: KubeContext }
  | { readonly part: "namespace"; readonly strip: NsStrip; readonly n: number }
  | { readonly part: "kind"; readonly kind: KindRef; readonly count: number | null; readonly bad: number };

/** The rail's items, top to bottom. */
export function railItems(v: K8s): readonly RailItem[] {
  const ctxs = (v.data.contexts.value ?? []).map((context): RailItem => ({ part: "context", context }));
  const ns = strips(v.data, v.settings.favourites).map((strip, n): RailItem => ({ part: "namespace", strip, n }));
  const kinds = kindCounts(v.data, v.namespace).map((k): RailItem => ({ part: "kind", kind: k.kind, count: k.n, bad: k.bad }));

  return [...ctxs, ...ns, ...kinds];
}

/** What enter on a rail item does. */
export function pickRail(v: K8s, item: RailItem): void {
  if (item.part === "context") setContext(v, item.context.name);
  else if (item.part === "namespace") setNamespace(v, item.strip.name);
  else {
    setKind(v, item.kind);
    v.panel = "table";
  }
}

/** The rail item the shown state points at (the cursor starts there). */
export function railIndexOfKind(v: K8s): number {
  return railItems(v).findIndex((i) => i.part === "kind" && i.kind === v.kind);
}
