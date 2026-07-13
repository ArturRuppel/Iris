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
const term = (id: string): ExplorerNode =>
  ({ id, kind: "figure", phase: "terminal", label: id, table: { via: "none" } });

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
    expect(affordances(term("figure"))).toEqual([]);
  });

  it("every option carries a non-empty label", () => {
    for (const o of affordances(tableNode("source"))) expect(o.label).toBeTruthy();
  });

  it("an overlay-compatible upstream node (pinSource) offers 'Add to plot' carrying its node id", () => {
    const node = { ...tableNode("step:0"), pinSource: "k0" };
    const opts = affordances(node);
    const geom = opts.find((o) => o.action.kind === "geom");
    expect(geom?.label).toBe("Add to plot");
    expect(geom?.action).toEqual({ kind: "geom", pinNodeId: "k0" });
    // collapse/stats stay the primary-editing terminals (a test names one node)
    expect(opts.find((o) => o.action.kind === "collapse")?.label).toBe("Collapse");
  });

  it("a node without a pinSource still offers the plain 'Plot (geom)' primary editor", () => {
    const geom = affordances(tableNode("step:0")).find((o) => o.action.kind === "geom");
    expect(geom?.label).toBe("Plot (geom)");
    expect(geom?.action).toEqual({ kind: "geom" });
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
  it("a geom action carrying a pinNodeId adds a layer pinned to that node", () => {
    expect(authorDispatch(0, { kind: "geom", pinNodeId: "k0" }))
      .toEqual({ atom: "addLayerAtNode", arg: { nodeId: "k0" } });
  });
});
