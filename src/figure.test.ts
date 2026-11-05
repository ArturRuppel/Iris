import { describe, expect, it } from "vitest";
import {
  FIGURE_DEFAULTS, labbookSvgSource, movePanel, nextTag, normalizeFigure, panelOrder,
} from "./figure";

const items = [
  { id: "u" }, { id: "p", tag: "B" }, { id: "q", tag: "A" }, { id: "r", tag: "  " },
];

describe("figure assembly", () => {
  it("normalizes like the engine: defaults, ranges, unknown keys dropped", () => {
    expect(normalizeFigure(null)).toBeNull();
    expect(normalizeFigure({})).toEqual(FIGURE_DEFAULTS);
    const n = normalizeFigure({ direction: "diagonal", gap_mm: -1, panels: ["a", "a", 3],
      sizes: { a: 2, b: "x" }, letters: { size_pt: 999, weight: "normal" }, junk: 1 })!;
    expect(n.direction).toBe("rows");
    expect(n.gap_mm).toBe(3);
    expect(n.panels).toEqual(["a"]);
    expect(n.sizes).toEqual({ a: 2 });
    expect(n.letters).toEqual({ show: true, size_pt: 10, weight: "normal", position: "outside" });
    expect("junk" in n).toBe(false);
    expect(normalizeFigure(n)).toEqual(n);
  });

  it("orders the tagged items: listed first, then document order", () => {
    expect(panelOrder(null, items).map((x) => x.id)).toEqual(["p", "q"]);
    expect(panelOrder({ ...FIGURE_DEFAULTS, panels: ["q"] }, items).map((x) => x.id)).toEqual(["q", "p"]);
  });

  it("moves a panel and writes the full order", () => {
    const f = movePanel(FIGURE_DEFAULTS, items, "q", -1);
    expect(f.panels).toEqual(["q", "p"]);
    expect(movePanel(f, items, "q", -1)).toBe(f);     // already first
  });

  it("hands out the next free letter", () => {
    expect(nextTag([])).toBe("A");
    expect(nextTag(["A", "C"])).toBe("B");
    expect(nextTag("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""))).toBe("A2");
  });
});

describe("what Save to lab book writes", () => {
  it("writes the assembly when it has panels", () => {
    expect(labbookSvgSource(2, FIGURE_DEFAULTS, 2)).toEqual({ kind: "assembly" });
    expect(labbookSvgSource(1, FIGURE_DEFAULTS, 1)).toEqual({ kind: "assembly" });
  });
  it("keeps a single-plot figure as it was", () => {
    expect(labbookSvgSource(1, null, 0)).toEqual({ kind: "single" });
    expect(labbookSvgSource(1, FIGURE_DEFAULTS, 0)).toEqual({ kind: "single" });
  });
  it("refuses several plots without a figure, saying what to do", () => {
    const r = labbookSvgSource(2, null, 0);
    expect(r.kind).toBe("error");
    expect(r.kind === "error" && r.message).toMatch(/2 plots and no figure: tag the panels/);
    expect(labbookSvgSource(2, FIGURE_DEFAULTS, 0).kind).toBe("error");
  });
});
