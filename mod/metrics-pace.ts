// How often the window reads CPU and memory, picked where they show: a chip
// by the metrics (the detail panel's strip, a node's load) and M open a short
// menu (2 s, 5 s, 15 s, 30 s, paused); the pick is kept in the settings file
// (`metrics`, every other field left as it was). metrics-server measures
// about every 15 s: the menu says so beside the faster paces, and the chip
// says "same numbers" while the reads keep answering its last sample.

import { div } from "gpui-kit";
import type { Context, Element } from "gpui-kit";
import { h_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { default as K8s } from "./main.ts";
import { chip } from "./kit.ts";
import { METRIC_PACES, paceText } from "./metrics.ts";
import { keepSetting } from "./settings-keep.ts";
import type { Menu } from "./state.ts";
import { atPress } from "./menu-anchor.ts";

/** What metrics-server's own pace means for a faster one. */
const RESOLUTION = "metrics-server measures ~every 15s: often the same numbers";

/** M: the paces, the one in force marked. */
export function paceMenu(v: K8s): Menu {
  const now = v.data.metricsEvery;

  return {
    title: "read cpu and memory every",
    at: Math.max(0, METRIC_PACES.indexOf(now)),
    rows: METRIC_PACES.map((s) => ({
      label: `${s === 0 ? "paused" : `every ${paceText(s)}`}${s === now ? "  ·  now" : ""}`,
      sub: s > 0 && s < 15 ? RESOLUTION : s === 0 ? "nothing read; the lines stop where they are" : null,
      go: (cx: Context) => setPace(v, s, cx),
    })),
  };
}

/** Takes a pace now and keeps it in the settings file. */
export function setPace(v: K8s, seconds: number, cx: Context): void {
  v.settings = { ...v.settings, metrics: seconds };
  v.data.paceMetrics(seconds);
  v.say(seconds === 0 ? "metrics paused" : `metrics read every ${paceText(seconds)}`, "ok");
  keepSetting(v, "metrics", seconds, cx);
}

/** The chip by the metrics: the pace (a click opens the menu), and "same numbers" while the reads repeat. */
export function paceChip(v: K8s, t: Theme, id: string): Element {
  const s = v.data.metricsEvery;

  return h_flex().flex_none().gap(4).items_center().text_size(10)
    .when(s > 0 && v.data.metricsSame, (el) => el.child(div().text_color(t.dim).child("same numbers")))
    .child(chip(t, id, h_flex().gap(4).child(div().text_color(t.accent).child("M")).child(div().child(s === 0 ? "paused" : `every ${paceText(s)}`)), false, () => {
      atPress(v, null, () => { v.menu = paceMenu(v); });
    }, s === 0 ? t.working : t.dim));
}
