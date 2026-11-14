// One filter syntax for the Resources tab's `/` and the Argo CD tab's: terms
// split by spaces, every term must match.
//
//   word            the name (and the other words a row shows) holds it
//   !word           … doesn't hold it
//   key=value       a label equals (key!=value: doesn't; several are several terms)
//   -l a=b,c,!d     kubectl's selector: a=b, has c, hasn't d
//   field:value     a field: Argo CD's project, sync, health, cluster, ns, repo;
//                   the resources' status, ns, node. !field:value: not that.
//
// Words and fields match without case; sync and health from the start
// ("sync:out" is OutOfSync), the others anywhere in the value.

/** One term of a filter. */
export type Term =
  | { readonly t: "word"; readonly word: string; readonly not: boolean }
  | { readonly t: "label"; readonly key: string; readonly op: "=" | "!=" | "has" | "hasnt"; readonly value: string }
  | { readonly t: "field"; readonly field: string; readonly value: string; readonly not: boolean };

/** A selector's parts (`a=b`, `a!=b`, `a`, `!a`) as label terms. */
function selector(text: string): Term[] {
  return text.split(",").map((s) => s.trim()).filter(Boolean).map((s): Term => {
    const ne = /^([^=!]+)!=(.*)$/.exec(s);

    if (ne) return { t: "label", key: ne[1] ?? "", op: "!=", value: ne[2] ?? "" };

    const eq = /^([^=!]+)==?(.*)$/.exec(s);

    if (eq) return { t: "label", key: eq[1] ?? "", op: "=", value: eq[2] ?? "" };

    return s.startsWith("!") ? { t: "label", key: s.slice(1), op: "hasnt", value: "" } : { t: "label", key: s, op: "has", value: "" };
  });
}

/** A filter's terms; `fields` are the field names this tab knows (anything else with a colon is a word). */
export function parseTerms(text: string, fields: readonly string[]): readonly Term[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out: Term[] = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i] ?? "";

    if (w === "-l") {
      out.push(...selector(words[++i] ?? ""));
      continue;
    }

    if (w.startsWith("-l") && w.length > 2) {
      out.push(...selector(w.slice(2)));
      continue;
    }

    const not = w.startsWith("!");
    const body = not ? w.slice(1) : w;
    const field = /^([a-z]+):(.*)$/.exec(body);

    if (field && fields.includes(field[1] ?? "")) out.push({ t: "field", field: field[1] ?? "", value: field[2] ?? "", not });
    else if (!not && /^[^=]+!?=/.test(w)) out.push(...selector(w));
    else out.push({ t: "word", word: body, not });
  }

  return out.filter((x) => x.t !== "word" || x.word !== "");
}

/** Whether labels satisfy a label term. */
export function labelMatch(labels: ReadonlyMap<string, string>, x: Extract<Term, { t: "label" }>): boolean {
  switch (x.op) {
    case "=": return labels.get(x.key) === x.value;
    case "!=": return labels.get(x.key) !== x.value;
    case "has": return labels.has(x.key);
    default: return !labels.has(x.key);
  }
}

/** What a thing offers a filter: the text its words search, its labels, its fields' values. */
export interface Filterable {
  readonly text: string;
  readonly labels: ReadonlyMap<string, string>;
  readonly fields: (field: string) => readonly string[];
}

/** The fields matched from their start (the others anywhere). */
const FROM_START: ReadonlySet<string> = new Set(["sync", "health", "status"]);

function fieldMatch(values: readonly string[], field: string, want: string): boolean {
  const w = want.toLowerCase();

  return values.some((v) => (FROM_START.has(field) ? v.toLowerCase().startsWith(w) : v.toLowerCase().includes(w)));
}

/** Whether a thing matches every term. */
export function matches(f: Filterable, terms: readonly Term[]): boolean {
  const hay = f.text.toLowerCase();

  return terms.every((x) => {
    if (x.t === "label") return labelMatch(f.labels, x);

    if (x.t === "field") return fieldMatch(f.fields(x.field), x.field, x.value) !== x.not;

    return hay.includes(x.word.toLowerCase()) !== x.not;
  });
}

/** A term as its chip says it (and as it's typed). */
export function termText(x: Term): string {
  if (x.t === "word") return `${x.not ? "!" : ""}${x.word}`;

  if (x.t === "field") return `${x.not ? "!" : ""}${x.field}:${x.value}`;

  return x.op === "=" ? `${x.key}=${x.value}` : x.op === "!=" ? `${x.key}!=${x.value}` : x.op === "has" ? `-l ${x.key}` : `-l !${x.key}`;
}

/** The filter without its `i`-th term (a chip clicked off), the rest written back. */
export function withoutTerm(text: string, fields: readonly string[], i: number): string {
  return parseTerms(text, fields).filter((_, k) => k !== i).map(termText).join(" ");
}

/** The filter with a term added (a menu's pick), unless it's there already. */
export function withTerm(text: string, fields: readonly string[], term: string): string {
  const now = parseTerms(text, fields).map(termText);
  const added = parseTerms(term, fields).map(termText);

  return [...now, ...added.filter((x) => !now.includes(x))].join(" ");
}

/** Tab: the last word completed from what's there (`candidates`: every term the things offer). */
export function complete(text: string, candidates: readonly string[]): readonly string[] {
  const words = text.split(" ");
  const last = words[words.length - 1] ?? "";

  if (!last) return [];

  return candidates.filter((c) => c.toLowerCase().startsWith(last.toLowerCase()) && c.toLowerCase() !== last.toLowerCase());
}

/** The text with its last word replaced by `word`. */
export function completed(text: string, word: string): string {
  const words = text.split(" ");

  words[words.length - 1] = word;

  return words.join(" ");
}
