// How often CPU and memory are read: the setting (parsed, defaulted, kept
// with the file's other fields), the feed at the picked pace against a fake
// clock, never a second read while one runs, only new samples on the lines.
import { describe, expect, test } from "bun:test";
import { parseSettings, withMetrics, METRICS_EVERY } from "../mod/settings.ts";
import { Feed } from "../mod/feed.ts";
import { Data } from "../mod/data.ts";
import type { Wants } from "../mod/data.ts";

describe("the setting", () => {
  test("15 s by default; 0 pauses; a number kept, rounded and bounded; anything else the default", () => {
    expect(parseSettings(null).metrics).toBe(METRICS_EVERY);
    expect(parseSettings("{}").metrics).toBe(15);
    expect(parseSettings('{"metrics": 0}').metrics).toBe(0);
    expect(parseSettings('{"metrics": 2}').metrics).toBe(2);
    expect(parseSettings('{"metrics": 2.4}').metrics).toBe(2);
    expect(parseSettings('{"metrics": 0.3}').metrics).toBe(15);
    expect(parseSettings('{"metrics": 9999}').metrics).toBe(600);
    // A wrong type spoils the file's shape: the defaults, as for any other field.
    expect(parseSettings('{"metrics": "fast"}').metrics).toBe(15);
  });

  test("kept in the file with every other field as it was; a file that isn't a JSON object is left alone", () => {
    const kept = withMetrics('{ "kubectl": "/bin/kubectl", "favourites": ["lantern"] }', 5)!;
    expect(JSON.parse(kept)).toEqual({ kubectl: "/bin/kubectl", favourites: ["lantern"], metrics: 5 });
    expect(JSON.parse(withMetrics(null, 0)!)).toEqual({ metrics: 0 });
    expect(withMetrics("// a comment\n{}", 5)).toBeNull();
    expect(withMetrics("[1, 2]", 5)).toBeNull();
  });
});

describe("the feed's pace", () => {
  test("due at the picked pace after a read, with a fake clock", async () => {
    const f = new Feed<string>(15000);
    let now = 1000;
    await f.run("ctx", { read: () => Promise.resolve({ ok: true as const, value: "a" }), sign: (v) => v }, () => now);
    f.pace(2000);
    expect(f.due("ctx", now + 1999)).toBe(false);
    expect(f.due("ctx", now + 2000)).toBe(true);
    f.pace(30000);
    expect(f.due("ctx", now + 29999)).toBe(false);
    now += 30000;
    expect(f.due("ctx", now)).toBe(true);
  });

  test("never a second read while one runs, however fast the pace", async () => {
    const f = new Feed<string>(2000);
    let release: (v: { ok: true; value: string }) => void = () => {};
    const slow = new Promise<{ ok: true; value: string }>((r) => (release = r));
    const running = f.run("ctx", { read: () => slow, sign: (v) => v }, () => 0);
    expect(f.due("ctx", 1e9)).toBe(false);
    expect(await f.run("ctx", { read: () => Promise.resolve({ ok: true as const, value: "b" }), sign: (v) => v })).toBe(false);
    release({ ok: true, value: "a" });
    await running;
    expect(f.value).toBe("a");
  });

  test("a failing read still backs off at a fast pace", () => {
    const f = new Feed<string>(2000);
    f.failures = 3;
    expect(f.wait()).toBe(16000);
  });
});

/** A Data whose kubectl answers `top` from a list, counting the reads; everything else empty. */
function cluster(tops: string[]) {
  const seen: string[][] = [];
  let pending: (() => void)[] = [];
  let hold = false;
  const data = new Data(async (args) => {
    seen.push([...args]);
    if (args.includes("top")) {
      if (hold) await new Promise<void>((r) => pending.push(r));
      return { code: 0, stdout: tops.shift() ?? tops[0] ?? "", stderr: "" };
    }
    return { code: 0, stdout: args.includes("config") ? "" : '{"items":[]}', stderr: "" };
  });
  const tasks: Promise<unknown>[] = [];
  let notified = 0;
  const cx: any = { spawn: (fn: (cx: unknown) => Promise<unknown>) => tasks.push(fn(cx)), notify: () => notified++ };
  const wants: Wants = { context: "nightjar-dev", namespace: "lantern", kind: "pods", tab: "resources", detail: "graph", row: null, appNamespace: null };
  const settle = async () => { for (let i = 0; i < 5; i++) await Promise.allSettled(tasks); };
  const topReads = () => seen.filter((a) => a.includes("top")).length;
  return { data, cx, wants, settle, topReads, notified: () => notified, holdTop: (h: boolean) => { hold = h; if (!h) { pending.forEach((r) => r()); pending = []; } } };
}

const TOP_A = "lantern lantern-api-1 100m 200Mi\n";
const TOP_B = "lantern lantern-api-1 140m 210Mi\n";

describe("reading the metrics", () => {
  test("at 2 s: a read every 2 s of the clock, none while one runs; paused: none", async () => {
    const c = cluster([TOP_A, TOP_A, TOP_B, TOP_B, TOP_B]);
    c.data.paceMetrics(2);
    // The feed stamps its reads with the real clock: the ticks' clock starts there.
    let now = Date.now();
    c.data.tick(c.wants, c.cx, now);
    await c.settle();
    expect(c.topReads()).toBe(1);
    c.data.tick(c.wants, c.cx, now + 1000);
    await c.settle();
    expect(c.topReads()).toBe(1);
    // A slow read: the ticks after its pace start nothing more until it answers.
    c.holdTop(true);
    now += 2100;
    c.data.tick(c.wants, c.cx, now);
    c.data.tick(c.wants, c.cx, now + 2500);
    c.data.tick(c.wants, c.cx, now + 5000);
    expect(c.topReads()).toBe(2);
    c.holdTop(false);
    await c.settle();
    c.data.paceMetrics(0);
    c.data.tick(c.wants, c.cx, now + 60000);
    await c.settle();
    expect(c.topReads()).toBe(2);
  });

  test("the same numbers again aren't added to the lines and don't redraw, past flipping 'same numbers' once", async () => {
    const c = cluster([TOP_A, TOP_A, TOP_A, TOP_B]);
    c.data.paceMetrics(2);
    const t0 = Date.now();
    const read = async (at: number) => { c.data.tick(c.wants, c.cx, t0 + at + (at ? 100 * (at / 2000) : 0)); await c.settle(); };
    await read(0);
    expect(c.data.history.of("lantern/lantern-api-1").map((s) => s.cpu)).toEqual([100]);
    expect(c.data.metricsSame).toBe(false);
    const before = c.notified();
    await read(2000);
    expect(c.data.metricsSame).toBe(true);
    const flipped = c.notified();
    expect(flipped).toBeGreaterThan(before);
    await read(4000);
    // Nothing new, nothing flipped: no redraw for the metrics.
    expect(c.notified()).toBe(flipped);
    expect(c.data.history.of("lantern/lantern-api-1")).toHaveLength(1);
    await read(6000);
    expect(c.data.history.of("lantern/lantern-api-1").map((s) => s.cpu)).toEqual([100, 140]);
    expect(c.data.metricsSame).toBe(false);
  });
});
