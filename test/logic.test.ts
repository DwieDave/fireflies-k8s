// The pure parts: forwards (ports, guesses, the hc arguments), the ask rules,
// Argo's actions as patches, the diff, kinds and their aliases, contexts, the
// feed's unchanged check and back-off, secrets' masking.
import { describe, expect, test } from "bun:test";
import { dbOf, forwardsIn, localPort, noteFor, startArgs, urlOf, webOf, connectArgs } from "../mod/forwards.ts";
import { askKey, asks, asksTwice, refusal } from "../mod/confirm.ts";
import type { Ask } from "../mod/confirm.ts";
import { parseSettings } from "../mod/settings.ts";
import { looksProd, parseContexts } from "../mod/contexts.ts";
import { appGraph, applicationRow, historyOf, isApplication, refreshArgs, rollbackRefusal, syncArgs, targetRevision } from "../mod/argo.ts";
import { diffLines, hunks, toYaml } from "../mod/diff.ts";
import { customKinds, kindCompletions, kindFor, resourceOf } from "../mod/kinds.ts";
import { Feed, MAX_WAIT } from "../mod/feed.ts";
import { maskSecretYaml, decode } from "../mod/secrets.ts";
import { parseTopNodes, parseTopPods, History } from "../mod/metrics.ts";
import { bytes, millicores } from "../mod/quantity.ts";
import { age, span } from "../mod/time.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMPTY } from "../mod/snapshot.ts";

const S = parseSettings(JSON.stringify({ readonly: ["nightjar-ro"] }));

describe("forwards", () => {
  test("local ports: the same from 1024 up (+10000 when free), 80 → 8080, the next free one when taken", () => {
    expect(localPort(5432, new Set())).toBe(15432);
    expect(localPort(80, new Set())).toBe(8080);
    expect(localPort(80, new Set([8080]))).toBe(8081);
    expect(localPort(443, new Set())).toBe(8443);
    expect(localPort(60000, new Set())).toBe(60000);
  });

  test("a database by port, name or image; a web server by port or name", () => {
    expect(dbOf({ port: 5432, name: null }, "svc/x")).toBe("postgres");
    expect(dbOf({ port: 15000, name: "sql" }, "svc/orders", ["mariadb:11"])).toBe("mysql");
    expect(dbOf({ port: 6379, name: "redis" }, "svc/moth-queue")).toBeNull();
    expect(webOf({ port: 8080, name: null }, "svc/x")).toBe("http");
    expect(webOf({ port: 443, name: null }, "svc/x")).toBe("https");
    expect(webOf({ port: 6379, name: "redis" }, "svc/moth-queue")).toBeNull();
  });

  test("the hc arguments start a labelled background terminal; the label reads back from terminals()", () => {
    const n = noteFor("nightjar-dev", "lantern", "svc/lantern-db", { port: 5432, name: "postgres" }, 15432);
    const args = startArgs("kubectl", n);
    expect(args.slice(0, 5)).toEqual(["run", "--bg", "--no-parent", "--no-notify", "--json"]);
    expect(args.slice(args.indexOf("--"))).toEqual(["--", "kubectl", "--context", "nightjar-dev", "-n", "lantern", "port-forward", "svc/lantern-db", "15432:5432", "--address", "127.0.0.1"]);
    const label = args[args.indexOf("--label") + 1]?.split("=").slice(1).join("=") ?? "";
    const [f] = forwardsIn([{ address: "t4", state: "live", labels: { "k8s.forward": label } }, { address: "t5", labels: { "k8s.forward": "{nope" } }, "junk"]);
    expect(f).toMatchObject({ address: "t4", live: true, db: "postgres", local: 15432 });
    expect(urlOf({ ...n, web: "http" })).toBe("http://localhost:15432");
    expect(connectArgs(n, "postgres")).toEqual({ kind: "postgres", name: "lantern-db (nightjar-dev/lantern)", host: "127.0.0.1", port: 15432, from: "port-forward svc/lantern-db in nightjar-dev/lantern" });
  });
});

