import { render, screen, fireEvent } from "@testing-library/react";
import { it, expect, describe } from "vitest";
import { WorkspaceView } from "./WorkspaceView";
import { buildGraph } from "../explorer/graph";
import type { Schema } from "../types";
import { RAW_LEVEL } from "../types";
import { defaultPlan } from "../collapse";

const SCHEMA = { schema_version: "1.0", columns: [
  { name: "experiment", label: "Experiment", type: "identifier" },
  { name: "cell", label: "Cell", type: "identifier" },
  { name: "area", label: "Area", type: "numeric" },
] } as unknown as Schema;
const SPINE = ["experiment", "cell"];

function graphWithCounts() {
  const g = buildGraph([{ kind: "drop", columns: ["area"] }], SPINE, defaultPlan(SPINE, {}),
    [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, { test: "Welch's t-test", describeOnly: false });
  const axes = [{ name: "experiment", n_levels: 3, ragged: false },
                { name: "cell", n_levels: 122, ragged: false }];
  return { ...g, nodes: g.nodes.map((n) => n.kind === "table"
    ? { ...n, count: { rows: 99, cols: 3, axes, values: [{ name: "area", type: "numeric", grain: null }] } } : n) };
}

describe("WorkspaceView", () => {
  it("renders the legend and the op-edge labels", () => {
    render(<WorkspaceView graph={graphWithCounts()} onClose={() => {}} />);
    expect(screen.getByText(/numeric/i)).toBeInTheDocument();
    expect(screen.getByText("drop Area")).toBeInTheDocument();
    expect(screen.getByText("mean over Cell")).toBeInTheDocument();
  });

  it("renders the terminal fork (plot + stats) with their read labels", () => {
    render(<WorkspaceView graph={graphWithCounts()} onClose={() => {}} />);
    expect(screen.getByText("dots")).toBeInTheDocument();
    expect(screen.getByText("Welch's t-test")).toBeInTheDocument();
  });

  it("invokes onClose when the close button is clicked", () => {
    let closed = false;
    render(<WorkspaceView graph={graphWithCounts()} onClose={() => { closed = true; }} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(closed).toBe(true);
  });
});
