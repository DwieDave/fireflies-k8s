// The whole view: the top bar, the shown tab's body, the forwards' shelf, the
// key bar, and what opens over the body. The resources tab at three widths:
// wide (rail | table | detail), middle (rail | table over detail), and
// narrow, under the pane pattern's break (one panel, the others folded into
// a row of numbered tabs). A window has a 1 px frame; a pane none. The
// gaps between panels drag to resize them (panels.ts).

import { div } from "gpui-kit";
import type { Context, Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { default as K8s } from "./main.ts";
import { WIDE } from "./main.ts";
import { tabActions } from "./form-keys.ts";
import { onKey } from "./input.ts";
import { header, keyBar, foldRow } from "./chrome.ts";
import { rail } from "./rail.ts";
import { columnTracking, table } from "./table.ts";
import { detail } from "./detail.ts";
import { argoTab } from "./argo-view.ts";
import { forwardsTab, shelf } from "./forwards-view.ts";
import { askCard, helpPanel, menuBox } from "./overlays.ts";
import { unzoom } from "./kit.ts";
import { detailWidth } from "./graph-shown.ts";
import { divider, tracking } from "./dividers.ts";
import { GAP, detailDivider, detailHeightDivider, railDivider, tableWidth } from "./panels.ts";

export function frame(v: K8s, t: Theme, _cx: Context): Element {
  const handle = v.handle;

  const root = v_flex().id("k8s-root").relative().size_full().bg(t.background).text_color(t.foreground).overflow_hidden()
    .when(v.inWindow(), (el) => el.border(1).border_color(t.ansi8))
    .on_size_change((size, cx) => {
      const w = Math.round(unzoom(size.width));
      const h = Math.round(unzoom(size.height));

      if (w !== v.size.width || h !== v.size.height) {
        v.size = { width: w, height: h };
        cx.notify();
      }
    })
    .on_mouse_down("left", () => {
      v.railDrag = null;
      handle?.focus();
    })
    .on_key_down((e, cx) => onKey(v, e, cx))
    .child(header(v, t))
    .child(v_flex().relative().flex_1().min_h(0).child(body(v, t))
      .children([menuBox(v, t), askCard(v, t), helpPanel(v, t)].flatMap((x) => (x ? [x] : []))))
    .children(v.tab === "resources" ? [shelf(v, t)].flatMap((x) => (x ? [x] : [])) : [])
    .child(keyBar(v, t));

  const keyed = tabActions(columnTracking(tracking(root, v.dividers), v), (e, cx) => onKey(v, e, cx));

  return handle ? keyed.track_focus(handle) : keyed;
}

function body(v: K8s, t: Theme): Element {
  if (v.tab === "argo") return argoTab(v, t);

  if (v.tab === "forwards") return forwardsTab(v, t);

  return resources(v, t);
}

function resources(v: K8s, t: Theme): Element {
  const w = v.size.width;

  if (v.narrow()) {
    const shown = v.panel === "rail" ? rail(v, t) : v.panel === "detail" ? detail(v, t, detailWidth(v)) : table(v, t, tableWidth(v));

    return v_flex().size_full().child(foldRow(v, t)).child(div().flex_1().min_h(0).p(8).child(shown));
  }

  const ds = v.dividers;
  const rd = railDivider(v);
  const rw = ds.size(rd);

  if (w >= WIDE) {
    const dd = detailDivider(v);
    const dw = ds.size(dd);

    return h_flex().size_full().px(GAP).pt(12).pb(8)
      .child(v_flex().w(rw).flex_none().h_full().child(rail(v, t)))
      .child(divider(t, "k8s-div-rail", rd, ds, GAP))
      .child(v_flex().flex_1().min_w(0).h_full().child(table(v, t, tableWidth(v))))
      .child(divider(t, "k8s-div-detail", dd, ds, GAP))
      .child(v_flex().w(dw).flex_none().h_full().child(detail(v, t, dw)));
  }

  const hd = detailHeightDivider(v);

  return h_flex().size_full().px(GAP).pt(12).pb(8)
    .child(v_flex().w(rw).flex_none().h_full().child(rail(v, t)))
    .child(divider(t, "k8s-div-rail", rd, ds, GAP))
    .child(v_flex().flex_1().min_w(0).h_full()
      .child(v_flex().flex_1().min_h(0).min_w(0).child(table(v, t, tableWidth(v))))
      .child(divider(t, "k8s-div-detail-h", hd, ds, 12))
      .child(div().h(ds.size(hd)).flex_none().child(detail(v, t, w - rw - 3 * GAP))));
}
