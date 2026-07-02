import { render, screen, fireEvent } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { StepJoin, type JoinPoolEntry } from "./StepJoin";
import type { ColumnDef, JoinStep, Schema } from "../types";

const cols: ColumnDef[] = [
  { name: "id", type: "identifier", label: "ID" },
  { name: "batch", type: "categorical", label: "Batch" },
];

const schemaOf = (names: string[]): Schema => ({
  schema_version: "1.0",
  columns: names.map((n) => ({ name: n, type: "categorical" as const, label: n })),
});

const pool: JoinPoolEntry[] = [
  { id: "annot", name: "annot", schema: schemaOf(["id", "batch", "note"]) },
  { id: "lookup", name: "lookup", schema: schemaOf(["batch"]) },
];

const makeStep = (on: string[], rightTableId = "annot"): JoinStep =>
  ({ kind: "join", on, how: "inner", rightTableId });

it("shows the referenced right table and join type", () => {
  render(<StepJoin step={makeStep(["id"])} columns={cols} pool={pool} onChange={vi.fn()} />);
  const select = screen.getByLabelText("right table") as HTMLSelectElement;
  expect(select.value).toBe("annot");
  expect(document.body.textContent).toContain("inner");
});

it("lists the left columns as join keys, with current keys active", () => {
  render(<StepJoin step={makeStep(["id"])} columns={cols} pool={pool} onChange={vi.fn()} />);
  const idBox = screen.getByLabelText(/id/i) as HTMLInputElement;
  const batchBox = screen.getByLabelText(/batch/i) as HTMLInputElement;
  expect(idBox.checked).toBe(true);
  expect(batchBox.checked).toBe(false);
});

it("toggling a column ON adds it to on, ordered by columns", () => {
  const spy = vi.fn();
  render(<StepJoin step={makeStep(["id"])} columns={cols} pool={pool} onChange={spy} />);
  fireEvent.click(screen.getByLabelText(/batch/i));
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ on: ["id", "batch"] }));
});

it("toggling a current key OFF removes it from on", () => {
  const spy = vi.fn();
  render(<StepJoin step={makeStep(["id"])} columns={cols} pool={pool} onChange={spy} />);
  fireEvent.click(screen.getByLabelText(/id/i));
  const call = spy.mock.calls[0][0] as JoinStep;
  expect(call.on).not.toContain("id");
});

it("an UNSET join disables the keys until a right table is picked", () => {
  render(<StepJoin step={makeStep([], "")} columns={cols} pool={pool} onChange={vi.fn()} />);
  expect((screen.getByLabelText(/id/i) as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText(/batch/i) as HTMLInputElement).disabled).toBe(true);
  expect(document.body.textContent).toMatch(/choose a right table/i);
});

it("picking a right table seeds `on` with the shared identifier columns", () => {
  const spy = vi.fn();
  render(<StepJoin step={makeStep([], "")} columns={cols} pool={pool} onChange={spy} />);
  fireEvent.change(screen.getByLabelText("right table"), { target: { value: "annot" } });
  expect(spy).toHaveBeenCalledWith(
    expect.objectContaining({ rightTableId: "annot", on: ["id"] }));
});

it("switching the right table prunes keys the new table doesn't share", () => {
  const spy = vi.fn();
  render(
    <StepJoin step={makeStep(["id", "batch"])} columns={cols} pool={pool} onChange={spy} />);
  fireEvent.change(screen.getByLabelText("right table"), { target: { value: "lookup" } });
  expect(spy).toHaveBeenCalledWith(
    expect.objectContaining({ rightTableId: "lookup", on: ["batch"] }));
});

it("keys absent from the chosen right table are disabled", () => {
  render(<StepJoin step={makeStep([], "lookup")} columns={cols} pool={pool} onChange={vi.fn()} />);
  expect((screen.getByLabelText(/id/i) as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText(/batch/i) as HTMLInputElement).disabled).toBe(false);
});

it("a rightTableId not in the pool shows as not-loaded and keeps keys editable", () => {
  render(<StepJoin step={makeStep(["id"], "ghost")} columns={cols} pool={pool} onChange={vi.fn()} />);
  const select = screen.getByLabelText("right table") as HTMLSelectElement;
  expect(select.value).toBe("ghost");
  expect(document.body.textContent).toMatch(/ghost \(not loaded\)/);
  expect((screen.getByLabelText(/id/i) as HTMLInputElement).disabled).toBe(false);
});
