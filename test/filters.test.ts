// The filters: one syntax for the Resources tab's / and the Argo CD tab's
// (filter-terms.ts), each Argo filter and their combination, the chips, the
// menu of what the applications have, tab completion, kept for the next
// opening.
import { beforeEach, describe, expect, test } from "bun:test";
import { El, byId, handlerOf, sharedMap, texts } from "./support/standins.ts";
import { open, reset } from "./support/window.ts";

const { parseTerms, matches, termText, withoutTerm, withTerm, complete } = await import("../mod/filter-terms.ts");
const { filterApps, facets, ARGO_FIELDS } = await import("../mod/argo-filter.ts");
const { apps, allApps, listRows } = await import("../mod/nav.ts");

const cx: any = { stop_propagation() {}, notify() {} };
const names = (v: any) => apps(v).map((a: any) => a.metadata.name);

beforeEach(() => reset());

describe("the syntax", () => {
  const F = ["project", "sync"];

  test("words, !words, k=v, k!=v, -l selectors, fields, !fields", () => {
    expect(parseTerms("web !old team=lantern env!=prod -l tier,!canary project:lan !sync:out", F)).toEqual([
      { t: "word", word: "web", not: false },
      { t: "word", word: "old", not: true },
      { t: "label", key: "team", op: "=", value: "lantern" },
      { t: "label", key: "env", op: "!=", value: "prod" },
      { t: "label", key: "tier", op: "has", value: "" },
      { t: "label", key: "canary", op: "hasnt", value: "" },
      { t: "field", field: "project", value: "lan", not: false },
      { t: "field", field: "sync", value: "out", not: true },
    ]);
    // A colon word that isn't a field is a word.
    expect(parseTerms("http://x", F)).toEqual([{ t: "word", word: "http://x", not: false }]);
  });

  test("matching: every term; labels exactly; sync from its start, others anywhere; no case", () => {
    const thing = { text: "lantern-api lantern", labels: new Map([["team", "lantern"], ["tier", "web"]]), fields: (f: string) => (f === "sync" ? ["OutOfSync"] : f === "project" ? ["lantern"] : []) };
    const yes = (s: string) => matches(thing, parseTerms(s, F));
    expect(yes("API")).toBe(true);
    expect(yes("team=lantern -l tier")).toBe(true);
    expect(yes("team=lantern tier")).toBe(false);
    expect(yes("-l tier,!canary")).toBe(true);
    expect(yes("team=moth")).toBe(false);
    expect(yes("sync:out")).toBe(true);
    expect(yes("sync:sync")).toBe(false);
    expect(yes("!sync:out")).toBe(false);
    expect(yes("project:ant api")).toBe(true);
    expect(yes("!api")).toBe(false);
  });

  test("a term written back as typed; one taken off; one added once", () => {
    const text = "team=lantern -l !canary sync:out web";
    expect(parseTerms(text, F).map(termText)).toEqual(["team=lantern", "-l !canary", "sync:out", "web"]);
    expect(withoutTerm(text, F, 1)).toBe("team=lantern sync:out web");
    expect(withTerm("sync:out", F, "sync:out")).toBe("sync:out");
    expect(withTerm("sync:out", F, "health:Degraded")).toBe("sync:out health:Degraded");
    expect(complete("team=lantern pro", ["project:", "project:lantern", "repo:"])).toEqual(["project:", "project:lantern"]);
  });

  test("the Resources tab's / reads the same syntax (and its old -l and ! still work)", async () => {
    const { v, press } = await open();
    const typed = (s: string) => [...s].map((c) => (c === " " ? "space" : c));
    await press("/", ...typed("-l app=lantern-db"), "enter");
    expect(listRows(v).map((r) => r.ref.name)).toEqual(["lantern-db-0"]);
    await press("escape", "/", ...typed("app=lantern-db"), "enter");
    expect(listRows(v).map((r) => r.ref.name)).toEqual(["lantern-db-0"]);
    await press("escape", "/", ...typed("status:crash"), "enter");
    expect(listRows(v).map((r) => r.status)).toEqual(["CrashLoopBackOff"]);
    await press("escape", "/", ...typed("!lantern"), "enter");
    expect(listRows(v).every((r) => !r.ref.name.includes("lantern"))).toBe(true);
  });
});

