import { describe, it, expect } from "vitest";
import { controlFor, formatFraction, tabFor, unitFor } from "./knobs";
import type { StyleKnob } from "../../types";

const k = (key: string, group: string, scope: "figure" | "geom" = "figure",
           widget: StyleKnob["widget"] = { type: "number" }) => ({ key, group, scope, widget });

describe("tabFor", () => {
  it("maps registry groups to tabs", () => {
    expect(tabFor(k("tick_length", "axes"))).toBe("axes");
    expect(tabFor(k("title", "text"))).toBe("text");
    expect(tabFor(k("show_n", "annotations"))).toBe("text");
    expect(tabFor(k("width_mm", "figure"))).toBe("layout");
    expect(tabFor(k("alpha", "dot", "geom"))).toBe("layers");
  });
  it("applies the key exceptions", () => {
    expect(tabFor(k("palette", "figure"))).toBe("encoding");
    expect(tabFor(k("font_pt", "figure"))).toBe("text");
    expect(tabFor(k("frame", "figure"))).toBe("axes");
    expect(tabFor(k("grid_x", "figure"))).toBe("axes");
    expect(tabFor(k("grid_y", "figure"))).toBe("axes");
  });
  it("never drops a knob from an unknown group", () => {
    expect(tabFor(k("mystery", "newgroup"))).toBe("layout");
    expect(tabFor(k("mystery", "newgeom", "geom"))).toBe("layers");
  });
});

describe("controlFor", () => {
  it("picks segmented for 2–3 options and a dropdown otherwise", () => {
    expect(controlFor({ key: "frame", widget: { type: "select", options: ["open", "closed"] } })).toBe("segmented");
    expect(controlFor({ key: "tick_direction", widget: { type: "select", options: ["out", "in", "inout"] } })).toBe("segmented");
    expect(controlFor({ key: "outlier_marker", widget: { type: "select", options: ["o", "D", "x", "+", "none"] } })).toBe("select");
    expect(controlFor({ key: "error_type", widget: { type: "select", options: ["ci95", "sem", "sd"] } })).toBe("select");
  });
  it("draws fractions as sliders and other numbers as fields", () => {
    expect(controlFor({ key: "alpha", widget: { type: "number", min: 0.05, max: 1 } })).toBe("fraction");
    expect(controlFor({ key: "jitter", widget: { type: "number", min: 0, max: 0.5 } })).toBe("fraction");
    expect(controlFor({ key: "hist_bins", widget: { type: "number", min: 2, max: 200 } })).toBe("number");
    expect(controlFor({ key: "y_min", widget: { type: "number" } })).toBe("number");
  });
  it("knows units by key", () => {
    expect(unitFor("width_mm")).toBe("mm");
    expect(unitFor("font_pt")).toBe("pt");
    expect(unitFor("x_tick_rotation")).toBeUndefined();
    expect(formatFraction(0.6, 0.05)).toBe("0.60");
    expect(formatFraction(0.18, 0.02)).toBe("0.18");
  });
});
