// Kubernetes quantities ("250m", "1.5", "128Mi", "8028140Ki") as numbers:
// CPU in millicores, memory in bytes; and back as short text.

const BINARY = new Map([["Ki", 2 ** 10], ["Mi", 2 ** 20], ["Gi", 2 ** 30], ["Ti", 2 ** 40], ["Pi", 2 ** 50]]);
const DECIMAL = new Map([["k", 1e3], ["M", 1e6], ["G", 1e9], ["T", 1e12], ["P", 1e15], ["m", 1e-3], ["", 1]]);

/** A CPU quantity in millicores ("250m" → 250, "2" → 2000), or null. */
export function millicores(q: string | null | undefined): number | null {
  const m = /^([0-9.]+)(m|n|u)?$/.exec(q?.trim() ?? "");

  if (!m) return null;

  const v = Number(m[1]);

  if (Number.isNaN(v)) return null;

  return m[2] === "m" ? v : m[2] === "n" ? v / 1e6 : m[2] === "u" ? v / 1e3 : v * 1000;
}

/** A memory quantity in bytes ("128Mi", "1G", "8028140Ki"), or null. */
export function bytes(q: string | null | undefined): number | null {
  const m = /^([0-9.]+)([A-Za-z]{0,2})$/.exec(q?.trim() ?? "");

  if (!m) return null;

  const v = Number(m[1]);
  const unit = m[2] ?? "";
  const scale = BINARY.get(unit) ?? DECIMAL.get(unit);

  return Number.isNaN(v) || scale === undefined ? null : v * scale;
}

/** Millicores as kubectl shows them ("212m", "1.5"). */
export function cpuText(mc: number): string {
  return mc >= 1000 ? `${(mc / 1000).toFixed(mc % 1000 ? 1 : 0)}` : `${Math.round(mc)}m`;
}

/** Bytes as kubectl top shows them ("318Mi", "1.2Gi"). */
export function memText(b: number): string {
  if (b >= 2 ** 30) return `${(b / 2 ** 30).toFixed(1)}Gi`;

  return `${Math.round(b / 2 ** 20)}Mi`;
}