describe("asking", () => {
  const ask = (o: Partial<Ask> = {}): Ask => ({ kind: "delete", title: "Delete pod x", context: "nightjar-dev", namespace: "lantern", name: "x", detail: [], args: [], step: 1, typed: "", go: null, ...o });

  test("delete, kill and drain ask twice; anything in a production-looking context too", () => {
    expect(asksTwice("delete", "nightjar-dev", "nightjar-dev", S)).toBe(true);
    expect(asksTwice("scale", "nightjar-dev", "nightjar-dev", S)).toBe(false);
    expect(asksTwice("scale", "nightjar-prod", "nightjar-prod", S)).toBe(true);
    expect(asksTwice("scale", "eu-1", "live-eu", S)).toBe(true);
  });

  test("a forward asks only in a production-looking context, and is never refused as a write", () => {
    expect(asks("forward", "nightjar-dev", "nightjar-dev", S)).toBe(false);
    expect(asks("forward", "nightjar-prod", "nightjar-prod", S)).toBe(true);
    expect(refusal("forward", "nightjar-ro", S)).toBeNull();
    expect(refusal("delete", "nightjar-ro", S)).toContain("read-only");
  });

  test("the typed step runs only on the exact name", () => {
    expect(askKey(ask(), true, "y", "y")).toEqual({ act: "next" });
    expect(askKey(ask(), false, "enter", null)).toEqual({ act: "run" });
    expect(askKey(ask({ step: 2, typed: "" }), true, "enter", null)).toEqual({ act: "none" });
    expect(askKey(ask({ step: 2, typed: "" }), true, "x", "x")).toEqual({ act: "typed", typed: "x" });
    expect(askKey(ask({ step: 2, typed: "x" }), true, "enter", null)).toEqual({ act: "run" });
    expect(askKey(ask({ step: 2, typed: "x" }), true, "escape", null)).toEqual({ act: "cancel" });
  });

  test("prod-looking names", () => {
    expect(looksProd({ name: "nightjar-prod", cluster: "a" })).toBe(true);
    expect(looksProd({ name: "product-dev", cluster: "a" })).toBe(false);
    expect(looksProd({ name: "x", cluster: "gke_live_eu" })).toBe(true);
  });
});

describe("argo", () => {
  const apps = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/nightjar/nightjar-dev/argocd/applications.argoproj.io.json"), "utf8")).items;
  const lantern = apps.find((a: { metadata: { name: string } }) => a.metadata.name === "lantern");

  test("every recorded application passes the guard", () => {
    expect(apps.filter((a: unknown) => !isApplication(a))).toEqual([]);
  });

  test("sync, refresh and rollback are patches and annotations on the Application", () => {
    expect(isApplication(lantern)).toBe(true);
    expect(targetRevision(lantern)).toBe("main");
    const sync = syncArgs("nightjar-dev", "argocd", "lantern", "main");
    expect(sync.slice(0, 9)).toEqual(["--context", "nightjar-dev", "-n", "argocd", "patch", "applications.argoproj.io", "lantern", "--type", "merge"]);
    expect(JSON.parse(sync[10] ?? "{}")).toEqual({ operation: { initiatedBy: { username: "fireflies" }, sync: { revision: "main", prune: false } } });
    expect(refreshArgs("c", "argocd", "lantern", true)).toEqual(["--context", "c", "-n", "argocd", "annotate", "applications.argoproj.io", "lantern", "argocd.argoproj.io/refresh=hard", "--overwrite"]);
  });

  test("rollback is refused while auto-sync is on, or to the running revision", () => {
    const moth = apps.find((a: { metadata: { name: string } }) => a.metadata.name === "moth");
    expect(rollbackRefusal(moth, historyOf(moth)[0] ?? null)).toContain("auto-sync");
    const h = historyOf(lantern);
    expect(rollbackRefusal(lantern, h[h.length - 1] ?? null)).toContain("running now");
    expect(rollbackRefusal(lantern, h[0] ?? null)).toBeNull();
  });

  test("the row and the tree: out of sync and missing flagged", () => {
    expect(applicationRow(lantern).cells[1]).toMatchObject({ text: "OutOfSync", tone: "wk" });
    const g = appGraph(lantern, EMPTY, []);
    const flags = g.root.children.flatMap((c) => (c.flag ? [`${c.label}:${c.flag}`] : []));
    expect(flags).toEqual(["lantern-flags:out of sync", "lantern-dark-sky:missing"]);
    expect(g.root.children[0]?.kind).toBe("cm");
  });
});

