// `e`: an object's YAML in the editor, applied on save after asking. The
// YAML is written under the app's folder (cache/k8s/edit/<context>/<ns>/),
// opened with `editor.open`, and noted in shared `k8s.edits`. Every copy of
// the window checks the noted files every couple of seconds; when one was
// saved with a change, the copy asks "apply?" (kubectl replace: it keeps the
// resourceVersion, so a change made in the cluster meanwhile is refused, not
// overwritten). A window closes when the editor opens; the ask comes when a
// copy is shown again. Secrets aren't edited here: their values would sit in
// a file.

import type { Context } from "gpui-kit";
import { appHome, readTextFile, run, setShared, shared } from "herdr";
import * as fs from "fs/promises";
import type { default as K8s } from "./main.ts";
import { arrayOf, isNumber, isString, object, readShared, sharedKey, writeShared } from "./guard.ts";
import type { Guarded } from "./guard.ts";
import { readText, yamlArgs } from "./kubectl.ts";
import { isBuiltin } from "./kinds.ts";
import type { Row } from "./rows.ts";
import { applySpec, request } from "./writes.ts";
import { openTerminal } from "./integrate.ts";

const isEdit = object({ path: isString, original: isString, context: isString, kind: isString, name: isString, at: isNumber }, { namespace: isString });

type Edit = Guarded<typeof isEdit>;

export const EDITS = sharedKey("k8s.edits", arrayOf(isEdit));

/** Where an object's YAML is written for editing. */
export function editPath(home: string, context: string, ns: string | null, kind: string, name: string): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_");

  return `${home}/cache/k8s/edit/${safe(context)}/${safe(ns ?? "_cluster")}/${safe(kind)}-${safe(name)}.yaml`;
}

/** Fetches the YAML, writes it, opens it in the editor and notes it. */
export function editRow(v: K8s, row: Row, cx: Context): void {
  if (row.ref.kind === "secrets") {
    v.say("secrets aren't edited here (their values would be written to a file)", "wk");

    return;
  }

  const context = v.context ?? "";
  const ns = row.ref.namespace;

  cx.spawn(async (cx) => {
    const r = await readText(v.data.exec, yamlArgs({ context, namespace: ns }, row.ref.kind, row.ref.name));

    if (!r.ok) {
      v.say(`couldn't read it: ${r.error}`, "bad");
      cx.notify();

      return;
    }

    const path = editPath(appHome(), context, ns, row.ref.kind, row.ref.name);

    try {
      await fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
      await fs.writeFile(path, r.value);
    } catch (cause: unknown) {
      v.say(`couldn't write ${path}: ${cause instanceof Error ? cause.message : String(cause)}`, "bad");
      cx.notify();

      return;
    }

    const edit: Edit = ns ? { path, original: r.value, context, namespace: ns, kind: row.ref.kind, name: row.ref.name, at: Date.now() } : { path, original: r.value, context, kind: row.ref.kind, name: row.ref.name, at: Date.now() };

    writeShared(setShared, EDITS, [...readShared(shared, EDITS, []).filter((e) => e.path !== path), edit]);
    v.say("save it in the editor: the window asks before it applies", "ok");
    run("editor.open", { path });
    cx.notify();
  });
}

/** One of the noted edits saved with a change: asks to apply it (once per save). */
export function checkEdits(v: K8s, cx: Context): void {
  if (v.ask || v.closed) return;

  const edits = readShared(shared, EDITS, []);

  if (!edits.length) return;

  cx.spawn(async (cx) => {
    for (const e of edits) {
      const now = await readTextFile(e.path).catch(() => null);

      if (now === null) {
        drop(e.path);
        continue;
      }

      if (now === e.original || v.ask) continue;

      // Taken: the next save is compared with what was asked about now.
      writeShared(setShared, EDITS, readShared(shared, EDITS, []).map((x) => (x.path === e.path ? { ...x, original: now } : x)));

      const kind = isBuiltin(e.kind) ? e.kind : "pods";
      const row: Row = { key: e.path, uid: null, ref: { kind, name: e.name, namespace: e.namespace ?? null }, tone: "ok", status: "", created: null, cells: [], labels: new Map() };

      request(v, applySpec(e.context, row, e.path), cx);
      cx.notify();

      return;
    }
  });
}

function drop(path: string): void {
  writeShared(setShared, EDITS, readShared(shared, EDITS, []).filter((e) => e.path !== path));
}

/** k9s's way, for what the editor can't take: `kubectl edit` in a terminal pane. */
export function editInTerminal(v: K8s, row: Row, cx: Context): void {
  const ns = row.ref.namespace;

  openTerminal(v, [v.settings.kubectl, "--context", v.context ?? "", ...(ns ? ["-n", ns] : []), "edit", row.ref.kind, row.ref.name], `edit ${row.ref.name}`, "right", cx);
}
