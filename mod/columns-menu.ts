// The columns by keyboard and as a menu: `,` `.` put the keys on the column
// left or right, `{` `}` make it narrower or wider, `o` sorts by it (again:
// the other way; a third time: the default order), `O` (or a right click on
// the header) opens the columns menu: sort by any column, the default order,
// hide the focused column (H) or show every hidden one, fit it to what it
// holds, wider / narrower, every width back, copy its name. The same keys
// as the Databases window's grids.

import type { default as K8s } from "./main.ts";
import type { Menu, MenuRow } from "./state.ts";
import { cycleSort, fitColumn, focusedColumn, hideColumn, kindColumns, resetWidths, setSort, showHidden, shownColumns, stepColumn, stepWidth, widthOf } from "./columns.ts";
import { listRows, revealRow, rowIndex } from "./nav.ts";
import { titleOf } from "./kinds.ts";
import { restWidth } from "./table.ts";

/** The columns menu: sort by each column (the sorted one marked), the default order, fit, widths back. */
export function columnsMenu(v: K8s, rest: number): Menu {
  const by = v.columns.sorts.get(v.kind) ?? null;
  const focus = v.columns.at.get(v.kind) ?? kindColumns(v)[0]?.title ?? "";
  const keep = () => revealRow(v, rowIndex(v));

  const sorts = kindColumns(v).map((c): MenuRow => {
    const now = by?.col === c.title ? (by.desc ? "  ·  sorted ↓ (again: ↑)" : "  ·  sorted ↑ (again: ↓)") : "";

    return { label: `sort by ${c.title}${now}`, sub: c.title === focus ? `the column with the keys · ${widthOf(v, c) ?? "the rest"}${widthOf(v, c) === null ? "" : " px"}` : null, go: () => {
      setSort(v, by?.col === c.title ? { col: c.title, desc: !by.desc } : { col: c.title, desc: false });
      v.columns.at.set(v.kind, c.title);
      keep();
    } };
  });

  const shown = shownColumns(v, Number.MAX_SAFE_INTEGER);
  const at = focusedColumn(v, shown);
  const hidden = v.columns.hidden.get(v.kind)?.size ?? 0;

  return {
    title: `columns of ${titleOf(v.kind).toLowerCase()}`, at: Math.max(0, kindColumns(v).findIndex((c) => c.title === (by?.col ?? focus))),
    rows: [
      ...sorts,
      { label: "the default order", key: "u", go: () => {
        setSort(v, null);
        keep();
      } },
      { label: `fit ${focus} to what it holds`, sub: "or a double click on its edge in the header", key: "f", go: () => {
        if (at) fitColumn(v, listRows(v), at);
      } },
      { label: "every width back", sub: "the kind's own widths", key: "w", go: () => resetWidths(v) },
      { label: `${focus} narrower`, key: "{", go: () => {
        if (at) stepWidth(v, at, -1, rest);
      } },
      { label: `${focus} wider`, key: "}", go: () => {
        if (at) stepWidth(v, at, 1, rest);
      } },
      { label: `hide ${focus}`, sub: at?.w === null ? "the name stays: it takes the rest" : null, key: "H", go: () => hide(v, focus) },
      ...(hidden ? [{ label: `show every hidden column (${hidden})`, sub: [...(v.columns.hidden.get(v.kind) ?? [])].join(", "), key: "S", go: () => showHidden(v) }] : []),
      { label: `copy "${focus}"`, key: "y", go: (cx) => cx.write_to_clipboard(focus) },
    ],
  };
}

/** H: the column hidden, the keys moved to the one before it; the name can't go. */
function hide(v: K8s, col: string): void {
  if (hideColumn(v, col)) v.say(`${col} hidden: O shows it again`, "ok");
  else v.say("the name stays: it takes the rest", "wk");
}

/** A column key in the table (`,` `.` `{` `}` `o` `O` `H`); false for any other key. */
export function columnKey(v: K8s, name: string, width: number): boolean {
  const shown = shownColumns(v, width);
  const at = focusedColumn(v, shown);
  const rest = restWidth(shown, width);

  switch (name) {
    case ",": stepColumn(v, shown, -1);

 return true;
    case ".": stepColumn(v, shown, 1);

 return true;
    case "{": if (at) stepWidth(v, at, -1, rest);

 return true;
    case "}": if (at) stepWidth(v, at, 1, rest);

 return true;
    case "o": if (at) cycleSort(v, at.col.title);

 revealRow(v, rowIndex(v));

 return true;
    case "H": if (at) hide(v, at.col.title);

 return true;
    case "O": v.menu = columnsMenu(v, rest);

 return true;
    default: return false;
  }
}
