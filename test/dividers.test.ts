// The dividers between panels (mod/dividers.ts, copied as it is from the
// Databases window's defaults/mods/databases/dividers.ts in Fireflies, its
// test adapted from scripts/databases-dividers.test.ts there): a drag by
// calling the handlers (the grab's press, the root's moves and release), the
// clamp so no panel vanishes, the keyboard steps, the double click's reset,
// the sizes kept and read back. Then the window's own: its dividers drawn
// where panels sit side by side or stacked, a drag of the rail, + and - on
// the panel with the keys, the sizes kept per window and per pane.
import { beforeEach, describe, expect, test } from "bun:test";
import { El, allCalls, byId, calls, env, handlerOf, key, makeCx, sharedMap, store } from "./support/standins.ts";
import { KUBECTL, writeLog } from "./support/fake.ts";

const { Dividers, clampSize, divider, tracking, STEP } = await import("../mod/dividers.ts");

const theme: any = { accent: "#ff0000", ansi8: "#808080" };
const cx: any = { stop_propagation() {}, notify() {} };
const LEFT = { key: "left", axis: "x", side: 1, min: 200, max: 700, start: 300 } as const;
const LOG = { key: "log", axis: "y", side: -1, min: 40, max: 400, start: 92 } as const;

describe("the dividers (the Databases window's pattern)", () => {
  test("a size is its start until dragged, always inside its bounds", () => {
    const ds = new Dividers({}, () => {});
    expect(ds.size(LEFT)).toBe(300);
    expect(clampSize(LEFT, 50)).toBe(200);
    expect(clampSize(LEFT, 9000)).toBe(700);
    // A max under the min (a small window): the min wins, the panel never vanishes.
    expect(clampSize({ ...LEFT, max: 120 }, 150)).toBe(200);
    expect(new Dividers({ left: 9999 }, () => {}).size(LEFT)).toBe(700);
  });

  test("a drag by the handlers: the press on the grab, the root's moves, the release keeps it", () => {
    const saved: unknown[] = [];
    const ds = new Dividers({}, (s) => saved.push(s));
    const grab = divider(theme, "split-left", LEFT, ds, 6) as unknown as El;
    handlerOf(grab, "on_mouse_down", "left")({ click_count: 1, position: { x: 306, y: 10 } }, cx);
    expect(ds.dragging("left")).toBe(true);
    const root = tracking(new El() as never, ds) as unknown as El;
    handlerOf(root, "on_mouse_move")({ position: { x: 386, y: 400 } }, cx);
    expect(ds.size(LEFT)).toBe(380);
    // Live: no save while it moves.
    expect(saved).toEqual([]);
    handlerOf(root, "on_mouse_move")({ position: { x: 5000, y: 0 } }, cx);
    expect(ds.size(LEFT)).toBe(700);
    handlerOf(root, "on_mouse_move")({ position: { x: 0, y: 0 } }, cx);
    expect(ds.size(LEFT)).toBe(200);
    handlerOf(root, "on_mouse_move")({ position: { x: 346, y: 0 } }, cx);
    handlerOf(root, "on_mouse_up", "left")({}, cx);
    expect(ds.dragging("left")).toBe(false);
    expect(saved).toEqual([{ left: 340 }]);
  });

  test("a divider sizing the panel after it (side -1): moving the pointer up grows it", () => {
    const ds = new Dividers({}, () => {});
    ds.down(LOG, 500);
    ds.move(440);
    expect(ds.size(LOG)).toBe(152);
    ds.up();
  });

  test("the pointer leaving the view ends the drag; the zoom is taken out of the pointer's px", () => {
    const saved: unknown[] = [];
    const ds = new Dividers({}, (s) => saved.push(s));
    env.zoom = 2;
    ds.down(LEFT, 300);
    const root = tracking(new El() as never, ds) as unknown as El;
    // 100 drawn px at zoom 2 are 50 layout px.
    handlerOf(root, "on_mouse_move")({ position: { x: 700, y: 0 } }, cx);
    expect(ds.size(LEFT)).toBe(300 + (350 - 300));
    handlerOf(root, "on_hover")(false, cx);
    expect(ds.drag).toBe(null);
    expect(saved.length).toBe(1);
    env.zoom = 1;
  });

  test("while held the root keeps the resize pointer and the line is the accent", () => {
    const ds = new Dividers({}, () => {});
    ds.down(LEFT, 300);
    const root = tracking(new El() as never, ds) as unknown as El;
    expect(root.calls.some(([m]) => m === "cursor_col_resize")).toBe(true);
    let grab = divider(theme, "split-left", LEFT, ds, 6) as unknown as El;
    expect(allCalls(grab).some(([m, a]) => m === "bg" && a[0] === "#ff0000")).toBe(true);
    // Not held, not hovered: nothing drawn but the grab area.
    ds.up();
    grab = divider(theme, "split-left", LEFT, ds, 6) as unknown as El;
    expect(allCalls(grab).some(([m]) => m === "bg")).toBe(false);
    expect(grab.calls.some(([m, a]) => m === "w" && a[0] === 6)).toBe(true);
    // Hovered: the quiet mark.
    handlerOf(grab, "on_hover")(true, cx);
    grab = divider(theme, "split-left", LEFT, ds, 6) as unknown as El;
    expect(allCalls(grab).some(([m, a]) => m === "bg" && a[0] === "#808080")).toBe(true);
  });

  test("the keys: + grows the focused panel at each of its edges, - shrinks it, clamped", () => {
    const saved: unknown[] = [];
    const ds = new Dividers({}, (s) => saved.push(s));
    const edges = [{ divider: LEFT, sign: -1 }, { divider: LOG, sign: -1 }] as const;
    expect(ds.stepAll(edges, 1)).toBe(true);
    expect(ds.size(LEFT)).toBe(300 - STEP);
    expect(ds.size(LOG)).toBe(92 - STEP);
    expect(saved.length).toBe(1);
    ds.stepAll(edges, -1);
    expect([ds.size(LEFT), ds.size(LOG)]).toEqual([300, 92]);
    const small = new Dividers({ log: 40, left: 200 }, (s) => saved.push(s));
    const n = saved.length;
    expect(small.stepAll(edges, 1)).toBe(false);
    expect(saved.length).toBe(n);
  });

  test("a double click on the divider resets it to its start, and the reset is kept", () => {
    const saved: unknown[] = [];
    const ds = new Dividers({ left: 500, log: 60 }, (s) => saved.push(s));
    const grab = divider(theme, "split-left", LEFT, ds, 6) as unknown as El;
    handlerOf(grab, "on_mouse_down", "left")({ click_count: 2, position: { x: 500, y: 0 } }, cx);
    expect(ds.size(LEFT)).toBe(300);
    expect(ds.drag).toBe(null);
    expect(saved).toEqual([{ log: 60 }]);
    expect(ds.reset("left")).toBe(false);
  });
});

