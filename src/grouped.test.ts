import { describe, it, expect } from "vitest";
import { pivotability, groupedSpec, longToWide,
  pivotCost, pivotOverflow, GROUPED_CELL_CAP } from "./grouped";
import type { ColumnDef, Row, Schema, Hierarchy } from "./types";

// "identifier" is shorthand for a categorical column carrying the identifier role
// (the value type is immaterial to the band-layout logic under test).
const col = (name: string, type: ColumnDef["type"] | "identifier"): ColumnDef =>
  type === "identifier"
    ? { name, type: "categorical", identifier: true, label: name }
    : { name, type, label: name };
const schema = (...cs: ColumnDef[]): Schema => ({ schema_version: "1.0", columns: cs });
const hier = (...spine: string[]): Hierarchy => ({ spine, fn: {} });
const rid = (id: string, o: Record<string, unknown>): Row => ({ id, ...o } as Row);

// cell_size, correctly typed: experiment/position/cell/frame are the grain,
// subpopulation labels it, value is the measurement.
const cellSizeSchema = schema(
  col("experiment_id", "identifier"), col("position_id", "identifier"),
  col("cell_id", "identifier"), col("frame", "identifier"),
  col("subpopulation", "categorical"), col("value", "numeric"),
);
const cellSizeSpine = hier("experiment_id", "position_id", "cell_id", "frame");

describe("groupedSpec — coarser identifiers band, finest is vertical, rest are leaves", () => {
  it("bands = spine minus finest; vertical = finest; leaves = every non-identifier", () => {
    const s = groupedSpec(cellSizeSchema, cellSizeSpine.spine);
    expect(s.bandCols.map((c) => c.name)).toEqual(["experiment_id", "position_id", "cell_id"]);
    expect(s.vertical?.name).toBe("frame");
    expect(s.values.map((c) => c.name)).toEqual(["subpopulation", "value"]);
  });

  it("a classifier is a LEAF column, never a band (that would be a cross-tab)", () => {
    const s = groupedSpec(
      schema(col("experiment_id", "identifier"), col("position", "identifier"),
             col("frame", "identifier"), col("cell_label", "categorical")),
      ["experiment_id", "position", "frame"]);
    expect(s.bandCols.map((c) => c.name)).toEqual(["experiment_id", "position"]);
    expect(s.vertical?.name).toBe("frame");
    expect(s.values.map((c) => c.name)).toEqual(["cell_label"]);
  });

  it("a single identifier: no bands, it becomes the vertical grain; rest are leaves", () => {
    const s = groupedSpec(
      schema(col("experiment_id", "identifier"), col("position", "categorical"),
             col("value", "numeric")),
      ["experiment_id"]);
    expect(s.bandCols).toEqual([]);
    expect(s.vertical?.name).toBe("experiment_id");
    expect(s.values.map((c) => c.name)).toEqual(["position", "value"]);
  });

  it("reordering the spine re-picks the finest (vertical) and re-nests the bands", () => {
    const s = schema(col("experiment_id", "identifier"), col("cell_id", "identifier"),
                     col("frame", "identifier"), col("value", "numeric"));
    expect(groupedSpec(s, ["experiment_id", "cell_id", "frame"]).vertical?.name).toBe("frame");
    expect(groupedSpec(s, ["frame", "experiment_id", "cell_id"]).vertical?.name).toBe("cell_id");
  });

  it("no spine -> nothing to lay out; a lone categorical does NOT band the table", () => {
    const s = groupedSpec(
      schema(col("contact_type", "categorical"), col("value", "numeric")), []);
    expect(s.bandCols).toEqual([]);
    expect(s.vertical).toBeNull();
    expect(s.values.map((c) => c.name)).toEqual(["contact_type", "value"]);
  });

  it("a spine level absent from the schema is skipped (self-healing)", () => {
    const s = groupedSpec(schema(col("a", "identifier"), col("v", "numeric")), ["a", "gone"]);
    expect(s.vertical?.name).toBe("a");
    expect(s.bandCols).toEqual([]);
    expect(s.values.map((c) => c.name)).toEqual(["v"]);
  });
});

describe("pivotability — grouping needs an identifier", () => {
  it("a non-empty spine is groupable", () => {
    expect(pivotability(cellSizeSchema, cellSizeSpine).ok).toBe(true);
  });

  it("a single identifier is groupable (it becomes the grain axis)", () => {
    const a = pivotability(schema(col("e", "identifier"), col("v", "numeric")), hier("e"));
    expect(a.ok).toBe(true);
    if (a.ok) { expect(a.spec.vertical?.name).toBe("e"); expect(a.spec.bandCols).toEqual([]); }
  });

  it("no spine is not groupable, even with a categorical present", () => {
    const a = pivotability(
      schema(col("contact_type", "categorical"), col("value", "numeric")), hier());
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toMatch(/identifier/i);
  });

  it("no schema is not groupable", () => {
    expect(pivotability(null, hier()).ok).toBe(false);
  });
});

