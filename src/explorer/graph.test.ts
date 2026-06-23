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
const edge = (g: ReturnType<typeof buildGraph>, from: string, to: string) =>
  g.edges.find((e) => e.fromId === from && e.toId === to);

describe("buildGraph", () => {
  it("nodes are datatypes: source/step tables, collapse tables, plot, stats", () => {
    const steps: ReduceStep[] = [
      { kind: "filter", conditions: [] },
      { kind: "drop", columns: ["area"] },
    ];
    const g = buildGraph(steps, HIER, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    expect(g.nodes.map((n) => n.id)).toEqual([
      "source", "step:0", "step:1", "level:cell", "level:experiment", "plot", "stats",
    ]);
    expect(g.nodes.map((n) => n.kind)).toEqual([
      "table", "table", "table", "table", "table", "plot", "stats",
    ]);
  });

  it("collapse chain runs finest -> coarsest after the last reduce step", () => {
    const g = buildGraph([{ kind: "drop", columns: ["area"] }], HIER,
      [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    expect(edge(g, "step:0", "level:cell")?.kind).toBe("collapse");
    expect(edge(g, "level:cell", "level:experiment")?.kind).toBe("collapse");
    expect(g.nodes.find((n) => n.id === "level:experiment")?.label).toBe("per Experiment");
  });

  it("reduce-step edges carry the step kind and a count label", () => {
    const steps: ReduceStep[] = [
      { kind: "filter", conditions: [{ column: "area", op: ">", value: 1 },
                                     { column: "area", op: "<", value: 9 }] },
      { kind: "drop", columns: ["area"] },
    ];
    const g = buildGraph(steps, HIER, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    expect(edge(g, "source", "step:0")).toMatchObject({ kind: "filter", label: "filter (2)" });
    expect(edge(g, "step:0", "step:1")).toMatchObject({ kind: "drop", label: "drop (1)" });
  });

  it("maps each node to its data-tab fetch strategy", () => {
    const g = buildGraph([{ kind: "drop", columns: ["area"] }], HIER,
      [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n.table]));
    expect(byId["source"]).toEqual({ via: "at_step", at_step: -1 });
    expect(byId["step:0"]).toEqual({ via: "at_step", at_step: 0 });
    expect(byId["level:cell"]).toEqual({ via: "level", level: "cell" });
    expect(byId["plot"]).toEqual({ via: "none" });
    expect(byId["stats"]).toEqual({ via: "none" });
  });

  it("geom edge per layer into plot; raw reads the last reduce node", () => {
    const steps: ReduceStep[] = [{ kind: "drop", columns: ["area"] }];
    const g = buildGraph(steps, HIER, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    expect(edge(g, "step:0", "plot")).toMatchObject({ kind: "geom", label: "dots" });
  });

  it("SuperPlot: distinct grains/geoms draw distinct geom edges; dups collapse", () => {
    const layers: Layer[] = [
      { geom: "dot", level: RAW_LEVEL },
      { geom: "box", level: "experiment" },
      { geom: "box", level: "experiment" },
    ];
    const g = buildGraph([], HIER, layers, SCHEMA, null);
    const geoms = g.edges.filter((e) => e.kind === "geom");
    expect(geoms).toHaveLength(2);
    expect(edge(g, "source", "plot")?.label).toBe("dots");
    expect(edge(g, "level:experiment", "plot")?.label).toBe("box");
  });

  it("skips a geom edge for a level no longer on the spine", () => {
    const g = buildGraph([], { spine: ["experiment"], fn: {} },
      [{ geom: "dot", level: "cell" }], SCHEMA, null);
    const geoms = g.edges.filter((e) => e.kind === "geom");
    expect(geoms).toEqual([{ id: expect.any(String), kind: "geom",
      label: "plotted", fromId: "source", toId: "plot" }]);
  });

  it("test edge runs at the coarsest layer-bound grain, into stats", () => {
    const layers: Layer[] = [
      { geom: "dot", level: RAW_LEVEL },
      { geom: "box", level: "experiment" },
    ];
    const g = buildGraph([], HIER, layers, SCHEMA, { test: "Welch's t-test", describeOnly: false });
    expect(edge(g, "level:experiment", "stats")).toMatchObject({
      kind: "test", label: "Welch's t-test" });
  });

  it("describe-only -> the test edge reads 'describe'", () => {
    const g = buildGraph([], HIER, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA,
      { test: null, describeOnly: true });
    expect(edge(g, "source", "stats")).toMatchObject({ kind: "test", label: "describe" });
  });

  it("nodeIdForLevel: raw -> given raw node (default source); spine level -> its collapse node", () => {
    expect(nodeIdForLevel(RAW_LEVEL)).toBe("source");
    expect(nodeIdForLevel(RAW_LEVEL, "step:2")).toBe("step:2");
    expect(nodeIdForLevel("experiment")).toBe("level:experiment");
  });
});
