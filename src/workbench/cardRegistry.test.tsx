import { describe, it, expect } from "vitest";
import { targetToCardKind, CARD_BODIES, type CardKind } from "./cardRegistry";
import type { ExplorerGraph } from "../explorer/graph";

const graph: ExplorerGraph = {
  nodes: [
    { id: "source", kind: "table", phase: "source", label: "Source", table: { via: "at_step", at_step: -1 } },
    { id: "plot", kind: "plot", phase: "terminal", label: "Plot", table: { via: "none" } },
    { id: "stats", kind: "stats", phase: "terminal", label: "Stats", table: { via: "none" } },
  ],
  edges: [
    { id: "e0", kind: "filter", label: "mask", fromId: "source", toId: "plot" },
    { id: "c0", kind: "collapse", label: "mean", fromId: "source", toId: "plot" },
    { id: "g0", kind: "geom", label: "dots", fromId: "source", toId: "plot" },
    { id: "t0", kind: "test", label: "MW", fromId: "source", toId: "stats" },
    { id: "a0", kind: "annotate", label: "significance", fromId: "stats", toId: "plot" },
  ],
  spine: [],
};

describe("targetToCardKind", () => {
  it("maps data/plot/stats nodes to their card kinds", () => {
    expect(targetToCardKind(graph, { kind: "node", id: "source" })).toBe("table");
    expect(targetToCardKind(graph, { kind: "node", id: "plot" })).toBe("plot");
    expect(targetToCardKind(graph, { kind: "node", id: "stats" })).toBe("stats");
  });

  it("maps each edge kind to its editor card", () => {
    expect(targetToCardKind(graph, { kind: "edge", id: "e0" })).toBe("op-editor");
    expect(targetToCardKind(graph, { kind: "edge", id: "c0" })).toBe("collapse-editor");
    expect(targetToCardKind(graph, { kind: "edge", id: "g0" })).toBe("geom-editor");
    expect(targetToCardKind(graph, { kind: "edge", id: "t0" })).toBe("test-editor");
    expect(targetToCardKind(graph, { kind: "edge", id: "a0" })).toBe("annotate-editor");
  });

  it("returns null for an id that is not in the graph", () => {
    expect(targetToCardKind(graph, { kind: "node", id: "nope" })).toBeNull();
    expect(targetToCardKind(graph, { kind: "edge", id: "nope" })).toBeNull();
  });
});

describe("CARD_BODIES", () => {
  const kinds: CardKind[] = ["table", "op-editor", "collapse-editor",
    "geom-editor", "test-editor", "annotate-editor", "plot", "stats"];

  it("has a body component for every card kind", () => {
    for (const k of kinds) expect(CARD_BODIES[k]).toBeTypeOf("function");
  });

  it("wires real (non-stub) bodies for every card kind", () => {
    // every kind now has a real component — no stubs remain.
    for (const kind of kinds) {
      // the real components require app atoms; here we only assert identity, not
      // a deep render — the body must NOT be a shared stub factory output.
      expect(CARD_BODIES[kind].name).not.toBe("StubBody");
    }
  });
});
