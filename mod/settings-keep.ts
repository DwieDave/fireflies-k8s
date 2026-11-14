// Keeping a pick in the settings file (`~/.config/herdr-app/k8s/settings.json`):
// one field written, every other field left as it was; a file that isn't a
// plain JSON object is left alone, with a note in the key bar.

import type { Context } from "gpui-kit";
import { appHome, readTextFile, writeTextFile } from "herdr";
import * as fs from "fs/promises";
import type { default as K8s } from "./main.ts";
import { SETTINGS_PATH, withField } from "./settings.ts";

/** Writes `field` into the settings file (the view's settings already hold it). */
export function keepSetting(v: K8s, field: "metrics" | "favourites", value: number | readonly string[], cx: Context): void {
  cx.spawn(async (cx) => {
    const path = `${appHome()}/${SETTINGS_PATH}`;
    const text = await readTextFile(path).catch(() => null);
    const next = withField(text, field, value);

    if (next === null) {
      v.say(`not kept: ${SETTINGS_PATH} isn't a plain JSON object, so it's left as it is`, "wk");
      cx.notify();

      return;
    }

    try {
      await fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
      await writeTextFile(path, next, text);
    } catch (cause: unknown) {
      v.say(`not kept: ${cause instanceof Error ? cause.message : String(cause)}`, "bad");
      cx.notify();
    }
  });
}
