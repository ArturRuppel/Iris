import { describe, it, expect } from "vitest";
import { defaultPlan, grainKey, planGrains } from "./collapse";

const SPINE = ["experiment", "cell", "frame"]; // coarse -> fine

describe("collapse helpers", () => {
  it("defaultPlan is the full-spine prefix chain finest->coarsest; fn from finest kept dim", () => {
    expect(defaultPlan(SPINE, { cell: "median" })).toEqual([
      { keep: ["experiment", "cell", "frame"], fn: "mean" },   // finest=frame -> fn[frame]||mean
      { keep: ["experiment", "cell"], fn: "median" },          // finest=cell  -> fn[cell]=median
      { keep: ["experiment"], fn: "mean" },                    // finest=experiment
    ]);
  });

  it("grainKey joins kept dims in spine order; raw is empty string", () => {
    expect(grainKey([])).toBe("");
    expect(grainKey(["experiment", "cell"])).toBe("experiment/cell");
  });

  it("planGrains lists raw + one grain key per step, in order", () => {
    expect(planGrains(defaultPlan(SPINE, {}))).toEqual([
      "", "experiment/cell/frame", "experiment/cell", "experiment",
    ]);
  });

  it("skipping a level = a step that drops two dims at once (pool)", () => {
    const plan = [
      { keep: ["experiment", "cell"], fn: "median" as const },
      { keep: ["experiment"], fn: "median" as const },
    ];
    expect(planGrains(plan)).toEqual(["", "experiment/cell", "experiment"]);
  });

  it("mean trajectory: keep a finer dim, drop a coarser one (non-prefix grain)", () => {
    const plan = [
      { keep: ["experiment", "cell", "frame"], fn: "mean" as const },
      { keep: ["experiment", "frame"], fn: "mean" as const },
    ];
    expect(planGrains(plan)).toEqual(["", "experiment/cell/frame", "experiment/frame"]);
  });
});
