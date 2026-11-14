// The window driven by keys against the fake kubectl: what it reads and
// draws, k9s's keys, the asks before writes (and the writes the fake
// recorded), the integrations' exact calls, window and pane.
import { beforeEach, describe, expect, test } from "bun:test";
import { calls, env, ids, key, makeCx, sharedMap, store, texts } from "./support/standins.ts";
import { KUBECTL, writeLog, writes } from "./support/fake.ts";

const { default: K8s } = await import("../mod/main.ts");
const { onKey } = await import("../mod/input.ts");
const { selectedRow, listRows } = await import("../mod/nav.ts");
const { frame } = await import("../mod/frame.ts");

const HOME = "/home/test/.config/herdr-app";
let log = "";

function settings(extra: Record<string, unknown> = {}) {
  env.files.set(`${HOME}/k8s/settings.json`, JSON.stringify({ kubectl: KUBECTL, favourites: ["lantern", "moth"], ...extra }));
}

/** A view opened (as a window unless `pane`), with everything read once. */
async function open(o: { pane?: boolean; width?: number; props?: Record<string, unknown> } = {}) {
  env.props = o.pane ? { slot: "s1", ...o.props } : { overlay: "o1", ...o.props };
  const v = new K8s();
  const t = makeCx();
  v.init(undefined, t.cx);
  await t.settle();
  v.size = { width: o.width ?? 1300, height: 800 };
  // Three ticks: contexts, then the context's reads, then the row's.
  for (let i = 0; i < 3; i++) {
    v.tick(t.cx);
    await t.settle();
  }
  return { v, ...t, press: async (...names: string[]) => {
    for (const n of names) {
      onKey(v, key(n) as never, t.cx);
      await t.settle();
      v.tick(t.cx);
      await t.settle();
    }
  }, draw: () => frame(v, new Proxy({}, { get: () => "#808080" }) as never, t.cx) as never };
}

beforeEach(() => {
  calls.length = 0;
  sharedMap.clear();
  store.clear();
  env.terminals = [];
  env.panes = [];
  env.focused = null;
  env.files.clear();
  log = writeLog();
  env.fake = { K8S_FAKE_LOG: log };
  settings();
});

describe("reading", () => {
  test("starts on the kubeconfig's context and namespace, pods listed, every namespace's strip", async () => {
    const { v, draw } = await open();
    expect(v.context).toBe("nightjar-dev");
    expect(v.namespace).toBe("lantern");
    expect(listRows(v).length).toBe(14);
    const shown = texts(draw());
    expect(shown).toContain("KUBERNETES");
    expect(shown).toContain("lantern");
    expect(shown).toContain("moth");
    // The failing pods are counted in red beside their namespace before it's opened.
    expect(shown).toContain("2✕");
  });

  test("no kubectl call before the settings are read (they name which kubectl)", async () => {
    env.props = { overlay: "o1" };
    const v = new K8s();
    const t = makeCx();
    v.init(undefined, t.cx);
    v.tick(t.cx);
    expect(v.data.contexts.at).toBe(0);
    expect(v.data.contexts.busy).toBe(false);
    await t.settle();
  });

  test("a failing pod row is red, CrashLoopBackOff, with recent restart marks", async () => {
    const { v } = await open();
    const crash = listRows(v).find((r) => r.status === "CrashLoopBackOff");
    expect(crash?.tone).toBe("bad");
  });
});

