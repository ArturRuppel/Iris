import { describe, it, expect } from "vitest";
import { pivotability, groupedSpec, longToWide,
  pivotCost, pivotOverflow, GROUPED_CELL_CAP } from "./grouped";
import type { ColumnDef, Row, Schema, Hierarchy } from "./types";

// "identifier" is shorthand for a categorical column carrying the identifier
// role (the value type is immaterial to the spine-layout logic under test).
const col = (name: string, type: ColumnDef["type"] | "identifier"): ColumnDef =>
  type === "identifier"
    ? { name, type: "categorical", identifier: true, label: name }
    : { name, type, label: name };
const schema = (...cs: ColumnDef[]): Schema => ({ schema_version: "1.0", columns: cs });
const hier = (...spine: string[]): Hierarchy => ({ spine, fn: {} });

// cell_size, correctly typed: experiment/position/cell/frame are the grain,
// subpopulation labels it, value is the measurement.
const cellSizeSchema = schema(
  col("experiment_id", "identifier"), col("position_id", "identifier"),
  col("cell_id", "identifier"), col("frame", "identifier"),
  col("subpopulation", "categorical"), col("value", "numeric"),
);
const cellSizeSpine = hier("experiment_id", "position_id", "cell_id", "frame");

describe("groupedSpec — layout roles from the spine", () => {
  it("bands = spine minus finest, plus classifiers; vertical = finest; body = the rest", () => {
    const s = groupedSpec(cellSizeSchema, cellSizeSpine.spine);
    expect(s.bandCols.map((c) => c.name)).toEqual(
      ["experiment_id", "position_id", "cell_id", "subpopulation"]);
    expect(s.vertical?.name).toBe("frame");
    expect(s.values.map((c) => c.name)).toEqual(["value"]);
  });

  it("a spineless table with a categorical bands by it, vertical falls back to null (row id)", () => {
    const s = groupedSpec(
      schema(col("contact_type", "categorical"), col("value", "numeric")), []);
    expect(s.bandCols.map((c) => c.name)).toEqual(["contact_type"]);
    expect(s.vertical).toBeNull();
    expect(s.values.map((c) => c.name)).toEqual(["value"]);
  });

  it("multiple non-structural numerics are all value columns", () => {
    const s = groupedSpec(
      schema(col("experiment_id", "identifier"), col("focal", "categorical"),
             col("obs", "numeric"), col("exp", "numeric")),
      ["experiment_id"]);
    expect(s.vertical?.name).toBe("experiment_id");
    expect(s.bandCols.map((c) => c.name)).toEqual(["focal"]);
    expect(s.values.map((c) => c.name)).toEqual(["obs", "exp"]);
  });

  it("a spine level absent from the schema is skipped (self-healing)", () => {
    const s = groupedSpec(
      schema(col("a", "identifier"), col("v", "numeric")), ["a", "gone"]);
    expect(s.vertical?.name).toBe("a");
    expect(s.bandCols).toEqual([]);
    expect(s.values.map((c) => c.name)).toEqual(["v"]);
  });
});

describe("groupedSpec — spine order is the nesting control (Slice 3)", () => {
  // the same columns, two spine orders. The finest spine level is the vertical
  // axis and the rest are the bands in spine order, so reordering the spine
  // re-picks the vertical axis and re-nests the bands. This is the whole point of
  // retiring factorOrderAtom: nesting order lives on the spine and nowhere else.
  const s = schema(
    col("experiment_id", "identifier"), col("cell_id", "identifier"),
    col("frame", "identifier"), col("value", "numeric"));

  it("finest spine level is the vertical axis; the rest are bands, in spine order", () => {
    const spec = groupedSpec(s, ["experiment_id", "cell_id", "frame"]);
    expect(spec.vertical?.name).toBe("frame");
    expect(spec.bandCols.map((c) => c.name)).toEqual(["experiment_id", "cell_id"]);
  });

  it("reordering the spine re-picks the vertical axis and re-nests the bands", () => {
    const spec = groupedSpec(s, ["frame", "experiment_id", "cell_id"]);
    expect(spec.vertical?.name).toBe("cell_id");   // the new finest level
    expect(spec.bandCols.map((c) => c.name)).toEqual(["frame", "experiment_id"]);
  });
});

