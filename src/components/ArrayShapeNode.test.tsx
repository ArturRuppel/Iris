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
  it("renders axis chips with level counts; ragged axis is dashed and shows ~", () => {
    render(<ArrayShapeNode title="filtered" variant="table" axes={axes} values={values} />);
    const exp = screen.getByText("experiment").closest(".txw-ax")!;
    expect(exp).not.toHaveClass("ragged");
    expect(exp).toHaveTextContent("3");
    const frame = screen.getByText("frame").closest(".txw-ax")!;
    expect(frame).toHaveClass("ragged");
    expect(frame).toHaveTextContent("~");
  });

  it("colours value chips by type and shows the @grain tag", () => {
    render(<ArrayShapeNode title="x" variant="table" axes={axes} values={values} />);
    expect(screen.getByText("speed").closest(".txw-val")).toHaveClass("num");
    const cls = screen.getByText("class").closest(".txw-val")!;
    expect(cls).toHaveClass("catg");
    expect(cls).toHaveTextContent("@cell");
  });

  it("renders removed axes struck-through (collapse), and join keys highlighted", () => {
    render(<ArrayShapeNode title="per cell" variant="grain"
      axes={axes.slice(0, 2)} values={[]} removed={["frame"]} onKeys={["experiment"]} />);
    expect(screen.getByText("frame").closest(".txw-ax")).toHaveClass("gone");
    expect(screen.getByText("experiment").closest(".txw-ax")).toHaveClass("keyhi");
  });

  it("applies the variant class and falls back to rows×cols when no descriptor", () => {
    const { container } = render(
      <ArrayShapeNode title="source" variant="source" axes={[]} values={[]} rows={1240} cols={5} />);
    expect(container.querySelector(".txw-node")).toHaveClass("source");
    expect(screen.getByText("1240×5")).toBeInTheDocument();
  });
});
