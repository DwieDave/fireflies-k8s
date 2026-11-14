// Every menu's rows: the key a row shows is the key that runs it (shownKey,
// read by the drawing and the handler alike), no two rows show one key, a
// row without a key of its own shows a digit only in a picker; a menu taller
// than its room scrolls with a mark, every row whole otherwise.
import { beforeEach, describe, expect, test } from "bun:test";
import { El, byId, texts } from "./support/standins.ts";
import { open, reset } from "./support/window.ts";

const { shownKey } = await import("../mod/state.ts");
const { rowGraph, appTree, detailWidth, treeWidth } = await import("../mod/graph-shown.ts");
const { menuHeight } = await import("../mod/overlays.ts");

beforeEach(() => reset());

/** Every row's shown key, pressed with the menu open, runs that row (and only it). */
async function eachKeyRunsItsRow(w: Awaited<ReturnType<typeof open>>, openMenu: () => Promise<void>) {
  await openMenu();
  const m = w.v.menu!;
  expect(m).toBeTruthy();
  const keys = m.rows.map((_r, i) => shownKey(m, i));
  const own = keys.filter((k): k is string => k !== null);
  expect(new Set(own).size).toBe(own.length);
  for (let i = 0; i < m.rows.length; i++) {
    const key = keys[i];
    if (key === null || key === undefined) continue;
    await openMenu();
    const ran: number[] = [];
    w.v.menu = { ...w.v.menu!, rows: w.v.menu!.rows.map((r, k) => ({ ...r, go: () => ran.push(k) })) };
    await w.press(key);
    expect([key, ran]).toEqual([key, [i]]);
  }
  w.v.menu = null;
  return { m, keys };
}

describe("a row's shown key runs it", () => {
  test("the row menu, the workload box's, the Argo box's (the longest), the application's, the columns'", async () => {
    const w = await open();
    await w.press(":", "d", "e", "p", "l", "o", "y", "enter");
    const row = await eachKeyRunsItsRow(w, async () => { w.v.menu = null; await w.press("0", "m"); });
    // "copy its name" has no key of its own and shows none (y is yaml here).
    const copy = row.m.rows.findIndex((r) => r.label === "copy its name");
    expect(row.keys[copy]).toBeNull();
    const s = rowGraph(w.v, detailWidth(w.v))!;
    const pod = s.laid.boxes.find((b) => b.node.kind === "pod")!;
    const box = await eachKeyRunsItsRow(w, async () => { w.v.menu = null; w.v.graphSel = pod.node.key; await w.press("4", "m"); });
    expect(box.keys[box.m.rows.findIndex((r) => r.label === "copy its name")]).toBeNull();
    await eachKeyRunsItsRow(w, async () => { w.v.menu = null; await w.press("0", "O"); });
    await w.press("]");
    const t = appTree(w.v, treeWidth(w.v))!;
    const dep = t.laid.boxes.find((b) => b.node.ref?.kind === "deployments")!;
    const argo = await eachKeyRunsItsRow(w, async () => { w.v.menu = null; w.v.argoNode = dep.node.key; await w.press("0", "m"); });
    // The application's rows in it carry no keys (theirs would clash with the row's), and show no digits.
    const appRows = argo.m.rows.map((r, i) => [r.label, argo.keys[i]] as const).filter(([l]) => l.includes("(application"));
    expect(appRows.length).toBeGreaterThan(5);
    expect(appRows.every(([, k]) => k === null)).toBe(true);
    await eachKeyRunsItsRow(w, async () => { w.v.menu = null; await w.press("1", "m"); });
  });

  test("a picker without keys of its own numbers its rows, and the digit runs that row", async () => {
    const w = await open();
    const { keys } = await eachKeyRunsItsRow(w, async () => { w.v.menu = null; await w.press(":", "c", "t", "x", "enter"); });
    expect(keys.slice(0, 2)).toEqual(["1", "2"]);
  });
});

describe("a tall menu", () => {
  test("in a short pane the longest menu scrolls and says there is more; in a tall window every row shows whole", async () => {
    const w = await open({ pane: true, height: 420 });
    await w.press("]");
    const t = appTree(w.v, treeWidth(w.v))!;
    w.v.argoNode = t.laid.boxes.find((b) => b.node.ref?.kind === "deployments")!.node.key;
    await w.press("0", "m");
    const n = w.v.menu!.rows.length;
    expect(menuHeight(w.v.menu!)).toBeGreaterThan(420 - 90);
    expect(texts(w.draw()).some((x) => x.startsWith(`${n} rows · ↑ ↓`))).toBe(true);
    const box = byId(w.draw(), "k8s-menu-box") as El;
    expect(box.calls.some(([m, a]) => m === "max_h" && a[0] === 330)).toBe(true);
    // A window at the size Developer's runs at (zoom 0.9): the same menu fits whole, no mark.
    const tall = await open({ height: 1170 });
    await tall.press("]");
    tall.v.argoNode = w.v.argoNode;
    await tall.press("0", "m");
    expect(menuHeight(tall.v.menu!)).toBeLessThan(1170 - 90);
    expect(texts(tall.draw()).some((x) => x.includes("↑ ↓ or the wheel"))).toBe(false);
  });
});
