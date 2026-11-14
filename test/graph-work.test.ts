// Graphs you can work in: zoom (bounds, around the pointer, + - over a graph
// with the keys, cmd-scroll, fit and back), boxes that give up their words
// when small, a box's menu (right click, m) built from its row's menu, an
// Argo box's with its application's, the applications list's right click,
// a scale from a box acting on that box's object.
import { beforeEach, describe, expect, test } from "bun:test";
import { El, byId, handlerOf, texts } from "./support/standins.ts";
import { open, reset } from "./support/window.ts";

const { ZOOM, clampZoom, zoomAt, zoomStep, fitZoom, toggleFit, scaled, lookAt } = await import("../mod/graph-zoom.ts");
const { newView } = await import("../mod/graph-pan.ts");
const { rowGraph, appTree, detailWidth, treeWidth } = await import("../mod/graph-shown.ts");
const { rowMenu } = await import("../mod/actions.ts");
const { rowOf } = await import("../mod/node-menu.ts");
const { listRows, selectedRow } = await import("../mod/nav.ts");

const cx: any = { stop_propagation() {}, notify() {}, spawn() {}, write_to_clipboard() {} };

beforeEach(() => reset());

describe("zoom", () => {
  test("clamped to its bounds; around a point that stays put; + - step around the middle", () => {
    expect(clampZoom(9)).toBe(ZOOM.max);
    expect(clampZoom(0.01)).toBe(ZOOM.min);
    const view = { ...newView(), w: 400, h: 300, x: 100, y: 50 };
    // The picture's point under (200, 100) is at (300, 150) at zoom 1; at 2 it's at (600, 300): still under the pointer.
    zoomAt(view, 2, 200, 100);
    expect(view.z).toBe(2);
    expect(view.x + 200).toBe(600);
    expect(view.y + 100).toBe(300);
    expect(zoomAt(view, 50, 0, 0)).toBe(false);
    expect(view.z).toBe(ZOOM.max);
    expect(zoomAt(view, 0.01, 0, 0)).toBe(true);
    expect(view.z).toBe(ZOOM.min);
    const v2 = { ...newView(), w: 400, h: 300 };
    zoomStep(v2, -1);
    expect(v2.z).toBeCloseTo(1 / ZOOM.step, 2);
  });

  test("fit shows the whole picture (never past 100%); again goes back to 100%", async () => {
    const { v } = await open();
    const s = rowGraph(v, 520)!;
    const view = { ...newView(), w: 300, h: 200 };
    const fit = fitZoom(view, s.laid);
    expect(fit).toBeLessThanOrEqual(1);
    toggleFit(view, s.laid);
    const l = scaled(s.laid, view.z);
    expect(l.width).toBeLessThanOrEqual(300);
    expect(l.height).toBeLessThanOrEqual(200);
    toggleFit(view, s.laid);
    expect(view.z).toBe(1);
    // A small graph in a big canvas: fit stays at 100%.
    expect(fitZoom({ ...newView(), w: 5000, h: 5000 }, s.laid)).toBe(1);
  });

  test("scaled: positions, boxes and lines by the zoom; small boxes give up their words, then show a mark", async () => {
    const { v } = await open();
    const s = rowGraph(v, 520)!;
    const half = scaled(s.laid, 0.5);
    expect(half.width).toBe(Math.round(s.laid.width * 0.5));
    expect(half.d.w).toBe(Math.round(s.laid.d.w * 0.5));
    expect(half.boxes[1]?.x).toBe(Math.round((s.laid.boxes[1]?.x ?? 0) * 0.5));
    expect(half.segs.every((g) => g.w >= 1 && g.h >= 1)).toBe(true);
    expect([lookAt(1), lookAt(0.6), lookAt(0.35)]).toEqual(["full", "line", "mark"]);
  });

  test("over a graph with the keys + and - zoom it, z fits it; elsewhere + and - size the panel", async () => {
    const { v, press, draw } = await open();
    await press(":", "d", "e", "p", "l", "o", "y", "enter", "4");
    draw();
    const view = v.canvases.get("g-row")!;
    const width = v.dividers.size({ key: "detail" } as never);
    await press("+");
    expect(view.z).toBeCloseTo(ZOOM.step, 2);
    expect(v.dividers.size({ key: "detail" } as never)).toBe(width);
    await press("-", "-");
    expect(view.z).toBeLessThan(1);
    await press("z");
    expect(view.z).toBe(fitZoom(view, rowGraph(v, detailWidth(v))!.laid));
    await press("z");
    expect(view.z).toBe(1);
    // The zoom's chips at the graph's foot.
    const shown = texts(draw());
    expect(shown).toContain("fit");
    expect(shown).toContain("100%");
  });

  test("cmd-scroll zooms around the pointer, a plain scroll pans", async () => {
    const { v, press, draw } = await open();
    await press(":", "d", "e", "p", "l", "o", "y", "enter");
    const canvas = byId(draw(), "g-row") as El;
    const view = v.canvases.get("g-row")!;
    handlerOf(canvas, "on_scroll_wheel")({ delta: { x: 0, y: -40 }, modifiers: { platform: true }, local_position: { x: 100, y: 100 } }, cx);
    expect(view.z).toBeCloseTo(ZOOM.step, 2);
    const y = view.y;
    handlerOf(canvas, "on_scroll_wheel")({ delta: { x: 0, y: -30 }, modifiers: {} }, cx);
    expect(view.z).toBeCloseTo(ZOOM.step, 2);
    expect(view.y).toBe(y + 30);
  });
});

