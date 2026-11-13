// The window's settings, in `~/.config/herdr-app/k8s/settings.json` (beside
// the app's own files, outside the mod's folder so an update of the mod
// keeps them). All optional:
//
//   {
//     "kubectl": "kubectl",              the program (a path, or a name on PATH)
//     "readonly": ["nightjar-prod"],     contexts the window never writes to
//     "prod": "prod|prd|production|live", what makes a context production-looking (asks twice)
//     "favourites": ["lantern", "moth"],  namespaces 1-9 jump to (else the first nine)
//     "metrics": 15                      seconds between CPU and memory reads (0: paused; M sets it)
//   }

import type { Guarded } from "./guard.ts";
import { arrayOf, isNumber, isString, object, parseJson } from "./guard.ts";
import { isRecord, maybe } from "./guards.ts";
import { PROD_PATTERN } from "./contexts.ts";

export const isSettingsFile = object({}, { kubectl: maybe(isString), readonly: maybe(arrayOf(isString)), prod: maybe(isString), favourites: maybe(arrayOf(isString)), metrics: maybe(isNumber) });

type SettingsFile = Guarded<typeof isSettingsFile>;

/** The settings in force. */
export interface Settings {
  readonly kubectl: string;
  readonly readonly: ReadonlySet<string>;
  readonly prod: string;
  readonly favourites: readonly string[];
  /** Seconds between `kubectl top` reads; 0: paused. */
  readonly metrics: number;
}

/** The metrics' pace before anyone picked one (metrics-server's own default resolution). */
export const METRICS_EVERY = 15;

export const DEFAULTS: Settings = { kubectl: "kubectl", readonly: new Set(), prod: PROD_PATTERN, favourites: [], metrics: METRICS_EVERY };

/** A metrics pace as kept: 0 (paused) or 1 to 600 s; anything else the default. */
export function metricsPace(n: number | null | undefined): number {
  if (n === 0) return 0;

  return n !== null && n !== undefined && n >= 1 ? Math.min(600, Math.round(n)) : METRICS_EVERY;
}

/** Where the file lives under the app's folder. */
export const SETTINGS_PATH = "k8s/settings.json";

/** The file's text as settings (a file in another shape, or none: the defaults). */
export function parseSettings(text: string | null): Settings {
  const f: SettingsFile | undefined = text ? parseJson(text, isSettingsFile) : undefined;

  if (!f) return DEFAULTS;

  return { kubectl: f.kubectl || DEFAULTS.kubectl, readonly: new Set(f.readonly ?? []), prod: f.prod || DEFAULTS.prod, favourites: f.favourites ?? [], metrics: metricsPace(f.metrics) };
}

/** The settings file's text with `metrics` set, everything else kept as it was; null when the text isn't a
 *  JSON object (it's left alone then). No file yet: one with just that. */
export function withMetrics(text: string | null, seconds: number): string | null {
  if (text === null || !text.trim()) return `${JSON.stringify({ metrics: seconds }, null, 2)}\n`;

  const o = parseJson(text, isRecord);

  return o ? `${JSON.stringify({ ...o, metrics: seconds }, null, 2)}\n` : null;
}
