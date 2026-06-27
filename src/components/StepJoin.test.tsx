import { render, screen, fireEvent } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { StepJoin } from "./StepJoin";
import type { ColumnDef, JoinStep } from "../types";

const cols: ColumnDef[] = [
  { name: "id", type: "identifier", label: "ID" },
  { name: "batch", type: "categorical", label: "Batch" },
];

const makeStep = (on: string[]): JoinStep =>
  ({ kind: "join", on, how: "inner", rightTableId: "annot" });

it("shows the referenced right table id and join type", () => {
  render(<StepJoin step={makeStep(["id"])} columns={cols} onChange={vi.fn()} />);
  const text = document.body.textContent ?? "";
  expect(text).toContain("annot");
  expect(text).toContain("inner");
});

it("lists the left columns as join keys, with current keys active", () => {
  render(<StepJoin step={makeStep(["id"])} columns={cols} onChange={vi.fn()} />);
  const idBox = screen.getByLabelText(/id/i) as HTMLInputElement;
  const batchBox = screen.getByLabelText(/batch/i) as HTMLInputElement;
  expect(idBox.checked).toBe(true);
  expect(batchBox.checked).toBe(false);
});

it("toggling a column ON adds it to on, ordered by columns", () => {
  const spy = vi.fn();
  render(<StepJoin step={makeStep(["id"])} columns={cols} onChange={spy} />);
  fireEvent.click(screen.getByLabelText(/batch/i));
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ on: ["id", "batch"] }));
});

it("toggling a current key OFF removes it from on", () => {
  const spy = vi.fn();
  render(<StepJoin step={makeStep(["id"])} columns={cols} onChange={spy} />);
  fireEvent.click(screen.getByLabelText(/id/i));
  const call = spy.mock.calls[0][0] as JoinStep;
  expect(call.on).not.toContain("id");
});
