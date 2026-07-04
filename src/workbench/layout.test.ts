import { describe, it, expect } from "vitest";
import { layoutGraph, COL_GAP } from "./layout";
import type { ExplorerGraph } from "../explorer/graph";

/* a minimal linear pipeline: source → step:0 → figure (both geom + test edges
   converge on the single figure terminal). Hand-built so the layout is isolated
   from buildGraph. */
const forkGraph = (): ExplorerGraph => ({
  nodes: [
    { id: "source", kind: "table", phase: "source", label: "Source", table: { via: "at_step", at_step: -1 } },
    { id: "step:0", kind: "table", phase: "reduce", label: "filtered", table: { via: "at_step", at_step: 0 } },
    { id: "figure", kind: "figure", phase: "terminal", label: "Figure", table: { via: "none" } },
  ],
  edges: [
    { id: "e0", kind: "filter", label: "mask", fromId: "source", toId: "step:0" },
    { id: "g0", kind: "geom", label: "dots", fromId: "step:0", toId: "figure" },
    { id: "t0", kind: "test", label: "MW", fromId: "step:0", toId: "figure" },
  ],
  spine: [],
});

const at = (L: ReturnType<typeof layoutGraph>, id: string) => L.nodes.find((n) => n.id === id)!;

describe("layoutGraph", () => {
  it("ranks the chain left->right by longest forward path (x = rank * COL_GAP)", () => {
    const L = layoutGraph(forkGraph());
    expect(at(L, "source").x).toBe(0);
    expect(at(L, "step:0").x).toBe(COL_GAP);
    expect(at(L, "figure").x).toBe(2 * COL_GAP);
  });

  it("stacks same-rank nodes vertically in node order; the chain stays on y=0", () => {
    const L = layoutGraph(forkGraph());
    expect(at(L, "source").y).toBe(0);
    expect(at(L, "step:0").y).toBe(0);
    expect(at(L, "figure").y).toBe(0);
  });

  it("emits one layout edge per graph edge, carrying kind/label/source/target", () => {
    const L = layoutGraph(forkGraph());
    expect(L.edges).toHaveLength(3);
    const g0 = L.edges.find((e) => e.id === "g0")!;
    expect(g0).toMatchObject({ source: "step:0", target: "figure", kind: "geom", label: "dots" });
  });

  it("places a join right-input just left of the join node, not at column 0", () => {
    const g: ExplorerGraph = {
      nodes: [
        { id: "source", kind: "table", phase: "source", label: "Source", table: { via: "at_step", at_step: -1 } },
        { id: "step:0", kind: "table", phase: "reduce", label: "joined", table: { via: "at_step", at_step: 0 } },
        { id: "source:0", kind: "table", phase: "join-input", label: "right", table: { via: "none" } },
      ],
      edges: [
        { id: "e0", kind: "join", label: "join", fromId: "source", toId: "step:0" },
        { id: "e1", kind: "join", label: "join", fromId: "source:0", toId: "step:0" },
      ],
      spine: [],
    };
    const L = layoutGraph(g);
    expect(at(L, "step:0").x).toBe(COL_GAP);
    expect(at(L, "source:0").x).toBe(0);
  });
});
