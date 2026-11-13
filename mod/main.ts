// k8s: Kubernetes and Argo CD in a Fireflies window or pane, in Nocturne's
// look. Its keys follow k9s where they fit (keys.ts).
//
//   resources  the rail (contexts, namespaces with their pods as cell strips,
//              kinds with counts), the kind's table, the selected row's
//              detail (its graph in traffic order, describe, YAML, events,
//              metrics); running port-forwards on a shelf over the key bar
//   argo cd    applications, an application's resource tree, its status,
//              history and diff, sync / refresh / rollback (asking first)
//   forwards   the port-forwards and where each leads (a web pane, Databases)
//
// A window when opened as an overlay (`mod.open:k8s`, its mod.json spec), a
// pane otherwise (`pane.split {mod: "k8s", props: {slot}}`): the same view and
// keys; host.ts holds what differs. Data: data.ts (kubectl, polled for what's
// shown), derive.ts (rows, strips, counts). Every write asks first (confirm.ts).

import { View } from "gpui-kit";
import { ScrollHandle, EditorState } from "gpui-base";
import type { AsyncContext, Context, Element, FocusHandle } from "gpui-kit";
import type { Props } from "gpui-shell";
import { appHome, exec, nextCommand, readTextFile, settings as appSettings, theme } from "herdr";
import { bindTab } from "./form-keys.ts";
import type { Ask } from "./confirm.ts";
import { Data } from "./data.ts";
import type { Wants } from "./data.ts";
import type { KindRef } from "./kinds.ts";
import type { Row } from "./rows.ts";
import type { Settings } from "./settings.ts";
import { DEFAULTS, SETTINGS_PATH, parseSettings } from "./settings.ts";
import type { ArgoPanel, DetailView, Drill, GraphDir, Menu, Note, Panel, Tab, Typing } from "./state.ts";
import type { Diffed } from "./argo-actions.ts";
import { DATABASES_MOD } from "./forwards.ts";
import { Memo } from "./derive.ts";
import type { View as CanvasView } from "./graph-pan.ts";
import { appNamespace, listRows, selectedRow } from "./nav.ts";
import { checkEdits } from "./edit.ts";
import { frame } from "./frame.ts";
import { beat, hostProps, takeOpening, command, saveCopy } from "./host.ts";
import type { HostProps } from "./host.ts";
import { Dividers } from "./dividers.ts";
import { keptSizes, saveSizes } from "./panels.ts";

/** The narrow break: one column under it. */
export const NARROW = 640;

/** The wide break: the detail panel beside the table at or over it, under it below. */
export const WIDE = 1100;

export default class K8s extends View {
  data = new Data((args, timeout) => exec(this.settings.kubectl, [...args], { timeout }));
  settings: Settings = DEFAULTS;
  props: HostProps = { overlay: null, slot: null };
  tab: Tab = "resources";
  context: string | null = null;
  namespace: string | null = null;
  kind: KindRef = "pods";
  panel: Panel = "table";
  /** The rail's cursor (rail.ts: contexts, then namespaces, then kinds). */
  railAt = 0;
  /** The selected row's key per list (context / namespace / kind / drill). */
  sel = new Map<string, string>();
  detail: DetailView = "graph";
  /** The graph box with the keyboard's cursor (arrows walk the graph when the detail panel has the keys). */
  graphSel: string | null = null;
  /** The workload graph's direction: "auto" follows the detail panel's shape, `O` picks one (kept). */
  graphDir: GraphDir = "auto";
  filter = "";
  typing: Typing | null = null;
  drill: Drill | null = null;
  ask: Ask | null = null;
  menu: Menu | null = null;
  help = false;
  note: Note | null = null;
  /** A secret's values, shown on its row only (dropped when the row is left). */
  secret: { readonly key: string; readonly values: ReadonlyMap<string, string> | string } | null = null;
  app: string | null = null;
  argoPanel: ArgoPanel = "apps";
  argoNode: string | null = null;
  histAt: number | null = null;
  argoDiff: Diffed | null = null;
  forwardAt = 0;
  databases = false;
  size = { width: 1100, height: 720 };
  handle: FocusHandle | null = null;
  tableScroll = ScrollHandle.new();
  nsScroll = ScrollHandle.new();
  kindsScroll = ScrollHandle.new();
  text: EditorState | null = null;
  shownText = "";
  rowsMemo = new Memo<readonly Row[]>();
  /** The panels' sizes, dragged at the gaps or stepped with + and - (panels.ts). */
  dividers = new Dividers({}, () => {});
  /** Each graph canvas's size and pan (graph-pan.ts). */
  canvases = new Map<string, CanvasView>();
  closed = false;
  /** No kubectl call before the settings are read (they name which kubectl). */
  loaded = false;

