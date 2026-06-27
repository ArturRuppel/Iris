import { describe, it, expect } from "vitest";
import type { ExplorerNode } from "../explorer/graph";
import { affordances, isValidDropTarget } from "./authoring";

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
