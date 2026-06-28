import { describe, it, expect } from "vitest";
import { heroCardStates } from "./cardGating";
import type { AnalysisSpec, Schema } from "../types";

const schema: Schema = { schema_version: "1.0", columns: [
  { name: "cond", type: "categorical", label: "Condition", levels: ["a", "b"] },
  { name: "val", type: "numeric", label: "Value" },
] };

const renderable: AnalysisSpec = {
  spec_version: "2.1", id: "p1", title: "t", data: { filter: [] },
  reduce: { steps: [] },
  encodings: { x: { column: "cond" }, y: { column: "val" }, color: null, size: null, shape: null },
  facet: { row: null, col: null, share_x: true, share_y: true },
  layers: [{ geom: "box", level: "" }],
} as unknown as AnalysisSpec;

describe("heroCardStates", () => {
  it("Table is always enabled", () => {
    expect(heroCardStates(null, schema).tableEnabled).toBe(true);
    expect(heroCardStates(renderable, schema).tableEnabled).toBe(true);
  });
  it("Plot and Stats are disabled with no spec", () => {
    const s = heroCardStates(null, schema);
    expect(s.plotEnabled).toBe(false);
    expect(s.statsEnabled).toBe(false);
  });
  it("Plot and Stats enable for a renderable spec", () => {
    const s = heroCardStates(renderable, schema);
    expect(s.plotEnabled).toBe(true);
    expect(s.statsEnabled).toBe(true);
  });
  it("Plot disabled when the spec has no layers", () => {
    const noLayers = { ...renderable, layers: [] } as unknown as AnalysisSpec;
    expect(heroCardStates(noLayers, schema).plotEnabled).toBe(false);
  });
});
