// The cluster's node metrics summed in the header: summed right over mixed
// quantity units, drawn on every tab (window and pane), nothing without
// metrics-server, cleared by a context switch, kept dim and marked stale
// when a read fails later; and read with the nodes table's own two calls,
// at the metrics' pace, never one of their own.
import { beforeEach, describe, expect, test } from "bun:test";
import { env, ids, texts } from "./support/standins.ts";
import type { El } from "./support/standins.ts";
import { fakeExec } from "./support/fake.ts";
import { open, reset } from "./support/window.ts";

const { sumNodes, memPair, percent } = await import("../mod/node-totals.ts");
const { parseTopNodes } = await import("../mod/metrics.ts");
const { setContext, setKind, setTab } = await import("../mod/nav.ts");
const { listArgs, topNodesArgs } = await import("../mod/kubectl.ts");

/** A fixed "now" for the fake, so its CPU wobble is the same for the window and the test's own sum. */
const NOW = String(Date.parse("2026-11-19T10:00:00Z"));

const node = (name: string, cpu: string, memory: string) => ({ metadata: { name }, status: { allocatable: { cpu, memory } } }) as never;

/** The CPU the fake's `top nodes` answers for a context, summed by hand (millicores). */
async function fakeCpu(context: string): Promise<number> {
  const r = await fakeExec({ K8S_FAKE_NOW: NOW })(["--context", context, "top", "nodes", "--no-headers"], 0);
  return r.stdout.trim().split("\n").reduce((n, l) => n + parseInt(l.trim().split(/\s+/)[1] ?? "0"), 0);
}

/** The header's drawn texts and ids. */
const head = (frame: El) => {
  const h = find(frame, "k8s-head");
  return { ids: h ? ids(h) : [], texts: h ? texts(h) : [] };
};

function find(el: El, id: string): El | null {
  if (el.ids.includes(id)) return el;
  for (const k of el.kids) {
    const f = find(k, id);
    if (f) return f;
  }
  return null;
}

beforeEach(() => reset({ K8S_FAKE_NOW: NOW }));

describe("summing the nodes", () => {
  test("mixed units: m, n and whole cores; Ki, Mi and Gi; a node in only one of the two left out of both sums", () => {
    const top = parseTopNodes([
      "a   1200m        30%   3Gi        19%",
      "b   250000000n   7%    524288Ki   6%",
      "c   2            50%   512Mi      3%",
      "e   900m         45%   1Gi        25%",
    ].join("\n"));
    const nodes = [node("a", "4", "16Gi"), node("b", "3800m", "8028140Ki"), node("c", "4", "16000Mi"), node("d", "2", "4Gi")];
    const s = sumNodes(top, nodes);
    expect(s).toEqual({
      cpu: 1200 + 250 + 2000,
      cpuOf: 4000 + 3800 + 4000,
      mem: 3 * 2 ** 30 + 512 * 2 ** 20 + 512 * 2 ** 20,
      memOf: 16 * 2 ** 30 + 8028140 * 2 ** 10 + 16000 * 2 ** 20,
      nodes: 3,
      of: 4,
    });
    expect(percent(s!.cpu, s!.cpuOf)).toBe(29);
    expect(memPair(s!.mem, s!.memOf)).toBe("4.0/39.3Gi");
    expect(memPair(512 * 2 ** 20, 4 * 2 ** 30)).toBe("512Mi/4.0Gi");
  });

  test("none in both, or no allocatable: no totals", () => {
    expect(sumNodes(parseTopNodes("a 100m 1% 1Gi 1%"), [node("b", "4", "8Gi")])).toBeNull();
    expect(sumNodes(parseTopNodes("a 100m 1% 1Gi 1%"), [{ metadata: { name: "a" }, status: {} } as never])).toBeNull();
    expect(sumNodes(new Map(), [])).toBeNull();
  });
});