describe("k9s's keys", () => {
  test(": jumps to a kind (aliases, tab completes), / filters, esc clears", async () => {
    const { v, press } = await open();
    await press(":", "d", "e", "p", "l", "o", "y", "enter");
    expect(v.kind).toBe("deployments");
    await press(":", "s", "t", "tab", "enter");
    expect(v.kind).toBe("statefulsets");
    await press(":", "p", "o", "enter", "/", "w", "e", "b", "enter");
    expect(listRows(v).map((r) => r.ref.name.split("-").slice(0, 2).join("-"))).toEqual(["lantern-web", "lantern-web"]);
    await press("escape");
    expect(v.filter).toBe("");
  });

  test("-l filters by label, ! inverts", async () => {
    const { v, press } = await open();
    await press("/", ...[..."-l app=lantern-db"].map((c) => (c === " " ? "space" : c)), "enter");
    expect(listRows(v).map((r) => r.ref.name)).toEqual(["lantern-db-0"]);
  });

  test("the digits give the keyboard to the panel with that number, in every tab, as in the Databases window", async () => {
    const { v, press, draw } = await open();
    const ns = v.namespace;
    await press("4");
    expect(v.panel).toBe("detail");
    await press("2");
    expect(v.panel).toBe("rail");
    expect(v.namespace).toBe(ns);
    const { railItems } = await import("../mod/menus.ts");
    const at = railItems(v)[v.railAt];
    expect(at?.part === "namespace" && at.strip.name).toBe("lantern");
    await press("1");
    expect(railItems(v)[v.railAt]?.part).toBe("context");
    await press("3");
    expect(railItems(v)[v.railAt]?.part === "kind" && railItems(v)[v.railAt]).toMatchObject({ kind: "pods" });
    await press("0");
    expect(v.panel).toBe("table");
    // The panels wear their numbers.
    const shown = texts(draw());
    for (const n of ["[1]", "[2]", "[3]", "[0]", "[4]"]) expect(shown).toContain(n);
    // tab walks them in the order drawn; shift-tab back.
    await press("1", "tab", "tab", "tab");
    expect(v.panel).toBe("table");
    await press("tab");
    expect(v.panel).toBe("detail");
    await press("shift-tab", "shift-tab");
    expect(railItems(v)[v.railAt]?.part).toBe("kind");
    // Argo CD: applications 1, the tree 0, the status 2.
    await press("]", "2");
    expect(v.tab).toBe("argo");
    expect(v.argoPanel).toBe("side");
    await press("0");
    expect(v.argoPanel).toBe("tree");
    await press("1");
    expect(v.argoPanel).toBe("apps");
    expect(v.namespace).toBe(ns);
  });

  test("n opens the namespaces picker: favourites first, typed letters narrow it, digits pick, * a favourite (kept)", async () => {
    const { v, press, draw } = await open();
    await press("n");
    expect(v.menu?.title).toBe("namespace");
    expect(v.menu?.rows.map((r) => r.label).slice(0, 3)).toEqual(["all namespaces", "lantern", "moth"]);
    expect(v.menu?.rows.map((r) => r.key).slice(0, 3)).toEqual(["0", "1", "2"]);
    expect(texts(draw())).toContain("type to narrow · 0-9 pick · * favourite · enter");
    await press("2");
    expect(v.menu).toBeNull();
    expect(v.namespace).toBe("moth");
    await press("n", "g", "l", "o");
    expect(v.menu?.rows.map((r) => r.label)).toEqual(["glowworm"]);
    await press("enter");
    expect(v.namespace).toBe("glowworm");
    await press("n", "0");
    expect(v.namespace).toBeNull();
    // * on glowworm makes it a favourite, written to the settings with every other field kept.
    await press("n", "g", "l", "o", "*");
    expect(v.settings.favourites).toEqual(["lantern", "moth", "glowworm"]);
    const kept = JSON.parse(env.files.get(`${HOME}/k8s/settings.json`) ?? "{}");
    expect(kept.favourites).toEqual(["lantern", "moth", "glowworm"]);
    expect(kept.kubectl).toBe(KUBECTL);
    await press("backspace", "backspace", "backspace");
    expect(v.menu?.rows.map((r) => r.label).slice(0, 4)).toEqual(["all namespaces", "lantern", "moth", "glowworm"]);
    await press("escape");
    expect(v.menu).toBeNull();
  });

  test("enter on a deployment drills into its pods; esc goes back to it", async () => {
    const { v, press } = await open();
    await press(":", "d", "e", "p", "l", "o", "y", "enter", "enter");
    expect(v.kind).toBe("pods");
    expect(v.drill?.label).toBe("deployment lantern-api");
    expect(listRows(v)).toHaveLength(4);
    await press("escape");
    expect(v.kind).toBe("deployments");
    expect(selectedRow(v)?.ref.name).toBe("lantern-api");
  });

  test("[ ] walk the tabs; the Argo tab lists the applications", async () => {
    const { v, press, draw } = await open();
    await press("]");
    expect(v.tab).toBe("argo");
    const shown = texts(draw());
    expect(shown).toContain("kube-stars");
    expect(shown).toContain("Applications");
  });
});

