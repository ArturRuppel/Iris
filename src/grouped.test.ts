import { describe, it, expect } from "vitest";
import {
  pivotability, longToWide, applyFactorOrder, MAX_GROUPED_ROWS, type GroupedSpec,
} from "./grouped";
import type { ColumnDef, Row, Schema } from "./types";

const col = (name: string, type: ColumnDef["type"]): ColumnDef =>
  ({ name, type, label: name });
const schema = (...cs: ColumnDef[]): Schema => ({ schema_version: "1.0", columns: cs });

describe("pivotability predicate", () => {
  it("one value + categorical factors → pivotable", () => {
    const s = schema(col("condition", "categorical"), col("value", "numeric"));
    const a = pivotability(s, 10);
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.spec.value.name).toBe("value");
      expect(a.spec.factors.map((f) => f.name)).toEqual(["condition"]);
    }
  });

  it("two numeric columns → not pivotable (ambiguous value)", () => {
    const s = schema(col("condition", "categorical"), col("v1", "numeric"), col("v2", "numeric"));
    const a = pivotability(s, 10);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toMatch(/2 numeric/);
  });

  it("no numeric column → not pivotable", () => {
    const a = pivotability(schema(col("condition", "categorical")), 10);
    expect(a.ok).toBe(false);
  });

  it("a bool measure alongside the value → not pivotable (neither group nor value)", () => {
    const s = schema(col("condition", "categorical"), col("alive", "bool"), col("value", "numeric"));
    const a = pivotability(s, 10);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toMatch(/alive/);
  });

  it("identifier columns are ignored (rows are positional replicates)", () => {
    const s = schema(col("cell_id", "identifier"), col("condition", "categorical"), col("value", "numeric"));
    const a = pivotability(s, 10);
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.spec.factors.map((f) => f.name)).toEqual(["condition"]);
  });

  it("oversize table → not pivotable, with a row-count reason", () => {
    const s = schema(col("condition", "categorical"), col("value", "numeric"));
    const a = pivotability(s, MAX_GROUPED_ROWS + 1);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toMatch(/too many/);
  });

  it("factor order follows schema order (outer → inner), value excluded", () => {
    const s = schema(col("group", "categorical"), col("value", "numeric"), col("day", "categorical"));
    const a = pivotability(s, 10);
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.spec.factors.map((f) => f.name)).toEqual(["group", "day"]);
  });
});

describe("applyFactorOrder (re-nesting)", () => {
  const factors = [col("group", "categorical"), col("day", "categorical"), col("site", "categorical")];
  const names = (fs: ColumnDef[]) => fs.map((f) => f.name);

  it("empty order is the identity (default nesting = schema order)", () => {
    expect(names(applyFactorOrder(factors, []))).toEqual(["group", "day", "site"]);
  });

  it("reorders factors by the saved outer → inner order", () => {
    expect(names(applyFactorOrder(factors, ["day", "group", "site"])))
      .toEqual(["day", "group", "site"]);
  });

  it("appends factors the order doesn't mention, in schema order", () => {
    // only "site" is pinned first; group/day follow in schema order
    expect(names(applyFactorOrder(factors, ["site"]))).toEqual(["site", "group", "day"]);
  });

  it("ignores stale names no longer among the factors (self-heals)", () => {
    expect(names(applyFactorOrder(factors, ["removed", "day", "gone", "group"])))
      .toEqual(["day", "group", "site"]);
  });
});

/* re-nesting flips which factor bands the header: [day, group] over the same
   rows makes "day" the outer band and "group" the leaf headers. */
describe("longToWide honours factor order", () => {
  it("swapping the factors swaps the header without touching the values", () => {
    const rows: Row[] = [
      { id: "1", group: "Ctl", day: "D1", value: 1 },
      { id: "2", group: "Ctl", day: "D2", value: 2 },
      { id: "3", group: "Trt", day: "D1", value: 3 },
      { id: "4", group: "Trt", day: "D2", value: 4 },
    ];
    const value = col("value", "numeric");
    const g = longToWide(rows, { value, factors: [col("day", "categorical"), col("group", "categorical")] });
    expect(g.bands).toEqual([[{ span: 2, label: "D1" }, { span: 2, label: "D2" }]]);
    expect(g.columnLabels).toEqual(["Ctl", "Trt", "Ctl", "Trt"]);
    // D1/Ctl=1, D1/Trt=3, D2/Ctl=2, D2/Trt=4
    expect(g.values).toEqual([[1, 3, 2, 4]]);
  });
});

/* a small long table: group × day, 2 replicates each (balanced) */
const spec2 = (rows: Row[]): { spec: GroupedSpec; rows: Row[] } => ({
  spec: {
    value: col("value", "numeric"),
    factors: [col("group", "categorical"), col("day", "categorical")],
  },
  rows,
});

