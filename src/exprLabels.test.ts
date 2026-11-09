import { describe, expect, it } from "vitest";
import { exprToDisplay, exprToNames } from "./exprLabels";
import type { ColumnDef } from "./types";

const cols: ColumnDef[] = [
  { name: "step_um", type: "numeric", label: "displacement since the previous frame (µm)" },
  { name: "group", type: "categorical", label: "genotype" },
  { name: "t_h", type: "numeric", label: "time (h)" },
  { name: "frame", type: "numeric", label: "frame" },
  { name: "speed (µm/h)", type: "numeric", label: "speed (µm/h)" },
  { name: "experiment_id", type: "categorical", label: "experiment" },
];

describe("exprToDisplay", () => {
  it("shows a column by its label, backticked unless it is a plain identifier", () => {
    expect(exprToDisplay("step_um / 0.25", cols))
      .toBe("`displacement since the previous frame (µm)` / 0.25");
    expect(exprToDisplay("log(group) + frame", cols)).toBe("log(genotype) + frame");
    expect(exprToDisplay("`speed (µm/h)` * 2", cols)).toBe("`speed (µm/h)` * 2");
  });
  it("leaves string literals, numbers, functions and unknown names alone", () => {
    expect(exprToDisplay('str(frame) + "step_um" + 1e3 * sqrt(x)', cols))
      .toBe('str(frame) + "step_um" + 1e3 * sqrt(x)');
  });
});

describe("exprToNames", () => {
  it("turns labels back into names", () => {
    expect(exprToNames("`displacement since the previous frame (µm)` / 0.25", cols))
      .toBe("step_um / 0.25");
    expect(exprToNames("log(genotype) + frame + experiment", cols))
      .toBe("log(group) + frame + experiment_id");
    expect(exprToNames("`time (h)` * 60", cols)).toBe("t_h * 60");
  });
  it("keeps a name that is typed directly, and a non-identifier name in backticks", () => {
    expect(exprToNames("step_um / t_h", cols)).toBe("step_um / t_h");
    expect(exprToNames("`speed (µm/h)` * 2", cols)).toBe("`speed (µm/h)` * 2");
  });
  it("passes an unfinished backtick reference through while it is being typed", () => {
    expect(exprToNames("`displacement si", cols)).toBe("`displacement si");
    expect(exprToDisplay("`displacement si", cols)).toBe("`displacement si");
  });
  it("round-trips", () => {
    for (const e of ["step_um / 0.25", "log(group) + frame", "`speed (µm/h)` * 2",
                     'str(frame) + " µm"', "experiment_id == \"SCMVI-01\""]) {
      expect(exprToNames(exprToDisplay(e, cols), cols)).toBe(e);
    }
  });
});
