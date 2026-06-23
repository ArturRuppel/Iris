import { describe, it, expect } from "vitest";
import { buildGraph, nodeIdForLevel } from "./graph";
import type { Hierarchy, Layer, ReduceStep, Schema } from "../types";
import { RAW_LEVEL } from "../types";

const SCHEMA: Schema = {
  schema_version: "1.0",
  columns: [
    { name: "experiment", label: "Experiment", type: "identifier" },
    { name: "cell", label: "Cell", type: "identifier" },
    { name: "area", label: "Area", type: "numeric" },
  ],
} as unknown as Schema;

const HIER: Hierarchy = { spine: ["experiment", "cell"], fn: {} };

describe("buildGraph", () => {
  it("emits source → steps → flatten-per-level → outputs in order", () => {
    const steps: ReduceStep[] = [
      { kind: "filter", conditions: [] },
      { kind: "drop", columns: ["area"] },
    ];
    const layers: Layer[] = [{ geom: "dot", level: RAW_LEVEL }];
    const g = buildGraph(steps, HIER, layers, SCHEMA);
    expect(g.nodes.map((n) => n.kind)).toEqual([
      "source", "filter", "drop", "flatten", "flatten", "outputs",
    ]);
    expect(g.nodes.map((n) => n.id)).toEqual([
      "source", "step:0", "step:1",
      "flatten:experiment", "flatten:cell", "outputs",
    ]);
  });

  it("maps each node to its fetch strategy", () => {
    const steps: ReduceStep[] = [{ kind: "drop", columns: ["area"] }];
    const g = buildGraph(steps, HIER, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA);
    const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n.table]));
    expect(byId["source"]).toEqual({ via: "at_step", at_step: -1 });
    expect(byId["step:0"]).toEqual({ via: "at_step", at_step: 0 });
    expect(byId["flatten:experiment"]).toEqual({ via: "level", level: "experiment" });
    expect(byId["outputs"]).toEqual({ via: "none" });
  });

  it("labels flatten nodes from the schema and counts step conditions/columns", () => {
    const steps: ReduceStep[] = [
      { kind: "filter", conditions: [
        { column: "area", op: ">", value: 1 },
        { column: "area", op: "<", value: 9 }] },
      { kind: "drop", columns: ["area"] },
    ];
    const g = buildGraph(steps, HIER, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA);
    const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n.label]));
    expect(byId["step:0"]).toBe("Filter (2)");
    expect(byId["step:1"]).toBe("Drop (1)");
    expect(byId["flatten:experiment"]).toBe("per Experiment");
    expect(byId["flatten:cell"]).toBe("per Cell");
  });

  it("draws one fan-in arrow for a plain plot (raw level)", () => {
    const g = buildGraph([], HIER, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA);
    expect(g.fanIn).toEqual([{ fromId: "source", toId: "outputs", level: "" }]);
  });

  it("draws one arrow per distinct grain level for a SuperPlot", () => {
    const layers: Layer[] = [
      { geom: "dot", level: RAW_LEVEL },          // per-cell points
      { geom: "dot", level: "experiment" },       // per-experiment means
      { geom: "summary", level: "experiment" },   // duplicate level → no extra arrow
    ];
    const g = buildGraph([], HIER, layers, SCHEMA);
    expect(g.fanIn).toEqual([
      { fromId: "source", toId: "outputs", level: "" },
      { fromId: "flatten:experiment", toId: "outputs", level: "experiment" },
    ]);
  });

  it("skips fan-in for a level no longer on the spine", () => {
    const layers: Layer[] = [{ geom: "dot", level: "cell" }];
    const g = buildGraph([], { spine: ["experiment"], fn: {} }, layers, SCHEMA);
    // "cell" is not on this spine → dropped; falls back to the raw arrow
    expect(g.fanIn).toEqual([{ fromId: "source", toId: "outputs", level: "" }]);
  });

  it("nodeIdForLevel resolves raw to source and a spine level to its flatten node", () => {
    expect(nodeIdForLevel(RAW_LEVEL)).toBe("source");
    expect(nodeIdForLevel("experiment")).toBe("flatten:experiment");
  });
});
