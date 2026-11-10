import { describe, it, expect } from "vitest";
import { toRFLanes, headId, rawNodeId, ADD_LANE_ID, type Lane } from "./lanes";
import type { ExplorerGraph } from "../explorer/graph";

const graph = (): ExplorerGraph => ({
  nodes: [
    { id: "source", kind: "table", phase: "source", label: "t" },
    { id: "figure", kind: "figure", phase: "terminal", label: "Figure",
      sections: [{ kind: "plot", facts: ["box"] }, { kind: "stats", facts: [] }] },
  ],
  edges: [{ id: "g:plain", fromId: "source", toId: "figure", kind: "geom", label: "box" }],
} as unknown as ExplorerGraph);
const lane = (id: string, active: boolean, svg: string | null = null): Lane => ({
  id, name: id, tag: "", marks: "Box", active, tableName: "t", statsOff: false, graph: graph(), svg,
});

describe("toRFLanes", () => {
  it("keeps the active lane's ids plain and prefixes the others", () => {
    const rf = toRFLanes([lane("a", false), lane("b", true)], {});
    const ids = rf.nodes.map((n) => n.id);
    expect(ids).toContain("source");
    expect(ids).toContain("lane:a::source");
    expect(ids).toContain(headId("a"));
    expect(ids).toContain(headId("b"));
    expect(ids[ids.length - 1]).toBe(ADD_LANE_ID);
    expect(rawNodeId("lane:a::figure")).toBe("figure");
    expect(rf.nodes.find((n) => n.id === "source")!.type).toBe("arrayShape");
    expect(rf.nodes.find((n) => n.id === "lane:a::source")!.type).toBe("ghost");
    expect(rf.edges.map((e) => e.id).sort()).toEqual(["g:plain", "lane:a::g:plain"]);
  });
  it("stacks lanes without overlap and reports the active lane's offset", () => {
    const rf = toRFLanes([lane("a", false, "<svg/>"), lane("b", true)], {});
    const yA = rf.nodes.find((n) => n.id === headId("a"))!.position.y;
    const yB = rf.nodes.find((n) => n.id === headId("b"))!.position.y;
    expect(yA).toBe(0);
    expect(yB).toBeGreaterThan(250);          // a figure node with its picture is tall
    expect(rf.activeOffset).toBe(yB);
  });
  it("applies a nudge relative to the lane", () => {
    const rf = toRFLanes([lane("a", false), lane("b", true)], { source: { x: 5, y: 7 } });
    expect(rf.nodes.find((n) => n.id === "source")!.position).toEqual({ x: 5, y: 7 + rf.activeOffset });
  });
});
