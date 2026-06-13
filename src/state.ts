import { atom } from "jotai";
import { EMPTY_REDUCE } from "./types";
import type {
  AnalysisSpec, AnalyzeResponse, Mark, Schema, Row, StatsFamily,
  StyleOverrides, Table, TestName, ReduceSpec,
} from "./types";

export const schemaAtom = atom<Schema | null>(null);
export const rowsAtom = atom<Row[]>([]);
export const engineErrorAtom = atom<string | null>(null);
export const engineSnapshotAtom = atom<Record<string, string> | null>(null);

/* must match compiler.PALETTE; the style panel edits copies of it */
export const DEFAULT_PALETTE = ["#0e7490", "#c2410c", "#4d7c0f", "#7c3aed"];

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

/* ---- Plottable: one analysis bundled with its visual + reduce config ---- */

export interface Plottable {
  id: string;
  name: string;
  mappings: { x: string; y: string };
  plotType: PlotType;
  override: TestName | null;
  preset: string;
  style: StyleOverrides;
  reduce: ReduceSpec;
}

let _pid = 0;
const nextId = () => `pt_${Date.now().toString(36)}_${_pid++}`;

export function makeDefaultPlottable(schema: Schema): Plottable {
  const cats = schema.columns.filter((c) => c.type === "categorical");
  const nums = schema.columns.filter((c) => c.type === "numeric");
  let plotType: PlotType = "dots";
  if (cats.length === 0) plotType = nums.length >= 2 ? "scatter" : "histogram";
  const kind = PLOT_TYPES[plotType].xKind;
  const y = nums[nums.length - 1]?.name ?? "";
  const x = kind === "numeric"
    ? (nums.find((c) => c.name !== y)?.name ?? y)
    : (cats[0]?.name ?? "");
  return {
    id: nextId(), name: "Analysis 1",
    mappings: { x, y }, plotType, override: null,
    preset: "demo_default", style: {}, reduce: EMPTY_REDUCE,
  };
}

export const plottablesAtom = atom<Plottable[]>([]);
export const activePlottableIdAtom = atom<string | null>(null);
export const viewModeAtom = atom<"data" | "analyses">("data");

export const activePlottableAtom = atom(
  (get): Plottable | null => {
    const id = get(activePlottableIdAtom);
    return get(plottablesAtom).find((p) => p.id === id) ?? null;
  },
  (get, set, next: Plottable) => {
    set(plottablesAtom, get(plottablesAtom).map((p) => (p.id === next.id ? next : p)));
  },
);

export const analysisByIdAtom = atom<Record<string, AnalyzeResponse>>({});

/* analysisAtom: derived read/write convenience for the ACTIVE plottable */
export const analysisAtom = atom(
  (get) => {
    const id = get(activePlottableIdAtom);
    return id ? (get(analysisByIdAtom)[id] ?? null) : null;
  },
  (get, set, res: AnalyzeResponse | null) => {
    const id = get(activePlottableIdAtom);
    if (!id) return;
    const map = { ...get(analysisByIdAtom) };
    if (res) map[id] = res; else delete map[id];
    set(analysisByIdAtom, map);
  },
);

/* swap in a freshly imported (or loaded) table and reset everything that
   referred to the old one: plottables, analysis, exclusion log */
export const loadTableAtom = atom(null, (get, set, table: Table) => {
  set(schemaAtom, table.schema);
  set(rowsAtom, table.rows);
  set(exclusionLogAtom, []);
  set(engineErrorAtom, null);
  set(selectedRowIdAtom, null);
  set(analysisByIdAtom, {});
  const first = makeDefaultPlottable(table.schema);
  set(plottablesAtom, [first]);
  set(activePlottableIdAtom, first.id);
});

/* the keystone: spec derived live from active plottable state */
export const specAtom = atom<AnalysisSpec | null>((get) => {
  const schema = get(schemaAtom);
  const p = get(activePlottableAtom);
  if (!schema || !p) return null;
  const pt = PLOT_TYPES[p.plotType];
  const recRaw = get(analysisAtom)?.stats.recommendation.test as TestName | undefined;
  const rec = recRaw && pt.tests.includes(recRaw) ? recRaw : undefined;
  const ycol = schema.columns.find((c) => c.name === p.mappings.y);
  const xcol = schema.columns.find((c) => c.name === p.mappings.x);
  const test = (p.override && pt.tests.includes(p.override) ? p.override : null)
    ?? rec ?? pt.tests[0];
  const usedOverride = p.override !== null && test === p.override && test !== rec;
  return {
    spec_version: "1.2",
    id: p.id,
    title: p.name,
    data: { filter: [], respect_exclusions: true },
    reduce: p.reduce,
    mappings: { x: { column: p.mappings.x }, y: { column: p.mappings.y },
                color: pt.xKind === "categorical" ? { column: p.mappings.x } : null,
                pair_by: null, facet: null },
    layers: pt.layers,
    stats: {
      family: pt.family, test,
      chosen_by: usedOverride ? "user_override"
        : rec ? "recommendation_accepted" : "default",
      alternatives_offered: pt.tests.filter((t) => t !== test),
      assumption_checks: [{ check: "shapiro_wilk",
                            per: pt.family === "group_comparison" ? "group" : "variable" }],
      alpha: 0.05,
      report: ["effect_size", "ci", "n_per_group"],
    },
    annotations: { significance_brackets: "auto", show_n: true },
    style: { preset: p.preset, overrides: p.style },
    engine_snapshot: get(engineSnapshotAtom) ?? {},
  };
});

/* ---- CRUD atoms for managing the plottables list ---- */

export const addPlottableAtom = atom(null, (get, set) => {
  const schema = get(schemaAtom);
  if (!schema) return;
  const p = makeDefaultPlottable(schema);
  p.name = `Analysis ${get(plottablesAtom).length + 1}`;
  set(plottablesAtom, [...get(plottablesAtom), p]);
  set(activePlottableIdAtom, p.id);
});

export const duplicatePlottableAtom = atom(null, (get, set, id: string) => {
  const src = get(plottablesAtom).find((p) => p.id === id);
  if (!src) return;
  const copy: Plottable = {
    ...src, id: nextId(), name: `${src.name} copy`,
    mappings: { ...src.mappings }, style: { ...src.style },
    reduce: { filter: src.reduce.filter.map((f) => ({ ...f })),
              collapse: src.reduce.collapse
                ? { group_by: [...src.reduce.collapse.group_by],
                    aggregate: { ...src.reduce.collapse.aggregate } } : null },
  };
  set(plottablesAtom, [...get(plottablesAtom), copy]);
  set(activePlottableIdAtom, copy.id);
});

export const renamePlottableAtom = atom(null, (get, set, arg: { id: string; name: string }) => {
  set(plottablesAtom, get(plottablesAtom).map(
    (p) => (p.id === arg.id ? { ...p, name: arg.name } : p)));
});

export const deletePlottableAtom = atom(null, (get, set, id: string) => {
  const list = get(plottablesAtom);
  if (list.length <= 1) return;
  const idx = list.findIndex((p) => p.id === id);
  const next = list.filter((p) => p.id !== id);
  set(plottablesAtom, next);
  if (get(activePlottableIdAtom) === id)
    set(activePlottableIdAtom, next[Math.max(0, idx - 1)].id);
  const map = { ...get(analysisByIdAtom) }; delete map[id];
  set(analysisByIdAtom, map);
});
