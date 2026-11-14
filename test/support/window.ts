// A window of the mod made for a test: the stand-ins first (they mock the
// app's modules), the fake kubectl in the settings, everything read once,
// keys pressed through the real handler, a frame drawn.
import { calls, env, key, makeCx, sharedMap, store } from "./standins.ts";
import { KUBECTL, writeLog } from "./fake.ts";

const { default: K8s } = await import("../../mod/main.ts");
const { onKey } = await import("../../mod/input.ts");
const { frame } = await import("../../mod/frame.ts");

export const HOME = "/home/test/.config/herdr-app";

/** A fresh world: no shared state, no files but the settings (the fake kubectl, two favourites). */
export function reset(fake: Record<string, string> = {}, extra: Record<string, unknown> = {}): void {
  calls.length = 0;
  sharedMap.clear();
  store.clear();
  env.terminals = [];
  env.panes = [];
  env.focused = null;
  env.files.clear();
  env.fake = { K8S_FAKE_LOG: writeLog(), ...fake };
  env.files.set(`${HOME}/k8s/settings.json`, JSON.stringify({ kubectl: KUBECTL, favourites: ["lantern", "moth"], ...extra }));
}

/** A view opened (a window unless `pane`), read once; `press` types keys, `draw` draws a frame. */
export async function open(o: { pane?: boolean; width?: number; height?: number } = {}) {
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
  const press = async (...names: string[]) => {
    for (const n of names) {
      onKey(v, key(n) as never, t.cx);
      await t.settle();
      v.tick(t.cx);
      await t.settle();
    }
  };
  return { v, ...t, press, draw: () => frame(v, new Proxy({}, { get: () => "#808080" }) as never, t.cx) as never };
}