describe("pivotability — availability from the spine", () => {
  it("a non-empty spine is pivotable", () => {
    const a = pivotability(cellSizeSchema, cellSizeSpine);
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.spec.vertical?.name).toBe("frame");
  });

  it("no spine but a categorical is pivotable (id fallback)", () => {
    const a = pivotability(
      schema(col("contact_type", "categorical"), col("value", "numeric")), hier());
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.spec.vertical).toBeNull();
  });

  it("no structure at all is not pivotable, with an honest reason", () => {
    const a = pivotability(schema(col("value", "numeric")), hier());
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toMatch(/group by/i);
  });

  it("no schema is not pivotable", () => {
    const a = pivotability(null, hier());
    expect(a.ok).toBe(false);
  });

  it("many rows are fine — there is no row cap", () => {
    const a = pivotability(cellSizeSchema, cellSizeSpine);
    expect(a.ok).toBe(true);
  });
});

const rid = (id: string, o: Record<string, unknown>): Row => ({ id, ...o } as Row);

describe("longToWide — aligned pivot on the spine", () => {
  it("aligns rows by the vertical grain across columns", () => {
    // two cells, one per band column; frame is the vertical axis
    const spec = groupedSpec(cellSizeSchema, cellSizeSpine.spine);
    const rows: Row[] = [
      rid("1", { experiment_id: "E1", position_id: "P1", cell_id: "c1", frame: 0, subpopulation: "KO", value: 10 }),
      rid("2", { experiment_id: "E1", position_id: "P1", cell_id: "c1", frame: 1, subpopulation: "KO", value: 11 }),
      rid("3", { experiment_id: "E1", position_id: "P1", cell_id: "c2", frame: 1, subpopulation: "WT", value: 20 }),
    ];
    const sheet = longToWide(rows, spec);
    expect(sheet.nCols).toBe(2);           // c1, c2
    expect(sheet.nRows).toBe(2);           // frames {0, 1}
    // c1 has frames 0 and 1; c2 has only frame 1 -> a hole at row 0 (frame 0)
    expect(sheet.values[0]).toEqual([10, null]);   // frame 0
    expect(sheet.values[1]).toEqual([11, 20]);     // frame 1
    // the hole carries no id, so it is not editable
    expect(sheet.rowIds[0]).toEqual(["1", null]);
    expect(sheet.rowIds[1]).toEqual(["2", "3"]);
  });

  it("carries the value column for each body column (single value)", () => {
    const spec = groupedSpec(cellSizeSchema, cellSizeSpine.spine);
    const rows: Row[] = [
      rid("1", { experiment_id: "E1", position_id: "P1", cell_id: "c1", frame: 0, subpopulation: "KO", value: 10 }),
    ];
    const sheet = longToWide(rows, spec);
    expect(sheet.valueOfCol).toEqual(["value"]);
  });

  it("multiple value columns become adjacent leaf sub-columns per group", () => {
    const s = schema(col("experiment_id", "identifier"), col("focal", "categorical"),
                     col("obs", "numeric"), col("exp", "numeric"));
    const spec = groupedSpec(s, ["experiment_id"]);   // vertical = experiment_id
    const rows: Row[] = [
      rid("1", { experiment_id: "E1", focal: "neg", obs: 3, exp: 2.5 }),
      rid("2", { experiment_id: "E1", focal: "pos", obs: 5, exp: 4.0 }),
    ];
    const sheet = longToWide(rows, spec);
    // 2 focal groups x 2 value columns = 4 leaf columns
    expect(sheet.nCols).toBe(4);
    expect(sheet.valueOfCol).toEqual(["obs", "exp", "obs", "exp"]);
    expect(sheet.columnLabels).toEqual(["obs", "exp", "obs", "exp"]);
    expect(sheet.values[0]).toEqual([3, 2.5, 5, 4.0]);
  });

  it("no spine, a categorical: ragged stack keyed by row id", () => {
    const s = schema(col("contact_type", "categorical"), col("value", "numeric"));
    const spec = groupedSpec(s, []);
    const rows: Row[] = [
      rid("1", { contact_type: "a", value: 1 }),
      rid("2", { contact_type: "a", value: 2 }),
      rid("3", { contact_type: "b", value: 9 }),
    ];
    const sheet = longToWide(rows, spec);
    expect(sheet.nCols).toBe(2);          // a, b
    expect(sheet.nRows).toBe(2);          // deepest stack = a has 2
    expect(sheet.values[0]).toEqual([1, 9]);
    expect(sheet.values[1]).toEqual([2, null]);   // b ragged tail
  });

  it("empty rows -> an empty sheet, no crash", () => {
    const spec = groupedSpec(cellSizeSchema, cellSizeSpine.spine);
    const sheet = longToWide([], spec);
    expect(sheet.nCols).toBe(0);
    expect(sheet.nRows).toBe(0);
  });
});

