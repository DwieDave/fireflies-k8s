// The workload graph top to bottom (ranks as rows, wrapping, no overlap, the
// lines going down) and moving a graph in its canvas (drag against click,
// the clamps, the keys' pan, centring).
import { describe, expect, test } from "bun:test";
import type { GNode, Graph } from "../mod/graph.ts";
import type { Laid, Placed } from "../mod/graph-layout.ts";
import { readingOrder } from "../mod/graph-layout.ts";
import { boxWidth, directionFor, layoutDown } from "../mod/graph-down.ts";
import { cancel, centreOn, dragTo, newView, offset, panBy, panKey, press, release, roomy, SLOP } from "../mod/graph-pan.ts";

const node = (key: string, kind: string, children: GNode[] = [], label = key): GNode => ({ key, label, kind, sub: "", tone: "ok", icon: null, ref: null, children });
const pods = (n: number, prefix = "lantern-api-n7es") => Array.from({ length: n }, (_, i) => node(`${prefix}-p${i}`, "pod"));

/** lantern-api as the fake cluster has it: ingress → service → deploy → three replica sets, the live one with `n` pods. */
function deployment(n: number): Graph {
  const root = node("deploy", "deploy", [node("rs-live", "rs", pods(n)), node("rs-old1", "rs"), node("rs-old2", "rs")], "lantern-api");
  const svc = node("svc", "svc", [], "lantern-api");
  const ing = node("ing", "ing", [], "lantern.nightjar.test");
  return { root, feeders: [{ node: svc, depth: 1, to: ["deploy"] }, { node: ing, depth: 2, to: ["svc"] }] };
}

const at = (l: Laid, key: string): Placed => l.boxes.find((b) => b.node.key === key)!;

function overlaps(l: Laid): boolean {
  const { w, h } = l.d;
  return l.boxes.some((a, i) => l.boxes.some((b, j) => i < j && a.x < b.x + w && b.x < a.x + w && a.y < b.y + h && b.y < a.y + h));
}

/** Whether a line piece runs through a box (not just touching its edge). */
function crossesBox(l: Laid): boolean {
  const { w, h } = l.d;
  return l.segs.some((s) => l.boxes.some((b) => s.x + s.w > b.x + 1 && s.x < b.x + w - 1 && s.y + s.h > b.y + 1 && s.y < b.y + h - 1));
}

