import { describe, it, expect } from "vitest";
import { nodeDeltas } from "./nodeDelta";
import { buildGraph, type NodeCount } from "../explorer/graph";
import { pruneIdentityGrains } from "../explorer/graphAtom";
import { defaultPlan } from "../collapse";
import { RAW_LEVEL } from "../types";
import type { AxisDesc, Schema, ReduceDag, ReduceStep } from "../types";

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

/* Regression: after pruneIdentityGrains drops the leading full-spine regroup, the
   first real collapse is rewired onto the source. Its shed level must still light
   (e.g. the innermost `frame`) — it is read from the collapse plan (node.dims),
   not the source's /shape_counts axes, which can omit a level the plan still pools.
   Before the fix this first collapse rendered "calm" with no shed highlight while
   the downstream collapses (cell, position) lit correctly. */

const ax = (name: string): AxisDesc => ({ name, n_levels: 3, ragged: false });
const cnt = (rows: number, axes: string[]): NodeCount => ({
  rows, cols: axes.length + 1,
  axes: axes.map(ax), values: [{ name: "value", type: "numeric", grain: null }],
});

const SCHEMA = { schema_version: "1.0", columns: [
  { name: "E", label: "Experiment", type: "identifier" },
  { name: "P", label: "Position", type: "identifier" },
  { name: "C", label: "Cell", type: "identifier" },
  { name: "F", label: "Frame", type: "identifier" },
  { name: "value", label: "Value", type: "numeric" },
] } as unknown as Schema;
const SPINE = ["E", "P", "C", "F"];

/* source -> [regroup E/P/C/F] -> E/P/C -> E/P -> E, the default prefix chain. */
function prunedDeltas() {
  const join = { kind: "join" as const, on: ["C"], how: "inner" as const, rightTableId: "labels" };
  const g = buildGraph(linearDag([join]), SPINE, defaultPlan(SPINE, {}),
    [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
  // counts with axes; the source is one-row-per-frame, so the regroup grain's row
  // count equals the source's and the prune fires, rewiring E/P/C onto the join.
  // NB the materialized axes keep reporting the innermost `F` in every collapsed
  // grain (the real /shape_counts quirk) — the bar must fade it via the plan dims,
  // not these axes, so these counts deliberately leave F in.
  const counts: Record<string, NodeCount> = {
    source: cnt(72, ["E", "P", "C", "F"]),
    "step:0": cnt(72, ["E", "P", "C", "F"]),
    "grain:E/P/C/F": cnt(72, ["E", "P", "C", "F"]),
    "grain:E/P/C": cnt(24, ["E", "P", "C", "F"]),
    "grain:E/P": cnt(6, ["E", "P", "F"]),
    "grain:E": cnt(3, ["E", "F"]),
  };
  let nodes = g.nodes.map((n) => (counts[n.id] ? { ...n, count: counts[n.id] } : n));
  let edges = g.edges;
  ({ nodes, edges } = pruneIdentityGrains(nodes, edges, counts));
  return nodeDeltas({ ...g, nodes, edges });
}

/* the class ArrayShapeNode paints each spine segment: shed wins, then live, else
   'gone' (the faint, already-pooled state). Mirrors the component's branch so the
   test asserts the actual rendered bar, not just the raw sets. */
function bar(d: { spine: string[]; live: string[]; shed: string[] }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const lvl of d.spine) {
    out[lvl] = d.shed.includes(lvl) ? "shed" : d.live.includes(lvl) ? "live" : "gone";
  }
  return out;
}

describe("nodeDeltas through the identity-grain prune", () => {
  it("the first collapse (median over frame) sheds F, carries E P C", () => {
    expect(bar(prunedDeltas().get("grain:E/P/C")!))
      .toEqual({ E: "live", P: "live", C: "live", F: "shed" });
  });

  it("downstream collapses shed their level while finer levels fade to 'gone'", () => {
    const m = prunedDeltas();
    // cell: C lit, F already pooled -> faint (NOT live, the bug this guards)
    expect(bar(m.get("grain:E/P")!))
      .toEqual({ E: "live", P: "live", C: "shed", F: "gone" });
    // position: P lit, C and F faint
    expect(bar(m.get("grain:E")!))
      .toEqual({ E: "live", P: "shed", C: "gone", F: "gone" });
  });

  it("the source carries the full spine and sheds nothing (calm)", () => {
    expect(bar(prunedDeltas().get("source")!))
      .toEqual({ E: "live", P: "live", C: "live", F: "live" });
  });
});
