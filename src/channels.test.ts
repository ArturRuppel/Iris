import { describe, it, expect } from "vitest";
import type { ColType } from "./channels";
import {
  familyFor, familyForMappings, familyForMappingsRef, geomAddable, geomAxisColTypes,
  geomGateReason, isOfferable, offeredColumns, renderStatus,
} from "./channels";
import type { ColumnDef, GeomMeta, Registry, Schema } from "./types";

/* a minimal GeomMeta — only x_type/y_type matter to the helpers under test */
const geom = (x_type: string, y_type: string): GeomMeta => ({
  label: "", family: "group_comparison", aggregates: false, needs: [],
  x_type, y_type, point_cap: null, aes: [],
});

/* today's registry: the axis types that ship in 3a (no h_orient, no tile) */
const REG: Registry = { point_cap: 3000, facet_cell_cap: 20, geoms: {
  dot: geom("categorical", "numeric"),
  summary: geom("categorical", "numeric"),
  box: geom("categorical", "numeric"),
  violin: geom("categorical", "numeric"),
  bar: geom("categorical", "numeric"),
  scatter: geom("numeric", "numeric"),
  regression: geom("numeric", "numeric"),
  distribution: geom("none", "numeric"),
} };

/* registry as shipped in 3d: includes the tile geom */
const REG_3D: Registry = { ...REG, geoms: { ...REG.geoms,
  tile: geom("categorical", "categorical"),
} };

const COLS: ColumnDef[] = [
  { name: "grp", type: "categorical", label: "Group" },
  { name: "val", type: "numeric", label: "Value" },
  { name: "id", type: "identifier", label: "ID" },
];
const SCHEMA: Schema = { schema_version: "1.0", columns: COLS };

describe("familyFor — (x_type, y_type) → derived family", () => {
  it("maps the three real families (vertical orientation)", () => {
    expect(familyFor("categorical", "numeric")).toBe("group_comparison");
    expect(familyFor("numeric", "numeric")).toBe("correlation");
    expect(familyFor(null, "numeric")).toBe("descriptive");
  });
  it("Phase 3c: numeric x + categorical y → group_comparison (horizontal)", () => {
    expect(familyFor("numeric", "categorical")).toBe("group_comparison");
  });
  it("falls through to describe-only ('none') for combos stats can't read", () => {
    // Note: categorical×categorical is "contingency" (Phase 3d), not "none"
    expect(familyFor("categorical", null)).toBe("none");
    expect(familyFor(null, null)).toBe("none");
  });
});

/* registry with h_orient=true on all group-comparison geoms, as shipped in 3c */
const REG_3C: Registry = { ...REG, geoms: Object.fromEntries(
  Object.entries(REG.geoms).map(([k, g]) =>
    ["dot", "summary", "box", "violin", "bar"].includes(k)
      ? [k, { ...g, h_orient: true }] : [k, g])
) };

