// A forward's database credentials found in the cluster (mod/creds.ts) and handed to the Databases
// window as the place of the password, never its value (the contract: the Databases mod's kube.ts):
// each env form, each operator's convention kept, none, several, a secret that isn't there; then
// the window's b and B against the fake kubectl (one clear secret goes along, several open the
// picker, any secret of the namespace by hand) with no value in anything sent.
import { beforeEach, describe, expect, test } from "bun:test";
import { calls, env, key, makeCx, sharedMap, store } from "./support/standins.ts";
import { KUBECTL, fakeExec, writeLog } from "./support/fake.ts";

const { candidatesOf, envOf, fileRef, fromEnv, fromOperators, findCredentials, secretKeysOf } = await import("../mod/creds.ts");
const { connectArgs } = await import("../mod/forwards.ts");
const { default: K8s } = await import("../mod/main.ts");
const { onKey } = await import("../mod/input.ts");
const { menuBox, menuWidth } = await import("../mod/overlays.ts");
const { texts } = await import("./support/standins.ts");

const HOME = "/home/test/.config/herdr-app";
const ref = (name: string, key: string) => ({ valueFrom: { secretKeyRef: { name, key } } });
const NO_MAPS = new Map<string, ReadonlyMap<string, string>>();
const pod = (containers: unknown[], labels: Record<string, string> = {}, volumes?: unknown[]) => ({ name: "db-0", labels: new Map(Object.entries(labels)), spec: { containers, ...(volumes ? { volumes } : {}) } });

