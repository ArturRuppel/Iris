import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "jotai";
import { TestPicker, StatsResults } from "./StatsPanel";
import { CollapseRoutingPanel } from "./CollapseRoutingPanel";
import { StatsCard } from "../workbench/cards/StatsCard";
import { seedStore } from "../workbench/cards/cardTestStore";
import {
  activePlottableAtom, setAnalysisByIdAtom, specAtom, buildSpec, plottableFromSpec,
} from "../state";
import { openCardAtom, setStatsOffAtom, stashAtom, pushStashAtom } from "../workbench/state";
import { affordances } from "../workbench/authoring";
import type { AnalyzeResponse } from "../types";
import type { ExplorerNode } from "../explorer/graph";

/* "No statistics" (`stats.off`): the toggle in the test editor, the way back
   ("Add statistics"), and every stats surface hiding while it is set. */

function seeded() {
  const { store, plottable } = seedStore();
  store.set(activePlottableAtom, { ...plottable,
    mappings: { x: "experiment", y: "val" }, layers: [{ id: "ly1", geom: "box", level: "" }] });
  const res = {
    figure: { svg: "<svg/>" }, issues: [], engine_snapshot: {},
    stat_model: { design: "Two independent groups", issues: [], family: "group_comparison",
      pairing: null, chosen_by: "inferred" },
    stats: {
      levels: ["a", "b"], checks: [], decision: null, summaries: [],
      recommendation: { test: "welch_t", reason: "two independent numeric groups" },
      result: { test: "welch_t", p: 0.02, t: 2.4, df: 17.3, n: 24,
        mean_diff: 1.4, mean_diff_ci: [0.2, 2.6],
        effect: { name: "hedges_g", value: 0.8, ci: [0.1, 1.5] } },
      alpha: 0.05, methods_text: "A Welch test.",
    },
  } as unknown as AnalyzeResponse;
  store.set(setAnalysisByIdAtom, { id: plottable.id, res });
  return { store, id: plottable.id };
}

describe("No statistics toggle", () => {
  it("the test editor offers it; clicking sets stats.off on the spec", () => {
    const { store } = seeded();
    render(<Provider store={store}><TestPicker /></Provider>);
    expect(store.get(specAtom)!.stats.off).toBeUndefined();
    fireEvent.click(screen.getByTestId("stats-off"));
    expect(store.get(activePlottableAtom)!.statsOff).toBe(true);
    expect(store.get(specAtom)!.stats.off).toBe(true);
    // the picker itself gives way to the notice
    expect(screen.queryByTestId("stats-off")).not.toBeInTheDocument();
    expect(screen.getByTestId("stats-off-notice")).toBeInTheDocument();
  });

  it("while off, the Stats card shows neither the result nor the picker", () => {
    const { store } = seeded();
    store.set(setStatsOffAtom, true);
    render(<Provider store={store}><StatsCard target={{ kind: "node", id: "figure", facet: "stats" }} /></Provider>);
    expect(screen.queryByText(/methods text/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/describe only/i)).not.toBeInTheDocument();
    expect(screen.getAllByTestId("stats-off-notice")).toHaveLength(1);
  });

  it("turning it off swaps a shown Stats card for the plot", () => {
    const { store } = seeded();
    store.set(pushStashAtom, { target: { kind: "node", id: "figure", facet: "stats" }, cardKind: "stats" });
    store.set(setStatsOffAtom, true);
    expect(store.get(stashAtom).map((e) => e.cardKind)).toEqual(["plot"]);
  });

  it("turning it off drops the reference line the test drew, keeps one set by hand", () => {
    const { store } = seeded();
    const p = store.get(activePlottableAtom)!;
    store.set(activePlottableAtom, { ...p, reference: 0, style: { ...p.style, reference_value: 0 } });
    store.set(setStatsOffAtom, true);
    expect(store.get(activePlottableAtom)!.style.reference_value).toBeUndefined();
    store.set(setStatsOffAtom, false);
    const q = store.get(activePlottableAtom)!;
    store.set(activePlottableAtom, { ...q, reference: 0, style: { ...q.style, reference_value: 0.5 } });
    store.set(setStatsOffAtom, true);
    expect(store.get(activePlottableAtom)!.style.reference_value).toBe(0.5);
  });

  it("Add statistics (the + menu's test action) turns them back on and opens the Stats card", () => {
    const { store } = seeded();
    store.set(setStatsOffAtom, true);
    store.set(openCardAtom, { target: { kind: "edge", id: "t:test" }, cardKind: "test-editor" });
    expect(store.get(activePlottableAtom)!.statsOff).toBeUndefined();
    expect(store.get(specAtom)!.stats.off).toBeUndefined();
    expect(store.get(stashAtom).map((e) => e.cardKind)).toEqual(["stats"]);
  });

  it("the notice's Add statistics button turns them back on", () => {
    const { store } = seeded();
    store.set(setStatsOffAtom, true);
    render(<Provider store={store}><StatsResults /></Provider>);
    fireEvent.click(screen.getByRole("button", { name: "Add statistics" }));
    expect(store.get(activePlottableAtom)!.statsOff).toBeUndefined();
  });

  it("the + menu labels the test option 'Add statistics' only while off", () => {
    const grain: ExplorerNode = { id: "grain:experiment", kind: "table", phase: "grain",
      label: "per experiment", table: { via: "none" } };
    const label = (off: boolean) =>
      affordances(grain, off).find((o) => o.action.kind === "test")?.label;
    expect(label(false)).toBe("Stats (test)");
    expect(label(true)).toBe("Add statistics");
  });

  it("hides the collapse card's 'Test reads at' control while off", () => {
    const { store } = seeded();
    store.set(setStatsOffAtom, true);
    render(<Provider store={store}><CollapseRoutingPanel /></Provider>);
    expect(screen.queryByLabelText(/test reads at/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /remove level/i }).length).toBeGreaterThan(0);
  });

  it("round-trips through spec build / load; absent stays absent", () => {
    const { store } = seeded();
    const p = store.get(activePlottableAtom)!;
    const hier = { spine: ["experiment", "cell"], fn: {} };
    const off = buildSpec({ ...p, statsOff: true }, "group_comparison", undefined, {}, hier, {},
      { sources: [{ id: "src", tableId: "main" }], steps: [] } as never);
    expect(off.stats.off).toBe(true);
    expect(plottableFromSpec(off).p.statsOff).toBe(true);
    const on = buildSpec(p, "group_comparison", undefined, {}, hier, {},
      { sources: [{ id: "src", tableId: "main" }], steps: [] } as never);
    expect("off" in on.stats).toBe(false);
    expect(plottableFromSpec(on).p.statsOff).toBeUndefined();
  });
});
