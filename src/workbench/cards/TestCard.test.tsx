import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { TestCard } from "./TestCard";
import { seedStore } from "./cardTestStore";
import { setAnalysisByIdAtom } from "../../state";
import type { AnalyzeResponse } from "../../types";

const target = { kind: "edge" as const, id: "t0" };

/* A partial AnalyzeResponse rich enough for both the picker (TestPicker) and the
   results (StatsResults) to render — only the fields the components read. */
const fixture = {
  stats: {
    result: {
      test: "welch_t", t: 2.5, df: 18.3, p: 0.022,
      mean_diff: 1.4, mean_diff_ci: [0.2, 2.6],
      effect: { name: "hedges_g", value: 0.8, ci: [0.1, 1.5] },
    },
    recommendation: { test: "welch_t", reason: "two independent numeric groups" },
    checks: [],
    summaries: [],
    decision: null,
    alpha: 0.05,
    methods_text: "Welch's t-test was used to compare the two groups.",
  },
  stat_model: {
    design: "Two independent groups",
    issues: [],
    family: "group_comparison",
    pairing: null,
    chosen_by: "inferred",
  },
} as unknown as AnalyzeResponse;

describe("TestCard", () => {
  it("renders the picker (not the results) inside the card wrapper", () => {
    const { store, plottable } = seedStore();
    store.set(setAnalysisByIdAtom, { id: plottable.id, res: fixture });
    render(<Provider store={store}><TestCard target={target} /></Provider>);
    expect(screen.getByTestId("test-card")).toBeInTheDocument();
    // picker marker present…
    expect(screen.getByText(/Describe only/i)).toBeInTheDocument();
    // …results marker absent.
    expect(screen.queryByText(/Methods text/i)).toBeNull();
  });
});
