import { describe, it, expect } from "vitest";
import { linearizeReduce, dagFromLinear } from "./state";
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
