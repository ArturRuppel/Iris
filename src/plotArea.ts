/* Canvas vs plot area.

   `width_mm`/`height_mm` are the CANVAS (the whole figure). `plot_w_mm` /
   `plot_h_mm` pin the PLOT AREA (the axes box) to a size in mm; a dimension
   left unset is whatever the layout gives. Nothing stores WHERE the box sits:
   the engine derives that from what the tick and axis labels need (left and
   bottom margins), and the rest of the canvas is free to the right and above
   (title, a legend dragged beside the plot). So canvas and plot sizes are
   independent: growing the canvas never stretches the plot, and the two
   cannot be pushed into a layout where the labels no longer fit.

   `axes_rect` is the legacy form: a whole rect [left, bottom, width, height]
   in canvas fractions, written by the old move/resize drags. The engine still
   reads it for its SIZE, and the first edit here rewrites it as a size. */

import type { StyleOverrides } from "./types";

export const CANVAS_DEFAULT = { w: 140, h: 100 };   // style.py width_mm/height_mm defaults

export interface PlotSizeMm { width?: number; height?: number }

export function canvasMm(style: StyleOverrides, defaults = CANVAS_DEFAULT) {
  return { w: style.width_mm ?? defaults.w, h: style.height_mm ?? defaults.h };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** the pinned plot-area size in mm (either dimension may be missing), or null
 *  when the plot area is automatic; a legacy rect counts for its size */
export function plotSizeMm(style: StyleOverrides, defaults = CANVAS_DEFAULT): PlotSizeMm | null {
  let { plot_w_mm: width, plot_h_mm: height } = style;
  const rect = style.axes_rect;
  if (rect && rect.length === 4) {
    const { w, h } = canvasMm(style, defaults);
    width ??= r1(rect[2] * w);
    height ??= r1(rect[3] * h);
  }
  if (width == null && height == null) return null;
  const size: PlotSizeMm = {};
  if (width != null) size.width = width;
  if (height != null) size.height = height;
  return size;
}

/** pin the plot area's size (mm; a missing dimension stays automatic), or
 *  clear it (null → automatic layout). Drops a legacy rect either way. */
export function setPlotSize(style: StyleOverrides, size: PlotSizeMm | null): StyleOverrides {
  const next = { ...style };
  delete next.axes_rect;
  delete next.plot_w_mm;
  delete next.plot_h_mm;
  if (size?.width != null) next.plot_w_mm = Math.max(5, r1(size.width));
  if (size?.height != null) next.plot_h_mm = Math.max(5, r1(size.height));
  return next;
}

/** a new canvas size; a pinned plot area keeps its mm size (a legacy rect is
 *  rewritten as a size first, so it cannot stretch with the canvas) */
export function resizeCanvas(style: StyleOverrides, w: number | undefined, h: number | undefined,
                             defaults = CANVAS_DEFAULT): StyleOverrides {
  const legacy = style.axes_rect ? plotSizeMm(style, defaults) : null;
  const next: StyleOverrides = legacy ? setPlotSize(style, legacy) : { ...style };
  if (w === undefined) delete next.width_mm; else next.width_mm = w;
  if (h === undefined) delete next.height_mm; else next.height_mm = h;
  return next;
}