describe("graphs", () => {
  test("a deployment's graph in traffic order is drawn in the detail panel", async () => {
    const { v, press, draw } = await open();
    await press(":", "d", "e", "p", "l", "o", "y", "enter", "g");
    const shown = texts(draw());
    for (const word of ["ing", "svc", "deploy", "rs", "pod", "lantern.nightjar.test"]) expect(shown).toContain(word);
  });

  test("tab to the detail panel, arrows walk the boxes, enter opens the one picked", async () => {
    const { v, press } = await open();
    await press(":", "d", "e", "p", "l", "o", "y", "enter", "tab");
    expect(v.panel).toBe("detail");
    await press("j", "j");
    await press("enter");
    expect(v.kind).toBe("services");
  });
});

describe("asking before writes", () => {
  test("ctrl-d asks twice (the name typed), then deletes exactly that pod", async () => {
    const { v, press, draw } = await open();
    const row = selectedRow(v);
    await press("ctrl-d");
    expect(v.ask?.title).toContain(`Delete pod ${row?.ref.name}`);
    expect(texts(draw()).join(" ")).toContain("nightjar-dev / lantern");
    await press("y");
    expect(v.ask?.step).toBe(2);
    await press("enter");
    expect(v.ask).not.toBeNull();
    for (const c of row?.ref.name ?? "") await press(c);
    await press("enter");
    expect(v.ask).toBeNull();
    expect(writes(log)).toEqual([["--context", "nightjar-dev", "-n", "lantern", "delete", "pods", row?.ref.name ?? ""]]);
  });

  test("q closes the ask (its first step), a menu and the keys overview; in the typed name it types", async () => {
    const { v, press } = await open();
    await press("ctrl-d", "q");
    expect(v.ask).toBeNull();
    await press("m", "q");
    expect(v.menu).toBeNull();
    await press("?", "q");
    expect(v.help).toBe(false);
    await press("ctrl-d", "y", "q");
    expect(v.ask?.typed).toBe("q");
    expect(writes(log)).toEqual([]);
  });

  test("esc or n says no: nothing runs", async () => {
    const { press } = await open();
    await press("ctrl-d", "n");
    await press(":", "d", "e", "p", "l", "o", "y", "enter", "R", "escape");
    expect(writes(log)).toEqual([]);
  });

  test("a restart asks once in a quiet context, twice in a production-looking one", async () => {
    const dev = await open();
    await dev.press(":", "d", "e", "p", "l", "o", "y", "enter", "R", "y");
    expect(writes(log)).toEqual([["--context", "nightjar-dev", "-n", "lantern", "rollout", "restart", "deployments.apps/lantern-api"]]);
    const prod = await open({ props: { context: "nightjar-prod", namespace: "lantern", kind: "deployments" } });
    await prod.press("R", "y");
    expect(prod.v.ask?.step).toBe(2);
  });

  test("a read-only context refuses writes outright", async () => {
    settings({ readonly: ["nightjar-dev"] });
    const { v, press } = await open();
    await press("ctrl-d");
    expect(v.ask).toBeNull();
    expect(v.note?.text).toContain("read-only");
    expect(writes(log)).toEqual([]);
  });

  test("scale: S takes a number, then asks", async () => {
    const { v, press } = await open();
    await press(":", "d", "e", "p", "l", "o", "y", "enter", "S", "backspace", "6", "enter");
    expect(v.ask?.title).toBe("Scale deployment lantern-api to 6");
    await press("y");
    expect(writes(log)).toEqual([["--context", "nightjar-dev", "-n", "lantern", "scale", "deployments.apps/lantern-api", "--replicas=6"]]);
  });
});

