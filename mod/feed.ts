// One read the window keeps fresh: what it last answered, when it's due
// again, and whether a new answer changed anything. The view asks every
// feed it shows to `tick` (main.ts, every half second); a feed reads when
// it's due and not already reading, and says whether the answer differs from
// the last (its `sign`), so an unchanged cluster costs no redraw.
//
// A failing or slow read backs off: each failure doubles the wait (up to 30 s),
// and a read slower than its pace waits twice its own time.

import type { Answer } from "./kubectl.ts";

/** How a feed reads (for a scope, e.g. "nightjar-dev/lantern") and how its answer is compared. */
export interface FeedSource<T> {
  readonly read: () => Promise<Answer<T>>;
  readonly sign: (value: T) => string;
}

export const MAX_WAIT = 30000;

export class Feed<T> {
  value: T | null = null;
  error: string | null = null;
  /** When the last answer came (ms), 0 before any. */
  at = 0;
  busy = false;
  failures = 0;
  /** The scope the value belongs to: a new scope drops the old value. */
  scope = "";
  private sig = "";
  private started = 0;
  private took = 0;

  /** The pace in ms (the metrics' changes with M). */
  every: number;

  constructor(every: number) {
    this.every = every;
  }

  /** A new pace: the next read is due `ms` after the last one started (a read running now isn't doubled). */
  pace(ms: number): void {
    this.every = ms;
  }

  /** The wait before the next read. */
  wait(): number {
    const backoff = this.failures ? Math.min(MAX_WAIT, this.every * 2 ** Math.min(this.failures, 5)) : this.every;

    return Math.max(backoff, this.took * 2);
  }

  /** Whether a read for `scope` should start now. */
  due(scope: string, now: number): boolean {
    if (this.busy) return false;

    if (scope !== this.scope) return true;

    return now - this.started >= this.wait();
  }

  /** Forgets what it read (a refresh, `r`): the next tick reads at once. */
  reset(): void {
    this.started = 0;
    this.failures = 0;
  }

  /** Reads for `scope`; true when what's shown changed (a new value, a new error, a new scope). */
  async run(scope: string, source: FeedSource<T>, now: () => number = Date.now): Promise<boolean> {
    if (this.busy) return false;

    const fresh = scope !== this.scope;

    if (fresh) {
      this.scope = scope;
      this.value = null;
      this.error = null;
      this.sig = "";
      this.failures = 0;
    }

    this.busy = true;
    this.started = now();

    const r = await source.read();

    this.busy = false;
    this.took = now() - this.started;

    // An answer for a scope left while it was read is dropped.
    if (scope !== this.scope) return false;

    this.at = now();

    if (!r.ok) {
      this.failures++;

      const changed = this.error !== r.error;

      this.error = r.error;

      return changed || fresh;
    }

    this.failures = 0;

    const sig = source.sign(r.value);
    const changed = fresh || sig !== this.sig || this.error !== null;

    this.error = null;

    if (changed) {
      this.sig = sig;
      this.value = r.value;
    }

    return changed;
  }
}

/** A list's signature: each object's uid and resourceVersion (what changes when it does). */
export function versions(items: readonly { readonly metadata: { readonly uid?: string | null | undefined; readonly name: string; readonly resourceVersion?: string | null | undefined } }[]): string {
  return items.map((o) => `${o.metadata.uid ?? o.metadata.name}@${o.metadata.resourceVersion ?? ""}`).join(",");
}
