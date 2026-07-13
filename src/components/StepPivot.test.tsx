import { render, screen, fireEvent } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { StepPivot } from "./StepPivot";
import type { ColumnDef, PivotStep } from "../types";

const cols: ColumnDef[] = [
  { name: "cell", type: "categorical", identifier: true, label: "Cell" },
  { name: "cond", type: "categorical", label: "Condition" },
  { name: "val", type: "numeric", label: "Value" },
  { name: "batch", type: "categorical", label: "Batch" },
  { name: "area", type: "numeric", label: "Area" },
];

const baseStep = (): PivotStep => ({
  kind: "pivot", index: ["cell"], column: "cond", values: "val",
  agg: "sum", fill: 0, names: [],
});

it("(a) emits the next step when the pivot column changes", () => {
  const spy = vi.fn();
  render(<StepPivot step={baseStep()} columns={cols} onChange={spy} />);
  fireEvent.change(screen.getByLabelText(/pivot column/i), { target: { value: "batch" } });
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ column: "batch" }));
});

it("(b) emits the next step when the values column changes", () => {
  const spy = vi.fn();
  render(<StepPivot step={baseStep()} columns={cols} onChange={spy} />);
  fireEvent.change(screen.getByLabelText(/values column/i), { target: { value: "area" } });
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ values: "area" }));
});

it("(c) emits fill as a JS number", () => {
  const spy = vi.fn();
  render(<StepPivot step={baseStep()} columns={cols} onChange={spy} />);
  fireEvent.change(screen.getByLabelText(/fill value/i), { target: { value: "1" } });
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ fill: 1 }));
  const calls = spy.mock.calls;
  const last = calls[calls.length - 1][0];
  expect(typeof last.fill).toBe("number");
});

it("(d) toggles a column into the index", () => {
  const spy = vi.fn();
  render(<StepPivot step={baseStep()} columns={cols} onChange={spy} />);
  fireEvent.click(screen.getByLabelText(/^batch$/i));
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ index: ["cell", "batch"] }));
});

it("(d2) index toggles stay in column order regardless of click order", () => {
  const spy = vi.fn();
  let step: PivotStep = { ...baseStep(), index: [] };
  const { rerender } = render(<StepPivot step={step} columns={cols} onChange={spy} />);
  // Toggle `batch` ON (later column) first…
  fireEvent.click(screen.getByLabelText(/^batch$/i));
  step = spy.mock.calls[spy.mock.calls.length - 1][0];
  expect(step.index).toEqual(["batch"]);
  rerender(<StepPivot step={step} columns={cols} onChange={spy} />);
  // …then `cell` ON (earlier column). Result is column order, not click order.
  fireEvent.click(screen.getByLabelText(/^cell$/i));
  step = spy.mock.calls[spy.mock.calls.length - 1][0];
  expect(step.index).toEqual(["cell", "batch"]);
});

it("(f) two blank relabel rows coexist — names is an array, not a collapsing dict (§2)", () => {
  const spy = vi.fn();
  const step: PivotStep = { ...baseStep(), names: [["", ""]] };
  render(<StepPivot step={step} columns={cols} onChange={spy} />);
  fireEvent.click(screen.getByRole("button", { name: /\+ relabel/i }));
  expect(spy).toHaveBeenCalledWith(
    expect.objectContaining({ names: [["", ""], ["", ""]] }));
});

it("(e) shows sum as static text, not an editable control", () => {
  render(<StepPivot step={baseStep()} columns={cols} onChange={vi.fn()} />);
  expect(screen.getByText(/sum/i)).toBeTruthy();
  expect(screen.queryByLabelText(/agg/i)).toBeNull();
});
