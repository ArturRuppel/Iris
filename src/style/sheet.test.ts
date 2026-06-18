import { describe, it, expect } from "vitest";
import type { StyleKnob, StyleOverrides } from "../types";
import {
  transferableKeys,
  captureStyle,
  mergeGeoms,
  applyStyleSheet,
  serializeStyleSheet,
  parseStyleSheet,
  type StyleSheet,
} from "./sheet";

/* ---- fixtures ---- */

/** A minimal style_registry with a mix of transferable and content keys. */
const REGISTRY: StyleKnob[] = [
  { key: "width_mm", label: "Width", group: "Size", widget: { type: "number" },
    default: 180, scope: "figure", transferable: true },
  { key: "font_size_pt", label: "Font size", group: "Text", widget: { type: "number" },
    default: 10, scope: "figure", transferable: true },
  { key: "palette", label: "Palette", group: "Color", widget: { type: "text" },
    default: [], scope: "figure", transferable: true },
  { key: "frame", label: "Frame", group: "Axes", widget: { type: "select", options: ["open", "closed"] },
    default: "open", scope: "figure", transferable: true },
  // content keys — NOT transferable
  { key: "title", label: "Title", group: "Text", widget: { type: "text" },
    default: "", scope: "figure", transferable: false },
  { key: "x_label", label: "X Label", group: "Text", widget: { type: "text" },
    default: "", scope: "figure", transferable: false },
  { key: "x_min", label: "X min", group: "Axes", widget: { type: "number" },
    default: undefined, scope: "figure", transferable: false },
  // geom-scoped key — not figure, so not in transferableKeys
  { key: "marker_alpha", label: "Alpha", group: "Marks", widget: { type: "number" },
    default: 1, scope: "geom", transferable: true },
];

function makeOverrides(extra: Partial<StyleOverrides> = {}): StyleOverrides {
  return {
    width_mm: 200,
    font_size_pt: 12,
    palette: ["#f00", "#0f0"],
    frame: "closed" as const,
    title: "My Plot",
    x_label: "Time",
    x_min: 0,
    geoms: {
      dot: { marker_size: 5, marker_alpha: 0.8 },
      line: { line_width: 2 },
    },
    ...extra,
  };
}

/* ---- transferableKeys ---- */

describe("transferableKeys", () => {
  it("returns only figure-scope, transferable keys", () => {
    const keys = transferableKeys(REGISTRY);
    expect(keys).toEqual(["width_mm", "font_size_pt", "palette", "frame"]);
  });

  it("excludes geom-scope knobs even when transferable", () => {
    const keys = transferableKeys(REGISTRY);
    expect(keys).not.toContain("marker_alpha");
  });

  it("excludes content keys (transferable: false)", () => {
    const keys = transferableKeys(REGISTRY);
    expect(keys).not.toContain("title");
    expect(keys).not.toContain("x_label");
    expect(keys).not.toContain("x_min");
  });
});

/* ---- captureStyle ---- */

describe("captureStyle", () => {
  it("captures transferable flat keys and drops content keys", () => {
    const captured = captureStyle(makeOverrides(), REGISTRY);
    expect(captured.width_mm).toBe(200);
    expect(captured.font_size_pt).toBe(12);
    expect(captured.palette).toEqual(["#f00", "#0f0"]);
    expect(captured.frame).toBe("closed");
    // content keys dropped
    expect((captured as Record<string, unknown>).title).toBeUndefined();
    expect((captured as Record<string, unknown>).x_label).toBeUndefined();
    expect((captured as Record<string, unknown>).x_min).toBeUndefined();
  });

  it("carries geom sections as-is (deep clone)", () => {
    const overrides = makeOverrides();
    const captured = captureStyle(overrides, REGISTRY);
    expect(captured.geoms).toEqual({
      dot: { marker_size: 5, marker_alpha: 0.8 },
      line: { line_width: 2 },
    });
    // deep clone — mutating the original doesn't affect the capture
    overrides.geoms!.dot.marker_size = 99;
    expect(captured.geoms!.dot.marker_size).toBe(5);
  });

  it("omits keys absent from overrides even if registry says transferable", () => {
    const captured = captureStyle({}, REGISTRY);
    expect(Object.keys(captured)).toEqual([]);
  });
});

/* ---- mergeGeoms ---- */

