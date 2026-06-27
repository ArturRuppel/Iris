import { render, screen } from "@testing-library/react";
import { it, expect, describe } from "vitest";
import { ArrayShapeNode } from "./ArrayShapeNode";
import type { AxisDesc, ValueDesc } from "../types";

const axes: AxisDesc[] = [
  { name: "experiment", n_levels: 3, ragged: false },
  { name: "cell", n_levels: 122, ragged: false },
  { name: "frame", n_levels: 1830, ragged: true },
];
const values: ValueDesc[] = [
  { name: "speed", type: "numeric", grain: null },
  { name: "class", type: "categorical", grain: "cell" },
];

describe("ArrayShapeNode", () => {
  it("lists index dims under 'Organised by' with counts; ragged shows 'varies' not ~", () => {
    render(<ArrayShapeNode title="filtered" variant="table" axes={axes} values={values} />);
    expect(screen.getByText("Organised by")).toBeInTheDocument();

    const exp = screen.getByText("experiment");
    expect(exp).toHaveClass("txw-dim");
    expect(exp).not.toHaveClass("ragged");
    expect(exp.closest(".txw-lvl")).toHaveTextContent("3");

    const frame = screen.getByText("frame");
    expect(frame).toHaveClass("ragged");
    expect(frame.closest(".txw-lvl")).toHaveTextContent("varies");
    expect(screen.queryByText("~")).toBeNull();

    expect(screen.getByText("varies").closest(".txw-pill")).toHaveAttribute("title", "count varies by parent (ragged)");
    expect(screen.getByText("3").closest(".txw-pill")).not.toHaveAttribute("title");
  });

  it("shows a nesting connector on every axis after the first", () => {
    const { container } = render(
      <ArrayShapeNode title="x" variant="table" axes={axes} values={[]} />);
    const lvls = container.querySelectorAll(".txw-tree .txw-lvl");
    expect(lvls[0]).not.toHaveClass("nested");
    expect(lvls[0].querySelector(".txw-twig")).toBeNull();
    expect(lvls[1]).toHaveClass("nested");
    expect(lvls[1].querySelector(".txw-twig")).not.toBeNull();
  });

  it("lists values under 'Values' with a plain-English type label and the @grain tag", () => {
    render(<ArrayShapeNode title="x" variant="table" axes={axes} values={values} />);
    expect(screen.getByText("Values")).toBeInTheDocument();

    const speed = screen.getByText("speed");
    expect(speed.closest(".txw-val")).toHaveClass("num");
    expect(speed.closest(".txw-vrow")).toHaveTextContent("number");

    const cls = screen.getByText("class").closest(".txw-val")!;
    expect(cls).toHaveClass("catg");
    expect(cls).toHaveTextContent("@cell");
    expect(screen.getByText("class").closest(".txw-vrow")).toHaveTextContent("category");
  });

  it("renders removed axes struck-through (collapse), and join keys highlighted", () => {
    render(<ArrayShapeNode title="per cell" variant="grain"
      axes={axes.slice(0, 2)} values={[]} removed={["frame"]} onKeys={["experiment"]} />);
    expect(screen.getByText("frame")).toHaveClass("gone");
    expect(screen.getByText("experiment")).toHaveClass("keyhi");
  });

  it("applies the variant class and falls back to rows×cols when no descriptor", () => {
    const { container } = render(
      <ArrayShapeNode title="source" variant="source" axes={[]} values={[]} rows={1240} cols={5} />);
    expect(container.querySelector(".txw-node")).toHaveClass("source");
    expect(screen.getByText("1240×5")).toBeInTheDocument();
  });
});