describe("longToWide", () => {
  it("balanced factors tile into merged bands and a value body", () => {
    const { spec, rows } = spec2([
      { id: "1", group: "Ctl", day: "D1", value: 1 },
      { id: "2", group: "Ctl", day: "D1", value: 2 },
      { id: "3", group: "Ctl", day: "D2", value: 3 },
      { id: "4", group: "Ctl", day: "D2", value: 4 },
      { id: "5", group: "Trt", day: "D1", value: 5 },
      { id: "6", group: "Trt", day: "D1", value: 6 },
      { id: "7", group: "Trt", day: "D2", value: 7 },
      { id: "8", group: "Trt", day: "D2", value: 8 },
    ]);
    const g = longToWide(rows, spec);
    expect(g.nCols).toBe(4);
    expect(g.columnLabels).toEqual(["D1", "D2", "D1", "D2"]);
    // one band (outer factor "group"), each cell spanning its two days
    expect(g.bands).toEqual([[{ span: 2, label: "Ctl" }, { span: 2, label: "Trt" }]]);
    expect(g.nRows).toBe(2);
    expect(g.values).toEqual([[1, 3, 5, 7], [2, 4, 6, 8]]);
    // rowIds run parallel to values (for edit routing later)
    expect(g.rowIds[0]).toEqual(["1", "3", "5", "7"]);
  });

  it("ragged groups blank-pad without dropping values", () => {
    const { spec, rows } = spec2([
      { id: "1", group: "Ctl", day: "D1", value: 1 },
      { id: "2", group: "Ctl", day: "D1", value: 2 },
      { id: "3", group: "Ctl", day: "D1", value: 3 },  // Ctl/D1 has 3 reps
      { id: "4", group: "Trt", day: "D1", value: 9 },  // Trt/D1 has 1
    ]);
    const g = longToWide(rows, spec);
    expect(g.nCols).toBe(2);   // only observed combos become columns
    expect(g.columnLabels).toEqual(["D1", "D1"]);
    expect(g.nRows).toBe(3);
    expect(g.values).toEqual([[1, 9], [2, null], [3, null]]);
    expect(g.rowIds).toEqual([["1", "4"], ["2", null], ["3", null]]);
  });

  it("a single factor makes leaf columns with no bands", () => {
    const spec: GroupedSpec = { value: col("value", "numeric"), factors: [col("group", "categorical")] };
    const g = longToWide([
      { id: "1", group: "Ctl", value: 1 },
      { id: "2", group: "Trt", value: 2 },
    ], spec);
    expect(g.bands).toEqual([]);
    expect(g.columnLabels).toEqual(["Ctl", "Trt"]);
    expect(g.values).toEqual([[1, 2]]);
  });

  it("no factors gives one flat value column in row order", () => {
    const spec: GroupedSpec = { value: col("value", "numeric"), factors: [] };
    const g = longToWide([
      { id: "1", value: 5 },
      { id: "2", value: 6 },
    ], spec);
    expect(g.nCols).toBe(1);
    expect(g.bands).toEqual([]);
    expect(g.columnLabels).toEqual(["value"]);
    expect(g.values).toEqual([[5], [6]]);
  });

  it("column order follows each factor's first-seen level order", () => {
    // Trt appears before Ctl in the data → Trt's columns come first
    const { spec, rows } = spec2([
      { id: "1", group: "Trt", day: "D2", value: 1 },
      { id: "2", group: "Trt", day: "D1", value: 2 },
      { id: "3", group: "Ctl", day: "D1", value: 3 },
    ]);
    const g = longToWide(rows, spec);
    expect(g.bands[0].map((c) => c.label)).toEqual(["Trt", "Ctl"]);
    // within Trt, D2 was seen before D1
    expect(g.columnLabels).toEqual(["D2", "D1", "D1"]);
    expect(g.values[0]).toEqual([1, 2, 3]);
  });

  it("three factors nest into two bands over the leaf headers", () => {
    const spec: GroupedSpec = {
      value: col("value", "numeric"),
      factors: [col("a", "categorical"), col("b", "categorical"), col("c", "categorical")],
    };
    const g = longToWide([
      { id: "1", a: "A", b: "B1", c: "C1", value: 1 },
      { id: "2", a: "A", b: "B1", c: "C2", value: 2 },
      { id: "3", a: "A", b: "B2", c: "C1", value: 3 },
    ], spec);
    expect(g.bands.length).toBe(2);
    expect(g.bands[0]).toEqual([{ span: 3, label: "A" }]);           // outer: a
    expect(g.bands[1]).toEqual([{ span: 2, label: "B1" }, { span: 1, label: "B2" }]); // mid: b
    expect(g.columnLabels).toEqual(["C1", "C2", "C1"]);              // leaf: c
  });
});