describe("the ecosystem", () => {
  test("l and s open terminals in panes (a container picker when there are several)", async () => {
    const { v, press } = await open();
    const worker = listRows(v).findIndex((r) => r.ref.name.startsWith("lantern-worker"));
    for (let i = 0; i < worker; i++) await press("j");
    await press("l");
    expect(v.menu?.rows.map((r) => r.label)).toEqual(["worker", "log-shipper"]);
    await press("enter");
    const open1 = calls.find((c) => c.name === "terminal.open");
    expect(open1?.args).toMatchObject({ place: "down", argv: [KUBECTL, "--context", "nightjar-dev", "-n", "lantern", "logs", "-f", "--tail", "500", selectedRow(v)?.ref.name, "-c", "worker"] });
    await press("s", "2");
    const shell = calls.filter((c) => c.name === "terminal.open")[1];
    expect(shell?.args).toMatchObject({ place: "right", argv: expect.arrayContaining(["exec", "-it", "-c", "log-shipper"]) });
  });

  test("F on a service starts a labelled forward terminal; the shelf offers Databases only when it's installed", async () => {
    const { v, press, draw } = await open();
    await press(":", "s", "v", "c", "enter");
    const db = listRows(v).findIndex((r) => r.ref.name === "lantern-db");
    for (let i = 0; i < db; i++) await press("j");
    await press("F");
    const hc = calls.find((c) => c.name === "hc")?.args as string[];
    expect(hc.slice(0, 5)).toEqual(["run", "--bg", "--no-parent", "--no-notify", "--json"]);
    expect(hc.slice(hc.indexOf("--") + 1)).toEqual([KUBECTL, "--context", "nightjar-dev", "-n", "lantern", "port-forward", "svc/lantern-db", "15432:5432", "--address", "127.0.0.1"]);
    const label = hc.find((a) => a.startsWith("k8s.forward="))?.slice(12) ?? "";
    expect(JSON.parse(label)).toMatchObject({ target: "svc/lantern-db", local: 15432, remote: 5432, db: "postgres" });
    env.terminals = [{ address: "t9", state: "live", labels: { "k8s.forward": label } }];
    expect(texts(draw())).not.toContain("Open in Databases");
    env.files.set(`${HOME}/mods/databases/mod.json`, "{}");
    v.load(makeCx().cx);
    await new Promise((r) => setTimeout(r, 10));
    expect(texts(draw())).toContain("Open in Databases");
  });

  test("Open in Databases: nocturne.databases with the contract's args, the password's secret named, never its value", async () => {
    env.files.set(`${HOME}/mods/databases/mod.json`, "{}");
    sharedMap.set("layout", "nocturne");
    const { v, press } = await open();
    env.terminals = [{ address: "t9", state: "live", labels: { "k8s.forward": JSON.stringify({ context: "nightjar-dev", namespace: "lantern", target: "svc/lantern-db", local: 15432, remote: 5432, db: "postgres", name: "lantern-db" }) } }];
    await press("f", "b");
    const c = calls.find((x) => x.name.startsWith("nocturne.databases:"));
    expect(JSON.parse(c?.name.slice("nocturne.databases:".length) ?? "{}")).toEqual({
      kind: "postgres", name: "lantern-db (nightjar-dev/lantern)", host: "127.0.0.1", port: 15432, from: "port-forward svc/lantern-db in nightjar-dev/lantern", database: "lantern",
      secret: { from: "kubernetes", context: "nightjar-dev", namespace: "lantern", name: "lantern-db-auth", key: "password", userKey: "username", kubectl: KUBECTL },
      forward: { context: "nightjar-dev", namespace: "lantern", target: "svc/lantern-db", remote: 5432, local: 15432, kubectl: KUBECTL },
    });
    expect(JSON.stringify(calls)).not.toContain("moth-lantern-42");
    expect(JSON.stringify(calls)).not.toContain(Buffer.from("moth-lantern-42").toString("base64"));
    // Elsewhere (no Nocturne): the window itself, the args as its connect prop.
    sharedMap.set("layout", "main");
    await press("f", "b");
    expect(calls.find((x) => x.name === "openOverlay")?.args).toMatchObject({ mod: "databases", key: "databases", props: { connect: { kind: "postgres", port: 15432, secret: { name: "lantern-db-auth", key: "password" } } } });
  });

  test("a web forward opens in a web pane", async () => {
    const { press } = await open();
    env.terminals = [{ address: "t8", state: "live", labels: { "k8s.forward": JSON.stringify({ context: "nightjar-dev", namespace: "lantern", target: "svc/lantern-web", local: 8080, remote: 80, web: "http" }) } }];
    await press("f", "w");
    expect(calls.find((c) => c.name === "app.open_url")?.args).toEqual({ url: "http://localhost:8080", in: "app" });
  });
});

