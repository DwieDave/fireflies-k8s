// The detail panel: the selected row's graph (in traffic order, with its
// CPU and memory lines and its last events under it), describe or YAML (a
// read-only code view: fold, find, copy), or its events. A secret shows its
// key names, its values only after x. A node shows its load against what it
// can take.

import { div } from "gpui-kit";
import type { Color, Element } from "gpui-kit";
import { Editor, h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { default as K8s } from "./main.ts";
import { chip, meterBar, panel, spark } from "./kit.ts";
import type { DetailView } from "./state.ts";
import { hasGraph, selectedRow, showRef } from "./nav.ts";
import { ROW_CANVAS, rowGraph } from "./graph-shown.ts";
import { canvas, rule } from "./graph-view.ts";
import type { Row } from "./rows.ts";
import { secretValues } from "./table.ts";
import { podsOwned, ownersOf } from "./graph.ts";
import { EMPTY } from "./snapshot.ts";
import { inNs } from "./derive.ts";
import type { KEvent } from "./objects.ts";
import { age, instant } from "./time.ts";
import { cpuText, memText } from "./quantity.ts";
import { allocatable } from "./rows-kinds.ts";
import { paceChip } from "./metrics-pace.ts";
import { panelNum } from "./panel-keys.ts";
import { nodeMenu } from "./node-menu.ts";

const VIEWS: readonly (readonly [DetailView, string, string])[] = [["graph", "g", "graph"], ["describe", "d", "describe"], ["yaml", "y", "yaml"], ["events", "v", "events"]];

export function detail(v: K8s, t: Theme, width: number): Element {
  const row = selectedRow(v);
  const active = v.panel === "detail";

  if (!row) return panel(t, "k8s-detail", "nothing selected", active, div().p(16).text_size(11).text_color(t.dim).child("pick a row"), { num: panelNum("detail") });

  const views = VIEWS.filter(([d]) => d !== "graph" || hasGraph(row.ref.kind));
  const shown = views.some(([d]) => d === v.detail) ? v.detail : "describe";

  const strip = h_flex().h(22).flex_none().px(6).gap(2).items_center().children(views.map(([d, k, w]) => chip(t, `dv-${d}`, h_flex().gap(4).child(div().text_color(t.accent).child(k)).child(div().child(w)), shown === d, () => {
    v.detail = d;
    v.panel = "detail";
  })));

  return panel(t, "k8s-detail", row.ref.name, active, v_flex().size_full().child(strip).child(v_flex().flex_1().min_h(0).min_w(0).child(body(v, t, row, shown, width, active))), { num: panelNum("detail"), right: row.status });
}

function body(v: K8s, t: Theme, row: Row, shown: DetailView, width: number, active: boolean): Element {
  if (row.ref.kind === "secrets") return v_flex().size_full().child(secretValues(v, t, row)).child(v_flex().flex_1().min_h(0).min_w(0).child(textView(v, t)));

  if (shown === "graph") return graphView(v, t, row, width, active);

  if (shown === "events") return eventList(t, v.data.selEvents.value ?? [], v.data.selEvents.at === 0);

  const node = row.ref.kind === "nodes" ? nodeLoad(v, t, row, width) : null;

  return v_flex().size_full().when(node !== null, (el) => el.child(node ?? div())).child(v_flex().flex_1().min_h(0).min_w(0).child(textView(v, t)));
}

/** The describe / YAML text, as a read-only code view. */
function textView(v: K8s, t: Theme): Element {
  const f = v.data.text;

  if (f.error) return div().p(12).text_size(11).text_color(t.blocked).child(`kubectl: ${f.error}`);

  if (f.value === null || !v.text) return div().p(12).text_size(11).text_color(t.dim).child("reading…");

  return div().id("k8s-text").size_full().child(Editor.new(v.text));
}

function graphView(v: K8s, t: Theme, row: Row, width: number, active: boolean): Element {
  const s = rowGraph(v, width);
  const keys = row.ref.kind === "pods" ? [`${row.ref.namespace ?? ""}/${row.ref.name}`] : podsOwned(row.uid, v.data.snap.value ?? EMPTY, ownersOf(inNs(v.data.pods.value ?? [], row.ref.namespace)));
  const line = v.data.history.sum(keys);

  return v_flex().size_full()
    .child(v_flex().flex_1().min_h(0).min_w(0).child(s ? canvas(v, t, s, width, v.graphSel ?? row.key, active, (b, how) => {
      v.graphSel = b.node.key;
      v.panel = "detail";

      const r = b.node.ref;

      if (how === "menu") v.menu = nodeMenu(v, b, null);
      else if (how === "open" && r) showRef(v, r.kind, r.name, r.namespace);
    }, ROW_CANVAS) : div().p(12).text_size(11).text_color(t.dim).child("reading…")))
    .when(line.length > 0 && !v.data.metricsMissing, (el) => el.child(metrics(v, t, line.map((x) => x.cpu), line.map((x) => x.mem), width, keys.length)))
    .child(rule(t, "events"))
    .child(eventList(t, (v.data.selEvents.value ?? []).slice(0, 4), v.data.selEvents.at === 0).h(78).flex_none());
}

/** CPU and memory over the samples since the window opened (each a new one from metrics-server), and how
 *  often they're read (the chip, M). */
function metrics(v: K8s, t: Theme, cpu: readonly number[], mem: readonly number[], width: number, pods: number): Element {
  const w = Math.max(80, Math.floor((width - 48) / 2));
  const last = (xs: readonly number[]) => xs[xs.length - 1] ?? 0;

  const block = (id: string, label: string, now: string, xs: readonly number[], color: Color) => v_flex().id(id).gap(3).flex_1().min_w(0)
    .child(h_flex().text_size(10).child(div().text_color(t.dim).child(label)).child(div().flex_1()).child(div().text_color(t.foreground).child(now)))
    .child(spark(t, `${id}-g`, xs, w, 26, color));

  return v_flex().flex_none().px(8).pt(2).pb(8).gap(2)
    .child(h_flex().h(20).items_center().child(div().flex_1()).child(paceChip(v, t, "m-pace")))
    .child(h_flex().gap(14)
      .child(block("m-cpu", pods > 1 ? `cpu · ${pods} pods` : "cpu", cpuText(last(cpu)), cpu, t.accent))
      .child(block("m-mem", "memory", memText(last(mem)), mem, t.ansi5)));
}

/** Events, newest first: age, reason (warnings yellow, failures red), message. */
export function eventList(t: Theme, events: readonly KEvent[], reading: boolean): Element {
  const sorted = [...events].sort((a, b) => (instant(b.lastTimestamp ?? b.metadata.creationTimestamp) ?? 0) - (instant(a.lastTimestamp ?? a.metadata.creationTimestamp) ?? 0));

  return v_flex().id("k8s-events").px(8).pt(2).gap(1).overflow_y_scroll().text_size(10)
    .when(!sorted.length, (el) => el.child(div().py(4).text_color(t.dim).child(reading ? "reading…" : "no events")))
    .children(sorted.map((e, i) => h_flex().id(`ev-${i}`).h(16).gap(8).items_center()
      .child(div().w(30).flex_none().text_color(t.dim).child(age(instant(e.lastTimestamp ?? e.eventTime ?? e.metadata.creationTimestamp))))
      .child(div().w(92).flex_none().truncate().text_color(e.type === "Warning" ? (/fail|backoff|error|kill/i.test(e.reason ?? "") ? t.blocked : t.working) : t.dim).child(e.reason ?? ""))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(`${(e.count ?? 1) > 1 ? `${e.count}× ` : ""}${e.message ?? ""}`))));
}

