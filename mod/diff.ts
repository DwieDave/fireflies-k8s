// A line diff (longest common subsequence) between two texts, and YAML from
// JSON values: what Argo's diff falls back to without the argocd CLI, the
// live object against its last-applied configuration.

/** One line of a diff. */
export interface DiffLine {
  readonly op: " " | "-" | "+";
  readonly text: string;
  /** Its line number on its side (the old for " " and "-", the new for "+"). */
  readonly n: number;
}

/** The lines of `b` against `a`: kept, removed, added. Long inputs are cut at 2000 lines a side. */
export function diffLines(a: string, b: string): readonly DiffLine[] {
  const x = a.split("\n").slice(0, 2000);
  const y = b.split("\n").slice(0, 2000);
  const w = y.length + 1;
  const lcs = new Uint16Array((x.length + 1) * w);

  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i * w + j] = x[i] === y[j] ? (lcs[(i + 1) * w + j + 1] ?? 0) + 1 : Math.max(lcs[(i + 1) * w + j] ?? 0, lcs[i * w + j + 1] ?? 0);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      out.push({ op: " ", text: x[i] ?? "", n: i + 1 });
      i++;
      j++;
    } else if (j < y.length && (i >= x.length || (lcs[i * w + j + 1] ?? 0) > (lcs[(i + 1) * w + j] ?? 0))) {
      out.push({ op: "+", text: y[j] ?? "", n: j + 1 });
      j++;
    } else {
      out.push({ op: "-", text: x[i] ?? "", n: i + 1 });
      i++;
    }
  }

  return out;
}

/** Only the changes, with `context` kept lines around each (a gap between shown as one "…" kept line). */
export function hunks(lines: readonly DiffLine[], context = 3): readonly DiffLine[] {
  const near = new Set<number>();

  lines.forEach((l, i) => {
    if (l.op !== " ") for (let k = i - context; k <= i + context; k++) near.add(k);
  });

  const out: DiffLine[] = [];
  let gap = false;

  lines.forEach((l, i) => {
    if (near.has(i)) {
      if (gap && out.length) out.push({ op: " ", text: "…", n: 0 });

      gap = false;
      out.push(l);
    } else gap = true;
  });

  return out;
}

/** A JSON value (the last-applied annotation holds JSON), to write as YAML for the diff. */
export type Yamlable = string | number | boolean | null | readonly Yamlable[] | YamlObject;

/** A JSON object of any keys. */
export interface YamlObject {
  readonly [key: string]: Yamlable | undefined;
}

const isYamlList = (v: unknown): v is readonly Yamlable[] => Array.isArray(v) && v.every(isYamlable);

const isYamlObject = (v: unknown): v is YamlObject => typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).every((k) => isYamlable(Object.getOwnPropertyDescriptor(v, k)?.value));

/** Any JSON value. */
export function isYamlable(v: unknown): v is Yamlable {
  return v === null || typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || isYamlList(v) || isYamlObject(v);
}

const plain = /^[A-Za-z0-9_./:@-][A-Za-z0-9_ ./:@,-]*$/;

/** A value as YAML (keys in the order given). */
export function toYaml(v: Yamlable, indent = ""): string {
  return yamlOf(v, indent).replace(/^\n/, "");
}

const asList = (v: Yamlable): v is readonly Yamlable[] => Array.isArray(v);

const asMap = (v: Yamlable): v is YamlObject => v !== null && typeof v === "object" && !Array.isArray(v);

function yamlOf(v: Yamlable, indent: string): string {
  if (asList(v)) return v.length ? v.map((x) => `\n${indent}-${yamlOf(x, `${indent}  `).replace(/^\n\s*/, " ")}`).join("") : " []";

  if (asMap(v)) {
    const keys = Object.keys(v);

    return keys.length ? keys.map((k) => `\n${indent}${plain.test(k) ? k : JSON.stringify(k)}:${yamlOf(v[k] ?? null, `${indent}  `)}`).join("") : " {}";
  }

  if (v === null) return " null";

  const s = String(v);

  return ` ${plain.test(s) && !/^(true|false|null|yes|no|[0-9.]+)$/i.test(s) ? s : v === true || v === false || s === String(Number(s)) ? s : JSON.stringify(s)}`;
}
