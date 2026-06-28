import { describe, it, expect } from "vitest";
import { nodeDeltas } from "./nodeDelta";
import type { ExplorerGraph } from "../explorer/graph";
import type { AxisDesc, ValueDesc } from "../types";

const ax = (name: string): AxisDesc => ({ name, n_levels: 3, ragged: false });
const val = (name: string, type = "numeric"): ValueDesc => ({ name, type, grain: null });

/* source(E,P,C,F; v) -> derive(+value) -> join(+class_label) ->
   collapse over F -> collapse over C, plus a stats terminal. */
const graph = (): ExplorerGraph => ({
  spine: ["E", "P", "C", "F"],
  nodes: [
    { id: "source", kind: "table", phase: "source", label: "Source", table: { via: "at_step", at_step: -1 },
      count: { rows: 9, cols: 5, axes: [ax("E"), ax("P"), ax("C"), ax("F")], values: [val("v")] } },
    { id: "d", kind: "table", phase: "reduce", label: "Derived", table: { via: "at_step", at_step: 0 },
      count: { rows: 9, cols: 6, axes: [ax("E"), ax("P"), ax("C"), ax("F")], values: [val("v"), val("value")] } },
    { id: "src:0", kind: "table", phase: "join-input", label: "T2", table: { via: "none" },
      count: { rows: 9, cols: 4, axes: [ax("E"), ax("P"), ax("C")], values: [val("class_label", "categorical")] } },
    { id: "j", kind: "table", phase: "reduce", label: "Joined", table: { via: "at_step", at_step: 1 },
      count: { rows: 9, cols: 6, axes: [ax("E"), ax("P"), ax("C"), ax("F")], values: [val("value"), val("class_label", "categorical")] } },
    { id: "c1", kind: "table", phase: "grain", dims: ["E", "P", "C"], label: "per E×P×C", table: { via: "none" },
      count: { rows: 6, cols: 4, axes: [ax("E"), ax("P"), ax("C")], values: [val("value")] } },
    { id: "c2", kind: "table", phase: "grain", dims: ["E", "P"], label: "per E×P", table: { via: "none" },
      count: { rows: 4, cols: 3, axes: [ax("E"), ax("P")], values: [val("value")] } },
    { id: "figure", kind: "figure", phase: "terminal", label: "Figure", table: { via: "none" } },
  ],
  edges: [
    { id: "e:d", kind: "derive", label: "value = v", fromId: "source", toId: "d" },
    { id: "e:j1", kind: "join", label: "on E,P", fromId: "d", toId: "j" },
    { id: "e:j2", kind: "join", label: "on E,P", fromId: "src:0", toId: "j" },
    { id: "e:c1", kind: "collapse", label: "median over F", fromId: "j", toId: "c1" },
    { id: "e:c2", kind: "collapse", label: "median over C", fromId: "c1", toId: "c2" },
    { id: "t:test", kind: "test", label: "paired t-test", fromId: "c2", toId: "figure" },
  ],
});

describe("nodeDeltas", () => {
  it("exposes the graph spine (the finest-grain axis order) on each node's delta", () => {
    const d = nodeDeltas(graph()).get("source")!;
    expect(d.spine).toEqual(["E", "P", "C", "F"]);
  });

  it("marks a collapse step's shed level (predecessor had it, this node doesn't)", () => {
    const m = nodeDeltas(graph());
    expect(m.get("c1")!.shed).toEqual(["F"]); // collapsed over frame
    expect(m.get("c1")!.live).toEqual(["E", "P", "C"]);
    expect(m.get("c2")!.shed).toEqual(["C"]); // collapsed over cell
    expect(m.get("c2")!.live).toEqual(["E", "P"]);
  });

  it("sheds nothing on non-collapse steps", () => {
    const m = nodeDeltas(graph());
    expect(m.get("d")!.shed).toEqual([]);
    expect(m.get("j")!.shed).toEqual([]);
  });

  it("a terminal (no axes of its own) sheds nothing and stays grain-less", () => {
    const s = nodeDeltas(graph()).get("figure")!;
    expect(s.live).toEqual([]);
    expect(s.shed).toEqual([]); // does NOT 'shed' the levels it inherited
  });

  it("flags values a step introduces", () => {
    const m = nodeDeltas(graph());
    expect(m.get("d")!.newValues).toEqual(["value"]);       // derive adds value
    expect(m.get("j")!.newValues).toEqual(["class_label"]); // join brings class_label
    expect(m.get("c1")!.newValues).toEqual([]);             // collapse adds nothing
  });

  it("picks the main-chain input as the primary incoming edge, not the join's source: input", () => {
    const j = nodeDeltas(graph()).get("j")!;
    expect(j.inEdge?.id).toBe("e:j1");
    expect(j.inEdge?.kind).toBe("join");
  });

  it("leaves the root source with no incoming edge", () => {
    expect(nodeDeltas(graph()).get("source")!.inEdge).toBeUndefined();
  });
});
