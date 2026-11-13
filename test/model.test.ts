// The guards against the recorded cluster (a guard can't be stricter than
// kubectl's real answers), the rows and the graphs built from them.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isPod, isEvent, isNode, isNamespace, isKList } from "../mod/objects.ts";
import { sortSnapshot, snapshotArgs } from "../mod/snapshot.ts";
import { listArgs, readList, readText, secretListArgs } from "../mod/kubectl.ts";
import { podRow, deploymentRow, eventRow, nodeRow } from "../mod/rows-kinds.ts";
import { workloadGraph, ownersOf, podsOwned } from "../mod/graph.ts";
import { layout, columnsOf, readingOrder } from "../mod/graph-layout.ts";
import { secretRows } from "../mod/secrets.ts";
import { fakeExec } from "./support/fake.ts";

const ROOT = join(import.meta.dir, "fixtures", "nightjar");
const exec = fakeExec();
const dev = { context: "nightjar-dev", namespace: "lantern" };

describe("the recorded cluster passes the guards", () => {
  const files = readdirSync(ROOT, { recursive: true }).map(String).filter((f) => f.endsWith(".json"));
  test.each(files)("%s", (f) => {
    const list = JSON.parse(readFileSync(join(ROOT, f), "utf8"));
    expect(isKList(list)).toBe(true);
    const items: unknown[] = list.items;
    if (f.endsWith("pods.json")) expect(items.filter((x) => !isPod(x))).toEqual([]);
    if (f.endsWith("events.json")) expect(items.filter((x) => !isEvent(x))).toEqual([]);
    if (f.endsWith("nodes.json")) expect(items.filter((x) => !isNode(x))).toEqual([]);
    if (f.endsWith("namespaces.json")) expect(items.filter((x) => !isNamespace(x))).toEqual([]);
  });
});

describe("snapshot", () => {
  test("one call gives every kind of the namespace", async () => {
    const r = await readText(exec, snapshotArgs(dev));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = sortSnapshot(JSON.parse(r.value).items);
    expect(s.deployments.map((d) => d.metadata.name)).toContain("lantern-api");
    expect(s.replicasets.length).toBeGreaterThan(6);
    expect(s.services.map((x) => x.metadata.name).sort()).toEqual(["lantern-api", "lantern-db", "lantern-web"]);
    expect(s.ingresses).toHaveLength(1);
    expect(s.configmaps.length).toBe(3);
    expect(s.pvcs.length).toBe(1);
  });

  test("an item of another shape is left out, not the list", () => {
    const s = sortSnapshot([{ kind: "Deployment", metadata: { name: 7 } }, { kind: "Deployment", metadata: { name: "ok" } }, "junk", null]);
    expect(s.deployments.map((d) => d.metadata.name)).toEqual(["ok"]);
  });
});

describe("rows", () => {
  test("pods: the crash-looping one is red with its restarts, recent", async () => {
    const r = await readList(exec, listArgs(dev, "pods"), isPod);
    if (!r.ok) throw new Error(r.error);
    const rows = r.value.map((p) => podRow(p, Date.now()));
    const crash = rows.find((x) => x.status === "CrashLoopBackOff");
    expect(crash?.tone).toBe("bad");
    expect(crash?.cells[2]).toEqual({ t: "marks", count: 5, recent: true });
    expect(rows.find((x) => x.status === "ImagePullBackOff")?.tone).toBe("bad");
    expect(rows.filter((x) => x.tone === "ok").length).toBeGreaterThan(5);
    const worker = rows.find((x) => x.ref.name.startsWith("lantern-worker"));
    expect(worker?.pod?.containers.map((c) => c.name)).toEqual(["worker", "log-shipper"]);
  });

  test("deployments: rolling api is on its way, the legacy one scaled away", async () => {
    const r = await readText(exec, snapshotArgs(dev));
    if (!r.ok) throw new Error(r.error);
    const s = sortSnapshot(JSON.parse(r.value).items);
    const rows = s.deployments.map((d) => deploymentRow(d, () => []));
    expect(rows.find((x) => x.ref.name === "lantern-api")?.tone).toBe("wk");
    expect(rows.find((x) => x.ref.name === "lantern-legacy")?.tone).toBe("off");
    expect(rows.find((x) => x.ref.name === "lantern-mailer")?.tone).toBe("bad");
    expect(rows.find((x) => x.ref.name === "lantern-web")?.tone).toBe("ok");
  });

  test("secrets: names, types and key names, never a value", async () => {
    const r = await readText(exec, secretListArgs(dev));
    if (!r.ok) throw new Error(r.error);
    expect(r.value).not.toContain("moth-wings");
    const rows = secretRows(r.value);
    expect(rows.map((x) => x.ref.name)).toEqual(["lantern-db-auth", "lantern-tls", "mailer-smtp"]);
    expect(rows[0]?.cells[2]).toEqual({ t: "text", text: "username password", tone: null, dim: false });
  });

  test("events and nodes", async () => {
    const ev = await readList(exec, listArgs(dev, "events"), isEvent);
    if (!ev.ok) throw new Error(ev.error);
    expect(ev.value.map(eventRow).some((r) => r.status === "BackOff")).toBe(true);
    const no = await readList(exec, listArgs(dev, "nodes"), isNode);
    if (!no.ok) throw new Error(no.error);
    expect(no.value.map(nodeRow).map((r) => r.cells[2])).toContainEqual({ t: "text", text: "control-plane", tone: null, dim: true });
  });

  test("an unreachable context answers kubectl's complaint", async () => {
    const r = await readText(fakeExec({ K8S_FAKE_DOWN: "nightjar-prod" }), listArgs({ context: "nightjar-prod", namespace: "lantern" }, "pods"));
    expect(r).toEqual({ ok: false, error: expect.stringContaining("Unable to connect") });
  });
});

