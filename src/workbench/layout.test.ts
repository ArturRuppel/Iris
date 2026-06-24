import { describe, it, expect } from "vitest";
import { layoutGraph, COL_GAP, ROW_GAP } from "./layout";
import type { ExplorerGraph } from "../explorer/graph";

/* a minimal linear pipeline that forks into plot (geom) + stats (test), with the
   stats->plot annotate back-edge. Hand-built so the layout is isolated from buildGraph. */
const forkGraph = (): ExplorerGraph => ({
  nodes: [
    { id: "source", kind: "table", label: "Source", table: { via: "at_step", at_step: -1 } },
    { id: "step:0", kind: "table", label: "filtered", table: { via: "at_step", at_step: 0 } },
    { id: "plot", kind: "plot", label: "Plot", table: { via: "none" } },
    { id: "stats", kind: "stats", label: "Stats", table: { via: "none" } },
  ],
  edges: [
    { id: "e0", kind: "filter", label: "mask", fromId: "source", toId: "step:0" },
    { id: "g0", kind: "geom", label: "dots", fromId: "step:0", toId: "plot" },
    { id: "t0", kind: "test", label: "MW", fromId: "step:0", toId: "stats" },
    { id: "a:annotate", kind: "annotate", label: "significance", fromId: "stats", toId: "plot" },
  ],
});

const at = (L: ReturnType<typeof layoutGraph>, id: string) => L.nodes.find((n) => n.id === id)!;

describe("layoutGraph", () => {
  it("ranks the chain left->right by longest forward path (x = rank * COL_GAP)", () => {
    const L = layoutGraph(forkGraph());
    expect(at(L, "source").x).toBe(0);
    expect(at(L, "step:0").x).toBe(COL_GAP);
    expect(at(L, "plot").x).toBe(2 * COL_GAP);
    expect(at(L, "stats").x).toBe(2 * COL_GAP);
  });

  it("does NOT let the annotate back-edge push the plot's rank", () => {
    const L = layoutGraph(forkGraph());
    expect(at(L, "plot").x).toBe(2 * COL_GAP);
  });

  it("stacks same-rank nodes vertically in node order; the chain stays on y=0", () => {
    const L = layoutGraph(forkGraph());
    expect(at(L, "source").y).toBe(0);
    expect(at(L, "step:0").y).toBe(0);
    expect(at(L, "plot").y).toBe(0);
    expect(at(L, "stats").y).toBe(ROW_GAP);
  });

  it("flags the annotate edge as a back-edge and forward edges as not", () => {
    const L = layoutGraph(forkGraph());
    expect(L.edges.find((e) => e.id === "a:annotate")!.back).toBe(true);
    expect(L.edges.filter((e) => e.id !== "a:annotate").every((e) => !e.back)).toBe(true);
  });

  it("emits one layout edge per graph edge, carrying kind/label/source/target", () => {
    const L = layoutGraph(forkGraph());
    expect(L.edges).toHaveLength(4);
    const g0 = L.edges.find((e) => e.id === "g0")!;
    expect(g0).toMatchObject({ source: "step:0", target: "plot", kind: "geom", label: "dots" });
  });

  it("places a join right-input just left of the join node, not at column 0", () => {
    const g: ExplorerGraph = {
      nodes: [
        { id: "source", kind: "table", label: "Source", table: { via: "at_step", at_step: -1 } },
        { id: "step:0", kind: "table", label: "joined", table: { via: "at_step", at_step: 0 } },
        { id: "source:0", kind: "table", label: "right", table: { via: "none" } },
      ],
      edges: [
        { id: "e0", kind: "join", label: "join", fromId: "source", toId: "step:0" },
        { id: "e1", kind: "join", label: "join", fromId: "source:0", toId: "step:0" },
      ],
    };
    const L = layoutGraph(g);
    expect(at(L, "step:0").x).toBe(COL_GAP);
    expect(at(L, "source:0").x).toBe(0);
  });
});
