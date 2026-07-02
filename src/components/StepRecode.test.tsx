import { render, screen, fireEvent } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { StepRecode } from "./StepRecode";
import type { ColumnDef, RecodeStep } from "../types";

const cols: ColumnDef[] = [
  { name: "cond", type: "categorical", label: "Condition" },
  { name: "treat", type: "categorical", label: "Treatment" },
];

const baseStep = (): RecodeStep => ({ kind: "recode", column: "cond", map: [["0", "ctrl"]] });

it("shows the chosen column and the current mapping row", () => {
  render(<StepRecode step={baseStep()} columns={cols} onChange={vi.fn()} />);
  expect((screen.getByLabelText(/recode column/i) as HTMLSelectElement).value).toBe("cond");
  expect((screen.getByLabelText(/^from$/i) as HTMLInputElement).value).toBe("0");
  expect((screen.getByLabelText(/^to$/i) as HTMLInputElement).value).toBe("ctrl");
});

it("(a) emits the next step when the mapping value changes", () => {
  const spy = vi.fn();
  render(<StepRecode step={baseStep()} columns={cols} onChange={spy} />);
  fireEvent.change(screen.getByLabelText(/^to$/i), { target: { value: "control" } });
  expect(spy).toHaveBeenCalledWith({ kind: "recode", column: "cond", map: [["0", "control"]] });
});

it("(b) appends a blank mapping entry on + mapping", () => {
  const spy = vi.fn();
  render(<StepRecode step={baseStep()} columns={cols} onChange={spy} />);
  fireEvent.click(screen.getByRole("button", { name: /\+ mapping/i }));
  expect(spy).toHaveBeenCalledWith({ kind: "recode", column: "cond", map: [["0", "ctrl"], ["", ""]] });
});

it("(b2) two blank rows coexist — an array does not collapse duplicate keys (§2)", () => {
  // Regression: with a dict the second [\"\",\"\"] collapsed onto the first, so a
  // second row could never be added by clicking + twice. As an array both survive.
  const spy = vi.fn();
  const step: RecodeStep = { kind: "recode", column: "cond", map: [["0", "ctrl"], ["", ""]] };
  render(<StepRecode step={step} columns={cols} onChange={spy} />);
  fireEvent.click(screen.getByRole("button", { name: /\+ mapping/i }));
  expect(spy).toHaveBeenCalledWith(
    { kind: "recode", column: "cond", map: [["0", "ctrl"], ["", ""], ["", ""]] });
});

it("(b3) editing a `from` through a colliding value does not merge/destroy a row (§2)", () => {
  // Two rows keyed "0" and "1"; retype the second's from to "0" (momentary
  // collision). A dict would merge them (one row lost); the array keeps both.
  const spy = vi.fn();
  const step: RecodeStep = { kind: "recode", column: "cond", map: [["0", "a"], ["1", "b"]] };
  render(<StepRecode step={step} columns={cols} onChange={spy} />);
  const froms = screen.getAllByLabelText(/^from$/i) as HTMLInputElement[];
  fireEvent.change(froms[1], { target: { value: "0" } });
  expect(spy).toHaveBeenCalledWith({ kind: "recode", column: "cond", map: [["0", "a"], ["0", "b"]] });
});

it("(c) emits the next step when the column changes", () => {
  const spy = vi.fn();
  render(<StepRecode step={baseStep()} columns={cols} onChange={spy} />);
  fireEvent.change(screen.getByLabelText(/recode column/i), { target: { value: "treat" } });
  expect(spy).toHaveBeenCalledWith({ kind: "recode", column: "treat", map: [["0", "ctrl"]] });
});

it("(d) removes a mapping row", () => {
  const spy = vi.fn();
  render(<StepRecode step={baseStep()} columns={cols} onChange={spy} />);
  fireEvent.click(screen.getByRole("button", { name: /remove/i }));
  expect(spy).toHaveBeenCalledWith({ kind: "recode", column: "cond", map: [] });
});
