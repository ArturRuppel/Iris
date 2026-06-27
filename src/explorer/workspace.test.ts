import { describe, it, expect } from "vitest";
import { buildGraph } from "./graph";
import { buildWorkspaceModel } from "./workspace";
import type { Layer, ReduceStep, Schema } from "../types";
import { RAW_LEVEL } from "../types";
import { defaultPlan } from "../collapse";

const SCHEMA = { schema_version: "1.0", columns: [
  { name: "experiment", label: "Experiment", type: "identifier" },
  { name: "cell", label: "Cell", type: "identifier" },
  { name: "area", label: "Area", type: "numeric" },
] } as unknown as Schema;
const SPINE = ["experiment", "cell"];
const PLAN = defaultPlan(SPINE, {});

/* attach a minimal descriptor to nodes the way explorerGraphAtom would, so the
   model can compute removed axes. */
function withCounts(g: ReturnType<typeof buildGraph>) {
  const axesFull = [
    { name: "experiment", n_levels: 3, ragged: false },
    { name: "cell", n_levels: 122, ragged: false },
  ];
  return {
    ...g,
    nodes: g.nodes.map((n) => {
      if (n.id === "grain:experiment") {
        return { ...n, count: { rows: 3, cols: 1, axes: axesFull.slice(0, 1), values: [] } };
      }
      if (n.kind === "table") {
        return { ...n, count: { rows: 99, cols: 3, axes: axesFull, values: [
          { name: "area", type: "numeric", grain: null }] } };
      }
      return n;
    }),
  };
}

describe("buildWorkspaceModel", () => {
  it("walks the main spine source→…→grain, attaching each node's in-edge op label", () => {
    const g = buildGraph([{ kind: "drop", columns: ["area"] }], SPINE, PLAN,
      [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    const m = buildWorkspaceModel(withCounts(g));
    const ids = m.spine.map((s) => s.node.id);
    expect(ids[0]).toBe("source");
    expect(ids).toContain("grain:experiment");
    const grain = m.spine.find((s) => s.node.id === "grain:experiment")!;
    expect(grain.inEdge?.kind).toBe("collapse");
    expect(grain.inEdge?.op).toBe("mean over Cell");
  });

  it("computes removed axes from the parent for a collapse node", () => {
    const g = buildGraph([], SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    const m = buildWorkspaceModel(withCounts(g));
    const grain = m.spine.find((s) => s.node.id === "grain:experiment")!;
    expect(grain.removed).toEqual(["cell"]);
  });

  it("attaches a join's right input + RAW on-keys (matching axis names) to the hub", () => {
    const g = buildGraph([{ kind: "join", on: ["cell"], how: "inner", rightTableId: "annot" }], SPINE, PLAN,
      [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
    const m = buildWorkspaceModel(withCounts(g));
    const join = m.spine.find((s) => s.node.kind === "table" && s.rightInput)!;
    expect(join.rightInput?.id).toBe("source:0");
    // RAW column name (matches AxisDesc.name), NOT the display label "Cell"
    expect(join.onKeys).toEqual(["cell"]);
    // cross-namespace check: an axis the node actually carries is highlighted
    expect(join.node.axes.some((a) => a.name === "cell" && join.onKeys!.includes(a.name))).toBe(true);
    expect(m.spine.some((s) => s.node.id === "source:0")).toBe(false);
  });

  it("collects the terminal fork: plot + stats with their incoming branch edges", () => {
    const g = buildGraph([], SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA,
      { test: "Welch's t-test", describeOnly: false });
    const m = buildWorkspaceModel(withCounts(g));
    const plot = m.fork.find((f) => f.terminal.kind === "plot")!;
    expect(plot.edges.some((e) => e.kind === "geom")).toBe(true);
    const stats = m.fork.find((f) => f.terminal.kind === "stats")!;
    expect(stats.edges.some((e) => e.kind === "test" && e.op === "Welch's t-test")).toBe(true);
  });
});
