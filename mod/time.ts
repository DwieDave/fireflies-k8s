// Times as the window shows them: an age the way kubectl prints it ("18d",
// "3h", "40m", "12s"), and the instants kubectl's timestamps name.

/** An RFC 3339 timestamp's milliseconds, or null. */
export function instant(stamp: string | null | undefined): number | null {
  if (!stamp) return null;

  const ms = Date.parse(stamp);

  return Number.isNaN(ms) ? null : ms;
}

/** How long ago `at` was, in kubectl's short form ("—" for an unknown time). */
export function age(at: number | null, now: number = Date.now()): string {
  if (at === null) return "—";

  return span(Math.max(0, now - at));
}

/** A duration in kubectl's short form: the two largest units under a day ("3h12m"), days alone. */
export function span(ms: number): string {
  const s = Math.floor(ms / 1000);

  if (s < 60) return `${s}s`;

  const m = Math.floor(s / 60);

  if (m < 60) return `${m}m`;

  const h = Math.floor(m / 60);

  if (h < 24) return m % 60 && h < 10 ? `${h}h${m % 60}m` : `${h}h`;

  const d = Math.floor(h / 24);

  return d < 10 && h % 24 ? `${d}d${h % 24}h` : `${d}d`;
}

/** An hour: restarts older than this are drawn faded. */
export const RECENT = 3600 * 1000;