describe("secrets", () => {
  test("listed by key names; x shows the values on the row only; nothing keeps them", async () => {
    const { v, press, draw } = await open();
    await press(":", "s", "e", "c", "enter");
    expect(texts(draw()).join(" ")).not.toContain("moth-lantern-42");
    await press("x");
    expect(texts(draw())).toContain("moth-lantern-42");
    await press("j");
    expect(v.secret).toBeNull();
    expect(JSON.stringify([...sharedMap.values()])).not.toContain("moth-lantern");
    v.close();
    expect(JSON.stringify([...store.values(), ...sharedMap.values()])).not.toContain("moth-lantern");
  });

  test("a secret's YAML has its values masked", async () => {
    const { v, press } = await open();
    await press(":", "s", "e", "c", "enter", "y");
    expect(v.data.text.value ?? "").toContain("password: ••••••••");
    expect(v.data.text.value ?? "").not.toContain("bW90aC");
  });
});

describe("window or pane", () => {
  test("a window has its ✕ and ◧; esc at the top closes it", async () => {
    const { press, draw } = await open();
    expect(ids(draw())).toContain("k8s-close");
    expect(texts(draw())).toContain("◧");
    await press("escape");
    expect(calls.find((c) => c.name === "closeOverlay")?.args).toBe("o1");
  });

  test("a pane: no ✕, ⧉ instead; esc never closes it; q closes its own pane", async () => {
    env.panes = [{ pane: "p7", mod: "k8s", props: { slot: "s1" }, terminal: null }];
    const { press, draw } = await open({ pane: true });
    expect(ids(draw())).not.toContain("k8s-close");
    expect(texts(draw())).toContain("⧉");
    await press("escape", "escape");
    expect(calls.filter((c) => c.name === "closeOverlay" || c.name === "pane.close")).toEqual([]);
    await press("q");
    expect(calls.find((c) => c.name === "pane.close")?.args).toEqual({ pane: "p7" });
  });

  test("narrow: one panel, the others folded into a row", async () => {
    const { v, press, draw } = await open({ pane: true, width: 520 });
    expect(ids(draw())).toContain("k8s-fold");
    expect(ids(draw())).not.toContain("k8s-rail");
    await press("tab");
    expect(v.panel).toBe("detail");
  });

  test("ctrl-t moves a window into a pane: the handover note, the pane, the window closed 300 ms later", async () => {
    const { v, press, fire } = await open();
    await press(":", "d", "e", "p", "l", "o", "y", "enter");
    await press("ctrl-t");
    const split = calls.find((c) => c.name === "pane.split")?.args as { mod: string; props: { slot: string } };
    expect(split.mod).toBe("k8s");
    expect(split.props.slot).toMatch(/^[a-z0-9]+$/);
    expect(sharedMap.get("k8s.handover")).toMatchObject({ kind: "deployments", context: "nightjar-dev", namespace: "lantern" });
    expect(calls.find((c) => c.name === "closeOverlay")).toBeUndefined();
    fire();
    expect(calls.find((c) => c.name === "closeOverlay")?.args).toBe("o1");
    // The new copy takes the note.
    const { v: pane } = await open({ pane: true });
    expect(pane.kind).toBe("deployments");
    expect(sharedMap.get("k8s.handover")).toBeNull();
    expect(v.kind).toBe("deployments");
  });

  test("a pane keeps its own state by slot (a restart gives it back)", async () => {
    const first = await open({ pane: true });
    await first.press(":", "c", "m", "enter");
    first.v.close();
    sharedMap.clear();
    const again = await open({ pane: true });
    expect(again.v.kind).toBe("configmaps");
  });

  test("opening args: k8s in a pane on a given kind and namespace", async () => {
    const { v } = await open({ pane: true, props: { namespace: "moth", kind: "svc" } });
    expect(v.namespace).toBe("moth");
    expect(v.kind).toBe("services");
  });
});

