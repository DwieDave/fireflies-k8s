// Where the window's menus stand (mod/menu-place.ts, the same file as the
// Databases window's defaults/mods/databases/menu-place.ts in Fireflies, and
// mod/menu-anchor.ts): a right press anywhere (rows, the column header, the
// rail, graph boxes, argo's apps and history, the forwards, the shelf) opens
// its menu at the press, taken from the window position less where the view
// sits (learned from the root's moves) at the app's zoom; a chip's click at
// the pointer as last heard; near the right and bottom edges flipped and whole;
// a key's menu under the table's selected row, else in the middle.
import { beforeEach, describe, expect, test } from "bun:test";
import { El, allCalls, byId, env, handlerOf } from "./support/standins.ts";
import { open, reset } from "./support/window.ts";

const { GAP, MARGIN, placeMenu, inView } = await import("../mod/menu-place.ts");
const { keyedAnchor } = await import("../mod/menu-anchor.ts");
const { menuWidth, menuHeight } = await import("../mod/overlays.ts");
const { railDivider, tableWidth } = await import("../mod/panels.ts");
const { ROW_H } = await import("../mod/nav.ts");

const cx: any = { stop_propagation() {}, notify() {} };

beforeEach(() => reset());

/** The view sits 60 px in and 40 px down in the app window (a window overlay). */
const ORIGIN = { x: 60, y: 40 };

/** The root hears the pointer over the view: where the view sits is learned. */
function hover(root: El, at = { x: 300, y: 200 }) {
  handlerOf(root, "on_mouse_move")({ position: { x: ORIGIN.x + at.x, y: ORIGIN.y + at.y }, local_position: at, modifiers: {} }, cx);
}

/** Where the drawn menu box stands: its left and top. */
function boxAt(root: El): { x: number; y: number } {
  const box = byId(root, "k8s-menu-box")!;
  const arg = (m: string) => box.calls.find(([n]) => n === m)?.[1][0] as number;

  return { x: arg("left"), y: arg("top") };
}

/** Every right press drawn (elements' and the virtual list's), called with a press at `at` (in the view). */
function pressEveryRight(v: any, root: El, at: { x: number; y: number }): number {
  const press = { button: "right", click_count: 1, position: { x: ORIGIN.x + at.x, y: ORIGIN.y + at.y }, modifiers: {} };
  let menus = 0;

  for (const [m, a] of allCalls(root)) {
    const right = m === "on_mouse_down" && a[0] === "right";
    const item = m === "on_item_secondary_click";

    if (!right && !item) continue;

    v.menu = null;
    const f = a[a.length - 1] as (...x: unknown[]) => void;

    if (item) f(v.data ? listKey(v) : "", press, cx);
    else f(press, cx);

    if (!v.menu) continue;

    menus++;
    expect(v.menu.near).toEqual(at);
  }

  return menus;
}

/** The first row's key (a right press on the list names its row). */
const listKey = (v: any): string => v.lastRows?.[0]?.key ?? "";

