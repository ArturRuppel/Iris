import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { targetToCardKind, CARD_BODIES, type CardKind } from "./cardRegistry";
import type { ExplorerGraph } from "../explorer/graph";

const graph: ExplorerGraph = {
  nodes: [
    { id: "source", kind: "table", label: "Source", table: { via: "at_step", at_step: -1 } },
    { id: "plot", kind: "plot", label: "Plot", table: { via: "none" } },
    { id: "stats", kind: "stats", label: "Stats", table: { via: "none" } },
  ],
  edges: [
    { id: "e0", kind: "filter", label: "mask", fromId: "source", toId: "plot" },
    { id: "c0", kind: "collapse", label: "mean", fromId: "source", toId: "plot" },
    { id: "g0", kind: "geom", label: "dots", fromId: "source", toId: "plot" },
    { id: "t0", kind: "test", label: "MW", fromId: "source", toId: "stats" },
    { id: "a0", kind: "annotate", label: "significance", fromId: "stats", toId: "plot" },
  ],
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

  it("renders a stub body that identifies its kind", () => {
    const Body = CARD_BODIES["test-editor"];
    render(<Body target={{ kind: "edge", id: "t0" }} />);
    expect(screen.getByTestId("card-stub").dataset.cardKind).toBe("test-editor");
  });

  it("wires real (non-stub) bodies for the five Phase-4 card kinds", () => {
    const realKinds: CardKind[] = ["table", "plot", "stats", "op-editor",
      "collapse-editor", "geom-editor", "annotate-editor"];
    for (const kind of realKinds) {
      // the real components require app atoms; here we only assert identity, not
      // a deep render — the body must NOT be the shared stub factory output
      // (whose inner fn is named "StubBody"; see the `stub` factory in cardRegistry.tsx).
      expect(CARD_BODIES[kind].name).not.toBe("StubBody");
    }
  });

  it("keeps test-editor as a stub (deferred to Phase 4b)", () => {
    for (const k of ["test-editor"] as CardKind[]) {
      expect(CARD_BODIES[k].name).toBe("StubBody");
    }
  });
});