describe("top to bottom", () => {
  test("a row per rank: ingress, service, the deployment, its replica sets, the pods", () => {
    const l = layoutDown(deployment(4), 1200);
    const y = (k: string) => at(l, k).y;
    expect(l.dir).toBe("down");
    expect(y("ing")).toBeLessThan(y("svc"));
    expect(y("svc")).toBeLessThan(y("deploy"));
    expect(y("deploy")).toBeLessThan(y("rs-live"));
    expect(y("rs-live")).toBe(y("rs-old1"));
    expect(y("rs-live")).toBeLessThan(y("lantern-api-n7es-p0"));
    // Wide enough: the four pods in one row.
    expect(new Set(pods(4).map((p) => y(p.key))).size).toBe(1);
    expect(overlaps(l)).toBe(false);
    expect(crossesBox(l)).toBe(false);
  });

  test("a parent sits centred over the first row of what it owns; the feeders centred on the root", () => {
    const l = layoutDown(deployment(4), 1200);
    const mid = (k: string) => at(l, k).x + l.d.w / 2;
    const ps = pods(4).map((p) => mid(p.key));
    expect(Math.abs(mid("rs-live") - (ps[0]! + ps[3]!) / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(mid("svc") - mid("deploy"))).toBeLessThanOrEqual(1);
    expect(Math.abs(mid("ing") - mid("deploy"))).toBeLessThanOrEqual(1);
  });

  test.each([300, 460, 560, 800])("a long row of pods wraps into further rows inside %ipx, nothing overlaps", (width) => {
    const l = layoutDown(deployment(9), width);
    expect(l.width).toBeLessThanOrEqual(width + 1);
    expect(l.boxes.every((b) => b.x >= l.d.pad && b.x + l.d.w <= width - l.d.pad + 1)).toBe(true);
    const rows = new Set(pods(9).map((p) => at(l, p.key).y));
    expect(rows.size).toBeGreaterThan(1);
    expect(overlaps(l)).toBe(false);
    expect(crossesBox(l)).toBe(false);
  });

  test("nested wrapped groups keep their spines apart (no two uprights overlap)", () => {
    for (const width of [460, 560]) {
      const l = layoutDown(deployment(9), width);
      const ups = l.segs.filter((s) => s.w === 1 && s.h > 1);
      const clash = ups.some((a, i) => ups.some((b, j) => i < j && a.x === b.x && a.y < b.y + b.h && b.y < a.y + a.h));
      expect(clash).toBe(false);
    }
  });

  test("the lines go down: every box but the top row has a line into its head", () => {
    const l = layoutDown(deployment(9), 460);
    const top = Math.min(...l.boxes.map((b) => b.y));
    for (const b of l.boxes.filter((x) => x.y > top)) {
      const mid = b.x + Math.round(l.d.w / 2);
      expect(l.segs.some((s) => s.w === 1 && s.x === mid && s.y + s.h === b.y)).toBe(true);
    }
  });

  test("a failing pod's line runs live", () => {
    const g = deployment(3);
    const bad = { ...g.root.children[0]!.children[0]!, tone: "bad" as const };
    const live = { ...g.root.children[0]!, children: [bad, ...g.root.children[0]!.children.slice(1)] };
    const l = layoutDown({ ...g, root: { ...g.root, children: [live, ...g.root.children.slice(1)] } }, 900);
    const b = at(l, bad.key);
    expect(l.segs.some((s) => s.live && s.w === 1 && s.y + s.h === b.y)).toBe(true);
  });

  test("boxes as wide as the longest name needs, as far as the panel allows", () => {
    const l = layoutDown(deployment(2), 900);
    expect(l.d.w).toBeGreaterThanOrEqual(boxWidth(node("lantern-api-n7es-p0", "pod")));
    expect(l.d.w).toBeGreaterThan(168);
    expect(layoutDown(deployment(2), 200).d.w).toBeLessThanOrEqual(200 - 2 * l.d.pad);
  });

  test("reading order goes row by row", () => {
    const l = layoutDown(deployment(4), 1200);
    expect(readingOrder(l).map((b) => b.node.key).slice(0, 4)).toEqual(["ing", "svc", "deploy", "rs-live"]);
  });

  test("the panel's proportions pick the direction", () => {
    expect(directionFor(546, 540)).toBe("down");
    expect(directionFor(680, 180)).toBe("right");
    expect(directionFor(1400, 330)).toBe("right");
  });
});

describe("moving a graph", () => {
  const big = (): Laid => layoutDown(deployment(30), 600);

  test("a press that doesn't move past the slop is a click on its box", () => {
    const v = newView();
    press(v, 100, 100, "rs-live");
    expect(dragTo(v, 100 + SLOP - 1, 100)).toBe(false);
    expect(release(v)).toBe("rs-live");
    expect(v.x).toBe(0);
  });

  test("a drag from a box moves the picture and selects nothing", () => {
    const v = newView();
    v.x = 50;
    v.y = 60;
    press(v, 100, 100, "rs-live");
    expect(dragTo(v, 80, 70)).toBe(true);
    expect([v.x, v.y]).toEqual([70, 90]);
    expect(release(v)).toBeNull();
    expect(v.drag).toBeNull();
  });

  test("the pointer leaving ends a drag; a press on the empty canvas selects nothing", () => {
    const v = newView();
    press(v, 10, 10, null);
    expect(cancel(v)).toBe(true);
    expect(cancel(v)).toBe(false);
    press(v, 10, 10, null);
    expect(release(v)).toBeNull();
  });

  test("the pan is clamped to the picture", () => {
    const l = big();
    const v = newView();
    v.w = 400;
    v.h = 300;
    const first = l.boxes[0]!.node.key;
    offset(l, first, v);
    panBy(v, -5000, -5000);
    expect(offset(l, first, v)).toEqual({ x: 0, y: 0 });
    panBy(v, 1e6, 1e6);
    expect(offset(l, first, v)).toEqual({ x: Math.max(0, l.width - 400), y: l.height - 300 });
  });

  test("a picture narrower than its canvas sits in the middle across", () => {
    const l = layoutDown(deployment(1), 600);
    const v = newView();
    v.w = l.width + 100;
    v.h = 2000;
    expect(offset(l, null, v).x).toBe(-50);
    expect(roomy(l, v)).toBe(false);
  });

  test("H J K L move the view; c centres the box", () => {
    expect(panKey("L")).toEqual([80, 0]);
    expect(panKey("K")).toEqual([0, -80]);
    expect(panKey("j")).toBeNull();
    const l = big();
    const v = newView();
    const last = l.boxes[l.boxes.length - 1]!;
    centreOn(v, l, last.node.key);
    const o = offset(l, last.node.key, v);
    expect(last.y - o.y).toBeGreaterThanOrEqual(0);
    expect(last.y + l.d.h - o.y).toBeLessThanOrEqual(v.h);
  });

  test("a selection moved out of sight is brought into view; a pan by hand stays while it doesn't move", () => {
    const l = big();
    const v = newView();
    const first = l.boxes[0]!.node.key;
    offset(l, first, v);
    panBy(v, 0, 200);
    expect(offset(l, first, v).y).toBe(200);
    const last = l.boxes[l.boxes.length - 1]!;
    const o = offset(l, last.node.key, v);
    expect(last.y - o.y).toBeGreaterThanOrEqual(0);
    expect(last.y + l.d.h - o.y).toBeLessThanOrEqual(v.h);
  });
});