describe("longToWide — coarser bands, finest grain vertical + aligned", () => {
  // the image target: experiment × position band, frame the vertical grain, cell_label
  // the single leaf column. Rows align by frame across blocks; blanks where absent.
  const s = schema(col("experiment_id", "identifier"), col("position", "identifier"),
                   col("frame", "identifier"), col("cell_label", "categorical"));
  const spec = groupedSpec(s, ["experiment_id", "position", "frame"]);
  const rows: Row[] = [
    rid("1", { experiment_id: "exp1", position: "pos0", frame: 1, cell_label: "ko" }),
    rid("2", { experiment_id: "exp1", position: "pos0", frame: 2, cell_label: "ctrl" }),
    rid("3", { experiment_id: "exp1", position: "pos1", frame: 1, cell_label: "ko" }),
    rid("4", { experiment_id: "exp2", position: "pos0", frame: 1, cell_label: "ko" }),
  ];

  it("the finest identifier is the grain column, aligning rows across blocks", () => {
    const sheet = longToWide(rows, spec);
    expect(sheet.grain?.name).toBe("frame");
    expect(sheet.rowLabels).toEqual(["1", "2"]);       // distinct frames, first-seen
    expect(sheet.nRows).toBe(2);
    expect(sheet.nCols).toBe(3);                       // 3 band combos × 1 leaf
    // frame 1 row: pos0=ko, pos1=ko, exp2/pos0=ko; frame 2 only exists in exp1/pos0
    expect(sheet.values[0]).toEqual(["ko", "ko", "ko"]);
    expect(sheet.values[1]).toEqual(["ctrl", null, null]);   // holes where a block lacks frame 2
    expect(sheet.rowIds[1]).toEqual(["2", null, null]);
  });

  it("does NOT fold a single leaf into the innermost band — both bands stay bands", () => {
    const sheet = longToWide(rows, spec);
    expect(sheet.bands.length).toBe(2);                // experiment level + position level
    expect(sheet.columnLabels).toEqual(["cell_label", "cell_label", "cell_label"]);
    // outer band: exp1 spans its two positions, exp2 spans one
    expect(sheet.bands[0].map((c) => `${c.label}:${c.span}`)).toEqual(["exp1:2", "exp2:1"]);
    expect(sheet.bands[1].map((c) => c.label)).toEqual(["pos0", "pos1", "pos0"]);
  });

  it("empty rows -> an empty sheet, no crash", () => {
    const sheet = longToWide([], spec);
    expect(sheet.nRows).toBe(0);
    expect(sheet.nCols).toBe(0);
  });
});

describe("pivotOverflow — the near-diagonal blow-up is still refused", () => {
  // Mismark the measurement `value` an identifier: it becomes the finest grain
  // (vertical), so the pivot is one row per distinct value × one column per
  // (experiment, cell) band combo — a near-diagonal, ~all-holes grid.
  const valueAsId = schema(
    col("experiment_id", "identifier"), col("cell_id", "identifier"),
    col("value", "identifier"),   // <- mismarked; becomes the finest grain
    col("subpopulation", "categorical"),
  );
  const spec = groupedSpec(valueAsId, ["experiment_id", "cell_id", "value"]);

  it("pivotCost mirrors longToWide's dimensions without allocating the grid", () => {
    const rows: Row[] = [];
    for (let i = 0; i < 40; i++)
      rows.push(rid(String(i), { experiment_id: "e1", cell_id: i % 10, value: i, subpopulation: "KO" }));
    const cost = pivotCost(rows, spec);
    const sheet = longToWide(rows, spec);
    expect(cost.nRows).toBe(sheet.nRows);
    expect(cost.nCols).toBe(sheet.nCols);
    expect(cost.cells).toBe(sheet.nRows * sheet.nCols);
  });

  it("over the cap it is refused, naming the finest grain and the fix", () => {
    const rows: Row[] = [];
    for (let i = 0; i < 1500; i++)     // 1500 distinct values × 1500 cells -> 2.25M cells
      rows.push(rid(String(i), { experiment_id: "e1", cell_id: i, value: i + 0.5, subpopulation: "KO" }));
    const over = pivotOverflow(rows, spec);
    expect(over).not.toBeNull();
    expect(over!.cost.cells).toBeGreaterThan(GROUPED_CELL_CAP);
    expect(over!.reason).toContain("value");     // names the offending grain
    expect(over!.reason).toContain("measure");   // guides toward re-typing it
  });

  it("the correctly-typed pivot is never refused", () => {
    const rows: Row[] = [];
    for (let i = 0; i < 1500; i++)     // vertical = frame (≤50), bands modest -> tiny grid
      rows.push(rid(String(i), {
        experiment_id: "e1", position_id: "p1", cell_id: i % 20, frame: i % 50,
        subpopulation: "KO", value: i + 0.5,
      }));
    expect(pivotOverflow(rows, groupedSpec(cellSizeSchema, cellSizeSpine.spine))).toBeNull();
  });
});
