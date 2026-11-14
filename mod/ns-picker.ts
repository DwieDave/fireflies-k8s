// The namespaces picker (n): every namespace, your favourites on top, typed
// letters narrow it, the first nine shown are picked by their digit (0 is
// every namespace), * makes the one under the cursor a favourite or not
// (kept in the settings' `favourites`, which also order the rail).

import type { Context } from "gpui-kit";
import type { default as K8s } from "./main.ts";
import type { Menu, MenuRow } from "./state.ts";
import { strips } from "./derive.ts";
import type { NsStrip } from "./derive.ts";
import { setNamespace, setTab } from "./nav.ts";
import { keepSetting } from "./settings-keep.ts";

/** The label of the row for every namespace. */
export const ALL = "all namespaces";

/** The rows a find shows: those whose label holds every typed word, keyed 0 (all) and 1-9 in order. */
export function findRows(all: readonly MenuRow[], text: string): readonly MenuRow[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = all.filter((r) => r.label === ALL ? !words.length : words.every((w) => r.label.toLowerCase().includes(w)));
  let n = 0;

  return hit.map((r) => {
    if (r.label === ALL) return { ...r, key: "0" };

    n++;

    return { ...r, key: n <= 9 ? String(n) : null };
  });
}

function nsRow(v: K8s, s: NsStrip): MenuRow {
  const fav = s.name !== null && v.settings.favourites.includes(s.name);
  const sub = [fav ? "★ favourite" : null, `${s.tones.length} pods`, s.bad ? `${s.bad} failing` : null, s.name === v.namespace ? "shown now" : null].filter(Boolean).join(" · ");

  return { label: s.name ?? ALL, sub, go: () => {
    setNamespace(v, s.name);
    setTab(v, "resources");
  } };
}

/** n: the picker, its cursor on the namespace shown now. */
export function namespaceMenu(v: K8s, text = "", at: string | null = v.namespace): Menu {
  const all = strips(v.data, v.settings.favourites).map((s) => nsRow(v, s));
  const rows = findRows(all, text);
  const i = rows.findIndex((r) => r.label === (at ?? ALL));

  return {
    title: "namespace", at: Math.max(0, i), rows,
    find: { text, all, hint: "type to narrow · 0-9 pick · * favourite · enter" },
    onKey: (name, cx) => {
      if (name !== "*") return false;

      const row = v.menu?.rows[v.menu.at];

      if (row && row.label !== ALL) toggleFavourite(v, row.label, cx);

      v.menu = namespaceMenu(v, text, row?.label ?? null);

      return true;
    },
  };
}

/** Makes a namespace a favourite (last of them) or not, kept in the settings file. */
export function toggleFavourite(v: K8s, ns: string, cx: Context): void {
  const favs = v.settings.favourites;
  const next = favs.includes(ns) ? favs.filter((f) => f !== ns) : [...favs, ns];

  v.settings = { ...v.settings, favourites: next };
  v.say(favs.includes(ns) ? `${ns} no longer a favourite` : `${ns} a favourite: listed first`, "ok");
  keepSetting(v, "favourites", next, cx);
}

/** Moves a favourite to another favourite's place (a drag in the rail), kept. */
export function moveFavourite(v: K8s, ns: string, onto: string, cx: Context): boolean {
  const favs = [...v.settings.favourites];
  const from = favs.indexOf(ns);
  const to = favs.indexOf(onto);

  if (from < 0 || to < 0 || from === to) return false;

  favs.splice(from, 1);
  favs.splice(to, 0, ns);
  v.settings = { ...v.settings, favourites: favs };
  keepSetting(v, "favourites", favs, cx);

  return true;
}

/** A key while a find menu is open: letters narrow it, arrows (ctrl-n ctrl-p) move, digits and enter pick. */
export function findKey(v: K8s, m: Menu, name: string, ch: string | null, cx: Context, pick: (i: number) => void): void {
  const f = m.find;

  if (!f) return;

  const refind = (text: string) => {
    v.menu = { ...m, rows: findRows(f.all, text), at: 0, find: { ...f, text } };
  };

  if (name === "escape") v.menu = null;
  else if (name === "down" || name === "ctrl-n") m.at = Math.min(m.rows.length - 1, m.at + 1);
  else if (name === "up" || name === "ctrl-p") m.at = Math.max(0, m.at - 1);
  else if (name === "enter") pick(m.at);
  else if (name === "backspace") refind(f.text.slice(0, -1));
  else if (m.onKey?.(name, cx)) return;
  else if (/^[0-9]$/.test(name)) {
    const i = m.rows.findIndex((r) => r.key === name);

    if (i >= 0) pick(i);
  } else if (ch && ch.length === 1 && ch > " ") refind(f.text + ch);
}
