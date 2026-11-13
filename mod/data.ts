// What the window reads, and when: one Feed per kubectl read, ticked twice a
// second by the view with what it shows now (`Wants`). Only what's on screen
// is read; a feed whose answer didn't change bumps nothing and redraws
// nothing (`version` counts the changes, derive.ts caches on it).

import type { Context as Cx } from "gpui-kit";
import type { Context } from "./contexts.ts";
import { parseContexts } from "./contexts.ts";
import type { Answer, Exec, Where } from "./kubectl.ts";
import { CONTEXTS_ARGS, apiResourcesArgs, describeArgs, eventArgs, listArgs, readList, readText, secretListArgs, topNodesArgs, topPodsArgs, yamlArgs } from "./kubectl.ts";
import type { KindRef } from "./kinds.ts";
import { customOf } from "./kinds.ts";
import type { AnyObject, KEvent, KNode, Namespace, Pod } from "./objects.ts";
import { isAnyObject, isEvent, isKList, isNamespace, isNode, isPod } from "./objects.ts";
import type { Snapshot } from "./snapshot.ts";
import { snapshotArgs, sortSnapshot } from "./snapshot.ts";
import type { Application } from "./argo.ts";
import { isApplication } from "./argo.ts";
import type { Row } from "./rows.ts";
import { secretRows, maskSecretYaml } from "./secrets.ts";
import { Feed, versions } from "./feed.ts";
import { History, parseTopNodes, parseTopPods } from "./metrics.ts";
import { parseJson } from "./guard.ts";
import type { DetailView, Tab } from "./state.ts";

/** What the view shows now: the feeds it needs follow from it. */
export interface Wants {
  readonly context: string | null;
  readonly namespace: string | null;
  readonly kind: KindRef;
  readonly tab: Tab;
  readonly detail: DetailView;
  /** The selected row (its uid for its events, name for describe / YAML). */
  readonly row: Pick<Row, "uid" | "ref"> | null;
  /** The Argo app shown, and the namespace it deploys to in this cluster (null: elsewhere). */
  readonly appNamespace: string | null;
}

/** One text read (describe or YAML) for the detail panel. */
type TextMode = "describe" | "yaml";

export class Data {
  readonly contexts = new Feed<readonly Context[]>(60000);
  readonly apiResources = new Feed<string>(120000);
  readonly namespaces = new Feed<readonly Namespace[]>(30000);
  readonly pods = new Feed<readonly Pod[]>(3000);
  readonly snap = new Feed<Snapshot>(3000);
  readonly secrets = new Feed<readonly Row[]>(10000);
  readonly events = new Feed<readonly KEvent[]>(5000);
  readonly nodes = new Feed<readonly KNode[]>(15000);
  readonly custom = new Feed<readonly AnyObject[]>(5000);
  readonly apps = new Feed<readonly Application[]>(4000);
  readonly argoSnap = new Feed<Snapshot>(4000);
  readonly topPods = new Feed<string>(15000);
  readonly topNodes = new Feed<string>(15000);
  readonly text = new Feed<string>(5000);
  readonly selEvents = new Feed<readonly KEvent[]>(5000);
  readonly history = new History();
  /** Counts every change to anything read: derived values cache on it. */
  version = 0;
  /** metrics-server answered no: the lines are left out. */
  metricsMissing = false;
  exec: Exec;

  constructor(exec: Exec) {
    this.exec = exec;
  }

  /** Every feed due now for what's shown starts its read. */
  tick(w: Wants, cx: Cx, now = Date.now()): void {
    const go = <T>(feed: Feed<T>, scope: string, read: () => Promise<Answer<T>>, sign: (v: T) => string, after: ((v: T | null) => void) | null = null): void => {
      if (!feed.due(scope, now)) return;

      cx.spawn(async (cx) => {
        const changed = await feed.run(scope, { read, sign });

        after?.(feed.value);

        if (changed) {
          this.version++;
          cx.notify();
        }
      });
    };

    go(this.contexts, "all", async () => {
      const r = await readText(this.exec, CONTEXTS_ARGS);

      return r.ok ? { ok: true, value: parseContexts(r.value) } : r;
    }, (v) => v.map((c) => c.name).join(","));

    if (w.context === null) return;

    this.tickContext(w, w.context, go);
  }

