// Metrics from `kubectl top` (metrics-server): each pod's and node's CPU and
// memory, kept as short histories for the dithered lines. A cluster without
// metrics-server answers an error once; the lines are then left out.

import { bytes, millicores } from "./quantity.ts";

/** One reading: millicores and bytes. */
export interface Sample {
  readonly cpu: number;
  readonly mem: number;
}

/** How many readings a line keeps (15 s apart: ten minutes). */
export const KEEP = 40;

/** `kubectl top pods [-A] --no-headers`: "[ns] name 12m 34Mi" lines, keyed "ns/name"
 *  (`ns` given when the answer has no namespace column). */
export function parseTopPods(out: string, ns: string | null): ReadonlyMap<string, Sample> {
  const m = new Map<string, Sample>();

  for (const line of out.split("\n")) {
    const f = line.trim().split(/\s+/);
    const [a, b, c, d] = f;

    if (f.length >= 4 && a && b && c && d) add(m, `${a}/${b}`, c, d);
    else if (f.length === 3 && a && b && c && ns !== null) add(m, `${ns}/${a}`, b, c);
  }

  return m;
}

/** `kubectl top nodes --no-headers`: "name 620m 15% 3100Mi 40%", keyed "node:name". */
export function parseTopNodes(out: string): ReadonlyMap<string, Sample> {
  const m = new Map<string, Sample>();

  for (const line of out.split("\n")) {
    const [name, cpu, , mem] = line.trim().split(/\s+/);

    if (name && cpu && mem) add(m, `node:${name}`, cpu, mem);
  }

  return m;
}

function add(m: Map<string, Sample>, key: string, cpu: string, mem: string): void {
  const c = millicores(cpu);
  const b = bytes(mem);

  if (c !== null && b !== null) m.set(key, { cpu: c, mem: b });
}

/** Each pod's and node's readings over time. */
export class History {
  private lines = new Map<string, Sample[]>();

  /** Adds a reading for every key in it; a key missing from it (a pod gone) is dropped. */
  push(now: ReadonlyMap<string, Sample>, scopePrefix = ""): void {
    for (const key of this.lines.keys()) if (key.startsWith(scopePrefix) && !now.has(key)) this.lines.delete(key);

    for (const [key, s] of now) {
      const line = this.lines.get(key) ?? [];

      line.push(s);

      if (line.length > KEEP) line.shift();

      this.lines.set(key, line);
    }
  }

  /** A key's readings, oldest first. */
  of(key: string): readonly Sample[] {
    return this.lines.get(key) ?? [];
  }

  /** Several keys summed reading by reading (a deployment's pods), aligned at the newest. */
  sum(keys: readonly string[]): readonly Sample[] {
    const lines = keys.flatMap((k) => {
      const l = this.of(k);

      return l.length ? [l] : [];
    });

    const n = Math.max(0, ...lines.map((l) => l.length));

    return Array.from({ length: n }, (_, i) => lines.reduce((acc, l) => {
      const s = l[l.length - n + i];

      return s ? { cpu: acc.cpu + s.cpu, mem: acc.mem + s.mem } : acc;
    }, { cpu: 0, mem: 0 }));
  }

  /** Whether any reading came in. */
  any(): boolean {
    return this.lines.size > 0;
  }

  clear(): void {
    this.lines.clear();
  }
}