describe("the env", () => {
  test("a secretKeyRef password with its user and database (a plain value, the same secret's key); the image's own user otherwise", () => {
    const c = { name: "postgres", env: [{ name: "POSTGRES_USER", ...ref("db-auth", "username") }, { name: "POSTGRES_PASSWORD", ...ref("db-auth", "password") }, { name: "POSTGRES_DB", value: "lantern" }] };
    expect(fromEnv("postgres", envOf(c, {}, null, NO_MAPS), "db-0").candidates).toEqual([{ secret: "db-auth", key: "password", userKey: "username", database: "lantern", why: "POSTGRES_PASSWORD of db-0" }]);
    const bare = { name: "postgres", env: [{ name: "POSTGRES_PASSWORD", ...ref("db-auth", "password") }] };
    expect(fromEnv("postgres", envOf(bare, {}, null, NO_MAPS), "db-0").candidates).toEqual([{ secret: "db-auth", key: "password", user: "postgres", why: "POSTGRES_PASSWORD of db-0" }]);
    // PGPASSWORD / PGUSER too; a mysql pod read as postgres finds nothing.
    const pg = { name: "c", env: [{ name: "PGUSER", value: "ada" }, { name: "PGPASSWORD", ...ref("s", "pw") }] };
    expect(fromEnv("postgres", envOf(pg, {}, null, NO_MAPS), "db-0").candidates[0]).toMatchObject({ secret: "s", key: "pw", user: "ada" });
    expect(fromEnv("mysql", envOf(pg, {}, null, NO_MAPS), "db-0").candidates).toEqual([]);
  });

  test("envFrom a secret (with its prefix): every key a variable, known from the secret's key names", () => {
    const c = { name: "mysql", envFrom: [{ secretRef: { name: "moth-env" }, prefix: "MYSQL_" }] };
    const secrets = [{ name: "moth-env", keys: ["ROOT_PASSWORD", "USER", "PASSWORD", "DATABASE"] }];
    expect(fromEnv("mysql", envOf(c, {}, secrets, NO_MAPS), "db-0").candidates).toEqual([
      { secret: "moth-env", key: "ROOT_PASSWORD", user: "root", databaseKey: "DATABASE", why: "MYSQL_ROOT_PASSWORD of db-0 (root)" },
      { secret: "moth-env", key: "PASSWORD", userKey: "USER", databaseKey: "DATABASE", why: "MYSQL_PASSWORD of db-0" },
    ]);
  });

  test("a *_FILE into a mounted secret: by the volume's items, else the file's name; another path is nothing", () => {
    const c = { name: "pg", env: [{ name: "POSTGRES_PASSWORD_FILE", value: "/run/secrets/db/pw" }], volumeMounts: [{ name: "creds", mountPath: "/run/secrets/db" }] };
    const items = { containers: [], volumes: [{ name: "creds", secret: { secretName: "db-files", items: [{ key: "postgres-password", path: "pw" }] } }] };
    expect(fileRef(c, items, "/run/secrets/db/pw")).toEqual({ secret: "db-files", key: "postgres-password" });
    expect(fileRef(c, { volumes: [{ name: "creds", secret: { secretName: "db-files" } }] }, "/run/secrets/db/pw")).toEqual({ secret: "db-files", key: "pw" });
    expect(fileRef(c, items, "/etc/pw")).toBeNull();
    expect(fromEnv("postgres", envOf(c, items, null, NO_MAPS), "db-0").candidates[0]).toMatchObject({ secret: "db-files", key: "postgres-password", user: "postgres" });
    // A subPath mount: the file is the key the subPath names.
    const sub = { name: "pg", volumeMounts: [{ name: "creds", mountPath: "/pw", subPath: "password" }] };
    expect(fileRef(sub, { volumes: [{ name: "creds", secret: { secretName: "s" } }] }, "/pw")).toEqual({ secret: "s", key: "password" });
  });

  test("a password written in the spec or a config map isn't passed on, it's named; a user from a config map goes along", () => {
    const plain = { name: "pg", env: [{ name: "POSTGRES_PASSWORD", value: "made-up-plain-1" }] };
    const r = fromEnv("postgres", envOf(plain, {}, null, NO_MAPS), "db-0");
    expect(r.candidates).toEqual([]);
    expect(r.notes).toEqual(["POSTGRES_PASSWORD is written in db-0's spec, not a secret: Databases asks (y on the pod shows it)"]);
    expect(JSON.stringify(r)).not.toContain("made-up-plain-1");
    const maps = new Map([["db-config", new Map([["user", "lantern"], ["db", "lanterns"]])]]);
    const c = { name: "pg", env: [{ name: "POSTGRES_USER", valueFrom: { configMapKeyRef: { name: "db-config", key: "user" } } }, { name: "POSTGRES_DB", valueFrom: { configMapKeyRef: { name: "db-config", key: "db" } } }, { name: "POSTGRES_PASSWORD", ...ref("s", "password") }] };
    expect(fromEnv("postgres", envOf(c, {}, null, maps), "db-0").candidates[0]).toMatchObject({ user: "lantern", database: "lanterns" });
    const other = { name: "pg", env: [{ name: "POSTGRES_USER", ...ref("users", "name") }, { name: "POSTGRES_PASSWORD", ...ref("s", "password") }] };
    const o = fromEnv("postgres", envOf(other, {}, null, NO_MAPS), "db-0");
    expect(o.candidates[0]).toEqual({ secret: "s", key: "password", why: "POSTGRES_PASSWORD of db-0" });
    expect(o.notes).toEqual(["POSTGRES_USER is in another secret (users): the user isn't filled in"]);
  });

  test("Bitnami's admin password beside the app user's, spilo's superuser: several candidates", () => {
    const c = { name: "pg", env: [{ name: "POSTGRES_USER", value: "app" }, { name: "POSTGRES_PASSWORD", ...ref("rel-postgresql", "password") }, { name: "POSTGRES_POSTGRES_PASSWORD", ...ref("rel-postgresql", "postgres-password") }] };
    expect(fromEnv("postgres", envOf(c, {}, null, NO_MAPS), "rel-postgresql-0").candidates.map((x) => [x.key, x.user, x.why])).toEqual([
      ["password", "app", "POSTGRES_PASSWORD of rel-postgresql-0"], ["postgres-password", "postgres", "POSTGRES_POSTGRES_PASSWORD of rel-postgresql-0 (superuser)"],
    ]);
    const spilo = { name: "postgres", env: [{ name: "PGUSER_SUPERUSER", value: "postgres" }, { name: "PGPASSWORD_SUPERUSER", ...ref("postgres.acid-x.credentials.postgresql.acid.zalan.do", "password") }] };
    expect(fromEnv("postgres", envOf(spilo, {}, null, NO_MAPS), "acid-x-0").candidates[0]).toMatchObject({ key: "password", user: "postgres" });
  });
});

