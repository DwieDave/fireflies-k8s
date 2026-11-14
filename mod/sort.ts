// Sorting a kind's table by a column, by what its cells mean rather than
// their text: ages by time, CPU and memory by the reading now, restarts and
// counts by number, readiness by how much is ready, a status by its tone
// (failing first) then its word, sizes ("10Gi") by bytes, spans ("3h12m") by
// length, the rest as text with numbers in it read as numbers. Rows that have
// nothing to sort by go last either way; ties keep the default order.

import type { Cell, Row, Tone } from "./rows.ts";

/** A sorted column: its title (unique in a kind's columns), and which way. */
export interface SortBy {
  readonly col: string;
  readonly desc: boolean;
}

/** What a cell sorts by: a rank first (a status's tone), then a number, then a text. */
export interface SortKey {
  readonly rank: number;
  readonly num: number | null;
  readonly text: string;
}

const TONE: Readonly<Record<Tone, number>> = { bad: 0, wk: 1, miss: 2, ok: 3, done: 4, off: 5 };

const UNIT = new Map<string, number>([["k", 1e3], ["M", 1e6], ["G", 1e9], ["T", 1e12], ["Ki", 1024], ["Mi", 1024 ** 2], ["Gi", 1024 ** 3], ["Ti", 1024 ** 4], ["Pi", 1024 ** 5]]);

/** A size as Kubernetes writes it ("10Gi", "512Mi", "1.5G"), in bytes; null for anything else. */
export function sizeOf(text: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|Pi|k|M|G|T)$/.exec(text.trim());
  const unit = m ? UNIT.get(m[2] ?? "") : undefined;

  return m && unit !== undefined ? Number(m[1]) * unit : null;
}

const SPAN_UNIT = new Map<string, number>([["d", 86400], ["h", 3600], ["m", 60], ["s", 1]]);

/** A span as kubectl writes it ("18d", "3h12m", "40s"), in seconds; null for anything else. */
export function spanOf(text: string): number | null {
  const t = text.trim();

  if (!/^(\d+[dhms])+$/.test(t)) return null;

  let s = 0;

  for (const [, n, u] of t.matchAll(/(\d+)([dhms])/g)) s += Number(n) * (SPAN_UNIT.get(u ?? "s") ?? 1);

  return s;
}

/** A text's number: plain, a size, or a span. */
function numberOf(text: string): number | null {
  const t = text.trim();

  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);

  return sizeOf(t) ?? spanOf(t);
}

/** What a cell sorts by. `metric` gives a CPU or memory cell's reading now (null: none yet). */
export function sortKey(c: Cell | undefined, metric: (c: Extract<Cell, { t: "metric" }>) => number | null, now: number = Date.now()): SortKey {
  if (!c) return { rank: 0, num: null, text: "" };

  switch (c.t) {
    case "age": return { rank: 0, num: c.at === null ? null : now - c.at, text: "" };
    case "marks": return { rank: 0, num: c.count, text: "" };
    case "metric": return { rank: 0, num: metric(c), text: "" };
    case "ready": {
      const ok = c.blocks.filter((b) => b === "ok" || b === "done").length;

      return { rank: 0, num: c.blocks.length ? ok / c.blocks.length : null, text: c.text };
    }

    case "text": return { rank: c.tone ? TONE[c.tone] : 0, num: c.text === "" ? null : numberOf(c.text), text: c.text };
    default: return { rank: 0, num: null, text: "" };
  }
}

/** Two keys compared (ascending); an empty key goes last either way, so it's apart from `desc`. */
function compare(a: SortKey, b: SortKey): number {
  if (a.rank !== b.rank) return a.rank - b.rank;

  if (a.num !== null && b.num !== null && a.num !== b.num) return a.num - b.num;

  return a.text.localeCompare(b.text, undefined, { numeric: true, sensitivity: "base" });
}

const empty = (k: SortKey): boolean => k.num === null && k.text === "";

/** The rows in the column's order (the cell at `index` of each row); ties and empties as they came. */
export function sortRows(rows: readonly Row[], index: number, desc: boolean, metric: (c: Extract<Cell, { t: "metric" }>) => number | null, now: number = Date.now()): readonly Row[] {
  const keyed = rows.map((r, i) => ({ r, i, k: sortKey(r.cells[index], metric, now) }));

  keyed.sort((a, b) => {
    const ea = empty(a.k);
    const eb = empty(b.k);

    if (ea !== eb) return ea ? 1 : -1;

    const c = compare(a.k, b.k);

    return (desc ? -c : c) || a.i - b.i;
  });

  return keyed.map((x) => x.r);
}

/** A header click (or `o`): sorted up, then down, then the default order. */
export function nextSort(now: SortBy | null, col: string): SortBy | null {
  if (now?.col !== col) return { col, desc: false };

  return now.desc ? null : { col, desc: true };
}
