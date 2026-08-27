import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { StatsResults } from "./StatsPanel";
import { seedStore } from "../workbench/cards/cardTestStore";
import { setAnalysisByIdAtom } from "../state";
import type { AnalyzeResponse, StatsResult } from "../types";

/* An analysis whose stats half is supplied per test; the figure/model halves are
   fixed since the results readout never reads them. */
function mount(stats: Partial<StatsResult>) {
  const { store, plottable } = seedStore();
  const res = {
    figure: { svg: "<svg/>" },
    issues: [], engine_snapshot: {},
    stat_model: {
      design: "Two independent groups", issues: [],
      family: "group_comparison", pairing: null, chosen_by: "inferred",
    },
    stats: {
      levels: [], checks: [], per_group: undefined, decision: null,
      recommendation: { test: "welch_t", reason: "two independent numeric groups" },
      alpha: 0.05, methods_text: "…",
      ...stats,
    },
  } as unknown as AnalyzeResponse;
  store.set(setAnalysisByIdAtom, { id: plottable.id, res });
  render(<Provider store={store}><StatsResults /></Provider>);
}

const WELCH = {
  test: "welch_t", p: 0.02, t: 2.4, df: 17.3, n: 24,
  mean_diff: 1.4, mean_diff_ci: [0.2, 2.6],
  effect: { name: "hedges_g", value: 0.8, ci: [0.1, 1.5] },
};

describe("StatsResults per-group summary", () => {
  // The engine has always shipped ci95_half and the glossary has always
  // promised it; until this test the panel dropped it on the floor.
  it("renders the 95% CI of the mean alongside n, mean and SD", () => {
    mount({
      result: WELCH as never,
      summaries: [{ group: "ctrl", n: 12, mean: 10, sd: 1.1, ci95_half: 2 }],
    });
    expect(screen.getByText(/^n = 12,/).textContent)
      .toBe("n = 12, mean 10.0 (SD 1.1; 95% CI 8.0, 12.0)");
  });

  // n = 1 has no interval: the engine sends ci95_half = 0.0 as a floor, which
  // would render as "95% CI 10.0, 10.0" — a fabricated bound. Iris does not
  // print a CI it does not have.
  it("omits the CI for a single-observation group", () => {
    mount({
      result: WELCH as never,
      summaries: [{ group: "solo", n: 1, mean: 10, sd: 0, ci95_half: 0 }],
    });
    expect(screen.getByText(/^n = 1,/).textContent).toBe("n = 1, mean 10.0 (SD 0.0)");
  });

  // an all-identical group has a genuine zero-width interval — that is a real
  // number, not a missing one, so it prints.
  it("keeps a zero-width CI when n supports one", () => {
    mount({
      result: WELCH as never,
      summaries: [{ group: "flat", n: 5, mean: 10, sd: 0, ci95_half: 0 }],
    });
    expect(screen.getByText(/^n = 5,/).textContent).toContain("95% CI 10.0, 10.0");
  });
});

describe("StatsResults descriptive block", () => {
  it("renders the 95% CI of the mean", () => {
    mount({
      result: {
        test: "descriptive", n: 9, mean: 10, sd: 1.5,
        median: 9.8, q1: 9, q3: 11, min: 7, max: 13,
        effect: { name: "none", value: 0, ci: null },
      } as never,
      summaries: [{ group: "val", n: 9, mean: 10, sd: 1.5, ci95_half: 1.15 }],
    });
    expect(screen.getByText(/95% CI of mean/)).toBeInTheDocument();
    expect(screen.getByText("8.85, 11.15")).toBeInTheDocument();
  });
});