describe("the operators", () => {
  test("CloudNativePG: <cluster>-app (user and database keys) and -superuser, by the cnpg.io/cluster label", () => {
    const secrets = [{ name: "pg-app", keys: ["dbname", "host", "password", "port", "uri", "username"] }, { name: "pg-superuser", keys: ["password", "username"] }, { name: "other", keys: ["password"] }];
    expect(fromOperators("postgres", new Map([["cnpg.io/cluster", "pg"]]), secrets)).toEqual([
      { secret: "pg-app", key: "password", userKey: "username", databaseKey: "dbname", why: "CloudNativePG cluster pg's app user" },
      { secret: "pg-superuser", key: "password", userKey: "username", why: "CloudNativePG cluster pg's superuser" },
    ]);
    expect(fromOperators("mysql", new Map([["cnpg.io/cluster", "pg"]]), secrets)).toEqual([]);
  });

  test("Crunchy PGO: each <cluster>-pguser-<user> (user, dbname); Zalando: each <user>.<cluster>.credentials… with spilo's labels", () => {
    const crunchy = [{ name: "hippo-pguser-rhino", keys: ["dbname", "host", "password", "port", "uri", "user", "verifier"] }, { name: "hippo-pguser-hippo", keys: ["password", "user", "verifier"] }];
    expect(fromOperators("postgres", new Map([["postgres-operator.crunchydata.com/cluster", "hippo"]]), crunchy).map((c) => [c.secret, c.userKey, c.databaseKey ?? null, c.why])).toEqual([
      ["hippo-pguser-rhino", "user", "dbname", "PGO cluster hippo's user rhino"], ["hippo-pguser-hippo", "user", null, "PGO cluster hippo's user hippo"],
    ]);
    const zalando = [{ name: "postgres.acid-x.credentials.postgresql.acid.zalan.do", keys: ["password", "username"] }, { name: "app.acid-x.credentials.postgresql.acid.zalan.do", keys: ["password", "username"] }, { name: "app.acid-y.credentials.postgresql.acid.zalan.do", keys: ["password", "username"] }];
    expect(fromOperators("postgres", new Map([["cluster-name", "acid-x"], ["application", "spilo"]]), zalando).map((c) => c.why)).toEqual(["postgres-operator cluster acid-x's user postgres", "postgres-operator cluster acid-x's user app"]);
    expect(fromOperators("postgres", new Map([["cluster-name", "acid-x"]]), zalando)).toEqual([]);
  });

  test("together: the env first, each secret's key once, one whose secret or key isn't there left out and said", () => {
    const secrets = [{ name: "pg-app", keys: ["password", "username", "dbname"] }, { name: "db-auth", keys: ["username"] }];
    const p = pod([{ name: "pg", env: [{ name: "POSTGRES_PASSWORD", ...ref("db-auth", "password") }, { name: "PGPASSWORD", ...ref("gone", "password") }] }], { "cnpg.io/cluster": "pg" });
    const r = candidatesOf("postgres", p, new Map(), secrets, NO_MAPS);
    expect(r.candidates.map((c) => c.secret)).toEqual(["pg-app"]);
    expect(r.notes).toEqual(["secret db-auth has no key password"]);
    // Not listed (RBAC): the env's are kept as they are, no operator's.
    expect(candidatesOf("postgres", p, new Map(), null, NO_MAPS).candidates.map((c) => c.secret)).toEqual(["db-auth"]);
    expect(candidatesOf("postgres", pod([]), new Map(), secrets, NO_MAPS)).toEqual({ candidates: [], notes: [] });
  });

  test("the secrets' list: names and key names from kubectl.ts's template", () => {
    expect(secretKeysOf("lantern\tdb-auth\tOpaque\t2026-11-01T00:00:00Z\tpassword,username,\nlantern\tempty\tOpaque\t2026-11-01T00:00:00Z\t\n")).toEqual([{ name: "db-auth", keys: ["password", "username"] }, { name: "empty", keys: [] }]);
  });
});