  private tickContext(w: Wants, context: string, go: Go): void {
    const here: Where = { context, namespace: w.namespace };
    const all: Where = { context, namespace: null };
    const kind = w.kind;
    const resources = w.tab === "resources";

    go(this.apiResources, context, () => readText(this.exec, apiResourcesArgs(context)), (v) => v);
    go(this.namespaces, context, () => readList(this.exec, listArgs(all, "namespaces"), isNamespace), versions);
    go(this.pods, context, () => readList(this.exec, listArgs(all, "pods"), isPod), versions);
    go(this.snap, key(here), () => this.readSnapshot(here), snapSign);
    go(this.topPods, context, () => readText(this.exec, topPodsArgs(all)), (v) => v, (v) => this.takeTopPods(v));

    if (resources && kind === "secrets") go(this.secrets, key(here), async () => {
      const r = await readText(this.exec, secretListArgs(here));

      return r.ok ? { ok: true, value: secretRows(r.value) } : r;
    }, (v) => v.map((x) => `${x.key}@${x.cells.length}`).join(","));

    if (resources && kind === "events") go(this.events, key(here), () => readList(this.exec, listArgs(here, "events"), isEvent), versions);

    if (resources && kind === "nodes") {
      go(this.nodes, context, () => readList(this.exec, listArgs(all, "nodes"), isNode), versions);
      go(this.topNodes, context, () => readText(this.exec, topNodesArgs(context)), (v) => v, (v) => this.takeTopNodes(v));
    }

    const custom = customOf(kind);

    if (resources && custom !== null) go(this.custom, `${key(here)}/${custom}`, () => readList(this.exec, listArgs(here, kind), isAnyObject), versions);

    if (w.tab === "argo" || (resources && kind === "applications")) go(this.apps, context, () => readList(this.exec, listArgs(all, "applications"), isApplication), versions);

    if (w.tab === "argo" && w.appNamespace !== null) {
      const dest: Where = { context, namespace: w.appNamespace };

      go(this.argoSnap, key(dest), () => this.readSnapshot(dest), snapSign);
    }

    this.tickRow(w, here, go);
  }

  /** The selected row's own reads: its text (describe / YAML) and its events. */
  private tickRow(w: Wants, here: Where, go: Go): void {
    const row = w.row;

    if (!row || w.tab !== "resources") return;

    const where: Where = { context: here.context, namespace: row.ref.namespace ?? here.namespace };
    const mode: TextMode | null = w.detail === "describe" || w.detail === "yaml" ? w.detail : null;

    if (mode) {
      const secret = row.ref.kind === "secrets";
      const args = mode === "describe" ? describeArgs(where, row.ref.kind, row.ref.name) : yamlArgs(where, row.ref.kind, row.ref.name);

      go(this.text, `${key(where)}/${row.ref.kind}/${row.ref.name}/${mode}`, async () => {
        const r = await readText(this.exec, args);

        // A secret's YAML comes in with its values: masked here, before anything keeps it.
        return r.ok && secret && mode === "yaml" ? { ok: true, value: maskSecretYaml(r.value) } : r;
      }, (v) => v);
    }

    if (row.uid && (w.detail === "events" || w.detail === "graph")) go(this.selEvents, `${key(where)}/${row.uid}`, () => readList(this.exec, eventArgs(where, row.uid ?? ""), isEvent), versions);
  }

  private async readSnapshot(where: Where): Promise<Answer<Snapshot>> {
    const r = await readText(this.exec, snapshotArgs(where));

    if (!r.ok) return r;

    const list = parseJson(r.value, isKList);

    return list ? { ok: true, value: sortSnapshot(list.items) } : { ok: false, error: "kubectl's answer wasn't a list" };
  }

  private takeTopPods(v: string | null): void {
    if (this.topPods.error && !this.history.any()) this.metricsMissing = true;

    if (v !== null && !this.topPods.error) {
      this.metricsMissing = false;
      this.history.push(parseTopPods(v, null), "");
    }
  }

  private takeTopNodes(v: string | null): void {
    if (v !== null && !this.topNodes.error) this.history.push(new Map(parseTopNodes(v)), "node:");
  }

  /** `r`: everything read again at once. */
  refresh(): void {
    for (const f of [this.contexts, this.apiResources, this.namespaces, this.pods, this.snap, this.secrets, this.events, this.nodes, this.custom, this.apps, this.argoSnap, this.text, this.selEvents]) f.reset();
  }
}

type Go = <T>(feed: Feed<T>, scope: string, read: () => Promise<Answer<T>>, sign: (v: T) => string, after?: ((v: T | null) => void) | null) => void;

const key = (w: Where): string => `${w.context}/${w.namespace ?? "*"}`;

function snapSign(s: Snapshot): string {
  return [s.deployments, s.replicasets, s.statefulsets, s.daemonsets, s.jobs, s.cronjobs, s.services, s.ingresses, s.configmaps, s.pvcs].map(versions).join("|");
}