describe("in the header", () => {
  test("on every tab and view: pods, deployments with the graph, the nodes, Argo CD, the forwards; in a window and a pane", async () => {
    const cpu = await fakeCpu("nightjar-dev");
    const numbers = `${(cpu / 1000).toFixed(1)}/12`;
    const pct = `${Math.round((cpu / 12000) * 100)}%`;
    // 3 × 3100Mi + … = 10400Mi used of 3 × 8028140Ki.
    const mem = 10400 * 2 ** 20;
    const memOf = 3 * 8028140 * 2 ** 10;
    const memPct = `${Math.round((mem / memOf) * 100)}%`;
    expect(memPct).toBe("44%");

    const { v, draw, press } = await open();
    const shows = () => {
      const h = head(draw());
      expect(h.ids).toContain("k8s-totals");
      for (const w of [numbers, pct, "10.2/23.0Gi", memPct]) expect(h.texts).toContain(w);
      expect(h.texts).not.toContain("stale");
    };
    expect(v.kind).toBe("pods");
    shows();
    await press(":", "d", "e", "p", "l", "o", "y", "enter", "g");
    expect(v.kind).toBe("deployments");
    expect(v.detail).toBe("graph");
    shows();
    setKind(v, "nodes");
    await press("j");
    shows();
    setTab(v, "argo");
    await press("j");
    shows();
    setTab(v, "forwards");
    await press("j");
    shows();

    const pane = await open({ pane: true });
    expect(pane.v.inWindow()).toBe(false);
    expect(head(pane.draw()).texts).toContain(numbers);
  });

  test("narrower: the bars and percents, then the percents alone", async () => {
    const { v, draw } = await open({ width: 900 });
    let h = head(draw());
    expect(h.texts).toContain("44%");
    expect(h.texts).not.toContain("10.2/23.0Gi");
    expect(h.ids).toContain("k8s-tot-mem-b");
    v.size = { width: 560, height: 700 };
    h = head(draw());
    expect(h.texts).toContain("44%");
    expect(h.ids).not.toContain("k8s-tot-mem-b");
  });

  test("a node without metrics is left out and said; paused, the last totals stay, dimmed", async () => {
    const { v, draw } = await open();
    v.data.topNodes.value = "lumen-a 620m 15% 3100Mi 40%\nlumen-b 410m 10% 2400Mi 31%\n";
    v.data.version++;
    const h = head(draw());
    expect(h.texts).toContain("1.0/8");
    expect(h.texts).toContain("2 of 3 nodes");
    v.data.paceMetrics(0);
    const strip = find(draw(), "k8s-totals")!;
    expect(texts(strip)).toContain("1.0/8");
  });

  test("a click on them shows the nodes", async () => {
    const { v, draw, cx } = await open();
    setTab(v, "forwards");
    const strip = find(draw(), "k8s-totals")!;
    const click = strip.calls.find(([name]) => name === "on_click")?.[1][0] as (e: unknown, cx: unknown) => void;
    click({}, cx);
    expect(v.tab).toBe("resources");
    expect(v.kind).toBe("nodes");
  });
});

describe("only when there are metrics", () => {
  test("without metrics-server nothing is drawn (no element, no room), and no node read is made again", async () => {
    reset({ K8S_FAKE_NOW: NOW, K8S_FAKE_NO_METRICS: "1" });
    const { v, draw, cx, settle } = await open();
    expect(v.data.metricsMissing).toBe(true);
    const h = head(draw());
    expect(h.ids.filter((i) => i.startsWith("k8s-tot"))).toEqual([]);
    expect(h.texts).not.toContain("stale");
    // A minute and more on: still no `top nodes`, no node list (they're the nodes table's alone then).
    const seen = record(v);
    for (const at of [20000, 40000, 70000, 140000]) {
      v.data.tick(v.wants(), cx, Date.now() + at);
      await settle();
    }
    expect(seen.filter((a) => a.includes("nodes"))).toEqual([]);
  });

  test("paused before any read: no top at all, nothing drawn", async () => {
    reset({ K8S_FAKE_NOW: NOW }, { metrics: 0 });
    const { v, draw } = await open();
    expect(v.data.topNodes.at).toBe(0);
    expect(v.data.nodes.at).toBe(0);
    expect(head(draw()).ids).not.toContain("k8s-totals");
  });

  test("a read that fails later keeps the last totals, dimmed and marked stale; a good one again unmarks them", async () => {
    const { v, draw, press } = await open();
    expect(head(draw()).texts).toContain("10.2/23.0Gi");
    env.fake = { ...env.fake, K8S_FAKE_NO_METRICS: "1" };
    v.data.topNodes.reset();
    await press("j");
    expect(v.data.topNodes.error).not.toBeNull();
    let h = head(draw());
    expect(h.texts).toContain("10.2/23.0Gi");
    expect(h.texts).toContain("stale");
    delete env.fake["K8S_FAKE_NO_METRICS"];
    v.data.topNodes.reset();
    await press("j");
    h = head(draw());
    expect(h.texts).toContain("10.2/23.0Gi");
    expect(h.texts).not.toContain("stale");
  });
});

