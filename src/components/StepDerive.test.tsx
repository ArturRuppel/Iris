import { render, screen, fireEvent } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { StepDerive } from "./StepDerive";
import type { ColumnDef, DeriveStep } from "../types";

const cols: ColumnDef[] = [
  { name: "a", type: "numeric", label: "A" },
  { name: "b", type: "numeric", label: "B" },
];

it("shows the current column name and the expression with column labels", () => {
  const step: DeriveStep = { kind: "derive", column: "ratio", expr: "a/b" };
  render(<StepDerive step={step} columns={cols} onChange={vi.fn()} />);
  expect((screen.getByLabelText(/new column/i) as HTMLInputElement).value).toBe("ratio");
  expect((screen.getByLabelText(/expression/i) as HTMLInputElement).value).toBe("A/B");
});

it("stores column names when labels are typed", () => {
  const spy = vi.fn();
  const step: DeriveStep = { kind: "derive", column: "ratio", expr: "" };
  const wide: ColumnDef[] = [...cols, { name: "step_um", type: "numeric", label: "step (µm)" }];
  render(<StepDerive step={step} columns={wide} onChange={spy} />);
  fireEvent.change(screen.getByLabelText(/expression/i), { target: { value: "`step (µm)` / A" } });
  expect(spy).toHaveBeenCalledWith({ kind: "derive", column: "ratio", expr: "step_um / a" });
  // the input keeps what was typed
  expect((screen.getByLabelText(/expression/i) as HTMLInputElement).value).toBe("`step (µm)` / A");
});

it("emits the next step on expression edit", () => {
  const spy = vi.fn();
  const step: DeriveStep = { kind: "derive", column: "ratio", expr: "a/b" };
  render(<StepDerive step={step} columns={cols} onChange={spy} />);
  fireEvent.change(screen.getByLabelText(/expression/i), { target: { value: "a/c" } });
  expect(spy).toHaveBeenCalledWith({ kind: "derive", column: "ratio", expr: "a/c" });
});

it("emits the next step on column-name edit, expression unchanged", () => {
  const spy = vi.fn();
  const step: DeriveStep = { kind: "derive", column: "ratio", expr: "a/b" };
  render(<StepDerive step={step} columns={cols} onChange={spy} />);
  fireEvent.change(screen.getByLabelText(/new column/i), { target: { value: "r2" } });
  expect(spy).toHaveBeenCalledWith({ kind: "derive", column: "r2", expr: "a/b" });
});
