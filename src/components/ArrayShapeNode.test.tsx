import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ArrayShapeNode, type ArrayShapeNodeProps } from "./ArrayShapeNode";
import type { CannedExample } from "../explorer/cannedExamples";

const base: ArrayShapeNodeProps = {
  variant: "grain", kind: "collapse", eyebrow: "Collapse", detail: "median over frame",
  spine: ["experiment_id", "position_id", "cell_id", "frame"],
  live: ["experiment_id", "position_id", "cell_id"],
  shed: ["frame"],
  values: [{ name: "value", type: "numeric", grain: null }],
  newValues: [],
};

const render1 = (p: Partial<ArrayShapeNodeProps> = {}) =>
  render(<ArrayShapeNode {...base} {...p} />);

describe("ArrayShapeNode", () => {
  it("shows the step eyebrow and its specifics", () => {
    render1();
    expect(screen.getByText("Collapse")).toBeInTheDocument();
    expect(screen.getByText("median over frame")).toBeInTheDocument();
  });

  it("renders one grain segment per spine level, classed live / shed / gone", () => {
    const { container } = render1({
      live: ["experiment_id", "position_id"], shed: ["cell_id"],
    });
    const segs = container.querySelectorAll(".txw-seg");
    expect(segs).toHaveLength(4);
    expect(container.querySelector(".txw-seg.shed")?.textContent).toBe("C"); // cell_id shed
    expect(container.querySelectorAll(".txw-seg.live")).toHaveLength(2);      // E, P
    expect(container.querySelector(".txw-seg.gone")?.textContent).toBe("F");  // frame already gone
  });

  it("quiets the grain bar (calm) on a step that sheds nothing", () => {
    const { container } = render1({ live: base.spine, shed: [] });
    expect(container.querySelector(".txw-grain.calm")).not.toBeNull();
    expect(container.querySelector(".txw-seg.shed")).toBeNull();
  });

  it("a non-collapse step shows only the columns it added, prefixed +, and no grain bar", () => {
    const { container } = render1({
      variant: "table", eyebrow: "Join", kind: "join", detail: "on exp + pos", shed: [], live: base.spine,
      values: [
        { name: "value", type: "numeric", grain: null },
        { name: "class_label", type: "categorical", grain: null },
      ],
      newValues: ["class_label"],
    });
    const chips = container.querySelectorAll(".txw-vchip");
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toBe("+ class_label");
    expect(container.querySelector(".txw-grain")).toBeNull();
  });

  it("a step that adds no column repeats no column list", () => {
    const { container } = render1({ variant: "table", kind: "filter", shed: [], live: base.spine });
    expect(container.querySelectorAll(".txw-vchip")).toHaveLength(0);
  });

  it("the source lists its columns once, with its grain", () => {
    const { container } = render1({ variant: "source", kind: "source", shed: [], live: base.spine,
      values: [{ name: "value", type: "numeric", grain: null }, { name: "dot", type: "numeric", grain: null }] });
    expect(container.querySelectorAll(".txw-vchip")).toHaveLength(2);
    expect(container.querySelector(".txw-grain")).not.toBeNull();
  });

  it("a collapse shows the grain it pools to, the surviving columns, and rings new ones", () => {
    const { container } = render1({
      values: [{ name: "value", type: "numeric", grain: null }, { name: "n", type: "numeric", grain: null }],
      newValues: ["n"],
    });
    expect(container.querySelector(".txw-grain-to")?.textContent).toBe("per experiment_id · position_id · cell_id");
    expect(container.querySelectorAll(".txw-vchip")).toHaveLength(2);
    expect(container.querySelector(".txw-vchip.isnew")?.textContent).toContain("n");
    expect(within(container.querySelector(".txw-vchip:not(.isnew)") as HTMLElement).getByText("value"))
      .toBeInTheDocument();
  });

  it("puts the grain explanation in the level badge's tooltip", () => {
    const { container } = render1();
    const shed = container.querySelector(".txw-seg.shed") as HTMLElement;
    expect(shed.title).toContain("Grain level “frame”");
    expect(shed.title).toContain("pools one level");
  });

  it("reveals the before/after example on hovering the eyebrow", () => {
    const example: CannedExample = {
      before: { cols: ["cell", "frame"], rows: [["c1", 1]] },
      after: { cols: ["cell"], rows: [["c1"]] },
      caption: "Aggregate over the innermost axis.",
    };
    render1({ example });
    expect(screen.queryByText("Aggregate over the innermost axis.")).toBeNull();
    fireEvent.mouseEnter(screen.getByText("Collapse").closest(".txw-eyebrow")!);
    expect(screen.getByText("Aggregate over the innermost axis.")).toBeInTheDocument();
  });

  it("shows the definition on hovering the detail", () => {
    render1({ definition: "Aggregate over the innermost axis." });
    expect(screen.queryByText("Aggregate over the innermost axis.")).toBeNull();
    fireEvent.mouseEnter(screen.getByText("median over frame").closest(".txw-ndetail")!);
    expect(screen.getByText("Aggregate over the innermost axis.")).toBeInTheDocument();
  });

  it("calls onEdit (and stops propagation) when the detail is clicked", () => {
    const onEdit = vi.fn();
    render1({ onEdit });
    const detail = screen.getByText("median over frame").closest(".txw-ndetail")!;
    expect(detail.className).toContain("editable");
    fireEvent.click(detail);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("falls back to rows×cols for a terminal with no grain or values", () => {
    render1({
      variant: "figure", kind: "geom", eyebrow: "Plot", detail: "dots",
      spine: [], live: [], shed: [], values: [], rows: 4, cols: 2,
    });
    expect(screen.getByText("4×2")).toBeInTheDocument();
  });
});

describe("ArrayShapeNode figure variant", () => {
  const fig = (sections: ArrayShapeNodeProps["sections"], thumb?: string) =>
    render(<ArrayShapeNode variant="figure" kind="geom" eyebrow="Figure" detail=""
      spine={[]} live={[]} shed={[]} values={[]} sections={sections} thumb={thumb} />);
  const sections = (over: { onPlot?: () => void; onStats?: () => void; onAdd?: () => void } = {}) => [
    { kind: "plot" as const, label: "Plot", facts: ["box"], onView: over.onPlot, onAdd: over.onAdd },
    { kind: "stats" as const, label: "Stats", facts: ["Welch t"], onView: over.onStats },
  ];

  it("with a thumb: the picture button and one stats line, no sections", () => {
    const onPlot = vi.fn(), onStats = vi.fn();
    const { container } = fig(sections({ onPlot, onStats }), "<svg xmlns='http://www.w3.org/2000/svg'/>");
    expect(container.querySelector(".txw-node.figure.picture")).toBeTruthy();
    expect(container.querySelector(".txw-figsec")).toBeNull();
    expect(container.querySelectorAll(".txw-figstat")).toHaveLength(1);
    expect(screen.getByText("Welch t")).toBeInTheDocument();
    const img = container.querySelector("img.txw-figthumb") as HTMLImageElement;
    expect(img.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    fireEvent.click(screen.getByRole("button", { name: "Plot summary" }));
    expect(onPlot).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Stats summary" }));
    expect(onStats).toHaveBeenCalledTimes(1);
  });

  it("without a thumb: one section per facet, no picture", () => {
    const { container } = fig(sections());
    expect(container.querySelector(".txw-figthumb")).toBeNull();
    expect(container.querySelectorAll(".txw-figsec")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Plot summary" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stats summary" })).toBeInTheDocument();
    expect(container.querySelector(".txw-node-add-plot")).toBeNull();   // no onAdd, no control
  });

  it("an empty plot section with onAdd offers + add plot, which does not also open the plot", () => {
    const onPlot = vi.fn(), onAdd = vi.fn();
    const { container } = fig(sections({ onPlot, onAdd }));
    const add = container.querySelector(".txw-node-add-plot")!;
    expect(add).toBeTruthy();
    expect(add.textContent).toBe("+ add plot");
    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onPlot).not.toHaveBeenCalled();
  });
});
