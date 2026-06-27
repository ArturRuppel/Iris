import { describe, it, expect } from "vitest";
import type { ExplorerNode } from "../explorer/graph";
import { affordances, isValidDropTarget, stepIndexOf, authorDispatch } from "./authoring";

const tableNode = (id: string): ExplorerNode =>
  ({ id, kind: "table", label: id, table: { via: "none" } });
const term = (id: string, kind: "plot" | "stats"): ExplorerNode =>
  ({ id, kind, label: id, table: { via: "none" } });

const actions = (n: ExplorerNode) => affordances(n).map((o) => o.action);

describe("affordances — the phase-keyed add menu", () => {
  it("a reduce-stage node (source / step:i) offers every reduce kind plus the terminals", () => {
    for (const id of ["source", "step:0", "step:3"]) {
      const acts = actions(tableNode(id));
      const reduceKinds = acts.filter((a) => a.kind === "reduce")
        .map((a) => (a.kind === "reduce" ? a.step : null));
      expect(reduceKinds).toEqual(
        ["filter", "drop", "derive", "recode", "join", "pivot", "grid_complete"]);
      expect(acts.some((a) => a.kind === "collapse")).toBe(true);
      expect(acts.some((a) => a.kind === "geom")).toBe(true);
      expect(acts.some((a) => a.kind === "test")).toBe(true);
    }
  });

  it("a grain node offers the terminals only (no reduce kinds)", () => {
    const acts = actions(tableNode("grain:experiment"));
    expect(acts.some((a) => a.kind === "reduce")).toBe(false);
    expect(acts.map((a) => a.kind)).toEqual(["collapse", "geom", "test"]);
  });

  it("a join-input node (source:i) offers nothing — its + is the missing circle", () => {
    expect(affordances(tableNode("source:2"))).toEqual([]);
  });

  it("a post-collapse node (post:i) offers nothing — post authoring is out of scope", () => {
    // a post:i node is reduce-shaped but lives in reduce.post; offering reduce
    // kinds here would misroute insertStepAtom into reduce.steps.
    expect(affordances(tableNode("post:0"))).toEqual([]);
  });

  it("terminals offer nothing (sinks emit no forward edge)", () => {
    expect(affordances(term("plot", "plot"))).toEqual([]);
    expect(affordances(term("stats", "stats"))).toEqual([]);
  });

  it("every option carries a non-empty label", () => {
    for (const o of affordances(tableNode("source"))) expect(o.label).toBeTruthy();
  });
});

describe("isValidDropTarget — drag-to-node is the binary (join) case", () => {
  it("accepts another data table", () => {
    expect(isValidDropTarget("step:0", tableNode("step:1"))).toBe(true);
  });
  it("rejects itself", () => {
    expect(isValidDropTarget("step:0", tableNode("step:0"))).toBe(false);
  });
  it("rejects terminals", () => {
    expect(isValidDropTarget("step:0", term("plot", "plot"))).toBe(false);
    expect(isValidDropTarget("step:0", term("stats", "stats"))).toBe(false);
  });
});

describe("stepIndexOf — where a node's + inserts after", () => {
  it("the root source is -1 (insert at 0)", () => {
    expect(stepIndexOf("source")).toBe(-1);
  });
  it("a step:i node is i", () => {
    expect(stepIndexOf("step:0")).toBe(0);
    expect(stepIndexOf("step:3")).toBe(3);
  });
});

describe("authorDispatch — a +-pick resolves to its atom call", () => {
  it("a reduce action splices after this node's step index", () => {
    expect(authorDispatch("step:1", { kind: "reduce", step: "derive" }))
      .toEqual({ atom: "insertStep", arg: { afterIndex: 1, kind: "derive" } });
  });
  it("a reduce action on the root source inserts at 0 (afterIndex -1)", () => {
    expect(authorDispatch("source", { kind: "reduce", step: "filter" }))
      .toEqual({ atom: "insertStep", arg: { afterIndex: -1, kind: "filter" } });
  });
  it("geom/collapse/test open their terminal editor card", () => {
    expect(authorDispatch("step:0", { kind: "geom" }))
      .toMatchObject({ atom: "openCard", arg: { cardKind: "geom-editor" } });
    expect(authorDispatch("grain:cell", { kind: "collapse" }))
      .toMatchObject({ atom: "openCard", arg: { cardKind: "collapse-editor" } });
    expect(authorDispatch("step:0", { kind: "test" }))
      .toMatchObject({ atom: "openCard", arg: { cardKind: "test-editor" } });
  });
});
