import { describe, expect, it } from "vitest";
import { plotSizeMm, resizeCanvas, setPlotSize } from "./plotArea";

describe("plot area vs canvas", () => {
  const legacy = { width_mm: 100, height_mm: 50, axes_rect: [0.1, 0.2, 0.6, 0.7] as [number, number, number, number] };

  it("reads the pinned size, either dimension alone", () => {
    expect(plotSizeMm({ plot_w_mm: 60, plot_h_mm: 35 })).toEqual({ width: 60, height: 35 });
    expect(plotSizeMm({ plot_h_mm: 35 })).toEqual({ height: 35 });
    expect(plotSizeMm({})).toBeNull();
  });

  it("reads a legacy rect for its size only", () => {
    expect(plotSizeMm(legacy)).toEqual({ width: 60, height: 35 });
    expect(plotSizeMm({ ...legacy, plot_w_mm: 50 })).toEqual({ width: 50, height: 35 });
  });

  it("pins, pins one dimension, and unpins; a legacy rect is dropped", () => {
    const pinned = setPlotSize({ width_mm: 100 }, { width: 60.26, height: 35 });
    expect(pinned).toEqual({ width_mm: 100, plot_w_mm: 60.3, plot_h_mm: 35 });
    expect(setPlotSize(pinned, { height: 40 })).toEqual({ width_mm: 100, plot_h_mm: 40 });
    expect(setPlotSize(legacy, { width: 60 })).toEqual({ width_mm: 100, height_mm: 50, plot_w_mm: 60 });
    expect(setPlotSize(legacy, null)).toEqual({ width_mm: 100, height_mm: 50 });
    expect(setPlotSize({}, { width: 1 }).plot_w_mm).toBe(5);
  });

  it("keeps the plot size when the canvas changes", () => {
    const next = resizeCanvas({ width_mm: 100, plot_w_mm: 60 }, 140, 70);
    expect(next).toEqual({ width_mm: 140, height_mm: 70, plot_w_mm: 60 });
    expect(resizeCanvas(legacy, 140, 70)).toEqual({ width_mm: 140, height_mm: 70, plot_w_mm: 60, plot_h_mm: 35 });
  });

  it("leaves an automatic plot area automatic", () => {
    expect(resizeCanvas({ width_mm: 100 }, 120, undefined)).toEqual({ width_mm: 120 });
  });
});