describe("pivotOverflow — refuse the near-diagonal blow-up", () => {
  // Mark the measurement `value` an identifier: it becomes the finest grain, so the
  // pivot is one row per distinct value × one column per (exp,pos,cell,frame,subpop)
  // group — a near-diagonal, ~all-holes grid. longToWide would allocate nRows × nCols
  // densely and OOM the tab; the guard refuses first. (cell_size in the field is a
  // 7,452 × 82,241 = 612M-cell, ~5 GB grid — "Aw, Snap! Error code 5".)
  const valueAsId = schema(
    col("experiment_id", "identifier"), col("position_id", "identifier"),
    col("cell_id", "identifier"), col("frame", "identifier"),
    col("subpopulation", "categorical"), col("value", "identifier"),   // <- mismarked
  );
  const valueAsIdSpine = ["experiment_id", "position_id", "cell_id", "frame", "value"];

  it("pivotCost mirrors longToWide's dimensions exactly, without allocating the grid", () => {
    const s = groupedSpec(valueAsId, valueAsIdSpine);
    expect(s.vertical?.name).toBe("value");   // the mismarked measure IS the finest grain
    const rows: Row[] = [];
    for (let i = 0; i < 40; i++)
      rows.push(rid(String(i), { experiment_id: "e1", position_id: "p1",
        cell_id: i % 10, frame: i % 4, subpopulation: "VimentinKO", value: i }));
    const cost = pivotCost(rows, s);
    const sheet = longToWide(rows, s);        // small enough to build and compare
    expect(cost.nRows).toBe(sheet.nRows);
    expect(cost.nCols).toBe(sheet.nCols);
    expect(cost.cells).toBe(sheet.nRows * sheet.nCols);
  });

  it("a near-diagonal pivot over the cap is refused, naming the finest grain and the fix", () => {
    const s = groupedSpec(valueAsId, valueAsIdSpine);
    const rows: Row[] = [];
    for (let i = 0; i < 1500; i++)            // 1500 unique (group, value) pairs -> ~2.25M cells
      rows.push(rid(String(i), { experiment_id: "e1", position_id: "p1",
        cell_id: i, frame: 0, subpopulation: "VimentinKO", value: i + 0.5 }));
    const over = pivotOverflow(rows, s);
    expect(over).not.toBeNull();
    expect(over!.cost.cells).toBeGreaterThan(GROUPED_CELL_CAP);
    expect(over!.reason).toContain("value");    // names the offending grain (its label)
    expect(over!.reason).toContain("measure");  // guides toward re-typing it
  });

  it("the correctly-typed cell_size pivot (value a measure) is never refused", () => {
    const s = groupedSpec(cellSizeSchema, cellSizeSpine.spine);
    const rows: Row[] = [];
    for (let i = 0; i < 1500; i++)            // vertical = frame (≤50), bands modest -> tiny grid
      rows.push(rid(String(i), { experiment_id: "e1", position_id: "p1",
        cell_id: i % 20, frame: i % 50, subpopulation: "VimentinKO", value: i + 0.5 }));
    expect(pivotOverflow(rows, s)).toBeNull();
  });
});
