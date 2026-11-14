// The Argo CD tab's filter: the applications narrowed by project, sync,
// health, destination cluster and namespace, repository, labels and free
// text (filter-terms.ts: the same syntax as the Resources tab's `/`). Typed
// after `/` (tab completes from what the applications have), picked from a
// menu of what they have with counts (`F`, the "+ filter" chip), shown as
// chips above the list that click off, a count of shown / all in the
// panel's title; kept in `k8s.state` for the next opening.

import type { default as K8s } from "./main.ts";
import type { Application } from "./argo.ts";
import { destinationOf, sourceOf } from "./argo.ts";
import type { Filterable, Term } from "./filter-terms.ts";
import { matches, parseTerms, withTerm } from "./filter-terms.ts";
import type { Menu, MenuRow } from "./state.ts";
import { labelsOf } from "./rows.ts";
import { saveCopy } from "./host.ts";

/** The fields the Argo filter knows. */
export const ARGO_FIELDS: readonly string[] = ["project", "sync", "health", "cluster", "ns", "repo"];

/** An application's destination cluster, as people read it ("in-cluster", "prod.nightjar.test"). */
const clusterOf = (a: Application): string => destinationOf(a).split("/")[0] ?? "";

/** What an application offers the filter. */
export function appFilterable(a: Application): Filterable {
  const project = a.spec?.project ?? "default";
  const repo = sourceOf(a)?.repoURL ?? "";

  const values = new Map<string, string>([
    ["project", project], ["sync", a.status?.sync?.status ?? "Unknown"], ["health", a.status?.health?.status ?? "Unknown"],
    ["cluster", clusterOf(a)], ["ns", a.spec?.destination?.namespace ?? ""], ["repo", repo],
  ]);

  return { text: `${a.metadata.name} ${project} ${destinationOf(a)} ${repo}`, labels: labelsOf(a.metadata), fields: (f) => {
    const value = values.get(f);

    return value === undefined ? [] : [value];
  } };
}

/** The applications the filter lets through (all of them, sorted by name, without one). */
export function filterApps(all: readonly Application[], text: string): readonly Application[] {
  const terms: readonly Term[] = parseTerms(text, ARGO_FIELDS);

  return terms.length ? all.filter((a) => matches(appFilterable(a), terms)) : all;
}

/** A value the applications have, as a term, with how many have it. */
export interface Facet {
  readonly term: string;
  readonly what: string;
  readonly count: number;
}

/** Every term the applications offer: each field's values and each label, counted; for the menu and tab. */
export function facets(all: readonly Application[]): readonly Facet[] {
  const counts = new Map<string, Facet>();
  const add = (term: string, what: string) => counts.set(term, { term, what, count: (counts.get(term)?.count ?? 0) + 1 });

  for (const a of all) {
    const f = appFilterable(a);

    for (const field of ARGO_FIELDS) for (const value of f.fields(field)) if (value) add(`${field}:${value}`, field);

    for (const [k, value] of f.labels) add(`${k}=${value}`, "label");
  }

  const order = (x: Facet) => [...ARGO_FIELDS, "label"].indexOf(x.what);

  return [...counts.values()].sort((a, b) => order(a) - order(b) || a.term.localeCompare(b.term));
}

/** F, the "+ filter" chip: what the applications have, each adding its term; "clear" when filtered. */
export function filterMenu(v: K8s, all: readonly Application[]): Menu {
  const rows = facets(all).map((f): MenuRow => ({ label: f.term, sub: `${f.what} · ${f.count} of ${all.length}`, go: () => {
    setArgoFilter(v, withTerm(v.argoFilter, ARGO_FIELDS, f.term));
  } }));

  return {
    title: "filter the applications by", at: 0,
    rows: [...(v.argoFilter ? [{ label: "clear the filter", sub: v.argoFilter, key: "x", go: () => setArgoFilter(v, "") }] : []), ...rows],
  };
}

/** Sets the filter (kept with the window's state). */
export function setArgoFilter(v: K8s, text: string): void {
  v.argoFilter = text;
  saveCopy(v);
}
