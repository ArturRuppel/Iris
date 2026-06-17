import { describe, it, expect } from "vitest";
import { combineGroupTest, overrideFor } from "./GuidedTestPicker";

/* The picker's job is to turn two answers into the engine's single `override`
   slot. The repo has no DOM test harness, so we exercise that mapping directly
   (the rendering is a thin shell over these two pure functions). */

describe("combineGroupTest — mirrors the engine _COMBINE grid", () => {
  it("maps the 2×2 answer grid to the four group tests", () => {
    expect(combineGroupTest("independent", "parametric")).toBe("welch_t");
    expect(combineGroupTest("independent", "robust")).toBe("mann_whitney");
    expect(combineGroupTest("paired", "parametric")).toBe("paired_t");
    expect(combineGroupTest("paired", "robust")).toBe("wilcoxon");
  });
});

describe("overrideFor — null when the pair equals the recommendation, else the test", () => {
  it("returns null for an unchanged pair (sends no override → recommendation_accepted)", () => {
    // recommendation is welch_t (independent × parametric)
    expect(overrideFor("independent", "parametric", "welch_t")).toBeNull();
  });
  it("returns the derived test when the user changes the assumption axis", () => {
    // flipping parametric → robust on an independent design yields Mann–Whitney
    expect(overrideFor("independent", "robust", "welch_t")).toBe("mann_whitney");
  });
  it("returns the derived test when the user changes the structural axis", () => {
    expect(overrideFor("paired", "parametric", "welch_t")).toBe("paired_t");
  });
  it("nulls again when a changed pair lands back on the recommendation", () => {
    // recommendation is mann_whitney; independent × robust reproduces it
    expect(overrideFor("independent", "robust", "mann_whitney")).toBeNull();
  });
});