const { rowGraph, detailWidth } = await import("../mod/graph-shown.ts");
const { command } = await import("../mod/host.ts");

describe("fits", () => {
  test.each([1300, 1100, 900, 520])("the deployment graph fits a %ipx window's detail panel", async (width) => {
    const { v, press } = await open({ width });
    await press(":", "d", "e", "p", "l", "o", "y", "enter", "g");
    const s = rowGraph(v, detailWidth(v));
    expect(s).not.toBeNull();
    const l = s!.laid;
    expect(l.width).toBeLessThanOrEqual(detailWidth(v) + 1);
    expect(l.boxes.every((b) => b.x + l.d.w <= detailWidth(v))).toBe(true);
    // The detail column (wide window, or the one column under 640 px) is tall: the graph runs top to bottom;
    // under the table (900 px) it's low and wide: left to right, the ingress and the service in a row over the tree.
    expect(l.dir).toBe(width === 900 ? "right" : "down");
    if (l.dir === "right" && detailWidth(v) < 700) expect(l.top).toBeGreaterThan(0);
  });

  test("the rail draws its three panels, the namespaces and kinds sharing the height", async () => {
    const { draw } = await open();
    const all = ids(draw());
    for (const id of ["rail-ctx", "rail-ns", "rail-kinds", "rail-ns-list", "rail-kinds-list"]) expect(all).toContain(id);
  });

  test("k8s.press spells the colon and slash: colon d e p l o y enter", async () => {
    const { v, cx } = await open();
    command(v, "press:colon d e p l o y enter slash w e b enter", cx);
    await new Promise((r) => setTimeout(r, 5));
    expect(v.kind).toBe("deployments");
    expect(v.filter).toBe("web");
  });

  test("k8s.open with full: the window over the whole app", async () => {
    const { v, cx } = await open();
    command(v, 'open:{"as":"window","full":true,"kind":"pods"}', cx);
    expect(calls.find((c) => c.name === "openOverlay")?.args).toMatchObject({ mod: "k8s", width: 1, height: 1, props: { kind: "pods" } });
  });
});

const { rowDirection, ROW_CANVAS } = await import("../mod/graph-shown.ts");
const { readingOrder } = await import("../mod/graph-layout.ts");