  override init(p: Props | undefined, cx: AsyncContext): void {
    this.props = hostProps(p);

    const inWindow = this.inWindow();

    this.dividers = new Dividers(keptSizes(inWindow), (sizes) => saveSizes(inWindow, sizes));
    takeOpening(this);

    const handle = cx.focus_handle();

    this.handle = handle;
    bindTab(cx);
    handle.focus();

    // A window grabs the keyboard as it opens (the overlay settles in a few frames); a pane doesn't.
    if (this.inWindow()) for (const ms of [60, 250, 600]) cx.timer.after(ms, () => {
      if (!this.closed && !this.text?.focused()) handle.focus();
    });

    const th = theme();

    this.text = EditorState.new({
      language: "yaml", value: "", readonly: true, line_numbers: true, folding: true, soft_wrap: false, font_family: appSettings().font_family,
      syntax: { keyword: th.ansi4, string: th.ansi2, comment: th.dim, number: th.ansi3, constant: th.ansi5, boolean: th.ansi5, type: th.ansi6, punctuation: th.muted, property: th.ansi4, variable: th.foreground },
    });
    this.load(cx);
    this.listen(handle, cx);
    cx.timer.every(500, (cx) => this.tick(cx));
    cx.timer.every(4000, () => beat(this));
    cx.timer.every(2000, (cx) => checkEdits(this, cx));
    beat(this);
  }

  /** The settings file and whether the databases mod is there. */
  load(cx: AsyncContext): void {
    cx.spawn(async (cx) => {
      this.settings = parseSettings(await readTextFile(`${appHome()}/${SETTINGS_PATH}`).catch(() => null));
      this.data.paceMetrics(this.settings.metrics);
      this.databases = (await readTextFile(`${appHome()}/${DATABASES_MOD}`).catch(() => null)) !== null;
      this.loaded = true;
      cx.notify();
    });
  }

  /** Commands for this mod (keys.json `k8s.<command>`, `herdr-app do`). */
  listen(handle: FocusHandle, cx: AsyncContext): void {
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();

        if (this.closed) return;

        if (c === "focus") handle.focus();
        else command(this, c.replace(/^k8s\./, ""), cx);

        cx.notify();
      }
    });
  }

  /** Below the break the panels fold into one column (the pane pattern's narrow rule). */
  narrow(): boolean {
    return this.size.width < NARROW;
  }

  inWindow(): boolean {
    return this.props.overlay !== null;
  }

  /** What's shown now, for the reads. */
  wants(): Wants {
    const row = this.tab === "resources" ? selectedRow(this) : null;

    return { context: this.context, namespace: this.namespace, kind: this.kind, tab: this.tab, detail: this.detail, row, appNamespace: appNamespace(this) };
  }

  tick(cx: Context): void {
    if (this.closed || !this.loaded) return;

    if (this.context === null) {
      const ctxs = this.data.contexts.value;
      const cur = ctxs?.find((c) => c.current) ?? ctxs?.[0] ?? null;

      if (cur) {
        this.context = cur.name;
        this.namespace ??= cur.namespace ?? "default";
        cx.notify();
      }
    }

    if (this.note && Date.now() - this.note.at > 6000) {
      this.note = null;
      cx.notify();
    }

    this.data.tick(this.wants(), cx);
    this.syncText();
  }

  /** The describe / YAML view shows what was read last (set outside render: it isn't a redraw). */
  syncText(): void {
    const text = this.data.text.value ?? "";

    if (text === this.shownText || !this.text) return;

    this.shownText = text;
    this.text.set_value(text);
  }

  rows(): readonly Row[] {
    return listRows(this);
  }

  say(text: string, tone: Note["tone"] = "ok"): void {
    this.note = { text, tone, at: Date.now() };
  }

  override close(): void {
    this.closed = true;
    this.secret = null;
    saveCopy(this);
    this.text?.release();
  }

  override render(cx: Context): Element {
    return frame(this, theme(), cx);
  }
}
