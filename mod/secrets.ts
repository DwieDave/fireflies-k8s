// Secrets: listed from kubectl.ts's template (namespace, name, type, created,
// key names), so their values never come into the window until one is
// asked for. `x` reads that one secret's values (revealSecret); the view
// keeps them in memory on the open row only and drops them when the row is
// left or the window closes. Nothing here writes a value anywhere.

import type { Guard } from "./guard.ts";
import { object, parseJson } from "./guard.ts";
import { mapOf } from "./guards.ts";
import { isString } from "./guard.ts";
import type { Exec, Where } from "./kubectl.ts";
import { readText, scope } from "./kubectl.ts";
import type { Row } from "./rows.ts";
import { text } from "./rows.ts";
import { instant } from "./time.ts";

/** A secret's line in the template's answer, as a row. */
export function secretRows(out: string): readonly Row[] {
  return out.split("\n").flatMap((line): Row[] => {
    const [namespace, name, type, created, keys] = line.split("\t");

    if (!name) return [];

    const names = (keys ?? "").split(",").filter(Boolean);
    const at = instant(created);

    return [{
      key: `secrets/${namespace ?? ""}/${name}`, uid: null, ref: { kind: "secrets", name, namespace: namespace || null }, tone: "ok", status: type ?? "", created: at, labels: new Map(),
      cells: [text(name), text(type ?? "", null, true), text(names.join(" ")), { t: "age", at }],
    }];
  });
}

const isSecretData = object({}, { data: mapOf(isString) });

/** The secret as kubectl answers `get secret x -o json`, its data proven a map of strings. */
const isSecretAnswer: Guard<{ readonly data?: { readonly [key: string]: string | undefined } }> = isSecretData;

/** One secret's values, decoded (base64 → text; bytes that aren't text shown as their size). */
export async function revealSecret(exec: Exec, where: Where, name: string): Promise<ReadonlyMap<string, string> | string> {
  const r = await readText(exec, [...scope(where, "secrets"), "get", "secret", name, "-o", "json"]);

  if (!r.ok) return r.error;

  const s = parseJson(r.value, isSecretAnswer);

  if (!s) return "kubectl's answer wasn't a secret";

  const out = new Map<string, string>();

  for (const [k, v] of Object.entries(s.data ?? {})) if (v !== undefined) out.set(k, decode(v));

  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** base64's bytes, or null when it isn't base64 (the engine has no atob to lean on). */
export function base64Bytes(b64: string): number[] | null {
  const clean = b64.replace(/\s+/g, "").replace(/=+$/, "");
  const out: number[] = [];
  let acc = 0;
  let bits = 0;

  for (const ch of clean) {
    const v = B64.indexOf(ch);

    if (v < 0) return null;

    acc = (acc << 6) | v;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }

  return out;
}

/** UTF-8 bytes as text, or null when they aren't UTF-8 text (or hold control characters). */
export function utf8(bytes: readonly number[]): string | null {
  let s = "";

  for (let i = 0; i < bytes.length;) {
    const b = bytes[i] ?? 0;
    const n = b < 0x80 ? 0 : b >> 5 === 6 ? 1 : b >> 4 === 14 ? 2 : b >> 3 === 30 ? 3 : -1;

    if (n < 0 || i + n >= bytes.length + (n ? 0 : 1)) return null;

    let cp = n === 0 ? b : b & (0x3f >> n);

    for (let k = 1; k <= n; k++) {
      const c = bytes[i + k] ?? 0;

      if (c >> 6 !== 2) return null;

      cp = (cp << 6) | (c & 0x3f);
    }

    if (cp < 0x20 && cp !== 9 && cp !== 10 && cp !== 13) return null;

    s += String.fromCodePoint(cp);
    i += n + 1;
  }

  return s;
}

/** base64 to text, or "(n bytes)" when it isn't UTF-8 text. */
export function decode(b64: string): string {
  const bytes = base64Bytes(b64);

  if (bytes === null) return "(not base64)";

  return utf8(bytes) ?? `(${bytes.length} bytes)`;
}

/** A value hidden: dots the length of nothing (a value's length is not shown either). */
export const HIDDEN = "••••••••";

/** A secret's YAML with every value under `data:` / `stringData:` masked (what `y` shows until x). */
export function maskSecretYaml(yaml: string): string {
  let inData = false;

  return yaml.split("\n").map((line) => {
    if (/^(data|stringData):\s*$/.test(line)) {
      inData = true;

      return line;
    }

    if (inData && /^\S/.test(line)) inData = false;

    if (inData) {
      const m = /^(\s+[^:\s][^:]*):\s?.*$/.exec(line);

      return m ? `${m[1]}: ${HIDDEN}` : line;
    }

    return line;
  }).join("\n");
}
