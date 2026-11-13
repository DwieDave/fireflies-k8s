// Stand-ins for what the app gives a mod ("gpui-kit", "gpui-base",
// "herdr", the globals), so the real view can be made, driven by keys and
// drawn in a test. An element records its text and children; `texts(el)`
// reads what a frame shows. herdr's calls are recorded (`calls`), its
// shared state is a Map, exec runs the fake kubectl.
import { mock } from "bun:test";
import { fakeExec } from "./fake.ts";

/** A drawn element: every builder method returns it; children and text are kept. */
export class El {
  kids: El[] = [];
  text: string[] = [];
  ids: string[] = [];
  constructor(label = "") {
    if (label) this.text.push(label);
    return new Proxy(this, {
      get(target, prop, recv) {
        if (prop in target) return Reflect.get(target, prop, recv);
        if (typeof prop === "symbol") return undefined;
        return (...args: unknown[]) => {
          if (prop === "child") target.add(args[0]);
          else if (prop === "children") for (const a of (args[0] as unknown[]) ?? []) target.add(a);
          else if (prop === "when") { if (args[0]) (args[1] as (e: El) => El)(recv as El); }
          else if (prop === "id") target.ids.push(String(args[0]));
          return recv;
        };
      },
    });
  }
  add(x: unknown) {
    if (x instanceof El) this.kids.push(x);
    else if (typeof x === "string" || typeof x === "number") this.text.push(String(x));
  }
}

/** Every text in a drawn tree, in order. */
export function texts(el: El): string[] {
  return [...el.text, ...el.kids.flatMap(texts)];
}

/** Every element id in a drawn tree. */
export function ids(el: El): string[] {
  return [...el.ids, ...el.kids.flatMap(ids)];
}

export const calls: { name: string; args: unknown }[] = [];
export const sharedMap = new Map<string, unknown>();
export const store = new Map<string, string>();
export const env = {
  props: {} as Record<string, unknown>,
  terminals: [] as unknown[],
  panes: [] as unknown[],
  focused: null as unknown,
  files: new Map<string, string>(),
  hcResult: { code: 0, stdout: '{"address":"t9"}', stderr: "" },
  fake: {} as Record<string, string>,
};

const theme = new Proxy({}, { get: () => "#808080" });
const chain = (): unknown => new Proxy(function () {}, { get: () => chain(), apply: () => chain() });

(globalThis as any).window = { paint_path: () => new El(), localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) } };
(globalThis as any).localStorage = (globalThis as any).window.localStorage;

mock.module("gpui-kit", () => ({
  View: class {},
  div: () => new El(),
  svg: (p: string) => new El(`svg:${p.split("/").pop()}`),
  image: () => new El(),
  PathBuilder: { fill: chain, stroke: chain },
  Background: { checkerboard: () => ({}), solid: () => ({}) },
}));

mock.module("gpui-base", () => ({
  h_flex: () => new El(),
  v_flex: () => new El(),
  ScrollHandle: { new: () => ({ scroll_to_item() {}, release: () => true }) },
  EditorState: { new: () => ({ value: "", set_value(v: string) { this.value = v; }, focused: () => false, top_line: () => 0, scroll_to_line() {}, release: () => true }) },
  Editor: { new: () => new El("[editor]") },
}));

mock.module("herdr", () => ({
  exec: (cmd: string, args: string[]) => (cmd.endsWith("kubectl") ? fakeExec(env.fake)(args, 0) : Promise.resolve({ code: 1, stdout: "", stderr: "not here" })),
  hc: (args: string[]) => { calls.push({ name: "hc", args }); return Promise.resolve(env.hcResult); },
  run: (name: string, args?: unknown) => { calls.push({ name, args }); return null; },
  openOverlay: (spec: unknown) => { calls.push({ name: "openOverlay", args: spec }); return "o9"; },
  closeOverlay: (id: string) => { calls.push({ name: "closeOverlay", args: id }); return null; },
  notify: () => null,
  shared: (k: string) => sharedMap.get(k) ?? null,
  setShared: (k: string, v: unknown) => { sharedMap.set(k, v); return null; },
  props: () => env.props,
  terminals: () => env.terminals,
  panes: () => env.panes,
  focused: () => env.focused,
  theme: () => theme,
  settings: () => ({ zoom: 1, font_family: "mono" }),
  window: () => ({ platform: "macos" }),
  nextCommand: () => Promise.reject(new Error("no commands in tests")),
  readTextFile: (p: string) => Promise.resolve(env.files.get(p) ?? null),
  appHome: () => "/home/test/.config/herdr-app",
}));

mock.module("fs/promises", () => ({
  mkdir: () => Promise.resolve(),
  writeFile: (p: string, t: string) => { env.files.set(p, t); return Promise.resolve(); },
}));

/** A test context: spawned tasks are kept so a test can wait for them; timers are recorded. */
export function makeCx() {
  const tasks: Promise<unknown>[] = [];
  const timers: { ms: number; fn: (cx: unknown) => void }[] = [];
  const cx: any = {
    notified: 0,
    stopped: 0,
    spawn: (fn: (cx: unknown) => Promise<unknown>) => { tasks.push(fn(cx)); },
    timer: { after: (ms: number, fn: (cx: unknown) => void) => timers.push({ ms, fn }), every: () => {} },
    focus_handle: () => ({ focus() {} }),
    bind_keys: () => 0,
    notify: () => { cx.notified++; },
    stop_propagation: () => { cx.stopped++; },
  };
  /** Waits until every task (and the ones they start) has finished. */
  const settle = async () => {
    for (let i = 0; i < 20; i++) {
      const n = tasks.length;
      await Promise.allSettled(tasks);
      if (tasks.length === n) return;
    }
  };
  /** Runs the timers set so far (the 300 ms closes of a move). */
  const fire = () => { for (const t of timers.splice(0)) t.fn(cx); };
  return { cx, settle, fire, tasks };
}

/** A key event as the engine sends it. */
export function key(name: string) {
  const ctrl = name.startsWith("ctrl-");
  const k = ctrl ? name.slice(5) : name;
  const ch = name === "space" ? " " : !ctrl && name.length === 1 ? name : undefined;
  return { key: k.length === 1 ? k.toLowerCase() : k, keystroke: name, modifiers: { control: ctrl, alt: false, shift: name.length === 1 && name !== name.toLowerCase(), platform: false, function: false }, ...(ch ? { key_char: ch } : {}) };
}
