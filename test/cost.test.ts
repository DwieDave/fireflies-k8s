// What a frame costs, kept small for the app's interpreter (a render has
// 50 ms there): the table's rows as a virtual list (its clicks and right
// presses on the list, the selection scrolled into sight), a graph built
// only where it shows, the busy fake namespace (60 pods), and every
// namespace's list finding its pods' readings.
import { beforeEach, describe, expect, test } from "bun:test";
import { El, byId, handlerOf } from "./support/standins.ts";
import { open, reset } from "./support/window.ts";

const { listRows, selectedRow, revealRow } = await import("../mod/nav.ts");
const { inSight } = await import("../mod/graph-view.ts");
const { metricNow } = await import("../mod/columns.ts");

const cx: any = { stop_propagation() {}, notify() {}, spawn() {} };

beforeEach(() => reset());

describe("the rows as a virtual list", () => {
  test("a click selects, a second soon after opens, a right press opens the row's menu", async () => {
    const { v, draw, press } = await open();
    await press(":", "d", "e", "p", "l", "o", "y", "enter");
    const rows = listRows(v);
    const list = byId(draw(), "k8s-rows") as El;
    const inner = list.kids.find((k) => k.calls.some(([m]) => m === "on_item_click")) as El;
    const second = rows[1]!;
    handlerOf(inner, "on_item_click")(second.key, cx);
    expect(selectedRow(v)?.key).toBe(second.key);
    expect(v.drill).toBeNull();
    handlerOf(inner, "on_item_click")(second.key, cx);
    expect(v.drill?.label).toBe(`deployment ${second.ref.name}`);
    await press("escape");
    handlerOf(inner, "on_item_secondary_click")(rows[2]!.key, {}, cx);
    expect(v.menu?.title).toBe(rows[2]!.ref.name);
  });

  test("the selection is scrolled into sight only when it leaves it", async () => {
    const { v } = await open();
    const asked: number[] = [];
    let y = 0;
    v.tableScroll = { scroll_to_item: (i: number) => asked.push(i), scroll_to_bottom() {}, offset: () => ({ x: 0, y }), release: () => true } as never;
    v.rowsHeight = 220; // ten rows in sight
    revealRow(v, 5);
    expect(asked).toEqual([]);
    revealRow(v, 12);
    expect(asked).toEqual([3]);
    y = -22 * 20;
    revealRow(v, 4);
    expect(asked).toEqual([3, 4]);
  });
});

describe("a busy namespace", () => {
  test("sixty pods list, sort and draw; the graph builds only the boxes in sight", async () => {
    const { v, press, draw } = await open({ width: 1600, height: 900 });
    await press("n", "h", "i", "v", "e", "enter");
    expect(listRows(v).length).toBe(60);
    draw();
    const view = v.canvases.get("g-row");
    expect(view).toBeDefined();
    const seen = inSight({ x: 0, y: 0 }, { w: 400, h: 300 }, 0);
    expect(seen(10, 10, 100, 40)).toBe(true);
    expect(seen(10, 900, 100, 40)).toBe(false);
    const ids = (el: El): string[] => [...el.ids, ...el.kids.flatMap(ids)];
    // Sixty pods, far fewer pod boxes built than that.
    const podBoxes = ids(draw()).filter((i) => /^g-row-[0-9a-f-]{36}$/.test(i));
    expect(podBoxes.length).toBeGreaterThan(0);
    expect(podBoxes.length).toBeLessThan(40);
  });

  test("every namespace's list finds its pods' readings (the metrics are keyed namespace/name)", async () => {
    const { v, press } = await open();
    await press("n", "0");
    const pod = listRows(v).find((r) => r.ref.name === "lantern-db-0")!;
    const cell = pod.cells.find((c) => c.t === "metric")!;
    expect(cell.t === "metric" && metricNow(v, cell)).toBeGreaterThan(0);
  });
});
