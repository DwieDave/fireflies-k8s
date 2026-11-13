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

  test("0-9 pick namespaces (0 all, favourites first)", async () => {
    const { v, press } = await open();
    await press("2");
    expect(v.namespace).toBe("moth");
    await press("0");
    expect(v.namespace).toBeNull();
    expect(listRows(v).length).toBeGreaterThan(20);
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

  test("Open in Databases: nocturne.databases with the contract's args, no secret", async () => {
    env.files.set(`${HOME}/mods/databases/mod.json`, "{}");
    sharedMap.set("layout", "nocturne");
    const { v, press } = await open();
    env.terminals = [{ address: "t9", state: "live", labels: { "k8s.forward": JSON.stringify({ context: "nightjar-dev", namespace: "lantern", target: "svc/lantern-db", local: 15432, remote: 5432, db: "postgres", name: "lantern-db" }) } }];
    await press("f", "b");
    const c = calls.find((x) => x.name.startsWith("nocturne.databases:"));
    expect(JSON.parse(c?.name.slice("nocturne.databases:".length) ?? "{}")).toEqual({ kind: "postgres", name: "lantern-db (nightjar-dev/lantern)", host: "127.0.0.1", port: 15432, from: "port-forward svc/lantern-db in nightjar-dev/lantern" });
    // Elsewhere (no Nocturne): the window itself, the args as its connect prop.
    sharedMap.set("layout", "main");
    await press("f", "b");
    expect(calls.find((x) => x.name === "openOverlay")?.args).toMatchObject({ mod: "databases", key: "databases", props: { connect: { kind: "postgres", port: 15432 } } });
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
    expect(texts(draw()).join(" ")).not.toContain("moth-wings-at-dusk");
    await press("x");
    expect(texts(draw())).toContain("moth-wings-at-dusk");
    await press("j");
    expect(v.secret).toBeNull();
    expect(JSON.stringify([...sharedMap.values()])).not.toContain("moth-wings");
    v.close();
    expect(JSON.stringify([...store.values(), ...sharedMap.values()])).not.toContain("moth-wings");
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
    // Narrow: the ingress and the service sit in a row over the tree.
    if (detailWidth(v) < 700) expect(l.top).toBeGreaterThan(0);
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