/** A node's load: its pods' CPU and memory now against what it can take. */
function nodeLoad(v: K8s, t: Theme, row: Row, width: number): Element {
  const n = (v.data.nodes.value ?? []).find((x) => x.metadata.name === row.ref.name);
  const cap = n ? allocatable(n) : { cpu: 0, mem: 0 };
  const now = v.data.history.of(`node:${row.ref.name}`);
  const last = now[now.length - 1];
  const pods = (v.data.pods.value ?? []).filter((p) => p.spec?.nodeName === row.ref.name).length;
  const w = Math.max(80, width - 200);

  const line = (id: string, label: string, part: number, whole: number, text: string, color: Color) => h_flex().id(id).h(16).gap(8).items_center().text_size(10)
    .child(div().w(56).flex_none().text_color(t.dim).child(label)).child(meterBar(t, `${id}-b`, part, whole, w, color)).child(div().text_color(t.muted).child(text));

  return v_flex().flex_none().px(8).py(6).gap(3)
    .child(line("nl-cpu", "cpu", last?.cpu ?? 0, cap.cpu, `${cpuText(last?.cpu ?? 0)} of ${cpuText(cap.cpu)}`, t.accent))
    .child(line("nl-mem", "memory", last?.mem ?? 0, cap.mem, `${memText(last?.mem ?? 0)} of ${memText(cap.mem)}`, t.ansi5))
    .child(h_flex().items_center().child(div().flex_1().text_size(10).text_color(t.dim).child(`${pods} pods run on it`)).child(paceChip(v, t, "nl-pace")));
}
