// The kind's table's columns: sorted by what the cells mean (sort.ts), the
// header's clicks and edges and the column keys (columns.ts,
// columns-menu.ts), widths and sorts kept per kind, CPU and memory lines in
// the workloads' rows, and a cluster without metrics-server said once.
import { beforeEach, describe, expect, test } from "bun:test";
import { El, byId, handlerOf, sharedMap, texts } from "./support/standins.ts";
import { open, reset } from "./support/window.ts";

const { sortRows, sortKey, sizeOf, spanOf, nextSort } = await import("../mod/sort.ts");
const { listRows, selectedRow } = await import("../mod/nav.ts");
const { shownColumns, focusedColumn, kindColumns } = await import("../mod/columns.ts");
const { tableWidth } = await import("../mod/panels.ts");

const cx: any = { stop_propagation() {}, notify() {} };
const none = () => null;

/** Every handler of that name on the element itself (the root carries the dividers' and the columns'). */
const each = (el: El, name: string, arg?: string) => (ev: unknown) => {
  for (const [m, a] of el.calls) if (m === name && (arg === undefined || a[0] === arg)) (a[a.length - 1] as (e: unknown, c: unknown) => void)(ev, cx);
};

beforeEach(() => reset());

describe("sorting by meaning", () => {
  const row = (name: string, cell: any) => ({ key: name, ref: { kind: "pods", name, namespace: "x" }, uid: name, tone: "ok", status: "", created: null, labels: new Map(), cells: [cell] }) as any;

  test("sizes, spans and plain numbers read as numbers; the rest as text with numbers in it", () => {
    expect(sizeOf("10Gi")).toBe(10 * 1024 ** 3);
    expect(sizeOf("512Mi")! < sizeOf("1Gi")!).toBe(true);
    expect(sizeOf("10.0.0.1")).toBeNull();
    expect(spanOf("3h12m")).toBe(3 * 3600 + 12 * 60);
    expect(spanOf("18d")).toBe(18 * 86400);
    expect(spanOf("never")).toBeNull();
    const rows = ["9", "10", "2"].map((n) => row(n, { t: "text", text: n }));
    expect(sortRows(rows, 0, false, none).map((r) => r.key)).toEqual(["2", "9", "10"]);
    const spans = ["1d", "40m", "3h12m"].map((n) => row(n, { t: "text", text: n }));
    expect(sortRows(spans, 0, false, none).map((r) => r.key)).toEqual(["40m", "3h12m", "1d"]);
  });

  test("ages by time (the youngest first up), restarts by count, a status by its tone then its word", () => {
    const now = 1_000_000;
    const ages = [row("old", { t: "age", at: now - 9000 }), row("new", { t: "age", at: now - 10 }), row("unknown", { t: "age", at: null })];
    expect(sortRows(ages, 0, false, none, now).map((r) => r.key)).toEqual(["new", "old", "unknown"]);
    // The unknown stays last the other way too.
    expect(sortRows(ages, 0, true, none, now).map((r) => r.key)).toEqual(["old", "new", "unknown"]);
    const marks = [3, 0, 12].map((n) => row(String(n), { t: "marks", count: n, recent: false }));
    expect(sortRows(marks, 0, true, none).map((r) => r.key)).toEqual(["12", "3", "0"]);
    const status = [row("a", { t: "text", text: "Running", tone: "ok" }), row("b", { t: "text", text: "CrashLoopBackOff", tone: "bad" }), row("c", { t: "text", text: "Pending", tone: "wk" })];
    expect(sortRows(status, 0, false, none).map((r) => r.key)).toEqual(["b", "c", "a"]);
  });

  test("cpu and memory by the reading now; ready by how much is ready", () => {
    const m = (pod: string) => ({ t: "metric", what: "mem", pods: [pod] });
    const rows = [row("small", m("small")), row("big", m("big")), row("none", m("none"))];
    const now = (c: any) => ({ small: 10, big: 900 } as Record<string, number>)[c.pods[0]] ?? null;
    expect(sortRows(rows, 0, true, now).map((r) => r.key)).toEqual(["big", "small", "none"]);
    expect(sortKey({ t: "ready", blocks: ["ok", "bad"], text: "1/2" }, none).num).toBe(0.5);
  });

  test("a click sorts up, again down, a third time back to the default order", () => {
    const up = nextSort(null, "age");
    expect(up).toEqual({ col: "age", desc: false });
    const down = nextSort(up, "age");
    expect(down).toEqual({ col: "age", desc: true });
    expect(nextSort(down, "age")).toBeNull();
    expect(nextSort(down, "cpu")).toEqual({ col: "cpu", desc: false });
  });
});