describe("graphs", () => {
  async function cluster() {
    const r = await readText(exec, snapshotArgs(dev));
    const p = await readList(exec, listArgs({ ...dev, namespace: null }, "pods"), isPod);
    if (!r.ok || !p.ok) throw new Error("read");
    return { snap: sortSnapshot(JSON.parse(r.value).items), pods: p.value };
  }

  test("lantern-api in traffic order: ingress → service → deploy → replica sets → pods", async () => {
    const { snap, pods } = await cluster();
    const d = snap.deployments.find((x) => x.metadata.name === "lantern-api")!;
    const g = workloadGraph({ kind: "deployments", name: "lantern-api", namespace: "lantern" }, d.metadata.uid ?? null, snap, pods)!;
    expect(g.root.kind).toBe("deploy");
    expect(g.feeders.map((f) => [f.depth, f.node.kind, f.node.label])).toEqual([[2, "ing", "lantern.nightjar.test"], [1, "svc", "lantern-api"]]);
    const [live, ...old] = g.root.children;
    expect(live?.children.map((c) => c.tone)).toEqual(["bad", "ok", "ok", "ok"]);
    expect(old.map((o) => o.ghost)).toEqual([true, true]);
    expect(columnsOf(g)).toBe(5);
    const l = layout(g);
    expect(l.boxes).toHaveLength(2 + 1 + 3 + 4);
    expect(readingOrder(l)[0]?.node.kind).toBe("ing");
    // The line into the failing pod runs live (yellow).
    expect(l.segs.some((s) => s.live)).toBe(true);
  });

  test("a pod's graph is its deployment's; a statefulset's pods; a cronjob's jobs", async () => {
    const { snap, pods } = await cluster();
    const pod = pods.find((p) => p.metadata.name.startsWith("lantern-web"))!;
    expect(workloadGraph({ kind: "pods", name: pod.metadata.name, namespace: "lantern" }, pod.metadata.uid ?? null, snap, pods)?.root.label).toBe("lantern-web");
    const sts = snap.statefulsets[0]!;
    const g = workloadGraph({ kind: "statefulsets", name: sts.metadata.name, namespace: "lantern" }, sts.metadata.uid ?? null, snap, pods)!;
    expect(g.root.children.map((c) => c.label)).toEqual(["lantern-db-0"]);
    expect(g.feeders.map((f) => f.node.label)).toEqual(["lantern-db"]);
    const cj = snap.cronjobs[0]!;
    const c = workloadGraph({ kind: "cronjobs", name: cj.metadata.name, namespace: "lantern" }, cj.metadata.uid ?? null, snap, pods)!;
    expect(c.root.children.map((j) => j.tone)).toEqual(["done", "done", "wk"]);
  });

  test("a deployment's pods for its CPU line", async () => {
    const { snap, pods } = await cluster();
    const d = snap.deployments.find((x) => x.metadata.name === "lantern-web")!;
    expect(podsOwned(d.metadata.uid ?? null, snap, ownersOf(pods))).toHaveLength(2);
  });
});
