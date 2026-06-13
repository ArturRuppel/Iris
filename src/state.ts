import { atom } from "jotai";
import { EMPTY_REDUCE } from "./types";
import type {
  AnalysisSpec, AnalyzeResponse, Mark, Schema, Row, StatsFamily,
  StyleOverrides, Table, TestName,
} from "./types";

export const schemaAtom = atom<Schema | null>(null);
export const rowsAtom = atom<Row[]>([]);
export const mappingsAtom = atom({ x: "treatment", y: "response" });
export const overrideAtom = atom<TestName | null>(null);
export const presetAtom = atom("demo_default");
export const analysisAtom = atom<AnalyzeResponse | null>(null);
export const engineErrorAtom = atom<string | null>(null);
export const engineSnapshotAtom = atom<Record<string, string> | null>(null);

/* must match compiler.PALETTE; the style panel edits copies of it */
export const DEFAULT_PALETTE = ["#0e7490", "#c2410c", "#4d7c0f", "#7c3aed"];
export const styleAtom = atom<StyleOverrides>({});

/* figure-side point selection (click); exclusion goes via right-click menu */
export const selectedRowIdAtom = atom<string | null>(null);

/* plot type drives the spec's layers + stats family; each entry is a
   sensible mark composition, not a free-form layer editor (yet) */
export type PlotType = "dots" | "box" | "violin" | "bar" | "scatter" | "histogram";
export const PLOT_TYPES: Record<PlotType, {
  label: string;
  family: StatsFamily;
  layers: AnalysisSpec["layers"];
  tests: TestName[];
  xKind: "categorical" | "numeric" | "none";
}> = {
  dots: {
    label: "Dots + mean ± CI", family: "group_comparison",
    layers: [{ mark: "dot" as Mark, options: { jitter: 0.18 } },
             { mark: "summary" as Mark, stat: { center: "mean", error: "ci95" } }],
    tests: ["welch_t", "mann_whitney"], xKind: "categorical",
  },
  box: {
    label: "Box + dots", family: "group_comparison",
    layers: [{ mark: "box" as Mark, options: {} },
             { mark: "dot" as Mark, options: { jitter: 0.18 } }],
    tests: ["welch_t", "mann_whitney"], xKind: "categorical",
  },
  violin: {
    label: "Violin + dots", family: "group_comparison",
    layers: [{ mark: "violin" as Mark, options: {} },
             { mark: "dot" as Mark, options: { jitter: 0.18 } }],
    tests: ["welch_t", "mann_whitney"], xKind: "categorical",
  },
  bar: {
    label: "Bar ± CI", family: "group_comparison",
    layers: [{ mark: "bar" as Mark, stat: { center: "mean", error: "ci95" } }],
    tests: ["welch_t", "mann_whitney"], xKind: "categorical",
  },
  scatter: {
    label: "Scatter + regression", family: "correlation",
    layers: [{ mark: "scatter" as Mark, options: {} },
             { mark: "regression" as Mark, options: { ci: 95 } }],
    tests: ["pearson", "spearman"], xKind: "numeric",
  },
  histogram: {
    label: "Histogram + density", family: "descriptive",
    layers: [{ mark: "histogram" as Mark, options: { bins: "auto" } },
             { mark: "density" as Mark, options: {} }],
    tests: ["descriptive"], xKind: "none",
  },
};
export const plotTypeAtom = atom<PlotType>("dots");

/* provenance: every exclusion toggle is logged, never silently applied */
export interface ExclusionEvent { row_id: string; excluded: boolean; at: string }
export const exclusionLogAtom = atom<ExclusionEvent[]>([]);

export const toggleExclusionAtom = atom(null, (get, set, rowId: string) => {
  const rows = get(rowsAtom);
  const row = rows.find((r) => r.id === rowId);
  if (!row) return;
  set(rowsAtom, rows.map((r) => (r.id === rowId ? { ...r, excluded: !r.excluded } : r)));
  set(exclusionLogAtom, [...get(exclusionLogAtom),
    { row_id: rowId, excluded: !row.excluded, at: new Date().toISOString() }]);
});

/* swap in a freshly imported (or loaded) table and reset everything that
   referred to the old one: mappings, override, analysis, exclusion log */
export const loadTableAtom = atom(null, (get, set, table: Table) => {
  set(schemaAtom, table.schema);
  set(rowsAtom, table.rows);
  set(exclusionLogAtom, []);
  set(analysisAtom, null);
  set(overrideAtom, null);
  set(engineErrorAtom, null);
  set(selectedRowIdAtom, null);
  /* visual style carries over; text + drag offsets were written for the old
     figure's labels and would silently mislabel the new data */
  const { title, x_label, y_label, offsets, ...keep } = get(styleAtom);
  set(styleAtom, keep);
  const cats = table.schema.columns.filter((c) => c.type === "categorical");
  const nums = table.schema.columns.filter((c) => c.type === "numeric");
  const plotType = get(plotTypeAtom);
  if (PLOT_TYPES[plotType].xKind === "categorical" && cats.length === 0)
    set(plotTypeAtom, nums.length >= 2 ? "scatter" : "histogram");
  const kind = PLOT_TYPES[get(plotTypeAtom)].xKind;
  const y = nums[nums.length - 1]?.name ?? "";
  const x = kind === "numeric"
    ? (nums.find((c) => c.name !== y)?.name ?? y)
    : (cats[0]?.name ?? "");
  set(mappingsAtom, { x, y });
});

/* the keystone: spec derived live from UI state (schema v1.1) */
export const specAtom = atom<AnalysisSpec | null>((get) => {
  const schema = get(schemaAtom);
  const m = get(mappingsAtom);
  const plotType = get(plotTypeAtom);
  const pt = PLOT_TYPES[plotType];
  const override = get(overrideAtom);
  const recRaw = get(analysisAtom)?.stats.recommendation.test as TestName | undefined;
  const rec = recRaw && pt.tests.includes(recRaw) ? recRaw : undefined;
  if (!schema) return null;
  const ycol = schema.columns.find((c) => c.name === m.y);
  const xcol = schema.columns.find((c) => c.name === m.x);
  const test = (override && pt.tests.includes(override) ? override : null)
    ?? rec ?? pt.tests[0];
  const usedOverride = override !== null && test === override && test !== rec;
  return {
    spec_version: "1.2",
    id: "an_01",
    title: pt.xKind === "none"
      ? `${ycol?.label ?? m.y}`
      : `${ycol?.label ?? m.y} by ${xcol?.label ?? m.x}`,
    data: { filter: [], respect_exclusions: true },
    reduce: EMPTY_REDUCE,
    mappings: { x: { column: m.x }, y: { column: m.y },
                color: pt.xKind === "categorical" ? { column: m.x } : null,
                pair_by: null, facet: null },
    layers: pt.layers,
    stats: {
      family: pt.family,
      test,
      chosen_by: usedOverride ? "user_override"
        : rec ? "recommendation_accepted" : "default",
      alternatives_offered: pt.tests.filter((t) => t !== test),
      assumption_checks: [{ check: "shapiro_wilk",
                            per: pt.family === "group_comparison" ? "group" : "variable" }],
      alpha: 0.05,
      report: ["effect_size", "ci", "n_per_group"],
    },
    annotations: { significance_brackets: "auto", show_n: true },
    style: { preset: get(presetAtom), overrides: get(styleAtom) },
    engine_snapshot: get(engineSnapshotAtom) ?? {},
  };
});
