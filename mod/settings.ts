// The window's settings, in `~/.config/herdr-app/k8s/settings.json` (beside
// the app's own files, outside the mod's folder so an update of the mod
// keeps them). All optional:
//
//   {
//     "kubectl": "kubectl",              the program (a path, or a name on PATH)
//     "readonly": ["nightjar-prod"],     contexts the window never writes to
//     "prod": "prod|prd|production|live", what makes a context production-looking (asks twice)
//     "favourites": ["lantern", "moth"]   namespaces 1-9 jump to (else the first nine)
//   }

import type { Guarded } from "./guard.ts";
import { arrayOf, isString, object, parseJson } from "./guard.ts";
import { maybe } from "./guards.ts";
import { PROD_PATTERN } from "./contexts.ts";

export const isSettingsFile = object({}, { kubectl: maybe(isString), readonly: maybe(arrayOf(isString)), prod: maybe(isString), favourites: maybe(arrayOf(isString)) });

type SettingsFile = Guarded<typeof isSettingsFile>;

/** The settings in force. */
export interface Settings {
  readonly kubectl: string;
  readonly readonly: ReadonlySet<string>;
  readonly prod: string;
  readonly favourites: readonly string[];
}

export const DEFAULTS: Settings = { kubectl: "kubectl", readonly: new Set(), prod: PROD_PATTERN, favourites: [] };

/** Where the file lives under the app's folder. */
export const SETTINGS_PATH = "k8s/settings.json";

/** The file's text as settings (a file in another shape, or none: the defaults). */
export function parseSettings(text: string | null): Settings {
  const f: SettingsFile | undefined = text ? parseJson(text, isSettingsFile) : undefined;

  if (!f) return DEFAULTS;

  return { kubectl: f.kubectl || DEFAULTS.kubectl, readonly: new Set(f.readonly ?? []), prod: f.prod || DEFAULTS.prod, favourites: f.favourites ?? [] };
}