describe("against the made-up cluster", () => {
  const exec = fakeExec();
  const dev = (namespace: string) => ({ context: "nightjar-dev", namespace });

  test("svc/lantern-db: the postgres image's variables, one clear secret", async () => {
    const f = await findCredentials(exec, dev("lantern"), "svc/lantern-db", "postgres");
    expect(f.candidates).toEqual([{ secret: "lantern-db-auth", key: "password", userKey: "username", database: "lantern", why: "POSTGRES_PASSWORD of lantern-db-0" }]);
    // The workload and the pod lead to the same.
    expect((await findCredentials(exec, dev("lantern"), "sts/lantern-db", "postgres")).candidates[0]?.secret).toBe("lantern-db-auth");
    expect((await findCredentials(exec, dev("lantern"), "pod/lantern-db-0", "postgres")).candidates[0]?.secret).toBe("lantern-db-auth");
  });

  test("svc/moth-mysql: root by its variable, the app user by its password file: two; glowworm-pg-rw: CloudNativePG's two", async () => {
    const m = await findCredentials(exec, dev("moth"), "svc/moth-mysql", "mysql");
    expect(m.candidates.map((c) => [c.secret, c.key, c.user ?? null, c.database ?? null])).toEqual([["moth-mysql", "mysql-root-password", "root", "moth"], ["moth-mysql", "mysql-password", "moth", "moth"]]);
    const g = await findCredentials(exec, dev("glowworm"), "svc/glowworm-pg-rw", "postgres");
    expect(g.candidates.map((c) => c.secret)).toEqual(["glowworm-pg-app", "glowworm-pg-superuser"]);
  });

  test("none (a web service read as a database), a target that isn't there, nothing ever read of a value", async () => {
    expect((await findCredentials(exec, dev("lantern"), "svc/lantern-web", "postgres")).candidates).toEqual([]);
    const gone = await findCredentials(exec, dev("lantern"), "svc/nope", "postgres");
    expect(gone.notes.at(-1)).toContain("couldn't read svc/nope");
    // Every call the finder makes: lists by key names, objects; never a secret by name.
    const seen: string[][] = [];
    await findCredentials(async (args, t) => { seen.push([...args]); return exec(args, t); }, dev("lantern"), "svc/lantern-db", "postgres");
    const readsValues = (a: string[]) => a.includes("secret") || (a.includes("secrets") && !a.some((x) => x.startsWith("go-template=")));
    expect(seen.some(readsValues)).toBe(false);
  });
});

