import { describe, expect, it } from "vitest";
import { TUTORIAL_STEPS } from "./steps";
import type { TutorialCtx } from "./types";
import type { Plottable } from "../state";
import type { Schema } from "../types";

const step = (id: string) => {
  const s = TUTORIAL_STEPS.find((x) => x.id === id);
  if (!s) throw new Error(`no step ${id}`);
  return s;
};

const schema: Schema = {
  schema_version: "1",
  columns: [
    { name: "species", type: "categorical", label: "species" },
    { name: "petal_length", type: "numeric", label: "petal length" },
  ],
};

// The predicates only read mappings + layers, so a minimal cast keeps the test
// from re-declaring every Plottable field (and from breaking when unrelated ones change).
const plot = (x: string, y: string, layers: number): Plottable =>
  ({ mappings: { x, y }, layers: Array(layers).fill({}) } as unknown as Plottable);

const ctx = (over: Partial<TutorialCtx> = {}): TutorialCtx =>
  ({ viewMode: "data", plottable: null, spec: null, schema, analysis: null,
     wizardOpen: false, ...over });

describe("tutorial step goals", () => {
  it("the workbench step is met only in the workbench view", () => {
    const g = step("workbench").goal!;
    expect(g(ctx({ viewMode: "data" }))).toBe(false);
    expect(g(ctx({ viewMode: "guide" }))).toBe(false);
    expect(g(ctx({ viewMode: "workbench" }))).toBe(true);
  });

  describe("the plot step", () => {
    const g = step("plot").goal!;
    it("is unmet with no plottable", () => {
      expect(g(ctx({ plottable: null }))).toBe(false);
    });
    it("is unmet when a mapping exists but no layer does", () => {
      expect(g(ctx({ plottable: plot("species", "petal_length", 0) }))).toBe(false);
    });
    it("stays unmet while the wizard is still open (a layer exists before Done)", () => {
      expect(g(ctx({ plottable: plot("species", "petal_length", 1), wizardOpen: true }))).toBe(false);
    });
    it("is met by any built plot once the wizard closes, whatever the mapping", () => {
      expect(g(ctx({ plottable: plot("species", "petal_length", 1) }))).toBe(true);
      expect(g(ctx({ plottable: plot("petal_length", "species", 1) }))).toBe(true);
      expect(g(ctx({ plottable: plot("petal_length", "petal_width", 1) }))).toBe(true);
    });
  });

  it("the observational steps carry no goal (Next always enabled)", () => {
    for (const id of ["table", "test", "result"]) expect(step(id).goal).toBeUndefined();
  });
});

describe("tutorial step wiring", () => {
  it("every step has an id, a title and a body", () => {
    for (const s of TUTORIAL_STEPS) {
      expect(s.id).toBeTruthy();
      expect(s.title).toBeTruthy();
      expect(s.body).toBeTruthy();
    }
  });
  it("gives every gated step a hint to show while it is unmet", () => {
    for (const s of TUTORIAL_STEPS) if (s.goal) expect(s.hint).toBeTruthy();
  });
  it("uses distinct step ids", () => {
    const ids = TUTORIAL_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
