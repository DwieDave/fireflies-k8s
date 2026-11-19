// The cluster's node metrics summed for the header, on every tab: CPU and
// memory used over all nodes against what they can take (allocatable), as
// numbers, a percent and a short bar ("cpu 1.9/12 16% · mem 10.2/23.0Gi 44%").
//
// They come from the nodes table's own reads (data.ts: `kubectl top nodes` at
// the metrics' pace, `get nodes` for allocatable): nothing is read for them
// alone. A cluster without metrics-server shows nothing, a context shows
// nothing until it has answered, and a read that fails later leaves the last
// totals dimmed, marked stale.

import { div } from "gpui-kit";
import type { Color, Element } from "gpui-kit";
import { h_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { default as K8s } from "./main.ts";
import type { Data } from "./data.ts";
import type { KNode } from "./objects.ts";
import type { Sample } from "./metrics.ts";
import { parseTopNodes } from "./metrics.ts";
import { allocatable } from "./rows-kinds.ts";
import { cpuText, memText } from "./quantity.ts";
import { meterBar, stop } from "./kit.ts";
import { NARROW } from "./main.ts";
import { setKind, setTab } from "./nav.ts";

/** The nodes' sums: millicores and bytes used, and what they can take. */
export interface Totals {
  readonly cpu: number;
  readonly cpuOf: number;
  readonly mem: number;
  readonly memOf: number;
  /** The nodes summed (in both the metrics and the list), of the nodes listed. */
  readonly nodes: number;
  readonly of: number;
}

/** The nodes' metrics (keyed "node:name", parseTopNodes) summed with their allocatable. A node in only
 *  one of the two is left out of both sums, so the percent compares like with like; null when none is in both. */
export function sumNodes(top: ReadonlyMap<string, Sample>, nodes: readonly KNode[]): Totals | null {
  let cpu = 0, cpuOf = 0, mem = 0, memOf = 0, n = 0;

  for (const node of nodes) {
    const s = top.get(`node:${node.metadata.name}`);
    const cap = allocatable(node);

    if (!s || cap.cpu <= 0 || cap.mem <= 0) continue;

    cpu += s.cpu;
    mem += s.mem;
    cpuOf += cap.cpu;
    memOf += cap.mem;
    n++;
  }

  return n ? { cpu, cpuOf, mem, memOf, nodes: n, of: nodes.length } : null;
}

/** The totals for `context` from what was read, or null: no metrics (yet), or read for another context. */
export function clusterTotals(d: Data, context: string | null): Totals | null {
  const top = d.topNodes;
  const list = d.nodes;

  if (context === null || top.scope !== context || list.scope !== context || top.value === null || list.value === null) return null;

  return sumNodes(parseTopNodes(top.value), list.value);
}

/** A whole percent of `of`. */
export const percent = (part: number, of: number): number => Math.round((part / of) * 100);

/** Memory used of memory there, in one unit where both are Gi ("10.2/23.0Gi"). */
export function memPair(used: number, of: number): string {
  return used >= 2 ** 30 && of >= 2 ** 30 ? `${(used / 2 ** 30).toFixed(1)}/${memText(of)}` : `${memText(used)}/${memText(of)}`;
}

/** How much the header has room for: the numbers and bars, the bars, or the percents alone. */
type Room = "full" | "bars" | "percent";

const roomOf = (width: number): Room => (width < NARROW ? "percent" : width < 1000 ? "bars" : "full");

/** The header's totals, or null when there are none (nothing drawn, no room taken). A click shows the nodes. */
export function totalsStrip(v: K8s, t: Theme): Element | null {
  const s = v.totalsMemo.get(v.data.version, v.context ?? "", () => clusterTotals(v.data, v.context));

  if (!s) return null;

  const stale = v.data.topNodes.error !== null;
  const quiet = stale || v.data.metricsEvery === 0;
  const room = roomOf(v.size.width);

  const part = (id: string, label: string, used: number, of: number, numbers: string, color: Color) => {
    const p = percent(used, of);
    const tone = quiet ? t.dim : p >= 90 ? t.blocked : p >= 75 ? t.working : color;

    return h_flex().id(id).flex_none().gap(5).items_center()
      .child(div().text_color(t.dim).child(label))
      .when(room === "full", (el) => el.child(div().text_color(quiet ? t.dim : t.muted).child(numbers)))
      .child(div().text_color(quiet ? t.dim : t.foreground).child(`${p}%`))
      .when(room !== "percent", (el) => el.child(meterBar(t, `${id}-b`, used, of, 32, tone)));
  };

  return h_flex().id("k8s-totals").relative().flex_none().gap(8).items_center().text_size(10).cursor_pointer()
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      setTab(v, "resources");
      setKind(v, "nodes");
      cx.notify();
    })
    .child(part("k8s-tot-cpu", "cpu", s.cpu, s.cpuOf, `${cpuText(s.cpu)}/${cpuText(s.cpuOf)}`, t.accent))
    .child(div().text_color(t.ansi0).child("·"))
    .child(part("k8s-tot-mem", "mem", s.mem, s.memOf, memPair(s.mem, s.memOf), t.ansi5))
    .when(room === "full" && s.nodes < s.of, (el) => el.child(div().text_color(t.dim).child(`${s.nodes} of ${s.of} nodes`)))
    .when(stale, (el) => el.child(div().text_color(t.working).child("stale")));
}