test("the args: the secret's place, kubectl named by its path (or left to the window's own), never a value", () => {
  const f = { context: "nightjar-dev", namespace: "lantern", target: "svc/lantern-db", local: 15432, remote: 5432, db: "postgres" as const, name: "lantern-db" };
  const picked = { secret: "lantern-db-auth", key: "password", userKey: "username", database: "lantern" };
  expect(connectArgs(f, "postgres", picked, "/nix/store/x-kubectl/bin/kubectl")).toEqual({
    kind: "postgres", name: "lantern-db (nightjar-dev/lantern)", host: "127.0.0.1", port: 15432, from: "port-forward svc/lantern-db in nightjar-dev/lantern", database: "lantern",
    secret: { from: "kubernetes", context: "nightjar-dev", namespace: "lantern", name: "lantern-db-auth", key: "password", userKey: "username", kubectl: "/nix/store/x-kubectl/bin/kubectl" },
    forward: { context: "nightjar-dev", namespace: "lantern", target: "svc/lantern-db", remote: 5432, local: 15432, kubectl: "/nix/store/x-kubectl/bin/kubectl" },
  });
  expect(connectArgs(f, "postgres", picked, "kubectl").secret?.kubectl).toBeUndefined();
  expect(connectArgs(f, "postgres", picked, "kubecolor").secret?.kubectl).toBeUndefined();
  expect(connectArgs(f, "postgres").secret).toBeUndefined();
});