describe("the Argo CD tab's filters", () => {
  test("each filter: project, sync, health, cluster, ns, repo, labels, text; and combined", async () => {
    const { v, press } = await open();
    await press("]");
    const all = allApps(v);
    const by = (s: string) => filterApps(all, s).map((a) => a.metadata.name);
    expect(by("project:lantern")).toEqual(["lantern", "lantern-prod"]);
    expect(by("sync:OutOfSync")).toEqual(["kube-stars", "lantern"]);
    expect(by("health:degraded")).toEqual(["glowworm"]);
    expect(by("cluster:prod")).toEqual(["lantern-prod"]);
    expect(by("ns:moth")).toEqual(["moth"]);
    expect(by("repo:platform")).toEqual(["argo-self", "kube-stars"]);
    expect(by("team=platform")).toEqual(["argo-self", "kube-stars"]);
    expect(by("-l tier")).toEqual(["glowworm", "lantern", "lantern-prod"]);
    expect(by("-l !env")).toEqual(["argo-self"]);
    expect(by("glow")).toEqual(["glowworm"]);
    // Combined: every term.
    expect(by("team=lantern sync:synced")).toEqual(["lantern-prod"]);
    expect(by("env=dev !health:healthy")).toEqual(["glowworm", "kube-stars", "lantern"]);
  });

  test("the menu of what the applications have (with counts) adds a term; chips click off; the title counts", async () => {
    const { v, press, draw } = await open();
    await press("]", "1", "F");
    expect(v.menu?.title).toBe("filter the applications by");
    const labels = v.menu?.rows.map((r) => r.label) ?? [];
    expect(labels).toEqual(expect.arrayContaining(["project:lantern", "sync:OutOfSync", "health:Degraded", "team=platform"]));
    expect(v.menu?.rows.find((r) => r.label === "project:lantern")?.sub).toBe("project · 2 of 6");
    v.menu?.rows.find((r) => r.label === "team=lantern")?.go(cx);
    v.menu = null;
    expect(names(v)).toEqual(["lantern", "lantern-prod"]);
    let shown = texts(draw());
    expect(shown).toContain("2 of 6");
    expect(shown).toContain("team=lantern");
    await press("F");
    v.menu?.rows.find((r) => r.label === "sync:Synced")?.go(cx);
    v.menu = null;
    expect(names(v)).toEqual(["lantern-prod"]);
    // A chip clicks off.
    handlerOf(byId(draw(), "argo-chip-0") as El, "on_click")({}, cx);
    expect(v.argoFilter).toBe("sync:Synced");
    shown = texts(draw());
    expect(shown).toContain("4 of 6");
  });

  test("/ types a filter live, tab completes from what's there, enter keeps it (for the next opening too), esc clears", async () => {
    const { v, press } = await open();
    await press("]", "/", "p", "r", "o", "j");
    expect(v.typing?.what).toBe("argo");
    await press("tab");
    expect(v.typing?.text).toBe("project:");
    await press("p", "l", "tab");
    expect(v.typing?.text).toBe("project:platform");
    expect(names(v)).toEqual(["argo-self", "kube-stars"]);
    await press("enter");
    expect(v.typing).toBeNull();
    expect((sharedMap.get("k8s.state") as any).argo).toBe("project:platform");
    const next = await open();
    expect(next.v.argoFilter).toBe("project:platform");
    await press("escape");
    expect(v.argoFilter).toBe("");
    expect(names(v).length).toBe(6);
  });

  test("a filter that hides everything says so; facets cover every field and label", async () => {
    const { v, press, draw } = await open();
    await press("]", "/", "z", "z", "z", "enter");
    expect(apps(v).length).toBe(0);
    expect(texts(draw()).some((s) => s.startsWith("nothing matches zzz"))).toBe(true);
    const kinds = new Set(facets(allApps(v)).map((f) => f.what));
    for (const f of [...ARGO_FIELDS, "label"]) expect(kinds.has(f)).toBe(true);
  });
});
