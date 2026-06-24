import { render, screen, fireEvent } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { StepGridComplete } from "./StepGridComplete";
import type { ColumnDef, GridCompleteStep } from "../types";

const cols: ColumnDef[] = [
  { name: "cell", type: "identifier", label: "Cell" },
  { name: "cond", type: "categorical", label: "Condition" },
  { name: "batch", type: "categorical", label: "Batch" },
];

const step: GridCompleteStep = {
  kind: "grid_complete", by: ["cell"], column: "cond", levels: ["a", "b"],
  count: true, count_unique: null, fill: 0, count_name: "n",
};

it("(a) toggles the count checkbox", () => {
  const spy = vi.fn();
  render(<StepGridComplete step={step} columns={cols} onChange={spy} />);
  fireEvent.click(screen.getByLabelText(/count rows/i));
  expect(spy).toHaveBeenCalledWith({ ...step, count: false });
});

it("(b) edits the count_name input", () => {
  const spy = vi.fn();
  render(<StepGridComplete step={step} columns={cols} onChange={spy} />);
  fireEvent.change(screen.getByLabelText(/count name/i), { target: { value: "cells" } });
  expect(spy).toHaveBeenCalledWith({ ...step, count_name: "cells" });
});

it("(c) changes the grid column select", () => {
  const spy = vi.fn();
  render(<StepGridComplete step={step} columns={cols} onChange={spy} />);
  fireEvent.change(screen.getByLabelText(/grid column/i), { target: { value: "batch" } });
  expect(spy).toHaveBeenCalledWith({ ...step, column: "batch" });
});

it("(d) edits the levels field", () => {
  const spy = vi.fn();
  render(<StepGridComplete step={step} columns={cols} onChange={spy} />);
  fireEvent.change(screen.getByLabelText(/levels/i), { target: { value: "a,b,c" } });
  expect(spy).toHaveBeenCalledWith({ ...step, levels: ["a", "b", "c"] });
});

it("(e) changes the count_unique select from none to a column", () => {
  const spy = vi.fn();
  render(<StepGridComplete step={step} columns={cols} onChange={spy} />);
  fireEvent.change(screen.getByLabelText(/count unique/i), { target: { value: "cell" } });
  expect(spy).toHaveBeenCalledWith({ ...step, count_unique: "cell" });
});