describe("the window's b and B", () => {
  const forward = (target: string, namespace: string, db: "postgres" | "mysql", local: number, remote: number) => ({ address: "t9", state: "live", labels: { "k8s.forward": JSON.stringify({ context: "nightjar-dev", namespace, target, local, remote, db, name: target.split("/")[1] }) } });
  const sent = () => calls.filter((c) => c.name.startsWith("nocturne.databases:")).map((c) => JSON.parse(c.name.slice("nocturne.databases:".length)));

  beforeEach(() => {
    calls.length = 0;
    sharedMap.clear();
    store.clear();
    env.panes = [];
    env.files.clear();
    env.fake = { K8S_FAKE_LOG: writeLog() };
    env.files.set(`${HOME}/k8s/settings.json`, JSON.stringify({ kubectl: KUBECTL }));
    env.files.set(`${HOME}/mods/databases/mod.json`, "{}");
    sharedMap.set("layout", "nocturne");
  });

  async function open() {
    env.props = { overlay: "o1" };
    const v = new K8s();
    const t = makeCx();
    v.init(undefined, t.cx);
    await t.settle();
    v.size = { width: 1300, height: 800 };
    const press = async (...names: string[]) => {
      for (const n of names) {
        onKey(v, key(n) as never, t.cx);
        await t.settle();
      }
    };
    return { v, press, cx: t.cx, settle: t.settle };
  }

  test("no psql on the app's PATH: the first b says what to install and stays; a second b opens Databases anyway", async () => {
    env.terminals = [forward("svc/lantern-db", "lantern", "postgres", 15432, 5432)];
    env.client = false;
    const { v, press } = await open();
    await press("f", "b");
    expect(sent()).toEqual([]);
    expect(v.note?.text).toBe("Databases needs psql to open this: brew install libpq (then brew link --force libpq); on nix pkgs.postgresql (libpq alone has no psql) · b again opens it anyway (a project's flake may bring its own)");
    expect(calls.some((c) => c.name === "closeOverlay")).toBe(false);
    await press("b");
    expect(sent().length).toBe(1);
    env.client = true;
  });

  test("several: the picker (by number, enter, a click), each with where it was found; the pick sent, no value", async () => {
    env.terminals = [forward("svc/moth-mysql", "moth", "mysql", 13306, 3306)];
    const { v, press } = await open();
    await press("f", "b");
    expect(sent()).toEqual([]);
    expect(v.menu?.title).toBe("the password for moth-mysql · 2 found in nightjar-dev/moth");
    expect(v.note?.text).toBe("2 found: pick the one with the password");
    expect(v.menu?.rows.map((r) => [r.label, r.sub])).toEqual([
      ["secret moth-mysql · mysql-root-password", "MYSQL_ROOT_PASSWORD of moth-mysql-0 (root) · user root · database moth"],
      ["secret moth-mysql · mysql-password", "MYSQL_PASSWORD of moth-mysql-0 · user moth · database moth"],
      ["No secret: Databases asks for the password", null],
      ["Another secret of the namespace…", "1 secret, by its key names"],
    ]);
    const drawn = texts(menuBox(v, new Proxy({}, { get: () => "#808080" }) as never) as never);
    expect(drawn).toContain("secret moth-mysql · mysql-password");
    // Each row's second line whole: the box as wide as the longest (70 characters at 10 px), within the window; wrapped when it can't be.
    const longest = Math.max(...(v.menu?.rows ?? []).map((r) => (r.sub ?? "").length));
    expect(menuWidth(v.menu!, 1300)).toBeGreaterThanOrEqual(96 + longest * 10 * 0.68);
    expect(menuWidth(v.menu!, 1300)).toBeGreaterThan(460);
    expect(menuWidth(v.menu!, 400)).toBe(376);
    expect(menuWidth({ title: "x", rows: [{ label: "Stop it" }] }, 1300)).toBe(460);
    await press("2");
    expect(sent()).toEqual([{ kind: "mysql", name: "moth-mysql (nightjar-dev/moth)", host: "127.0.0.1", port: 13306, from: "port-forward svc/moth-mysql in nightjar-dev/moth", user: "moth", database: "moth", secret: { from: "kubernetes", context: "nightjar-dev", namespace: "moth", name: "moth-mysql", key: "mysql-password", kubectl: KUBECTL }, forward: { context: "nightjar-dev", namespace: "moth", target: "svc/moth-mysql", remote: 3306, local: 13306, kubectl: KUBECTL } }]);
    for (const value of ["moth-lantern-42", "dusk-root-77"]) {
      expect(JSON.stringify([calls, [...sharedMap], [...store], [...env.files]])).not.toContain(value);
      expect(JSON.stringify(calls)).not.toContain(Buffer.from(value).toString("base64"));
    }
  });

  test("none: as before (Databases asks) and said; B opens the picker anyway, and any secret by hand: the secret, its password key, its user key", async () => {
    env.terminals = [forward("svc/lantern-web", "lantern", "postgres", 15433, 80)];
    const { v, press } = await open();
    await press("f", "b");
    expect(sent()).toEqual([{ kind: "postgres", name: "lantern-web (nightjar-dev/lantern)", host: "127.0.0.1", port: 15433, from: "port-forward svc/lantern-web in nightjar-dev/lantern", forward: { context: "nightjar-dev", namespace: "lantern", target: "svc/lantern-web", remote: 80, local: 15433, kubectl: KUBECTL } }]);
    calls.length = 0;
    await press("f", "B");
    expect(v.menu?.rows.map((r) => r.label)).toEqual(["No secret: Databases asks for the password", "Another secret of the namespace…"]);
    await press("2");
    expect(v.menu?.rows.map((r) => r.label)).toEqual(["lantern-db-auth", "lantern-tls", "mailer-smtp"]);
    await press("enter");
    expect(v.menu?.title).toBe("lantern-db-auth: the key with the password");
    expect(v.menu?.at).toBe(0);
    expect(v.menu?.rows.map((r) => r.label)).toEqual(["password", "username"]);
    await press("enter");
    expect(v.menu?.rows.map((r) => r.label)).toEqual(["user from username", "No user: the client's own"]);
    await press("enter");
    expect(sent()[0]?.secret).toEqual({ from: "kubernetes", context: "nightjar-dev", namespace: "lantern", name: "lantern-db-auth", key: "password", userKey: "username", kubectl: KUBECTL });
  });

  test("the forward's menu offers both (b found, B picked), each its key", async () => {
    env.terminals = [forward("svc/lantern-db", "lantern", "postgres", 15432, 5432)];
    const { v, press } = await open();
    await press("f", "enter");
    expect(v.menu?.rows.map((r) => [r.key ?? null, r.label])).toEqual(expect.arrayContaining([["b", "Open in Databases as postgres"], ["B", "Open in Databases with a secret you pick"]]));
    await press("escape");
    // One clear secret: sent without a question.
    await press("b");
    expect(v.menu).toBeNull();
    expect(sent()[0]?.secret?.name).toBe("lantern-db-auth");
  });
});
