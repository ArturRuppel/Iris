import { describe, it, expect } from "vitest";
import { createStore } from "jotai";
import {
  linearizeReduce, dagFromLinear, plottablesAtom, activePlottableIdAtom,
  insertStepAtom, activePlottableAtom, activeReduceDagAtom, reduceStoreAtom,
  makeDefaultPlottable, dagView, poolFor, SHARED_SRC,
  connectInputAtom, branchStepAtom, resolveSaveDag, plottableFromSpec,
} from "./state";
import type { ReduceStepNode, ReduceDag, AnalysisSpec } from "./types";

/* a plottable whose reduce fans src out to a derive branch, then joins the branch
   back in through a WIRED right input (inputs[1]), not the picker. */
function wiredJoinDag(): ReduceDag {
  return {
    sources: [{ id: "src", tableId: "t" }],
    steps: [
      { kind: "derive", column: "b", expr: "x*2", id: "branch", inputs: ["src"], _key: "kb" },
      { kind: "join", on: ["cell"], how: "inner", rightTableId: "", id: "j",
        inputs: ["src", "branch"], _key: "kj" },
    ] as unknown as ReduceStepNode[],
    output: "j",
  };
}

describe("reduce DAG adapters", () => {
  it("dagFromLinear chains inputs and sets output to the last step", () => {
    const steps = [
      { kind: "filter", conditions: [], _key: "k0" },
      { kind: "derive", column: "y", expr: "x+1", _key: "k1" },
    ] as unknown as ReduceStepNode[];
    const dag = dagFromLinear("tbl", steps);
    expect(dag.sources).toEqual([{ id: "src", tableId: "tbl" }]);
    expect(dag.steps[0].inputs).toEqual(["src"]);
    expect(dag.steps[1].inputs).toEqual([dag.steps[0].id]);
    expect(dag.output).toBe(dag.steps[1].id);
  });

  it("linearize returns steps in topo order for a straight chain", () => {
    const dag = dagFromLinear("tbl", [
      { kind: "filter", conditions: [], _key: "k0" },
      { kind: "drop", columns: [], _key: "k1" },
    ] as unknown as ReduceStepNode[]);
    expect(linearizeReduce(dag).map((s) => s.kind)).toEqual(["filter", "drop"]);
  });
});

describe("a plottable's reduce is a VIEW onto its table's shared pool", () => {
  it("a fresh plottable pins to the source; its view is the degenerate single-source DAG", () => {
    const p = makeDefaultPlottable("tbl");
    expect(p.output).toBe(SHARED_SRC);
    // with no pool entry yet, the reconstructed view is the full table (no steps).
    expect(dagView(poolFor({}, "tbl"), p)).toEqual(
      { sources: [{ id: "src", tableId: "tbl" }], steps: [], output: "src" });
  });

  it("insertStep appends a node chained to its predecessor", () => {
    const store = createStore();
    const p = makeDefaultPlottable("tbl");
    store.set(plottablesAtom, [p]);
    store.set(activePlottableIdAtom, p.id);
    store.set(insertStepAtom, { afterId: "src", kind: "filter" });
    const dag = store.get(activeReduceDagAtom)!;
    expect(dag.steps).toHaveLength(1);
    expect(dag.steps[0].inputs).toEqual(["src"]);
    expect(dag.output).toBe(dag.steps[0].id);
    // the node physically lives in the table's shared pool.
    expect(store.get(reduceStoreAtom)["tbl"].steps).toHaveLength(1);
  });
});