describe("diff", () => {
  test("lines kept, removed and added; hunks with context", () => {
    const d = diffLines("a\nb\nc\nd\ne\nf\ng\nh", "a\nb\nc\nD\ne\nf\ng\nh");
    expect(d.filter((l) => l.op !== " ").map((l) => `${l.op}${l.text}`)).toEqual(["-d", "+D"]);
    expect(hunks(d, 1).map((l) => l.text)).toEqual(["…", "c", "d", "D", "e"].slice(1));
  });

  test("YAML of JSON values", () => {
    expect(toYaml({ data: { NEW: "true", n: 3, list: ["a", { b: 1 }] } })).toBe('data:\n  NEW: "true"\n  n: 3\n  list:\n    - a\n    - b: 1');
  });
});

describe("kinds, contexts, quantities, times", () => {
  test(": takes k9s's aliases and custom kinds", () => {
    expect(kindFor("po")).toBe("pods");
    expect(kindFor("deploy")).toBe("deployments");
    expect(kindFor("ing")).toBe("ingresses");
    expect(kindFor("certificate", customKinds("certificates.cert-manager.io\npods\n"))).toBe("custom:certificates.cert-manager.io");
    expect(kindFor("nope")).toBeNull();
    expect(kindCompletions("s").slice(0, 3)).toEqual(["statefulsets", "services", "secrets"]);
    expect(resourceOf("custom:certificates.cert-manager.io")).toBe("certificates.cert-manager.io");
  });

  test("get-contexts' columns, with an empty namespace and the current mark", () => {
    const c = parseContexts("*         dev   dev-cluster   admin   lantern\n          prod  prod-cluster  reader\n");
    expect(c).toEqual([{ name: "dev", cluster: "dev-cluster", namespace: "lantern", current: true }, { name: "prod", cluster: "prod-cluster", namespace: null, current: false }]);
  });

  test("quantities and kubectl's ages", () => {
    expect(millicores("250m")).toBe(250);
    expect(millicores("2")).toBe(2000);
    expect(bytes("128Mi")).toBe(128 * 2 ** 20);
    expect(span(3 * 3600e3 + 12 * 60e3)).toBe("3h12m");
    expect(span(18 * 86400e3)).toBe("18d");
    expect(age(null)).toBe("—");
  });

  test("top's answers, and the history summed for a deployment's pods", () => {
    const pods = parseTopPods("lantern  a  10m  20Mi\nlantern  b  5m  10Mi\n", null);
    expect(pods.get("lantern/a")).toEqual({ cpu: 10, mem: 20 * 2 ** 20 });
    expect(parseTopPods("a 1m 2Mi", "moth").has("moth/a")).toBe(true);
    expect(parseTopNodes("lumen-a  620m  15%  3100Mi  40%").get("node:lumen-a")?.cpu).toBe(620);
    const h = new History();
    h.push(pods);
    h.push(pods);
    expect(h.sum(["lantern/a", "lantern/b"]).map((s) => s.cpu)).toEqual([15, 15]);
  });
});

describe("feed", () => {
  test("an unchanged answer changes nothing; a failure backs off up to 30 s", async () => {
    const f = new Feed<string>(2000);
    let now = 0;
    const clock = () => now;
    const ok = { read: async () => ({ ok: true as const, value: "a" }), sign: (v: string) => v };
    expect(await f.run("s", ok, clock)).toBe(true);
    expect(await f.run("s", ok, clock)).toBe(false);
    expect(f.due("s", 1000)).toBe(false);
    expect(f.due("other", 1000)).toBe(true);
    const bad = { read: async () => ({ ok: false as const, error: "down" }), sign: (v: string) => v };
    for (let i = 0; i < 8; i++) await f.run("s", bad, clock);
    expect(f.wait()).toBe(MAX_WAIT);
    expect(f.value).toBe("a");
  });
});

describe("secrets", () => {
  test("a secret's YAML is masked under data:, nothing else", () => {
    const y = "apiVersion: v1\ndata:\n  password: bW90aA==\n  username: bGFudGVybg==\nkind: Secret\nmetadata:\n  name: x\n";
    const m = maskSecretYaml(y);
    expect(m).not.toContain("bW90aA");
    expect(m).toContain("  password: ••••••••");
    expect(m).toContain("name: x");
  });

  test("base64 decoded as UTF-8, binary as its size", () => {
    expect(decode(Buffer.from("moth").toString("base64"))).toBe("moth");
    expect(decode(Buffer.from([0, 1, 255]).toString("base64"))).toBe("(3 bytes)");
  });
});
