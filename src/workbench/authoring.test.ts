import { describe, it, expect } from "vitest";
import type { ExplorerNode, NodePhase } from "../explorer/graph";
import { affordances, authorDispatch } from "./authoring";

/* affordances/phaseOf read node.phase; derive it from the conventional id so the
   fixtures stay readable as "the node with this id". */
const phaseOfId = (id: string): NodePhase =>
  id === "source" ? "source"
    : id.startsWith("source:") ? "join-input"
    : id.startsWith("grain:") ? "grain"
    : id.startsWith("post:") ? "post"
    : "reduce";   // step:i (and any plain reduce node)
const tableNode = (id: string): ExplorerNode =>
  ({ id, kind: "table", phase: phaseOfId(id), label: id, table: { via: "none" } });
const term = (id: string, kind: "plot" | "stats"): ExplorerNode =>
  ({ id, kind, phase: "terminal", label: id, table: { via: "none" } });

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

describe("authorDispatch — a +-pick resolves to its atom call", () => {
  it("a reduce action splices after the given step index", () => {
    expect(authorDispatch(1, { kind: "reduce", step: "derive" }))
      .toEqual({ atom: "insertStep", arg: { afterIndex: 1, kind: "derive" } });
  });
  it("a reduce action from the root source (index -1) inserts at 0", () => {
    expect(authorDispatch(-1, { kind: "reduce", step: "filter" }))
      .toEqual({ atom: "insertStep", arg: { afterIndex: -1, kind: "filter" } });
  });
  it("geom/collapse/test open their terminal editor card (index ignored)", () => {
    expect(authorDispatch(0, { kind: "geom" }))
      .toMatchObject({ atom: "openCard", arg: { cardKind: "geom-editor" } });
    expect(authorDispatch(0, { kind: "collapse" }))
      .toMatchObject({ atom: "openCard", arg: { cardKind: "collapse-editor" } });
    expect(authorDispatch(0, { kind: "test" }))
      .toMatchObject({ atom: "openCard", arg: { cardKind: "test-editor" } });
  });
});