describe("Phase D authoring: connect, branch, round-trip", () => {
  // seed the plottable's pin (output/post) plus its table's shared pool from a
  // whole ReduceDag, mirroring how a loaded doc lands in the store.
  function seed(reduce: ReduceDag) {
    const store = createStore();
    const p = { ...makeDefaultPlottable("t"), output: reduce.output,
      ...(reduce.post?.length ? { post: reduce.post } : {}) };
    store.set(plottablesAtom, [p]);
    store.set(activePlottableIdAtom, p.id);
    store.set(reduceStoreAtom, { t: { sources: reduce.sources, steps: reduce.steps } });
    return store;
  }

  it("connectInput wires a join's right input (slot 1) and clears the picker", () => {
    const store = seed({
      sources: [{ id: "src", tableId: "t" }],
      steps: [
        { kind: "derive", column: "b", expr: "x*2", id: "branch", inputs: ["src"], _key: "kb" },
        { kind: "join", on: ["cell"], how: "inner", rightTableId: "picked", id: "j",
          inputs: ["src"], _key: "kj" },
      ] as unknown as ReduceStepNode[],
      output: "j",
    });
    store.set(connectInputAtom, { targetId: "j", sourceId: "branch", slot: 1 });
    const j = store.get(activeReduceDagAtom)!.steps.find((s) => s.id === "j")!;
    expect(j.inputs).toEqual(["src", "branch"]);
    expect((j as { rightTableId: string }).rightTableId).toBe("");   // wire supersedes picker
  });

  it("connectInput no-ops a wire that would form a cycle", () => {
    const store = seed(wiredJoinDag());
    // branch already depends (via src) on nothing downstream of j; but wiring
    // branch's input to j WOULD cycle (j depends on branch).
    store.set(connectInputAtom, { targetId: "branch", sourceId: "j", slot: 0 });
    const branch = store.get(activeReduceDagAtom)!.steps.find((s) => s.id === "branch")!;
    expect(branch.inputs).toEqual(["src"]);   // unchanged
  });

  it("branchStep adds a fan-out node to the shared pool without moving output", () => {
    const store = seed({
      sources: [{ id: "src", tableId: "t" }],
      steps: [{ kind: "derive", column: "a", expr: "x", id: "a", inputs: ["src"], _key: "ka" }] as unknown as ReduceStepNode[],
      output: "a",
    });
    store.set(branchStepAtom, { fromId: "src", kind: "filter" });
    // the fan-out node lands in the table POOL, but — being unreachable from this
    // plottable's output ("a") — it's a dead branch invisible to the reduce VIEW
    // until a later slice wires it back in (Stage-2 reachable-slice semantics).
    const pool = store.get(reduceStoreAtom)["t"];
    expect(pool.steps).toHaveLength(2);
    expect(pool.steps.filter((s) => s.inputs[0] === "src")).toHaveLength(2);   // fan-out in the pool
    expect(store.get(activeReduceDagAtom)!.steps).toHaveLength(1);             // view excludes the dead branch
    expect(store.get(activePlottableAtom)!.output).toBe("a");                  // unchanged
  });

  it("resolveSaveDag emits a wired join with two real inputs and no synthetic right source", () => {
    const eng = resolveSaveDag(wiredJoinDag());
    const j = eng.nodes.find((n) => n.id === "j")!;
    expect((j as { inputs: string[] }).inputs).toEqual(["src", "branch"]);
    expect(eng.nodes.some((n) => n.id.endsWith("__right"))).toBe(false);
  });

  function specWith(reduceNodes: unknown[], output: string): AnalysisSpec {
    return {
      spec_version: "2.2", id: "p1", title: "A", table_id: "t",
      sources: [{ id: "src", table_id: "t" }],
      reduce: { nodes: reduceNodes, output },
      encodings: {}, facet: undefined, layers: [], stats: null,
    } as unknown as AnalysisSpec;
  }

  it("round-trips a WIRED join through plottableFromSpec (inputs[1] preserved)", () => {
    const spec = specWith([
      { id: "src", kind: "source", table_id: "t" },
      { id: "branch", kind: "step", inputs: ["src"], step: { kind: "derive", column: "b", expr: "x*2" } },
      { id: "j", kind: "step", inputs: ["src", "branch"], step: { kind: "join", on: ["cell"], how: "inner" } },
    ], "j");
    const dag = plottableFromSpec(spec).dag;
    const j = dag.steps.find((s) => s.id === "j")!;
    expect(j.inputs).toEqual(["src", "branch"]);
    expect((j as { rightTableId: string }).rightTableId).toBe("");
    expect(dag.steps.some((s) => s.id === "branch")).toBe(true);
  });

  it("round-trips a PICKER join through plottableFromSpec (synthetic source folds to rightTableId)", () => {
    const spec = specWith([
      { id: "src", kind: "source", table_id: "t" },
      { id: "j__right", kind: "source", table_id: "other" },
      { id: "j", kind: "step", inputs: ["src", "j__right"], step: { kind: "join", on: ["cell"], how: "inner" } },
    ], "j");
    const dag = plottableFromSpec(spec).dag;
    expect(dag.sources).toEqual([{ id: "src", tableId: "t" }]);   // synthetic right dropped
    const j = dag.steps.find((s) => s.id === "j")!;
    expect(j.inputs).toEqual(["src"]);
    expect((j as { rightTableId: string }).rightTableId).toBe("other");
  });
});