describe("a box's menu", () => {
  test("a box's menu is its row's menu (one source), then 'show it in the list'; a right click opens it", async () => {
    const { v, press, draw } = await open();
    await press(":", "d", "e", "p", "l", "o", "y", "enter");
    const s = rowGraph(v, detailWidth(v))!;
    const pod = s.laid.boxes.find((b) => b.node.kind === "pod")!;
    const row = rowOf(v, pod.node.ref!)!;
    expect(row).not.toBeNull();
    const el = byId(draw(), `g-row-${pod.node.key}`) as El;
    handlerOf(el, "on_mouse_down", "right")({}, cx);
    const labels = v.menu?.rows.map((r) => r.label) ?? [];
    const rowLabels = rowMenu(v, row).map((r) => r.label);
    expect(labels.slice(0, rowLabels.length)).toEqual(rowLabels);
    expect(labels).toContain("show it in the list");
    expect(labels).toContain("logs in a pane");
    expect(labels).toContain("copy its name");
    // The same keys as the row's.
    expect(v.menu?.rows.slice(0, rowLabels.length).map((r) => r.key)).toEqual(rowMenu(v, row).map((r) => r.key));
    // Hover names a box whole.
    expect(el.calls.some(([m, a]) => m === "tooltip" && String(a[0]).includes(pod.node.label))).toBe(true);
  });

  test("m on the selected box opens its menu; a view from it shows the object in the list", async () => {
    const { v, press } = await open();
    await press(":", "d", "e", "p", "l", "o", "y", "enter", "4", "m");
    expect(v.menu?.title).toBe(`deploy ${selectedRow(v)?.ref.name}`);
    await press("escape", "j", "j", "m");
    const title = v.menu?.title ?? "";
    const i = v.menu?.rows.findIndex((r) => r.label === "describe") ?? -1;
    v.menu?.rows[i]?.go(cx);
    expect(v.detail).toBe("describe");
    expect(title.endsWith(selectedRow(v)?.ref.name ?? "?")).toBe(true);
  });

  test("a write from a box keeps its ask, and a scale acts on that box's object, not the selected row", async () => {
    const { v, press } = await open();
    await press(":", "d", "e", "p", "l", "o", "y", "enter");
    const selected = selectedRow(v)!;
    const s = rowGraph(v, detailWidth(v))!;
    const rs = s.laid.boxes.find((b) => b.node.kind === "rs" && !b.node.ghost)!;
    v.graphSel = rs.node.key;
    await press("4", "m");
    const scale = v.menu?.rows.find((r) => r.label === "scale");
    v.menu = null;
    scale?.go(cx);
    expect(v.typing?.what).toBe("scale");
    expect(v.typing?.row?.ref.name).toBe(rs.node.ref?.name);
    await press("backspace", "2", "enter");
    expect(v.ask?.name).toBe(rs.node.ref?.name);
    expect(v.ask?.name).not.toBe(selected.ref.name);
    await press("escape");
    expect(v.ask).toBeNull();
  });

  test("an Argo box adds its application's menu; the tree's root and the list's right click open the application's", async () => {
    const { v, press, draw } = await open();
    await press("]", "0");
    expect(v.tab).toBe("argo");
    const s = appTree(v, treeWidth(v))!;
    v.argoNode = s.graph.root.key;
    await press("m");
    const appRows = v.menu?.rows.map((r) => r.label) ?? [];
    expect(appRows).toEqual(expect.arrayContaining(["open its tree", "sync", "refresh", "diff", "history", "roll back to the picked revision"]));
    expect(v.menu?.rows.find((r) => r.label === "sync")?.danger).toBe(true);
    await press("escape");
    const svc = s.laid.boxes.find((b) => b.node.ref?.kind === "deployments")!;
    v.argoNode = svc.node.key;
    await press("m");
    const labels = v.menu?.rows.map((r) => r.label) ?? [];
    expect(labels).toContain("show it in the list");
    expect(labels.some((l) => l.startsWith("sync (application"))).toBe(true);
    await press("escape");
    // The applications list: a right click opens the application's menu.
    const row = byId(draw(), "app-1") as El;
    handlerOf(row, "on_mouse_down", "right")({}, cx);
    expect(v.menu?.title).toMatch(/^application /);
    // Picking sync asks first.
    v.menu?.rows.find((r) => r.label === "sync")?.go(cx);
    expect(v.ask?.kind).toBe("sync");
  });

  test("every row's menu copies its name", async () => {
    const { v } = await open();
    const copied: string[] = [];
    const r = listRows(v)[0]!;
    rowMenu(v, r).find((x) => x.label === "copy its name")?.go({ ...cx, write_to_clipboard: (s: string) => copied.push(s) });
    expect(copied).toEqual([r.ref.name]);
  });
});
