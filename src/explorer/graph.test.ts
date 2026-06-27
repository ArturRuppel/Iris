import { describe, it, expect } from "vitest";
import { buildGraph, nodeIdForGrain } from "./graph";
import type { Layer, ReduceStep, Schema, Table } from "../types";
import { RAW_LEVEL } from "../types";
import { defaultPlan } from "../collapse";

const SCHEMA: Schema = {
  schema_version: "1.0",
  columns: [
    { name: "experiment", label: "Experiment", type: "identifier" },
    { name: "cell", label: "Cell", type: "identifier" },
    { name: "area", label: "Area", type: "numeric" },
  ],
} as unknown as Schema;

const SPINE = ["experiment", "cell"];
const PLAN = defaultPlan(SPINE, {});
const edge = (g: ReturnType<typeof buildGraph>, from: string, to: string) =>
  g.edges.find((e) => e.fromId === from && e.toId === to);

describe("buildGraph", () => {
  it("nodes are datatypes: source/step tables, collapse tables, plot, stats", () => {
    const steps: ReduceStep[] = [
      { kind: "filter", conditions: [] },
      { kind: "drop", columns: ["area"] },
    ];
    const g = buildGraph(steps, SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    expect(g.nodes.map((n) => n.id)).toEqual([
      "source", "step:0", "step:1", "grain:experiment/cell", "grain:experiment", "plot", "stats",
    ]);
    expect(g.nodes.map((n) => n.kind)).toEqual([
      "table", "table", "table", "table", "table", "plot", "stats",
    ]);
  });

  it("collapse nodes are keyed by grain; chain runs full-spine -> coarsest", () => {
    const g = buildGraph([{ kind: "drop", columns: ["area"] }], SPINE, PLAN,
      [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    expect(edge(g, "step:0", "grain:experiment/cell")?.kind).toBe("collapse");
    expect(edge(g, "grain:experiment/cell", "grain:experiment")?.kind).toBe("collapse");
    expect(g.nodes.find((n) => n.id === "grain:experiment")?.label).toBe("per Experiment");
  });

  it("each collapse edge carries the white #3 flatten-info guard", () => {
    const g = buildGraph([], SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    const ce = g.edges.find((e) => e.kind === "collapse");
    expect(ce?.guards?.some((gd) => gd.id === "flatten_info" && gd.severity === "info")).toBe(true);
  });

  it("collapse edge label reads as the reduction; identity regroup reads 'group per'", () => {
    const g = buildGraph([], SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    // real collapse: experiment/cell -> experiment removes Cell
    expect(edge(g, "grain:experiment/cell", "grain:experiment")?.label).toBe("mean over Cell");
    // first chain edge keeps the full spine (removes nothing): a regroup, not a collapse
    expect(edge(g, "source", "grain:experiment/cell")?.label).toBe("group per Experiment × Cell");
    // the flatten-info guard is still attached
    expect(edge(g, "grain:experiment/cell", "grain:experiment")
      ?.guards?.some((gd) => gd.id === "flatten_info")).toBe(true);
  });

  it("reduce-step edges carry the step kind and a count label", () => {
    const steps: ReduceStep[] = [
      { kind: "filter", conditions: [{ column: "area", op: ">", value: 1 },
                                     { column: "area", op: "<", value: 9 }] },
      { kind: "drop", columns: ["area"] },
    ];
    const g = buildGraph(steps, SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    expect(edge(g, "source", "step:0")).toMatchObject({ kind: "filter", label: "mask (2 conditions)" });
    expect(edge(g, "step:0", "step:1")).toMatchObject({ kind: "drop", label: "drop Area" });
  });

  it("maps each node to its data-tab fetch strategy", () => {
    const g = buildGraph([{ kind: "drop", columns: ["area"] }], SPINE, PLAN,
      [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n.table]));
    expect(byId["source"]).toEqual({ via: "at_step", at_step: -1 });
    expect(byId["step:0"]).toEqual({ via: "at_step", at_step: 0 });
    expect(byId["grain:experiment/cell"]).toEqual({ via: "grain", grain: "experiment/cell" });
    expect(byId["plot"]).toEqual({ via: "none" });
    expect(byId["stats"]).toEqual({ via: "none" });
  });

  it("geom edge per layer into plot; raw reads the last reduce node", () => {
    const steps: ReduceStep[] = [{ kind: "drop", columns: ["area"] }];
    const g = buildGraph(steps, SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    expect(edge(g, "step:0", "plot")).toMatchObject({ kind: "geom", label: "dots" });
  });

  it("SuperPlot: distinct grains/geoms draw distinct geom edges; dups collapse", () => {
    const layers: Layer[] = [
      { geom: "dot", level: RAW_LEVEL },
      { geom: "box", level: "experiment" },
      { geom: "box", level: "experiment" },
    ];
    const g = buildGraph([], SPINE, PLAN, layers, SCHEMA, null);
    const geoms = g.edges.filter((e) => e.kind === "geom");
    expect(geoms).toHaveLength(2);
    expect(edge(g, "source", "plot")?.label).toBe("dots");
    expect(edge(g, "grain:experiment", "plot")?.label).toBe("box");
  });

  it("two geoms at the same grain collapse to one comma-joined edge", () => {
    const layers: Layer[] = [
      { geom: "dot", level: RAW_LEVEL },
      { geom: "box", level: RAW_LEVEL },
    ];
    const g = buildGraph([], SPINE, PLAN, layers, SCHEMA, null);
    const geoms = g.edges.filter((e) => e.kind === "geom");
    expect(geoms).toHaveLength(1);
    expect(geoms[0].label).toBe("dots, box");
    expect(geoms[0].fromId).toBe("source");
  });

  it("skips a geom edge for a level no longer on the spine", () => {
    const g = buildGraph([], ["experiment"], defaultPlan(["experiment"], {}),
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
    const g = buildGraph([], SPINE, PLAN, layers, SCHEMA, { test: "Welch's t-test", describeOnly: false });
    expect(edge(g, "grain:experiment", "stats")).toMatchObject({
      kind: "test", label: "Welch's t-test" });
  });

  it("describe-only -> the test edge reads 'describe'", () => {
    const g = buildGraph([], SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA,
      { test: null, describeOnly: true });
    expect(edge(g, "grain:experiment", "stats")).toMatchObject({ kind: "test", label: "describe" });
  });

  it("nodeIdForGrain: raw -> given raw node; a grain key -> its grain node", () => {
    expect(nodeIdForGrain("", "step:2")).toBe("step:2");
    expect(nodeIdForGrain("experiment/cell", "source")).toBe("grain:experiment/cell");
  });

  it("derive and recode are linear single-edge steps", () => {
    const steps: ReduceStep[] = [
      { kind: "derive", column: "q", expr: "perimeter / sqrt(area)" },
      { kind: "recode", column: "class_label", map: { negative: "VimentinKO" } },
    ];
    const g = buildGraph(steps, SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    const kinds = g.edges.filter((e) => e.kind === "derive" || e.kind === "recode")
      .map((e) => e.kind);
    expect(kinds).toEqual(["derive", "recode"]);
  });

  it("pivot and grid_complete are linear single-edge steps", () => {
    const steps: ReduceStep[] = [
      { kind: "pivot", index: ["cell"], column: "opp", values: "n",
        agg: "sum", fill: 0, names: { s: "same", o: "opp" } },
      { kind: "grid_complete", by: ["experiment"], column: "tt",
        levels: ["a", "b"], count: true, fill: 0, count_name: "count" },
    ];
    const g = buildGraph(steps, SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    expect(edge(g, "source", "step:0")).toMatchObject({ kind: "pivot", label: "unstack opp → {same, opp}" });
    expect(edge(g, "step:0", "step:1")).toMatchObject({ kind: "grid_complete", label: "densify Experiment × tt · fill 0" });
    const kinds = g.edges.filter((e) => e.kind === "pivot" || e.kind === "grid_complete")
      .map((e) => e.kind);
    expect(kinds).toEqual(["pivot", "grid_complete"]);
  });

  it("array-op labels: derive shows the expr, single filter inlines the condition", () => {
    const steps: ReduceStep[] = [
      { kind: "filter", conditions: [{ column: "area", op: ">", value: 1 }] },
      { kind: "derive", column: "q", expr: "perimeter / sqrt(area)" },
    ];
    const g = buildGraph(steps, SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    expect(edge(g, "source", "step:0")?.label).toBe("mask: Area > 1");
    expect(edge(g, "step:0", "step:1")?.label).toBe("q = perimeter / sqrt(area)");
  });

  it("a join emits a named right node and two 'join on <keys>' edges", () => {
    const right: Table = {
      schema: { schema_version: "1.0", columns: [
        { name: "cell_id", type: "identifier", label: "Cell" },
        { name: "class_label", type: "categorical", label: "Class" },
      ] },
      rows: [{ id: "1", cell_id: "c1", class_label: "negative" }],
    };
    const steps: ReduceStep[] = [{ kind: "join", on: ["cell_id"], how: "inner", right }];
    const g = buildGraph(steps, SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    const sources = g.nodes.filter((n) => n.kind === "table" && n.id.startsWith("source"));
    expect(sources.length).toBeGreaterThanOrEqual(2);
    const incoming = g.edges.filter((e) => e.toId === "step:0" && e.kind === "join");
    expect(incoming.length).toBe(2);
    // right node is named for the value column(s) it brings in, not "join source"
    expect(g.nodes.find((n) => n.id === "source:0")?.label).toBe("Class");
    // both converging edges state the key path, using the right schema's label
    expect(incoming.every((e) => e.label === "join on Cell")).toBe(true);
    // the join edges carry the RAW on-keys (not the display label) for keyhi matching
    expect(incoming.every((e) => JSON.stringify(e.onKeys) === JSON.stringify(["cell_id"]))).toBe(true);
  });

  it("an UNFILLED join (empty right) renders its right input as a missing/open node", () => {
    const right: Table = { schema: { schema_version: "1.0", columns: [] }, rows: [] };
    const steps: ReduceStep[] = [{ kind: "join", on: [], how: "inner", right }];
    const g = buildGraph(steps, SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    const src = g.nodes.find((n) => n.id === "source:0");
    expect(src?.missing).toBe(true);
    expect(src?.label).toBe("drop a table here");
  });

  it("a FILLED join's right input is not missing (label = its value column)", () => {
    const right: Table = {
      schema: { schema_version: "1.0", columns: [
        { name: "cell_id", type: "identifier", label: "Cell" },
        { name: "class_label", type: "categorical", label: "Class" },
      ] },
      rows: [{ id: "1", cell_id: "c1", class_label: "negative" }],
    };
    const steps: ReduceStep[] = [{ kind: "join", on: ["cell_id"], how: "inner", right }];
    const g = buildGraph(steps, SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    const src = g.nodes.find((n) => n.id === "source:0");
    expect(src?.missing).toBeFalsy();
    expect(src?.label).toBe("Class");
  });

  it("post-collapse phase: a derive runs after the collapse chain, with the caution badge", () => {
    const post: ReduceStep[] = [{ kind: "derive", column: "enrich", expr: "obs / exp" }];
    const g = buildGraph([], SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }],
      SCHEMA, null, post);
    // the post derive hangs off the coarsest grain node (where the test runs)
    const pe = edge(g, "grain:experiment", "post:0");
    expect(pe?.kind).toBe("derive");
    expect(pe?.guards?.[0]?.id).toBe("post_aggregate_derive");
    expect(pe?.guards?.[0]?.severity).toBe("caution");
    // the test edge now reads the post-phase output, not the bare grain
    expect(edge(g, "post:0", "stats")?.kind).toBe("test");
  });

  it("no post phase: the test reads the coarsest grain directly", () => {
    const g = buildGraph([], SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    expect(edge(g, "grain:experiment", "stats")?.kind).toBe("test");
    expect(g.nodes.some((n) => n.id.startsWith("post:"))).toBe(false);
  });
});

describe("buildGraph: annotate edge (stats -> plot)", () => {
  it("emits an annotate edge when a test runs and annotation is enabled", () => {
    const g = buildGraph([], SPINE, PLAN, [], SCHEMA,
      { test: "mann_whitney", describeOnly: false, annotate: true });
    const a = g.edges.filter((e) => e.kind === "annotate");
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ fromId: "stats", toId: "plot" });
  });

  it("omits the annotate edge when annotation is disabled", () => {
    const g = buildGraph([], SPINE, PLAN, [], SCHEMA,
      { test: "mann_whitney", describeOnly: false, annotate: false });
    expect(g.edges.some((e) => e.kind === "annotate")).toBe(false);
  });

  it("omits the annotate edge in describe-only mode (no test to bracket)", () => {
    const g = buildGraph([], SPINE, PLAN, [], SCHEMA,
      { test: null, describeOnly: true, annotate: true });
    expect(g.edges.some((e) => e.kind === "annotate")).toBe(false);
  });

  it("omits the annotate edge when stats input is null", () => {
    const g = buildGraph([], SPINE, PLAN, [], SCHEMA, null);
    expect(g.edges.some((e) => e.kind === "annotate")).toBe(false);
  });

  it("the plot node then has two inbound edges: geom and annotate", () => {
    const g = buildGraph([], SPINE, PLAN, [], SCHEMA,
      { test: "mann_whitney", describeOnly: false, annotate: true });
    const intoPlot = g.edges.filter((e) => e.toId === "plot");
    expect(intoPlot.some((e) => e.kind === "geom")).toBe(true);
    expect(intoPlot.some((e) => e.kind === "annotate")).toBe(true);
  });
});
