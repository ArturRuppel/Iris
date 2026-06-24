import { describe, it, expect } from "vitest";
import { cannedExample, CANNED } from "./cannedExamples";
import type { EdgeKind } from "./graph";

describe("cannedExamples", () => {
  it("has an authored before/after pair for every op edge kind", () => {
    const ops: EdgeKind[] = ["filter", "drop", "derive", "recode", "join", "pivot", "grid_complete", "collapse"];
    for (const k of ops) {
      const ex = cannedExample(k);
      expect(ex, k).toBeTruthy();
      expect(ex!.before.cols.length).toBeGreaterThan(0);
      expect(ex!.after.cols.length).toBeGreaterThan(0);
      expect(ex!.before.rows.length).toBeGreaterThan(0);
      expect(ex!.after.rows.length).toBeGreaterThan(0);
      expect(ex!.caption.length).toBeGreaterThan(0);
    }
  });

  it("returns null for the non-op terminal edges (geom/test)", () => {
    expect(cannedExample("geom")).toBeNull();
    expect(cannedExample("test")).toBeNull();
  });

  it("pivot widens (after has more cols than before)", () => {
    const ex = CANNED.pivot!;
    expect(ex.after.cols.length).toBeGreaterThan(ex.before.cols.length);
  });
});