describe("mergeGeoms", () => {
  it("overlays source geom sections onto target by name", () => {
    const target = { dot: { marker_size: 5 }, bar: { bar_width: 0.8 } };
    const source = { dot: { marker_alpha: 0.6 }, line: { line_width: 2 } };
    const result = mergeGeoms(target, source);
    expect(result).toEqual({
      dot: { marker_size: 5, marker_alpha: 0.6 },
      bar: { bar_width: 0.8 },
      line: { line_width: 2 },
    });
  });

  it("source values override target values in the same geom", () => {
    const target = { dot: { marker_size: 5 } };
    const source = { dot: { marker_size: 10 } };
    expect(mergeGeoms(target, source).dot.marker_size).toBe(10);
  });

  it("handles undefined target (creates from source)", () => {
    const source = { dot: { marker_alpha: 0.5 } };
    expect(mergeGeoms(undefined, source)).toEqual({ dot: { marker_alpha: 0.5 } });
  });

  it("does not mutate the original target", () => {
    const target = { dot: { marker_size: 5 } };
    mergeGeoms(target, { dot: { marker_alpha: 0.6 } });
    expect(target.dot).toEqual({ marker_size: 5 });
  });
});

/* ---- applyStyleSheet ---- */

describe("applyStyleSheet", () => {
  const sheet: StyleSheet = {
    iris_style_version: "1.0",
    name: "Test Sheet",
    style: {
      width_mm: 160,
      font_size_pt: 14,
      palette: ["#00f"],
      frame: "open",
      geoms: { dot: { marker_alpha: 0.4 }, violin: { bw: 0.3 } },
    },
  };

  it("replaces transferable flat keys from the sheet", () => {
    const result = applyStyleSheet(makeOverrides(), sheet, REGISTRY);
    expect(result.width_mm).toBe(160);
    expect(result.font_size_pt).toBe(14);
    expect(result.frame).toBe("open");
    expect(result.palette).toEqual(["#00f"]);
  });

  it("preserves content keys on the target", () => {
    const result = applyStyleSheet(makeOverrides(), sheet, REGISTRY);
    expect(result.title).toBe("My Plot");
    expect(result.x_label).toBe("Time");
    expect(result.x_min).toBe(0);
  });

  it("merges geom sections by name", () => {
    const result = applyStyleSheet(makeOverrides(), sheet, REGISTRY);
    // dot merged: target's marker_size + sheet's marker_alpha
    expect(result.geoms?.dot).toEqual({ marker_size: 5, marker_alpha: 0.4 });
    // line survived from target
    expect(result.geoms?.line).toEqual({ line_width: 2 });
    // violin added from sheet
    expect(result.geoms?.violin).toEqual({ bw: 0.3 });
  });

  it("applies to a bare target (empty overrides)", () => {
    const result = applyStyleSheet({}, sheet, REGISTRY);
    expect(result.width_mm).toBe(160);
    expect(result.geoms?.dot).toEqual({ marker_alpha: 0.4 });
  });

  it("sheet without geoms leaves target geoms untouched", () => {
    const noGeomSheet: StyleSheet = {
      iris_style_version: "1.0",
      name: "Flat only",
      style: { width_mm: 100 },
    };
    const result = applyStyleSheet(makeOverrides(), noGeomSheet, REGISTRY);
    expect(result.geoms).toEqual(makeOverrides().geoms);
  });
});

/* ---- .iris-style serialization round-trip ---- */

describe("serializeStyleSheet / parseStyleSheet", () => {
  it("round-trips a style sheet through JSON", () => {
    const sheet: StyleSheet = {
      iris_style_version: "1.0",
      name: "My Style",
      style: { width_mm: 180, palette: ["#abc"], geoms: { dot: { alpha: 0.5 } } },
    };
    const json = serializeStyleSheet(sheet);
    const parsed = parseStyleSheet(json);
    expect(parsed).toEqual(sheet);
  });

  it("rejects a missing version", () => {
    const json = JSON.stringify({ name: "bad", style: {} });
    expect(() => parseStyleSheet(json)).toThrow("Missing iris_style_version");
  });

  it("rejects an unsupported version", () => {
    const json = JSON.stringify({ iris_style_version: "2.0", name: "future", style: {} });
    expect(() => parseStyleSheet(json)).toThrow('Unsupported .iris-style version "2.0"');
  });

  it("rejects non-object JSON", () => {
    expect(() => parseStyleSheet('"hello"')).toThrow("not a JSON object");
  });

  it("rejects missing style object", () => {
    const json = JSON.stringify({ iris_style_version: "1.0", name: "oops" });
    expect(() => parseStyleSheet(json)).toThrow("missing style object");
  });

  it("defaults name to empty string if absent", () => {
    const json = JSON.stringify({ iris_style_version: "1.0", style: { width_mm: 100 } });
    const parsed = parseStyleSheet(json);
    expect(parsed.name).toBe("");
  });
});