const { default: K8s } = await import("../mod/main.ts");
const { onKey } = await import("../mod/input.ts");
const { frame } = await import("../mod/frame.ts");
const { detailWidth } = await import("../mod/graph-shown.ts");
const { railDivider, detailDivider } = await import("../mod/panels.ts");

const HOME = "/home/test/.config/herdr-app";

async function open(o: { pane?: boolean; width?: number; height?: number } = {}) {
  env.props = o.pane ? { slot: "s1" } : { overlay: "o1" };
  const v = new K8s();
  const t = makeCx();
  v.init(undefined, t.cx);
  await t.settle();
  v.size = { width: o.width ?? 1300, height: o.height ?? 800 };
  for (let i = 0; i < 3; i++) {
    v.tick(t.cx);
    await t.settle();
  }
  const draw = () => frame(v, new Proxy({}, { get: () => "#808080" }) as never, t.cx) as unknown as El;
  const press = (...names: string[]) => { for (const n of names) onKey(v, key(n) as never, t.cx); };
  const settle = async () => {
    v.tick(t.cx);
    await t.settle();
  };
  return { v, draw, press, settle };
}

beforeEach(() => {
  calls.length = 0;
  sharedMap.clear();
  store.clear();
  env.files.clear();
  env.fake = { K8S_FAKE_LOG: writeLog() };
  env.files.set(`${HOME}/k8s/settings.json`, JSON.stringify({ kubectl: KUBECTL }));
});

describe("the window's panels", () => {
  test("wide: a divider each side of the table; middle: the rail's and one over the detail panel; narrow: none", async () => {
    const ids = (el: El): string[] => [...el.ids, ...el.kids.flatMap(ids)];
    expect(ids((await open()).draw())).toEqual(expect.arrayContaining(["k8s-div-rail", "k8s-div-detail"]));
    expect(ids((await open({ width: 900 })).draw())).toEqual(expect.arrayContaining(["k8s-div-rail", "k8s-div-detail-h"]));
    const narrow = ids((await open({ width: 520 })).draw()).filter((i) => i.startsWith("k8s-div"));
    expect(narrow).toEqual([]);
    const argo = await open();
    argo.press("]");
    await argo.settle();
    await argo.settle();
    expect(ids(argo.draw())).toEqual(expect.arrayContaining(["argo-div-apps", "argo-div-side"]));
  });

  test("the rail dragged wider by its divider: the root follows the pointer, the size is kept for the next window", async () => {
    const { v, draw } = await open();
    const root = draw();
    const grab = byId(root, "k8s-div-rail")!;
    handlerOf(grab, "on_mouse_down", "left")({ click_count: 1, position: { x: 220, y: 300 } }, cx);
    // The root is the frame's outer element: tracking's handlers sit on it.
    const moves = root.calls.filter(([m]) => m === "on_mouse_move").map(([, a]) => a[a.length - 1] as (...x: unknown[]) => void);
    moves.forEach((f) => f({ position: { x: 300, y: 300 } }, cx));
    handlerOf(root, "on_mouse_up", "left")({}, cx);
    expect(v.dividers.size(railDivider(v))).toBe(290);
    expect(sharedMap.get("k8s.sizes")).toEqual({ window: { rail: 290 } });
    const again = await open();
    expect(again.v.dividers.size(railDivider(again.v))).toBe(290);
    // A pane keeps its own.
    const pane = await open({ pane: true });
    expect(pane.v.dividers.size(railDivider(pane.v))).toBe(210);
  });

  test("+ and - on the detail panel widen and narrow it; the graph is laid out for the new width", async () => {
    const { v, press } = await open();
    press("4");
    expect(v.panel).toBe("detail");
    const before = detailWidth(v);
    press("+");
    expect(detailWidth(v)).toBe(before + 24);
    press("-", "-");
    expect(detailWidth(v)).toBe(before - 24);
    // The table between: + takes from both its neighbours.
    press("0");
    expect(v.panel).toBe("table");
    const rail = v.dividers.size(railDivider(v));
    const det = v.dividers.size(detailDivider(v));
    press("=");
    expect([v.dividers.size(railDivider(v)), v.dividers.size(detailDivider(v))]).toEqual([rail - 24, det - 24]);
  });

  test("the keys are listed in ?", async () => {
    const { draw, press } = await open();
    press("?");
    const texts = (el: El): string[] => [...el.text, ...el.kids.flatMap(texts)];
    expect(texts(draw()).join(" ")).toContain("the panel with the keys wider or narrower");
  });
});