describe("a context switch", () => {
  test("clears them at once; the new context's come when it answers", async () => {
    const { v, draw, cx, settle } = await open();
    expect(head(draw()).ids).toContain("k8s-totals");
    setContext(v, "nightjar-prod");
    expect(head(draw()).ids).not.toContain("k8s-totals");
    // The first tick reads the new context's `top nodes`, the next its list; then they show.
    for (let i = 0; i < 2; i++) {
      v.tick(cx);
      await settle();
    }
    const cpu = await fakeCpu("nightjar-prod");
    const h = head(draw());
    expect(h.texts).toContain(`${(cpu / 1000).toFixed(1)}/16`);
    // 12200Mi of 4 × 8028140Ki.
    expect(h.texts).toContain("11.9/30.6Gi");
    expect(h.texts).toContain(`${Math.round((12200 * 2 ** 20 / (4 * 8028140 * 2 ** 10)) * 100)}%`);
  });

  test("a switch while the old context's read runs: its late answer is dropped, never shown as the new one's", async () => {
    const { v, draw, cx, settle } = await open();
    v.data.topNodes.reset();
    v.data.tick(v.wants(), cx);
    setContext(v, "nightjar-prod");
    await settle();
    expect(head(draw()).ids).not.toContain("k8s-totals");
  });
});

/** Runs `body` on a clock it moves (`at(ms)`: that long after the start), the feeds' stamps included. */
async function clocked(body: (at: (ms: number) => void) => Promise<void>): Promise<void> {
  const real = Date.now;
  const t0 = real();
  let now = t0;
  Date.now = () => now;
  try {
    await body((ms) => { now = t0 + ms; });
  } finally {
    Date.now = real;
  }
}

/** Every kubectl call the view makes from now on. */
function record(v: { data: { exec: (a: readonly string[], t: number) => Promise<unknown> } }): string[][] {
  const seen: string[][] = [];
  const exec = v.data.exec;
  v.data.exec = (a, t) => {
    seen.push([...a]);
    return exec(a, t);
  };
  return seen;
}

describe("no call of their own", () => {
  test("the only node reads are the nodes table's two, with its very arguments; nothing from the metrics API", async () => {
    const { v, cx, settle } = await open();
    const seen = record(v);
    for (const at of [0, 16000, 32000, 61000, 125000]) {
      v.data.tick(v.wants(), cx, Date.now() + at);
      await settle();
    }
    const all = { context: "nightjar-dev", namespace: null };
    const allowed = new Set([topNodesArgs("nightjar-dev"), listArgs(all, "nodes")].map((a) => a.join(" ")));
    const nodeReads = seen.filter((a) => a.includes("nodes")).map((a) => a.join(" "));
    expect(nodeReads.length).toBeGreaterThan(0);
    for (const r of nodeReads) expect(allowed.has(r)).toBe(true);
    expect(seen.filter((a) => a.join(" ").includes("metrics.k8s.io") || a.includes("--raw"))).toEqual([]);
  });

  test("on the nodes table: one `top nodes` per metrics read, as many as `top pods`, the list at its own 15 s", async () => {
    const { v, cx, settle } = await open();
    setKind(v, "nodes");
    const seen = record(v);
    // A tick every 5 s for a minute.
    await clocked(async (at) => {
      for (let i = 1; i <= 12; i++) {
        at(i * 5000);
        v.data.tick(v.wants(), cx);
        await settle();
      }
    });
    const tops = (what: string) => seen.filter((a) => a.includes("top") && a.includes(what)).length;
    expect(tops("nodes")).toBe(tops("pods"));
    expect(tops("nodes")).toBe(4);
    expect(seen.filter((a) => a.includes("get") && a.includes("nodes")).length).toBe(4);
  });

  test("away from the nodes table the list goes at a minute; paused, neither is read; closed, nothing is", async () => {
    const { v, cx, settle } = await open();
    const seen = record(v);
    // A tick every 5 s for two minutes: `top nodes` every 15 s, the list once a minute.
    await clocked(async (at) => {
      for (let i = 1; i <= 24; i++) {
        at(i * 5000);
        v.data.tick(v.wants(), cx);
        await settle();
      }
    });
    expect(seen.filter((a) => a.includes("top") && a.includes("nodes")).length).toBe(8);
    expect(seen.filter((a) => a.includes("get") && a.includes("nodes")).length).toBe(2);
    seen.length = 0;
    v.data.paceMetrics(0);
    v.data.tick(v.wants(), cx, Date.now() + 600000);
    await settle();
    expect(seen.filter((a) => a.includes("nodes") || a.includes("top"))).toEqual([]);
    v.data.paceMetrics(15);
    v.close();
    seen.length = 0;
    v.tick(cx);
    await settle();
    expect(seen).toEqual([]);
  });
});