describe("the header and the column keys", () => {
  test("a header click sorts by that column (↑, ↓, gone); the selection stays on its row; kept per kind", async () => {
    const { v, draw, press } = await open();
    const before = listRows(v).map((r) => r.ref.name);
    await press("j", "j");
    const picked = selectedRow(v)?.key;
    const restarts = kindColumns(v).findIndex((c) => c.title === "restarts");
    const th = () => byId(draw(), `th-${restarts}`) as El;
    handlerOf(th(), "on_click")({}, cx);
    expect(v.columns.sorts.get("pods")).toEqual({ col: "restarts", desc: false });
    expect(texts(draw())).toContain("RESTARTS ↑");
    handlerOf(th(), "on_click")({}, cx);
    expect(texts(draw())).toContain("RESTARTS ↓");
    // The most restarted pod first.
    expect(listRows(v)[0]?.status).toBe("CrashLoopBackOff");
    expect(selectedRow(v)?.key).toBe(picked);
    expect((sharedMap.get("k8s.columns") as any).sort.pods).toEqual({ col: "restarts", desc: true });
    handlerOf(th(), "on_click")({}, cx);
    expect(listRows(v).map((r) => r.ref.name)).toEqual(before);
    // Deployments keep their own.
    await press(":", "d", "e", "p", "l", "o", "y", "enter");
    expect(v.columns.sorts.get("deployments")).toBeUndefined();
  });

  test(", . move the keys along the columns; o sorts by that one; < > narrow and widen it; kept for the next window", async () => {
    const { v, press, draw } = await open();
    await press(".", ".", ".");
    const shown = shownColumns(v, tableWidth(v));
    expect(focusedColumn(v, shown)?.col.title).toBe("status");
    await press("o");
    expect(v.columns.sorts.get("pods")).toEqual({ col: "status", desc: false });
    expect(listRows(v)[0]?.tone).toBe("bad");
    await press(">", ">");
    expect(v.columns.widths.get("pods")?.get("status")).toBe(128 + 32);
    await press("<");
    expect(v.columns.widths.get("pods")?.get("status")).toBe(128 + 16);
    await press(",");
    expect(focusedColumn(v, shownColumns(v, tableWidth(v)))?.col.title).toBe("restarts");
    expect(texts(draw())).toContain("STATUS ↑");
    // A new window reads them back.
    const next = await open();
    expect(next.v.columns.widths.get("pods")?.get("status")).toBe(144);
    expect(next.v.columns.sorts.get("pods")).toEqual({ col: "status", desc: false });
  });

  test("a drag on a header's edge sets the width (kept when it ends); a double click fits it; the name can be set too", async () => {
    const { v, draw } = await open({ width: 1900 });
    const edge = byId(draw(), "th-edge-node") as El;
    handlerOf(edge, "on_mouse_down", "left")({ click_count: 1, position: { x: 500, y: 0 } }, cx);
    expect(v.columns.drag?.col).toBe("node");
    const root = draw() as El;
    each(root, "on_mouse_move")({ position: { x: 560, y: 0 } });
    expect(v.columns.widths.get("pods")?.get("node")).toBe(140);
    expect(sharedMap.get("k8s.columns")).toBeUndefined();
    each(root, "on_mouse_up", "left")({});
    expect(v.columns.drag).toBeNull();
    expect((sharedMap.get("k8s.columns") as any).widths.pods.node).toBe(140);
    // A double click fits the column to its longest cell (the node names) and its title.
    handlerOf(byId(draw(), "th-edge-node") as El, "on_mouse_down", "left")({ click_count: 2, position: { x: 0, y: 0 } }, cx);
    const fitted = v.columns.widths.get("pods")?.get("node") ?? 0;
    expect(fitted).toBeGreaterThan(40);
    expect(fitted).toBeLessThan(140);
    // The name (which takes the rest) dragged narrower gets a width of its own.
    handlerOf(byId(draw(), "th-edge-name") as El, "on_mouse_down", "left")({ click_count: 1, position: { x: 400, y: 0 } }, cx);
    each(draw() as El, "on_mouse_move")({ position: { x: 300, y: 0 } });
    expect(v.columns.widths.get("pods")?.get("name")).toBeGreaterThan(36);
  });

  test("O (and a right click on a header) opens the columns menu: sort by any, the default order, fit, widths back", async () => {
    const { v, press, draw } = await open();
    await press("O");
    expect(v.menu?.title).toBe("columns of pods");
    const labels = v.menu?.rows.map((r) => r.label) ?? [];
    expect(labels).toContain("sort by mem");
    expect(labels).toContain("the default order");
    expect(labels).toContain("every width back");
    const i = labels.indexOf("sort by mem");
    v.menu?.rows[i]?.go(cx);
    expect(v.columns.sorts.get("pods")).toEqual({ col: "mem", desc: false });
    await press("escape");
    v.menu = null;
    handlerOf(byId(draw(), "th-1") as El, "on_mouse_down", "right")({}, cx);
    expect(v.menu?.title).toBe("columns of pods");
    expect(v.columns.at.get("pods")).toBe("ready");
  });
});

describe("cpu and memory", () => {
  test("a narrow table lets the details go first (node, up-to-date…), keeping cpu and memory longer", async () => {
    const { v } = await open({ width: 1600 });
    const titles = shownColumns(v, 700).map((s) => s.col.title);
    expect(titles).toContain("cpu");
    expect(titles).toContain("mem");
    expect(titles).not.toContain("node");
    expect(titles).toEqual(kindColumns(v).map((c) => c.title).filter((t) => titles.includes(t)));
  });

  test("deployments and stateful sets show memory beside cpu, as a line and the value now", async () => {
    const { v, press, draw } = await open({ width: 1600 });
    await press(":", "d", "e", "p", "l", "o", "y", "enter");
    expect(kindColumns(v).map((c) => c.title)).toContain("mem");
    const shown = texts(draw());
    expect(shown).toContain("MEM");
    expect(shown.some((s) => /Mi$/.test(s))).toBe(true);
    await press(":", "s", "t", "s", "enter");
    expect(kindColumns(v).map((c) => c.title)).toEqual(["name", "ready", "service", "cpu", "mem", "age"]);
  });

  test("without metrics-server the column says so once, quietly, not a row of dashes", async () => {
    reset({ K8S_FAKE_NO_METRICS: "1" });
    const { v, draw } = await open({ width: 1600 });
    expect(v.data.metricsMissing).toBe(true);
    const shown = texts(draw());
    expect(shown.filter((s) => s === "no metrics-server").length).toBe(2);
    expect(shown.filter((s) => s === "—").length).toBe(0);
  });
});
