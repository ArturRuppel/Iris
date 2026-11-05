/* The plot inspector's map from the style registry to its tabs and controls.

   The registry (engine/iris_engine/style.py, served on /health) stays the
   source of truth for which knobs exist; this module only decides where each
   one shows and which control draws it. A knob the tables below do not name
   still lands in a tab (by its group) and gets a control (by its widget), so a
   new registry knob never disappears from the editor. */

import type { StyleKnob } from "../../types";

export type InspectorTab = "encoding" | "layers" | "axes" | "text" | "layout";

export const INSPECTOR_TABS: { id: InspectorTab; label: string }[] = [
  { id: "encoding", label: "Encoding" },
  { id: "layers", label: "Layers" },
  { id: "axes", label: "Axes" },
  { id: "text", label: "Text" },
  { id: "layout", label: "Layout" },
];

/* knobs whose tab is not the one their registry group implies */
const KEY_TAB: Record<string, InspectorTab> = {
  palette: "encoding",
  font_pt: "text",
  frame: "axes",
  grid_x: "axes",
  grid_y: "axes",
};

const GROUP_TAB: Record<string, InspectorTab> = {
  axes: "axes",
  text: "text",
  annotations: "text",
  figure: "layout",
};

/** The inspector tab a registry knob renders in. Geom-scoped knobs (and any
 *  group that is not a figure group, i.e. a geom name) go to Layers, where
 *  each layer card carries its own. */
export function tabFor(knob: Pick<StyleKnob, "key" | "group" | "scope">): InspectorTab {
  if (knob.scope === "geom") return "layers";
  if (KEY_TAB[knob.key]) return KEY_TAB[knob.key];
  return GROUP_TAB[knob.group] ?? "layout";
}

/* the unit a number knob is measured in, shown as a suffix on its field */
const UNITS: Record<string, string> = {
  width_mm: "mm", height_mm: "mm", plot_w_mm: "mm", plot_h_mm: "mm",
  font_pt: "pt", tick_length: "pt", axis_linewidth: "pt", line_width: "pt",
  linewidth: "pt", capsize: "pt", outlier_size: "pt", marker_size: "pt",
};
export const unitFor = (key: string): string | undefined => UNITS[key];

/* pure fractions: a slider with the value read out beside it */
const FRACTIONS = new Set(["alpha", "fill_alpha", "jitter", "mark_width"]);

/* selects that stay dropdowns even with only 2–3 options */
const DROPDOWN_KEYS = new Set(["error_type"]);

export type ControlKind =
  "segmented" | "select" | "fraction" | "number" | "bool" | "text" | "swatch";

/** Which control draws a knob. Numbers in 0…1 are fractions (slider); other
 *  numbers are a typed field; 2–3 option selects are segmented. */
export function controlFor(knob: Pick<StyleKnob, "key" | "widget">): ControlKind {
  const w = knob.widget;
  switch (w.type) {
    case "number":
      if (FRACTIONS.has(knob.key)) return "fraction";
      if (w.min != null && w.max != null && w.min >= 0 && w.max <= 1 && !UNITS[knob.key])
        return "fraction";
      return "number";
    case "select": {
      const n = w.options?.length ?? 0;
      return n >= 2 && n <= 3 && !DROPDOWN_KEYS.has(knob.key) ? "segmented" : "select";
    }
    default:
      return w.type;
  }
}

/** a slider value as text, to the precision its step implies */
export function formatFraction(v: number, step?: number): string {
  const s = step ?? 0.01;
  const decimals = Math.min(3, Math.max(0, Math.ceil(-Math.log10(s) - 1e-9)));
  return v.toFixed(decimals);
}
