// The keyboard-and-pointer pass: every row kind has a right-click menu and
// m, a favourite namespace moves by a drag or J / K (kept), the top bar's
// namespace opens the picker, the bar's keys click.
import { beforeEach, describe, expect, test } from "bun:test";
import { El, byId, env, handlerOf, texts } from "./support/standins.ts";
import { HOME, open, reset } from "./support/window.ts";

const { railItems } = await import("../mod/menus.ts");

const cx: any = { stop_propagation() {}, notify() {}, spawn() {}, write_to_clipboard() {} };

beforeEach(() => reset());

const railIndex = (v: any, name: string) => railItems(v).findIndex((x: any) => x.part === "namespace" && x.strip.name === name);

describe("menus on every row", () => {
  test("rail rows: a right click (and m) opens a context's, a namespace's, a kind's menu", async () => {
    const { v, draw, press } = await open();
    handlerOf(byId(draw(), "rail-0") as El, "on_mouse_down", "right")({}, cx);
    expect(v.menu?.title).toBe("context nightjar-dev");
    v.menu = null;
    handlerOf(byId(draw(), `rail-${railIndex(v, "moth")}`) as El, "on_mouse_down", "right")({}, cx);
    expect(v.menu?.rows.map((r) => r.label)).toEqual(["show it", "no longer a favourite", "move it up among the favourites", "move it down", "copy its name"]);
    v.menu = null;
    await press("3", "m");
    expect(v.menu?.title).toBe("pods");
  });

  test("a favourite namespace moves by a drag onto another favourite, or J / K in the rail; * toggles; kept", async () => {
    const w = await open();
    const { v, draw, press } = w;
    const moth = byId(draw(), `rail-${railIndex(v, "moth")}`) as El;
    handlerOf(moth, "on_mouse_down", "left")({ click_count: 1 }, w.cx);
    const lantern = byId(draw(), `rail-${railIndex(v, "lantern")}`) as El;
    handlerOf(lantern, "on_mouse_up", "left")({}, w.cx);
    await w.settle();
    expect(v.settings.favourites).toEqual(["moth", "lantern"]);
    expect(JSON.parse(env.files.get(`${HOME}/k8s/settings.json`) ?? "{}").favourites).toEqual(["moth", "lantern"]);
    // Keys: the cursor on moth (first now), J moves it down and the cursor follows.
    await press("2");
    v.railAt = railIndex(v, "moth");
    await press("J");
    expect(v.settings.favourites).toEqual(["lantern", "moth"]);
    expect(railItems(v)[v.railAt]).toMatchObject({ part: "namespace", strip: { name: "moth" } });
    v.railAt = railIndex(v, "glowworm");
    await press("*");
    expect(v.settings.favourites).toEqual(["lantern", "moth", "glowworm"]);
  });

  test("a forward's row, the shelf and a history entry open their menus on a right click", async () => {
    const { v, press, draw } = await open();
    await press("]", "2");
    handlerOf(byId(draw(), "hist-0") as El, "on_mouse_down", "right")({}, cx);
    expect(v.menu?.rows.map((r) => r.label)).toEqual(["roll back to it", "copy the revision", "diff"]);
    expect(v.histAt).toBe(0);
    v.menu = null;
    await press("m");
    expect(v.menu?.rows[0]?.label).toBe("roll back to it");
  });
});

describe("the chrome", () => {
  test("the top bar's namespace opens the namespaces picker", async () => {
    const { v, draw } = await open();
    handlerOf(byId(draw(), "k8s-where-ns") as El, "on_click")({}, cx);
    expect(v.menu?.title).toBe("namespace");
  });

  test("a key in the bar clicks: it presses that key", async () => {
    const { v, draw } = await open();
    const bar = byId(draw(), "k8s-keys") as El;
    const i = bar.kids.findIndex((k) => texts(k).includes("graph"));
    expect(i).toBeGreaterThan(-1);
    handlerOf(bar.kids[i] as El, "on_click")({}, cx);
    expect(v.detail).toBe("graph");
    const d = bar.kids.find((k) => texts(k)[0] === "v") as El;
    handlerOf(d, "on_click")({}, cx);
    expect(v.detail).toBe("events");
  });
});
