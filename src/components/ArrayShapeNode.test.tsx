import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ArrayShapeNode, type ArrayShapeNodeProps } from "./ArrayShapeNode";
import type { CannedExample } from "../explorer/cannedExamples";

const base: ArrayShapeNodeProps = {
  variant: "table", kind: "collapse", eyebrow: "Collapse", detail: "median over frame",
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

  it("rings the value(s) a step introduced", () => {
    const { container } = render1({
      eyebrow: "Join", kind: "join", detail: "on exp + pos", shed: [], live: base.spine,
      values: [
        { name: "value", type: "numeric", grain: null },
        { name: "class_label", type: "categorical", grain: null },
      ],
      newValues: ["class_label"],
    });
    const chips = container.querySelectorAll(".txw-vchip");
    expect(chips).toHaveLength(2);
    expect(container.querySelector(".txw-vchip.isnew")?.textContent).toContain("class_label");
    expect(within(container.querySelector(".txw-vchip:not(.isnew)") as HTMLElement).getByText("value"))
      .toBeInTheDocument();
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
