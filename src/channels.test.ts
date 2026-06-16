import { describe, it, expect } from "vitest";
import type { ColType } from "./channels";
import {
  familyFor, familyForMappings, geomGateReason, isOfferable, offeredColumns,
  renderStatus,
} from "./channels";
import type { ColumnDef, GeomMeta, Registry, Schema } from "./types";

/* a minimal GeomMeta — only x_type/y_type matter to the helpers under test */
const geom = (x_type: string, y_type: string): GeomMeta => ({
  label: "", family: "group_comparison", aggregates: false, needs: [],
  x_type, y_type, params: {}, param_specs: [], point_cap: null, aes: [],
});

/* today's registry: the axis types that ship in 3a */
const REG: Registry = { point_cap: 3000, geoms: {
  dot: geom("categorical", "numeric"),
  summary: geom("categorical", "numeric"),
  box: geom("categorical", "numeric"),
  violin: geom("categorical", "numeric"),
  bar: geom("categorical", "numeric"),
  scatter: geom("numeric", "numeric"),
  regression: geom("numeric", "numeric"),
  histogram: geom("none", "numeric"),
  density: geom("none", "numeric"),
} };

const COLS: ColumnDef[] = [
  { name: "grp", type: "categorical", label: "Group" },
  { name: "val", type: "numeric", label: "Value" },
  { name: "id", type: "identifier", label: "ID" },
];
const SCHEMA: Schema = { schema_version: "1.0", columns: COLS };

describe("familyFor — (x_type, y_type) → derived family", () => {
  it("maps the three real families", () => {
    expect(familyFor("categorical", "numeric")).toBe("group_comparison");
    expect(familyFor("numeric", "numeric")).toBe("correlation");
    expect(familyFor(null, "numeric")).toBe("descriptive");
  });
  it("falls through to describe-only ('none') for combos stats can't read", () => {
    expect(familyFor("categorical", "categorical")).toBe("none");
    expect(familyFor("numeric", "categorical")).toBe("none");
    expect(familyFor("categorical", null)).toBe("none");
    expect(familyFor(null, null)).toBe("none");
  });
});

describe("offer rule (§4) — derived from the registry for x/y, the matrix for aes", () => {
  it("X offers both types; Y offers numerics only", () => {
    expect(isOfferable(REG, "x", "categorical")).toBe(true);
    expect(isOfferable(REG, "x", "numeric")).toBe(true);
    expect(isOfferable(REG, "y", "numeric")).toBe(true);
    expect(isOfferable(REG, "y", "categorical")).toBe(false);
  });
  it("color offers both: categorical palette and numeric continuous colormap (3b)", () => {
    expect(renderStatus(REG, "color", "categorical")).toBe("ok");
    expect(renderStatus(REG, "color", "numeric")).toBe("ok");
  });
  it("size offers numerics only; shape offers categoricals", () => {
    expect(renderStatus(REG, "size", "numeric")).toBe("ok");
    expect(renderStatus(REG, "size", "categorical")).toBeNull(); // not offered at all
    expect(renderStatus(REG, "shape", "categorical")).toBe("ok");
    expect(renderStatus(REG, "shape", "numeric")).toMatchObject({ reason: expect.any(String) });
  });
  it("the mechanism: a synthetic geom with y_type categorical makes Y offer categoricals", () => {
    const reg: Registry = { ...REG,
      geoms: { ...REG.geoms, tile: geom("categorical", "categorical") } };
    expect(isOfferable(reg, "y", "categorical")).toBe(true);
  });
});

describe("offeredColumns — selectable vs disabled-with-reason, identifiers excluded", () => {
  it("color: both categorical and numeric selectable (3b), identifier excluded", () => {
    const { selectable, disabled } = offeredColumns(REG, "color", COLS);
    expect(selectable.map((c) => c.name)).toEqual(["grp", "val"]);
    expect(disabled).toEqual([]);                       // no id (identifier excluded)
  });

  it("shape: categorical selectable, numeric disabled-with-reason", () => {
    const { selectable, disabled } = offeredColumns(REG, "shape", COLS);
    expect(selectable.map((c) => c.name)).toEqual(["grp"]);
    expect(disabled.map((d) => d.col.name)).toEqual(["val"]);
    expect(disabled[0].reason).toBeTruthy();
  });
  it("y: only the numeric column is selectable", () => {
    const { selectable, disabled } = offeredColumns(REG, "y", COLS);
    expect(selectable.map((c) => c.name)).toEqual(["val"]);
    expect(disabled).toEqual([]);
  });
  it("size: only the numeric column; categorical is not offered at all", () => {
    const { selectable, disabled } = offeredColumns(REG, "size", COLS);
    expect(selectable.map((c) => c.name)).toEqual(["val"]);
    expect(disabled).toEqual([]);
  });
});

describe("primitive gating — geom enabled iff (x_type, y_type) satisfied", () => {
  const enabled = (g: string, x: ColType | null, y: ColType | null) =>
    geomGateReason(REG.geoms[g], x, y) === null;

  it("categorical x + numeric y: group geoms enabled, scatter/regression disabled", () => {
    for (const g of ["dot", "summary", "box", "violin", "bar"])
      expect(enabled(g, "categorical", "numeric")).toBe(true);
    for (const g of ["scatter", "regression"]) {
      expect(enabled(g, "categorical", "numeric")).toBe(false);
      expect(geomGateReason(REG.geoms[g], "categorical", "numeric")).toMatch(/numeric X/);
    }
  });
  it("numeric x + numeric y: scatter/regression enabled, group geoms disabled", () => {
    for (const g of ["scatter", "regression"])
      expect(enabled(g, "numeric", "numeric")).toBe(true);
    for (const g of ["dot", "box"]) {
      expect(enabled(g, "numeric", "numeric")).toBe(false);
      expect(geomGateReason(REG.geoms[g], "numeric", "numeric")).toMatch(/categorical X/);
    }
  });
  it("empty x + numeric y: descriptive geoms enabled, axis geoms need an X", () => {
    expect(enabled("histogram", null, "numeric")).toBe(true);
    expect(enabled("density", null, "numeric")).toBe(true);
    expect(geomGateReason(REG.geoms.dot, null, "numeric")).toMatch(/categorical X/);
  });
});

describe("back-compat — derived family matches the pre-3a stored family", () => {
  it("each template's seeded mapping derives the family it used to store", () => {
    // group-comparison templates (dots/box/violin/bar): categorical x + numeric y
    expect(familyForMappings({ x: "grp", y: "val" }, SCHEMA)).toBe("group_comparison");
    // scatter: numeric x + numeric y
    expect(familyForMappings({ x: "val", y: "val" }, SCHEMA)).toBe("correlation");
    // histogram: empty x + numeric y
    expect(familyForMappings({ x: "", y: "val" }, SCHEMA)).toBe("descriptive");
  });
  it("the describe-only fall-through serializes as descriptive", () => {
    expect(familyForMappings({ x: "grp", y: "grp" }, SCHEMA)).toBe("descriptive");
  });
});
