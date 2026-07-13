import { describe, it, expect } from "vitest";
import { buildGraph, nodeIdForGrain } from "./graph";
import type { Layer, ReduceDag, ReduceStep, Schema } from "../types";
import { RAW_LEVEL } from "../types";
import { defaultPlan } from "../collapse";

/* wrap a linear step list in the degenerate reduce DAG buildGraph now takes: one
   source, a straight `inputs` chain, output = the last step. buildGraph re-maps
   these ids to `step:<arrayIndex>`, so the internal ids here are arbitrary. */
function linearDag(steps: ReduceStep[], post: ReduceStep[] = []): ReduceDag {
  const nodes = steps.map((s, i) => ({
    ...s, id: `k${i}`, inputs: [i === 0 ? "src" : `k${i - 1}`] }));
  return {
    sources: [{ id: "src", tableId: "t" }],
    steps: nodes,
    output: nodes.length ? nodes[nodes.length - 1].id : "src",
    ...(post.length ? { post } : {}),
  };
}

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
const edge = (g: ReturnType<typeof buildGraph>, from: string, to: string, kind?: string) =>
  g.edges.find((e) => e.fromId === from && e.toId === to && (!kind || e.kind === kind));

describe("buildGraph", () => {
  it("nodes are datatypes: source/step tables, collapse tables, figure", () => {
    const steps: ReduceStep[] = [
      { kind: "filter", conditions: [] },
      { kind: "drop", columns: ["area"] },
    ];
    const g = buildGraph(linearDag(steps), SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    expect(g.nodes.map((n) => n.id)).toEqual([
      "source", "step:0", "step:1", "grain:experiment/cell", "grain:experiment", "figure",
    ]);
    expect(g.nodes.map((n) => n.kind)).toEqual([
      "table", "table", "table", "table", "table", "figure",
    ]);
  });

  it("draws one edge per input; a fan-out node emits two outgoing edges", () => {
    // src feeds two derives (a fan-out); one of them is the output.
    const dag: ReduceDag = {
      sources: [{ id: "src", tableId: "t" }],
      steps: [
        { kind: "derive", column: "hi", expr: "area+1", id: "hi", inputs: ["src"] },
        { kind: "derive", column: "lo", expr: "area-1", id: "lo", inputs: ["src"] },
      ] as ReduceDag["steps"],
      output: "hi",
    };
    const g = buildGraph(dag, SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    // "hi" is step:0, "lo" is step:1 (array order); both hang off the source.
    const fromSrc = g.edges.filter((e) => e.fromId === "source" && e.kind === "derive");
    expect(fromSrc.map((e) => e.toId).sort()).toEqual(["step:0", "step:1"]);
  });

  it("a wired join right draws an edge from the real upstream node, not a synthetic source", () => {
    // src -> derive(branch); a join whose right input is WIRED to that branch.
    const dag: ReduceDag = {
      sources: [{ id: "src", tableId: "t" }],
      steps: [
        { kind: "derive", column: "b", expr: "area*2", id: "branch", inputs: ["src"] },
        { kind: "join", on: ["cell"], how: "inner", rightTableId: "", id: "j",
          inputs: ["src", "branch"] },
      ] as ReduceDag["steps"],
      output: "j",
    };
    const g = buildGraph(dag, SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    // no synthetic join-input node when the right is wired.
    expect(g.nodes.some((n) => n.phase === "join-input")).toBe(false);
    // branch (step:0) feeds the join (step:1) as its right input.
    expect(edge(g, "step:0", "step:1", "join")).toBeTruthy();
  });

  it("an unwired join with a rightTableId keeps the picker's synthetic source node", () => {
    const dag = linearDag([
      { kind: "join", on: ["cell"], how: "inner", rightTableId: "other" } as ReduceStep,
    ]);
    const g = buildGraph(dag, SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    const ji = g.nodes.find((n) => n.phase === "join-input");
    expect(ji?.label).toBe("other");
    expect(ji?.missing).toBe(false);
    expect(edge(g, "source:0", "step:0", "join")).toBeTruthy();
  });

  it("a layer pinned to a non-output node roots its geom edge at that node (2.3 Stage 1)", () => {
    // src -> filter(output). A raw layer pins to the PRE-filter source; a box
    // draws the filtered output. Two lineages overlaid on one figure — the
    // reported raw-vs-filtered case.
    const dag = linearDag([{ kind: "filter", conditions: [] }]); // output = "k0" -> step:0
    const layers: Layer[] = [
      { geom: "dot", level: RAW_LEVEL, nodeId: "src" },  // raw pre-filter dots
      { geom: "box", level: RAW_LEVEL },                 // filtered output (nodeId absent = output)
    ];
    const g = buildGraph(dag, SPINE, PLAN, layers, SCHEMA, null);
    expect(edge(g, "source", "figure", "geom")?.label).toBe("dots");   // pinned to the source
    expect(edge(g, "step:0", "figure", "geom")?.label).toBe("box");    // output's raw grain
  });

  it("a layer pinned to a deleted node drops its edge rather than mis-rooting to the source", () => {
    const dag = linearDag([{ kind: "filter", conditions: [] }]);
    // "ghost" names no node in the dag — the pinned node was removed.
    const layers: Layer[] = [{ geom: "dot", level: RAW_LEVEL, nodeId: "ghost" }];
    const g = buildGraph(dag, SPINE, PLAN, layers, SCHEMA, null);
    // the orphaned layer roots nowhere; the plain output fallback fires (one edge),
    // and crucially it is NOT mis-rooted to the source node.
    expect(g.edges.filter((e) => e.kind === "geom" && e.toId === "figure").length).toBe(1);
    expect(edge(g, "source", "figure", "geom")).toBeUndefined();       // not silently rerouted to source
  });

  it("stamps pinSource on the source and column-preserving upstream steps, not the output or shape-changers", () => {
    // src -> filter(compatible) -> pivot(shape-changer, output). The source and
    // the filter can be overlaid; the pivot (and the output) cannot.
    const dag: ReduceDag = {
      sources: [{ id: "src", tableId: "t" }],
      steps: [
        { kind: "filter", conditions: [], id: "f", inputs: ["src"] },
        { kind: "pivot", column: "k", names: [["a", "a"]], id: "pv", inputs: ["f"] },
      ] as unknown as ReduceDag["steps"],
      output: "pv",
    };
    const g = buildGraph(dag, SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    const pin = (id: string) => g.nodes.find((n) => n.id === id)?.pinSource;
    expect(pin("source")).toBe("src");   // the raw table overlays
    expect(pin("step:0")).toBe("f");     // the filter (column-preserving) overlays
    expect(pin("step:1")).toBeUndefined(); // the pivot is the output AND a shape-changer
  });

  it("does not stamp pinSource on the source when it IS the output (a no-step DAG)", () => {
    const g = buildGraph(linearDag([]), SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    expect(g.nodes.find((n) => n.id === "source")?.pinSource).toBeUndefined();
  });

  it("collapse nodes are keyed by grain; chain runs full-spine -> coarsest", () => {
    const g = buildGraph(linearDag([{ kind: "drop", columns: ["area"] }]), SPINE, PLAN,
      [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    expect(edge(g, "step:0", "grain:experiment/cell")?.kind).toBe("collapse");
    expect(edge(g, "grain:experiment/cell", "grain:experiment")?.kind).toBe("collapse");
    expect(g.nodes.find((n) => n.id === "grain:experiment")?.label).toBe("per Experiment");
  });

  it("each collapse edge carries the white #3 flatten-info guard", () => {
    const g = buildGraph(linearDag([]), SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    const ce = g.edges.find((e) => e.kind === "collapse");
    expect(ce?.guards?.some((gd) => gd.id === "flatten_info" && gd.severity === "info")).toBe(true);
  });

  it("collapse edge label reads as the reduction; identity regroup reads 'group per'", () => {
    const g = buildGraph(linearDag([]), SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    // real collapse: experiment/cell -> experiment removes Cell
    expect(edge(g, "grain:experiment/cell", "grain:experiment")?.label).toBe("mean over Cell");
    // first chain edge keeps the full spine (removes nothing): a regroup, not a collapse
    expect(edge(g, "source", "grain:experiment/cell")?.label).toBe("group per Experiment × Cell");
    // the flatten-info guard is still attached
    expect(edge(g, "grain:experiment/cell", "grain:experiment")
      ?.guards?.some((gd) => gd.id === "flatten_info")).toBe(true);
  });

  it("tags the leading full-spine grain as a regroup candidate; real collapses are not", () => {
    const g = buildGraph(linearDag([]), SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    expect(g.nodes.find((n) => n.id === "grain:experiment/cell")?.regroup).toBe(true);
    expect(g.nodes.find((n) => n.id === "grain:experiment")?.regroup).toBe(false);
  });

  it("reduce-step edges carry the step kind and a count label", () => {
    const steps: ReduceStep[] = [
      { kind: "filter", conditions: [{ column: "area", op: ">", value: 1 },
                                     { column: "area", op: "<", value: 9 }] },
      { kind: "drop", columns: ["area"] },
    ];
    const g = buildGraph(linearDag(steps), SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    expect(edge(g, "source", "step:0")).toMatchObject({ kind: "filter", label: "2 conditions" });
    expect(edge(g, "step:0", "step:1")).toMatchObject({ kind: "drop", label: "Area" });
  });

  it("maps each node to its data-tab fetch strategy", () => {
    const g = buildGraph(linearDag([{ kind: "drop", columns: ["area"] }]), SPINE, PLAN,
      [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n.table]));
    expect(byId["source"]).toEqual({ via: "at_step", at_step: -1 });
    expect(byId["step:0"]).toEqual({ via: "at_step", at_step: 0 });
    expect(byId["grain:experiment/cell"]).toEqual({ via: "grain", grain: "experiment/cell" });
    expect(byId["figure"]).toEqual({ via: "none" });
  });

  it("geom edge per layer into figure; raw reads the last reduce node", () => {
    const steps: ReduceStep[] = [{ kind: "drop", columns: ["area"] }];
    const g = buildGraph(linearDag(steps), SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    expect(edge(g, "step:0", "figure", "geom")).toMatchObject({ kind: "geom", label: "dots" });
  });

  it("SuperPlot: distinct grains/geoms draw distinct geom edges; dups collapse", () => {
    const layers: Layer[] = [
      { geom: "dot", level: RAW_LEVEL },
      { geom: "box", level: "experiment" },
      { geom: "box", level: "experiment" },
    ];
    const g = buildGraph(linearDag([]), SPINE, PLAN, layers, SCHEMA, null);
    const geoms = g.edges.filter((e) => e.kind === "geom");
    expect(geoms).toHaveLength(2);
    expect(edge(g, "source", "figure", "geom")?.label).toBe("dots");
    expect(edge(g, "grain:experiment", "figure", "geom")?.label).toBe("box");
  });

  it("panels (2.3 Stage 2): each panel is its own plot section, geom edges carry the panel", () => {
    const layers: Layer[] = [
      { geom: "box", level: RAW_LEVEL, panel: 0 },   // primary panel
      { geom: "dot", level: RAW_LEVEL, panel: 1 },   // second panel, same source node
    ];
    const g = buildGraph(linearDag([]), SPINE, PLAN, layers, SCHEMA,
      { test: "Welch's t-test", describeOnly: false });
    const fig = g.nodes.find((n) => n.id === "figure")!;
    // two plot sections (one per panel) + the single stats section
    expect(fig.sections).toEqual([
      { kind: "plot", panel: 0, facts: ["box"] },
      { kind: "plot", panel: 1, facts: ["dots"] },
      { kind: "stats", facts: ["Welch's t-test"] },
    ]);
    // two geom edges from the SAME source node, one per panel, distinct ids
    const geoms = g.edges.filter((e) => e.kind === "geom");
    expect(geoms).toHaveLength(2);
    expect(geoms.find((e) => e.panel === 0)).toMatchObject({ id: "g:source", label: "box" });
    expect(geoms.find((e) => e.panel === 1)).toMatchObject({ id: "g:p1:source", label: "dots" });
  });

  it("two geoms at the same grain collapse to one comma-joined edge", () => {
    const layers: Layer[] = [
      { geom: "dot", level: RAW_LEVEL },
      { geom: "box", level: RAW_LEVEL },
    ];
    const g = buildGraph(linearDag([]), SPINE, PLAN, layers, SCHEMA, null);
    const geoms = g.edges.filter((e) => e.kind === "geom");
    expect(geoms).toHaveLength(1);
    expect(geoms[0].label).toBe("dots, box");
    expect(geoms[0].fromId).toBe("source");
  });

  it("skips a geom edge for a level no longer on the spine", () => {
    const g = buildGraph(linearDag([]), ["experiment"], defaultPlan(["experiment"], {}),
      [{ geom: "dot", level: "cell" }], SCHEMA, null);
    const geoms = g.edges.filter((e) => e.kind === "geom");
    expect(geoms).toEqual([{ id: expect.any(String), kind: "geom",
      label: "", fromId: "source", toId: "figure" }]);
  });

  it("test edge runs at the coarsest layer-bound grain, into figure", () => {
    const layers: Layer[] = [
      { geom: "dot", level: RAW_LEVEL },
      { geom: "box", level: "experiment" },
    ];
    const g = buildGraph(linearDag([]), SPINE, PLAN, layers, SCHEMA, { test: "Welch's t-test", describeOnly: false });
    expect(edge(g, "grain:experiment", "figure", "test")).toMatchObject({
      kind: "test", label: "Welch's t-test" });
  });

  it("describe-only -> the test edge reads 'describe'", () => {
    const g = buildGraph(linearDag([]), SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA,
      { test: null, describeOnly: true });
    expect(edge(g, "grain:experiment", "figure", "test")).toMatchObject({ kind: "test", label: "describe" });
  });

  it("nodeIdForGrain: raw -> given raw node; a grain key -> its grain node", () => {
    expect(nodeIdForGrain("", "step:2")).toBe("step:2");
    expect(nodeIdForGrain("experiment/cell", "source")).toBe("grain:experiment/cell");
  });

  it("derive and recode are linear single-edge steps", () => {
    const steps: ReduceStep[] = [
      { kind: "derive", column: "q", expr: "perimeter / sqrt(area)" },
      { kind: "recode", column: "class_label", map: [["negative", "VimentinKO"]] },
    ];
    const g = buildGraph(linearDag(steps), SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    const kinds = g.edges.filter((e) => e.kind === "derive" || e.kind === "recode")
      .map((e) => e.kind);
    expect(kinds).toEqual(["derive", "recode"]);
  });

  it("pivot and grid_complete are linear single-edge steps", () => {
    const steps: ReduceStep[] = [
      { kind: "pivot", index: ["cell"], column: "opp", values: "n",
        agg: "sum", fill: 0, names: [["s", "same"], ["o", "opp"]] },
      { kind: "grid_complete", by: ["experiment"], column: "tt",
        levels: ["a", "b"], fill: 0, count_name: "count" },
    ];
    const g = buildGraph(linearDag(steps), SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    expect(edge(g, "source", "step:0")).toMatchObject({ kind: "pivot", label: "opp → {same, opp}" });
    expect(edge(g, "step:0", "step:1")).toMatchObject({ kind: "grid_complete", label: "Experiment × tt · fill 0" });
    const kinds = g.edges.filter((e) => e.kind === "pivot" || e.kind === "grid_complete")
      .map((e) => e.kind);
    expect(kinds).toEqual(["pivot", "grid_complete"]);
  });

  it("array-op labels: derive shows the expr, single filter inlines the condition", () => {
    const steps: ReduceStep[] = [
      { kind: "filter", conditions: [{ column: "area", op: ">", value: 1 }] },
      { kind: "derive", column: "q", expr: "perimeter / sqrt(area)" },
    ];
    const g = buildGraph(linearDag(steps), SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    expect(edge(g, "source", "step:0")?.label).toBe("Area > 1");
    expect(edge(g, "step:0", "step:1")?.label).toBe("q = perimeter / sqrt(area)");
  });

  it("a join emits a referenced right node and two 'join on <keys>' edges", () => {
    const steps: ReduceStep[] = [{ kind: "join", on: ["cell_id"], how: "inner", rightTableId: "annot" }];
    const g = buildGraph(linearDag(steps), SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    const sources = g.nodes.filter((n) => n.kind === "table" && n.id.startsWith("source"));
    expect(sources.length).toBeGreaterThanOrEqual(2);
    const incoming = g.edges.filter((e) => e.toId === "step:0" && e.kind === "join");
    expect(incoming.length).toBe(2);
    // right node is named for the referenced table id
    expect(g.nodes.find((n) => n.id === "source:0")?.label).toBe("annot");
    // both converging edges state the raw key path
    expect(incoming.every((e) => e.label === "on cell_id")).toBe(true);
    // the join edges carry the RAW on-keys (not the display label) for keyhi matching
    expect(incoming.every((e) => JSON.stringify(e.onKeys) === JSON.stringify(["cell_id"]))).toBe(true);
  });

  it("an UNFILLED join (empty rightTableId) renders its right input as a missing node", () => {
    const steps: ReduceStep[] = [{ kind: "join", on: [], how: "inner", rightTableId: "" }];
    const g = buildGraph(linearDag(steps), SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    const src = g.nodes.find((n) => n.id === "source:0");
    expect(src?.missing).toBe(true);
    expect(src?.label).toBe("drop a table here");
  });

  it("a FILLED join (rightTableId set) is not missing (label = the table name)", () => {
    const steps: ReduceStep[] = [{ kind: "join", on: ["k"], how: "inner", rightTableId: "annot" }];
    const g = buildGraph(linearDag(steps), SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    const src = g.nodes.find((n) => n.id === "source:0");
    expect(src?.missing).toBeFalsy();
    expect(src?.label).toBe("annot");
  });

  it("post-collapse phase: a derive runs after the collapse chain, with the caution badge", () => {
    const post: ReduceStep[] = [{ kind: "derive", column: "enrich", expr: "obs / exp" }];
    const g = buildGraph(linearDag([], post), SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }],
      SCHEMA, null);
    // the post derive hangs off the coarsest grain node (where the test runs)
    const pe = edge(g, "grain:experiment", "post:0");
    expect(pe?.kind).toBe("derive");
    expect(pe?.guards?.[0]?.id).toBe("post_aggregate_derive");
    expect(pe?.guards?.[0]?.severity).toBe("caution");
    // the test edge now reads the post-phase output, not the bare grain
    expect(edge(g, "post:0", "figure", "test")?.kind).toBe("test");
  });

  it("no post phase: the test reads the coarsest grain directly", () => {
    const g = buildGraph(linearDag([]), SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    expect(edge(g, "grain:experiment", "figure", "test")?.kind).toBe("test");
    expect(g.nodes.some((n) => n.id.startsWith("post:"))).toBe(false);
  });

  it("the single figure terminal carries a plot section and a stats section", () => {
    const g = buildGraph(linearDag([]), SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA,
      { test: "Welch's t-test", describeOnly: false });
    const fig = g.nodes.find((n) => n.id === "figure")!;
    expect(fig.kind).toBe("figure");
    expect(fig.sections).toEqual([
      { kind: "plot", panel: 0, facts: ["dots"] },
      { kind: "stats", facts: ["Welch's t-test"] },
    ]);
    expect(g.edges.some((e) => (e.kind as string) === "annotate")).toBe(false);
  });

  it("annotated test marks the stats section, not a back-edge", () => {
    const g = buildGraph(linearDag([]), SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA,
      { test: "Welch's t-test", describeOnly: false, annotate: true });
    const fig = g.nodes.find((n) => n.id === "figure")!;
    expect(fig.sections?.find((s) => s.kind === "stats")?.facts)
      .toEqual(["Welch's t-test", "on figure"]);
    expect(g.edges.some((e) => (e.kind as string) === "annotate")).toBe(false);
  });
});