describe("the workload graph's direction and pan", () => {
  test("O turns it and the turn is kept for the next opening; O again follows the panel", async () => {
    const { v, press } = await open();
    await press(":", "d", "e", "p", "l", "o", "y", "enter", "g", "tab");
    expect(rowDirection(v)).toBe("down");
    await press("O");
    expect(v.graphDir).toBe("right");
    expect(rowGraph(v, detailWidth(v))?.laid.dir).toBe("right");
    expect((sharedMap.get("k8s.state") as { graph?: string }).graph).toBe("right");
    const again = await open();
    expect(again.v.graphDir).toBe("right");
    await press("O");
    expect(v.graphDir).toBe("auto");
  });

  test("top to bottom, j goes a row down (to the service under the ingress), l along the row", async () => {
    const { v, press } = await open();
    await press(":", "d", "e", "p", "l", "o", "y", "enter", "g", "tab");
    v.graphSel = "ing";
    const s = rowGraph(v, detailWidth(v))!;
    const ing = s.laid.boxes.find((b) => b.node.kind === "ing")!;
    v.graphSel = ing.node.key;
    await press("j");
    expect(s.laid.boxes.find((b) => b.node.key === v.graphSel)?.node.kind).toBe("svc");
    await press("j", "j");
    const rs = s.laid.boxes.find((b) => b.node.key === v.graphSel)!;
    expect(rs.node.kind).toBe("rs");
    // l reads on along the rows: the next box right of it, or the next row's first.
    await press("l");
    const order = readingOrder(s.laid);
    expect(order.findIndex((b) => b.node.key === v.graphSel)).toBe(order.indexOf(rs) + 1);
  });

  test("H J K L pan the graph's canvas, c centres the selected box; the keys are listed in ?", async () => {
    const { v, press, draw } = await open();
    await press(":", "d", "e", "p", "l", "o", "y", "enter", "g", "tab");
    draw();
    const view = v.canvases.get(ROW_CANVAS)!;
    view.w = 200;
    view.h = 120;
    view.x = 0;
    view.y = 0;
    await press("J", "L");
    expect([view.x, view.y]).toEqual([80, 80]);
    await press("c");
    expect(view.follow).toBe(v.graphSel ?? selectedRow(v)?.key ?? null);
    await press("?");
    const help = texts(draw()).join(" ");
    for (const w of ["H J K L", "move the graph (or drag it, or the wheel)", "turn the graph: top to bottom / left to right (kept)"]) expect(help).toContain(w);
    await press("escape");
    // The bar, with the graph's keys while it has the keyboard.
    for (const w of ["move", "menu", "zoom", "fit", "turn"]) expect(texts(draw())).toContain(w);
  });
});

describe("the metrics' pace", () => {
  test("M opens the paces; picking 2s reads at 2s, keeps it in settings.json beside the other fields, the strip and bar say it", async () => {
    const { v, press, draw } = await open();
    await press(":", "d", "e", "p", "l", "o", "y", "enter", "g");
    expect(texts(draw())).toContain("every 15s");
    await press("M");
    expect(v.menu?.title).toBe("read cpu and memory every");
    expect(v.menu?.rows.map((r) => r.label)).toEqual(["every 2s", "every 5s", "every 15s  ·  now", "every 30s", "paused"]);
    expect(v.menu?.rows[0]?.sub).toContain("metrics-server measures ~every 15s");
    await press("1");
    expect(v.data.metricsEvery).toBe(2);
    expect(v.data.topPods.every).toBe(2000);
    const kept = JSON.parse(env.files.get(`${HOME}/k8s/settings.json`) ?? "{}");
    expect(kept).toMatchObject({ metrics: 2, favourites: ["lantern", "moth"] });
    v.note = null;
    const shown = texts(draw());
    expect(shown).toContain("every 2s");
    expect(shown).toContain("metrics 2s");
  });

  test("a kept pace is read with the settings; paused reads no top at all", async () => {
    settings({ metrics: 0 });
    const { v, draw } = await open();
    expect(v.data.metricsEvery).toBe(0);
    expect(v.data.topPods.at).toBe(0);
    expect(texts(draw())).toContain("metrics paused");
  });
});