describe("offer rule (§4) — derived from the registry for x/y, the matrix for aes", () => {
  it("X offers both types; Y offers numerics only (pre-3c registry)", () => {
    expect(isOfferable(REG, "x", "categorical")).toBe(true);
    expect(isOfferable(REG, "x", "numeric")).toBe(true);
    expect(isOfferable(REG, "y", "numeric")).toBe(true);
    expect(isOfferable(REG, "y", "categorical")).toBe(false);
  });
  it("Phase 3c: h_orient geoms make Y offer categoricals", () => {
    expect(isOfferable(REG_3C, "y", "categorical")).toBe(true);
    expect(isOfferable(REG_3C, "y", "numeric")).toBe(true);  // still offered
    expect(isOfferable(REG_3C, "x", "numeric")).toBe(true);  // still via scatter/reg
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
  it("Phase 4: facet_row/facet_col offer categoricals only, no numeric faceting in v1", () => {
    expect(renderStatus(REG, "facet_row", "categorical")).toBe("ok");
    expect(renderStatus(REG, "facet_row", "numeric")).toBeNull();
    expect(renderStatus(REG, "facet_col", "categorical")).toBe("ok");
    expect(renderStatus(REG, "facet_col", "numeric")).toBeNull();
  });
});

describe("offeredColumns — selectable vs disabled-with-reason, identifiers excluded (except colour)", () => {
  it("color: categorical, numeric AND identifier selectable (id colours per-grain dots)", () => {
    const { selectable, disabled } = offeredColumns(REG, "color", COLS);
    expect(selectable.map((c) => c.name)).toEqual(["grp", "val", "id"]);
    expect(disabled).toEqual([]);                       // identifier offered as discrete
  });

  it("color: an aggregate-only layer stack disables numeric colour (box takes a categorical/ID colour)", () => {
    const boxOnly: GeomMeta[] = [{ ...geom("categorical", "numeric"),
      aggregates: true, aes: ["color"] }];
    const { selectable, disabled } = offeredColumns(REG, "color", COLS, boxOnly);
    expect(selectable.map((c) => c.name)).toEqual(["grp", "id"]);  // categorical + id
    expect(disabled.map((d) => d.col.name)).toEqual(["val"]);      // numeric disabled
    expect(disabled[0].reason).toBeTruthy();
  });

  it("color: a per-point layer (dot) re-enables numeric colour as a colormap", () => {
    const withDot: GeomMeta[] = [
      { ...geom("categorical", "numeric"), aggregates: true, aes: ["color"] },
      { ...geom("categorical", "numeric"), aggregates: false,
        aes: ["color", "size", "shape"] },
    ];
    const { selectable } = offeredColumns(REG, "color", COLS, withDot);
    expect(selectable.map((c) => c.name)).toEqual(["grp", "val", "id"]);
  });

  it("facets offer identifiers as discrete (small multiples per date/position)", () => {
    for (const ch of ["facet_row", "facet_col"] as const) {
      const { selectable, disabled } = offeredColumns(REG, ch, COLS);
      expect(selectable.map((c) => c.name)).toEqual(["grp", "id"]);  // categorical + id
      expect(disabled).toEqual([]);                                  // numeric not offered
    }
  });

  it("shape: identifier selectable as discrete (a marker per grain, like colour)", () => {
    const { selectable, disabled } = offeredColumns(REG, "shape", COLS);
    expect(selectable.map((c) => c.name)).toContain("id");
    expect(disabled.map((d) => d.col.name)).not.toContain("id");
  });

  it("shape: categorical + identifier selectable, numeric disabled-with-reason", () => {
    const { selectable, disabled } = offeredColumns(REG, "shape", COLS);
    expect(selectable.map((c) => c.name)).toEqual(["grp", "id"]);
    expect(disabled.map((d) => d.col.name)).toEqual(["val"]);
    expect(disabled[0].reason).toBeTruthy();
  });
  it("y (pre-3c): only the numeric column is selectable", () => {
    const { selectable, disabled } = offeredColumns(REG, "y", COLS);
    expect(selectable.map((c) => c.name)).toEqual(["val"]);
    expect(disabled).toEqual([]);
  });
  it("Phase 3c y: both numeric and categorical are selectable via h_orient", () => {
    const { selectable, disabled } = offeredColumns(REG_3C, "y", COLS);
    expect(selectable.map((c) => c.name)).toEqual(["grp", "val"]);
    expect(disabled).toEqual([]);
  });
  it("bool is offered like a numeric on y (it plots as a fraction)", () => {
    const cols: ColumnDef[] = [...COLS, { name: "hit", type: "bool", label: "Hit" }];
    const { selectable } = offeredColumns(REG, "y", cols);
    expect(selectable.map((c) => c.name)).toEqual(["val", "hit"]);
    // and it derives the numeric family on the value axis
    const schema: Schema = { schema_version: "1.0", columns: cols };
    expect(familyForMappings({ x: "grp", y: "hit" }, schema)).toBe("group_comparison");
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
  const enabled3c = (g: string, x: ColType | null, y: ColType | null) =>
    geomGateReason(REG_3C.geoms[g], x, y) === null;

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
  it("empty x + numeric y: descriptive geom enabled, axis geoms need an X", () => {
    expect(enabled("distribution", null, "numeric")).toBe(true);
    expect(geomGateReason(REG.geoms.dot, null, "numeric")).toMatch(/categorical X/);
  });
  it("Phase 3c: numeric x + categorical y enables h_orient group geoms", () => {
    for (const g of ["dot", "summary", "box", "violin", "bar"])
      expect(enabled3c(g, "numeric", "categorical")).toBe(true);
    // scatter/regression have no h_orient — still disabled
    expect(enabled3c("scatter", "numeric", "categorical")).toBe(false);
    expect(enabled3c("regression", "numeric", "categorical")).toBe(false);
    // descriptive geom also disabled (needs x absent)
    expect(enabled3c("distribution", "numeric", "categorical")).toBe(false);
  });
  it("Phase 3c: h_orient geoms still work for vertical (categorical x + numeric y)", () => {
    for (const g of ["dot", "box"])
      expect(enabled3c(g, "categorical", "numeric")).toBe(true);
  });
});

describe("familyFor — Phase 3d: categorical × categorical → contingency", () => {
  it("both categorical axes yield contingency (tile geom)", () => {
    expect(familyFor("categorical", "categorical")).toBe("contingency");
  });
  it("contingency never falls through to describe-only", () => {
    expect(familyFor("categorical", "categorical")).not.toBe("none");
  });
});

describe("Phase 3d primitive gating — tile geom enabled by REG_3D", () => {
  const enabled3d = (g: string, x: ColType | null, y: ColType | null) =>
    geomGateReason(REG_3D.geoms[g], x, y) === null;

  it("tile: categorical x + categorical y → enabled", () => {
    expect(enabled3d("tile", "categorical", "categorical")).toBe(true);
  });
  it("tile: numeric x or missing axis → disabled", () => {
    expect(enabled3d("tile", "numeric", "categorical")).toBe(false);
    expect(enabled3d("tile", "categorical", "numeric")).toBe(false);
    expect(enabled3d("tile", null, "categorical")).toBe(false);
  });
  it("tile does not have h_orient, so swapped pair does not enable it", () => {
    // tile has no h_orient, so the h_orient shortcut must not fire
    expect(REG_3D.geoms["tile"].h_orient).toBeFalsy();
    expect(enabled3d("tile", "numeric", "categorical")).toBe(false);
  });
  it("group-comparison geoms remain disabled for categorical×categorical", () => {
    for (const g of ["dot", "box", "violin", "bar", "summary"])
      expect(enabled3d(g, "categorical", "categorical")).toBe(false);
  });
  it("REG_3D: Y offers categoricals (via tile geom's y_type)", () => {
    expect(isOfferable(REG_3D, "y", "categorical")).toBe(true);
  });
  it("REG_3D: X still offers numerics (via scatter/regression)", () => {
    expect(isOfferable(REG_3D, "x", "numeric")).toBe(true);
  });
});

describe("back-compat — derived family matches the pre-3a stored family", () => {
  it("each template's seeded mapping derives the family it used to store", () => {
    // group-comparison templates (dots/box/violin/bar): categorical x + numeric y
    expect(familyForMappings({ x: "grp", y: "val" }, SCHEMA)).toBe("group_comparison");
    // scatter: numeric x + numeric y
    expect(familyForMappings({ x: "val", y: "val" }, SCHEMA)).toBe("correlation");
    // distribution: empty x + numeric y
    expect(familyForMappings({ x: "", y: "val" }, SCHEMA)).toBe("descriptive");
    // Phase 3d: categorical × categorical → contingency (no longer falls back to descriptive)
    expect(familyForMappings({ x: "grp", y: "grp" }, SCHEMA)).toBe("contingency");
  });
});

describe("familyForMappingsRef — vs-reference (location) opt-in", () => {
  it("a numeric reference flips the group-comparison shape to location", () => {
    expect(familyForMappingsRef({ x: "grp", y: "val" }, SCHEMA, 0)).toBe("location");
    // a non-zero reference works too (chance/control/unity is any constant)
    expect(familyForMappingsRef({ x: "grp", y: "val" }, SCHEMA, 1.5)).toBe("location");
    // an ungrouped single sample (empty x) is also a one-sample test
    expect(familyForMappingsRef({ x: "", y: "val" }, SCHEMA, 0)).toBe("location");
  });
  it("no reference keeps the type-derived family", () => {
    expect(familyForMappingsRef({ x: "grp", y: "val" }, SCHEMA, null)).toBe("group_comparison");
    expect(familyForMappingsRef({ x: "", y: "val" }, SCHEMA, null)).toBe("descriptive");
  });
  it("a reference is ignored for shapes that can't be a location test", () => {
    // numeric × numeric stays a correlation; categorical × categorical stays contingency
    expect(familyForMappingsRef({ x: "val", y: "val" }, SCHEMA, 0)).toBe("correlation");
    expect(familyForMappingsRef({ x: "grp", y: "grp" }, SCHEMA, 0)).toBe("contingency");
  });
});

describe("geomAddable — geom-first entry (unmapped axis doesn't block)", () => {
  const box = REG.geoms["box"];          // categorical x, numeric y, no h_orient here
  const scatter = REG.geoms["scatter"];  // numeric x, numeric y
  const hbox = REG_3C.geoms["box"];      // h_orient

  it("offers every geom when nothing is mapped (the geom-first start)", () => {
    for (const g of Object.values(REG.geoms))
      expect(geomAddable(g, null, null)).toBe(true);
  });
  it("keeps a geom addable when only the matching axis is mapped", () => {
    expect(geomAddable(box, "categorical", null)).toBe(true);   // y still open
    expect(geomAddable(scatter, "numeric", null)).toBe(true);
  });
  it("rules a geom out only when a mapped axis is the wrong type", () => {
    expect(geomAddable(scatter, "categorical", null)).toBe(false); // x must be numeric
    expect(geomAddable(box, "numeric", "numeric")).toBe(false);    // x must be categorical
  });
  it("h_orient geoms are addable for either orientation's mapped axis", () => {
    expect(geomAddable(hbox, "numeric", null)).toBe(true);      // horizontal x
    expect(geomAddable(hbox, "categorical", null)).toBe(true);  // vertical x
    expect(geomAddable(hbox, null, "categorical")).toBe(true);  // horizontal y
  });
});

describe("geomAxisColTypes — geom→encoding narrowing", () => {
  it("a scatter narrows both axes to numeric", () => {
    expect([...geomAxisColTypes([REG.geoms["scatter"]], "x")]).toEqual(["numeric"]);
    expect([...geomAxisColTypes([REG.geoms["scatter"]], "y")]).toEqual(["numeric"]);
  });
  it("a vertical box narrows X to categorical, Y to numeric", () => {
    expect([...geomAxisColTypes([REG.geoms["box"]], "x")]).toEqual(["categorical"]);
    expect([...geomAxisColTypes([REG.geoms["box"]], "y")]).toEqual(["numeric"]);
  });
  it("an h_orient box accepts categorical OR numeric on each axis", () => {
    expect(new Set(geomAxisColTypes([REG_3C.geoms["box"]], "x")))
      .toEqual(new Set(["categorical", "numeric"]));
    expect(new Set(geomAxisColTypes([REG_3C.geoms["box"]], "y")))
      .toEqual(new Set(["numeric", "categorical"]));
  });
  it("no geoms → empty set (caller falls back to the registry-wide offer)", () => {
    expect(geomAxisColTypes([], "x").size).toBe(0);
  });
  it("joint constraint: an h_orient box with numeric X narrows Y to categorical only", () => {
    // the reported bug — without the other-axis constraint Y also offered numeric,
    // giving a numeric/numeric pair that fell through to a scatter.
    expect([...geomAxisColTypes([REG_3C.geoms["box"]], "y", "numeric")])
      .toEqual(["categorical"]);
  });
  it("joint constraint: an h_orient box with categorical X narrows Y to numeric only", () => {
    expect([...geomAxisColTypes([REG_3C.geoms["box"]], "y", "categorical")])
      .toEqual(["numeric"]);
  });
  it("joint constraint: an h_orient box with numeric Y narrows X to categorical only", () => {
    expect([...geomAxisColTypes([REG_3C.geoms["box"]], "x", "numeric")])
      .toEqual(["categorical"]);
  });
  it("an unmapped other axis (null) leaves every orientation open", () => {
    expect(new Set(geomAxisColTypes([REG_3C.geoms["box"]], "y", null)))
      .toEqual(new Set(["numeric", "categorical"]));
  });
});