describe("a menu a press opened", () => {
  test("every right press in every tab: the menu stands at the press, wherever the view sits", async () => {
    // A forward running (made up: a port from 25432 up), for the shelf and the forwards tab.
    env.terminals = [{ address: "t9", state: "live", labels: { "k8s.forward": JSON.stringify({ context: "nightjar-dev", namespace: "lantern", target: "svc/lantern-db", local: 25432, remote: 5432, db: "postgres", name: "lantern-db" }) } }];
    const w = await open({ width: 1300 });
    const { listRows } = await import("../mod/nav.ts");
    (w.v as any).lastRows = listRows(w.v);
    hover(w.draw());
    expect(w.v.origin).toEqual(ORIGIN);
    // The resources tab: rows, the column header, the rail.
    let menus = pressEveryRight(w.v, w.draw(), { x: 400, y: 300 });
    // The detail panel's graph boxes.
    await w.press("4", "d");
    menus += pressEveryRight(w.v, w.draw(), { x: 410, y: 310 });
    w.v.menu = null;
    // Argo: the applications, the tree's boxes, the history.
    await w.press("esc", "]");
    menus += pressEveryRight(w.v, w.draw(), { x: 420, y: 320 });
    w.v.menu = null;
    // The forwards.
    await w.press("]");
    expect(w.v.tab).toBe("forwards");
    const forwards = pressEveryRight(w.v, w.draw(), { x: 430, y: 330 });
    expect(forwards).toBeGreaterThan(0);
    expect(menus).toBeGreaterThan(10);
    env.terminals = [];
  });

  test("the drawn box: just past the press; near the right and bottom edges flipped, whole, the press not under it", async () => {
    const w = await open({ width: 1300, height: 800 });
    hover(w.draw());
    const { selectedRow } = await import("../mod/nav.ts");
    const { rowMenu } = await import("../mod/actions.ts");
    const { atPress } = await import("../mod/menu-anchor.ts");
    const row = selectedRow(w.v)!;
    const openAt = (x: number, y: number) => atPress(w.v, { position: { x: ORIGIN.x + x, y: ORIGIN.y + y } }, () => { w.v.menu = { title: row.ref.name, at: 0, rows: rowMenu(w.v, row) }; });
    openAt(300, 200);
    expect(boxAt(w.draw())).toEqual({ x: 300 + GAP, y: 200 + GAP });
    const width = menuWidth(w.v.menu!, 1300);
    const height = menuHeight(w.v.menu!);
    openAt(1290, 790);
    const at = boxAt(w.draw());
    expect(at).toEqual({ x: 1290 - GAP - width, y: 790 - GAP - height });
    expect(at.x + width).toBeLessThan(1290);
    expect(at.y + height).toBeLessThan(790);
    expect(at.x).toBeGreaterThanOrEqual(MARGIN);
    expect(at.y).toBeGreaterThanOrEqual(MARGIN);
  });

  test("at Developer's zoom 0.9 the press is taken over the zoom", async () => {
    env.zoom = 0.9;
    const w = await open({ width: 1300 });
    hover(w.draw(), { x: 270, y: 180 });
    expect(w.v.pointer).toEqual({ x: 300, y: 200 });
    const { atPress } = await import("../mod/menu-anchor.ts");
    atPress(w.v, { position: { x: ORIGIN.x + 450, y: ORIGIN.y + 270 } }, () => { w.v.menu = { title: "x", at: 0, rows: [{ label: "a", go: () => {} }] }; });
    expect(w.v.menu!.near!.x).toBeCloseTo(500);
    expect(w.v.menu!.near!.y).toBeCloseTo(300);
    expect(inView({ x: 510, y: 310 }, ORIGIN, 0.9)).toEqual({ x: 500, y: 300 });
    env.zoom = 1;
  });

  test("a chip's click (no position): the menu stands where the root last heard the pointer", async () => {
    const w = await open({ width: 1300 });
    hover(w.draw(), { x: 140, y: 16 });
    handlerOf(byId(w.draw(), "k8s-where")!, "on_click")({ click_count: 1, modifiers: {} }, cx);
    expect(w.v.menu?.near).toEqual({ x: 140, y: 16 });
  });
});

describe("a menu a key opened", () => {
  test("m on the table: under the selected row, at the table's left edge", async () => {
    const w = await open({ width: 1300, height: 800 });
    await w.press("j", "j", "m");
    expect(w.v.menu?.near).toBeUndefined();
    const row = keyedAnchor(w.v)!;
    const left = 10 + w.v.dividers.size(railDivider(w.v)) + 10 + 1;
    expect(row).toEqual({ x: left, y: 34 + 12 + 1 + 20 + 18 + 2 * ROW_H, w: tableWidth(w.v) - 2, h: ROW_H });
    expect(boxAt(w.draw())).toEqual({ x: left, y: row.y + ROW_H });
  });

  test("another panel with the keys (the rail), or a narrow window: the middle", async () => {
    const w = await open({ width: 1300, height: 800 });
    await w.press("1", "m");
    expect(keyedAnchor(w.v)).toBeNull();
    const m = w.v.menu!;
    expect(boxAt(w.draw())).toEqual(placeMenu({ width: menuWidth(m, 1300), height: menuHeight(m) }, w.v.size, null));
    const narrow = await open({ width: 600, height: 800 });
    await narrow.press("m");
    expect(keyedAnchor(narrow.v)).toBeNull();
  });
});
