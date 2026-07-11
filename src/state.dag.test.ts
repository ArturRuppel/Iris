import { describe, it, expect } from "vitest";
import { createStore } from "jotai";
import {
  linearizeReduce, dagFromLinear, plottablesAtom, activePlottableIdAtom,
  insertStepAtom, activePlottableAtom, makeDefaultPlottable,
} from "./state";
import type { ReduceStepNode } from "./types";

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

describe("Plottable.reduce is a DAG", () => {
  it("a fresh plottable carries the degenerate single-source DAG", () => {
    const p = makeDefaultPlottable("tbl");
    expect(p.reduce).toEqual({ sources: [{ id: "src", tableId: "tbl" }], steps: [], output: "src" });
  });

  it("insertStep appends a node chained to its predecessor", () => {
    const store = createStore();
    const p = makeDefaultPlottable("tbl");
    store.set(plottablesAtom, [p]);
    store.set(activePlottableIdAtom, p.id);
    store.set(insertStepAtom, { afterId: "src", kind: "filter" });
    const dag = store.get(activePlottableAtom)!.reduce;
    expect(dag.steps).toHaveLength(1);
    expect(dag.steps[0].inputs).toEqual(["src"]);
    expect(dag.output).toBe(dag.steps[0].id);
  });
});
