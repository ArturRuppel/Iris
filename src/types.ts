/* Shared types mirroring the frozen analysis-spec schema (v1.0). */

export interface ColumnDef {
  name: string;
  type: "numeric" | "categorical" | "identifier" | "bool";
  label: string;
  unit?: string;
  levels?: string[];
  labels?: Record<string, string>;
}
export interface Schema { schema_version: string; columns: ColumnDef[] }
export interface Row {
  id: string;
  excluded: boolean;
  [col: string]: string | number | boolean | null;
}
export interface Table { schema: Schema; rows: Row[] }

export interface TableCounts { total: number; excluded: number }

/* a handle to the server-owned session table: the browser holds this (id +
   version + schema + row count + included/excluded split), not the N rows. */
export interface TableHandle {
  id: string;
  n: number;
  version: number;
  schema: Schema;
  counts?: TableCounts;
}

/* the compact wire form of a full table: one array per column instead of one
   object per row, so a wide table doesn't repeat every column name on every
   row. /import/commit returns this; the frontend decodes it to Row[] (which the
   grid and figure code consume) via tableFromColumnar. */
export interface ColumnarTable {
  schema: Schema;
  columns: Record<string, (string | number | boolean | null)[]>;
  n: number;
}

export function tableFromColumnar(ct: ColumnarTable): Table {
  const names = Object.keys(ct.columns);
  const cols = names.map((name) => ct.columns[name]);
  const rows: Row[] = new Array(ct.n);
  for (let i = 0; i < ct.n; i++) {
    const r: Record<string, string | number | boolean | null> = {};
    for (let c = 0; c < names.length; c++) r[names[c]] = cols[c][i];
    rows[i] = r as Row;
  }
  return { schema: ct.schema, rows };
}

export type StatsFamily = "group_comparison" | "correlation" | "descriptive" | "contingency" | "timeseries";
export type TestName =
  | "welch_t" | "mann_whitney" | "paired_t" | "wilcoxon"
  | "one_way_anova" | "kruskal"
  | "pearson" | "spearman" | "descriptive"
  | "chi_square" | "fisher_exact";

/* One pairwise comparison in a multi-group result: the two group labels, the
   raw and (multiplicity-)adjusted p-values, and the significance stars. */
export interface PairwiseComparison {
  a: string;
  b: string;
  p: number;
  p_adj: number;
  stars: string;
  mean_diff?: number;
  effect?: { name: string; value: number };
}
export type Mark =
  | "dot" | "summary" | "box" | "violin" | "bar"
  | "scatter" | "regression" | "histogram" | "density";

/* the live geom vocabulary: histogram/density were folded into a single
   `distribution` geom (see migrateDistLayers). The legacy names remain in `Mark`
   only so an older .viz still type-checks while it is migrated on load. */
export type Geom =
  | "dot" | "summary" | "box" | "violin" | "bar"
  | "scatter" | "regression" | "distribution" | "tile"
  | "histogram" | "density";

/* Data-hierarchy redesign: a layer draws from a data *level* of the hierarchy
   (a spine column name, or "" = the raw/finest reduced rows). A dot at "" is the
   faint replicate cloud; a dot at a coarse level is one bold mark per grain; a
   summary at a coarse level shows mean ± error of that level's spread — composing
   a superplot with no preset. The unit columns live on the plottable's
   `hierarchy`, shared by every consumer. */
export interface Layer { geom: Geom; params: Record<string, unknown>; level: string }

/* How finer rows aggregate into a coarser grain — the set the engine's
   `materialize_levels` honors (hierarchy._AGG). This is the only aggregation
   surface: there is no separate reduce-step aggregate. */
export type LevelFn = "mean" | "median" | "sum" | "min" | "max";
export const LEVEL_FNS: LevelFn[] = ["mean", "median", "sum", "min", "max"];

/* The nesting spine (coarsest → finest, e.g. date › position › cell › frame) and
   the per-level aggregate function (default mean). Defined once per plottable;
   each layer and the reduced-table preview pick a level from it. */
export interface Hierarchy { spine: string[]; fn: Record<string, LevelFn> }
export const EMPTY_HIERARCHY: Hierarchy = { spine: [], fn: {} };
export const RAW_LEVEL = "";

/* /hierarchy describe response: per-level grain cardinalities and where each
   classifier attaches (its home level), for the Data-tab editor + visualization. */
export interface HierarchyInfo {
  spine: string[];
  levels: { name: string; n_groups: number }[];
  classifiers: { name: string; home: string | null; n_levels: number }[];
  n_raw: number;
}

export interface ParamSpec {
  key: string; label: string;
  type: "number" | "select" | "bool";
  min?: number; max?: number; step?: number; options?: string[];
}
export interface GeomMeta {
  label: string; family: StatsFamily; aggregates: boolean;
  needs: string[];
  /* Phase 3: the column type each axis requires, driving type-match gating.
     "categorical" | "numeric" | "none" ("none" = the axis must be absent). */
  x_type: string; y_type: string;
  /* Phase 3c: true on group-comparison geoms that render horizontally when the
     encoding has numeric x + categorical y; lets the offer rule surface
     categorical columns on Y and enables those geoms for the swapped types. */
  h_orient?: boolean;
  params: Record<string, unknown>;
  param_specs: ParamSpec[]; point_cap: number | null;
  aes: string[];   // accepted aesthetic channels: "color" | "size" | "shape"
}
export interface Registry {
  point_cap: number; facet_cell_cap: number; geoms: Record<string, GeomMeta>;
}

export interface StatModel {
  design: string;
  family: StatsFamily | "none";
  factors: { column: string; role: string }[];
  test: TestName | null;
  facet_handling: { per_facet: boolean; correction: "holm" | "bonferroni" | null } | null;
  chosen_by: "inferred" | "user_override" | "describe_only";
  /* Hierarchy redesign: the spine present after reduction, the pairing verdict
     for the comparison qualifier (derived from the spine), and the inferential
     grain — the coarsest level any layer draws at, the grain the test actually
     reads so plot and stats share one materialization. All absent for
     non-comparison families. */
  spine?: string[];
  pairing?: Pairing | null;
  inferential_level?: string;
  issues: unknown[];
}

/* Paired/partially-paired/unpaired follows from the spine: a comparison
   qualifier is paired over the spine levels coarser than its home level. */
export interface Pairing {
  qualifier: string;
  verdict: "paired" | "partially_paired" | "unpaired";
  across: string | null;
  n_units: number;
  n_complete: number;
  levels?: string[];
}
export interface Issue {
  level: "blocking" | "warning";
  code: string; message: string; geom: string | null;
}

/* ---- reduction: an ordered pipeline of steps applied top-to-bottom ----
   each step transforms the output of the one above (spec_version 1.3). */
export type FilterOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not-in";
export interface FilterCond {
  column: string;
  op: FilterOp;
  value: string | number | (string | number)[]; // array only for in / not-in
}

/* keep only these columns, in this order (projection). */
export interface SelectStep { kind: "select"; columns: string[] }
/* drop rows that fail every condition (AND-ed). */
export interface FilterStep { kind: "filter"; conditions: FilterCond[] }
/* Reduction only filters/projects rows — it never aggregates. Coarsening to a
   grain is the data hierarchy's job (pick a level), so the figure and the stats
   read one shared grain rather than a destructive collapse. */
export type ReduceStep = SelectStep | FilterStep;
export type ReduceStepKind = ReduceStep["kind"];

export interface ReduceSpec { steps: ReduceStep[] } // [] means the full table
export const EMPTY_REDUCE: ReduceSpec = { steps: [] };

/* ---- /reduce preview payload (display-only; no figure/stats render) ---- */
export interface ColumnSummary {
  column: string; n: number; n_distinct: number; n_missing: number;
}
export interface StepTrace { n_rows_out: number; schema_out: Schema }
export interface ReducePreview {
  preview: Table;        // reduced rows, capped to the first PREVIEW_CAP
  n_total: number;       // true final row count
  trace: StepTrace[];    // one entry per step, in order
  summary: ColumnSummary[];
}

/* every key the style panel exposes; the engine fills in defaults, so all
   fields are optional and an empty object means "preset look" */
export interface StyleOverrides {
  width_mm?: number;
  height_mm?: number;
  font_size_pt?: number;
  marker_size?: number;
  marker_alpha?: number;
  jitter?: number;
  axis_linewidth?: number;
  line_width?: number;
  frame?: "open" | "closed";
  grid_x?: boolean;
  grid_y?: boolean;
  palette?: string[];
  title?: string;
  x_label?: string;
  y_label?: string;
  /* written by dragging labels on the figure; SVG px, y down */
  offsets?: Record<string, [number, number]>;
  /* axes & ticks */
  tick_direction?: "out" | "in" | "inout";
  tick_length?: number;
  x_tick_side?: "bottom" | "top";
  y_tick_side?: "left" | "right";
  x_tick_spacing?: number;
  y_tick_spacing?: number;
  minor_ticks?: boolean;
  x_tick_rotation?: number;
  y_scale?: "linear" | "log";
  x_scale?: "linear" | "log";
  y_min?: number;
  y_max?: number;
  x_min?: number;
  x_max?: number;
  /* marks */
  notch?: boolean;
  mark_width?: number;
  outlier_marker?: "o" | "D" | "x" | "+" | "none";
  outlier_size?: number;
  error_type?: "ci95" | "sem" | "sd";
  capsize?: number;
  hist_bins?: number;
  /* annotations */
  show_n?: boolean;
  show_significance?: boolean;
  show_annotation?: boolean;
}

export interface AnalysisSpec {
  spec_version: "2.0";
  id: string;
  title: string;
  data: { filter: unknown[]; respect_exclusions: boolean };
  reduce: ReduceSpec;
  encodings: {
    x: { column: string } | null;
    y: { column: string } | null;
    color: { column: string } | null;
    size: { column: string } | null;   // Phase 2
    shape: { column: string } | null;  // Phase 2
  };
  /* Phase 4: row/col map to categorical columns for small-multiples; mapping
     either forces describe-only (no per-facet inferential test, v1). */
  facet: {
    row: { column: string } | null;
    col: { column: string } | null;
    share_x: boolean; share_y: boolean;
  };
  /* the data hierarchy (nesting spine + per-level aggregate); each layer's
     `level` selects a grain from it. */
  hierarchy: Hierarchy;
  layers: Layer[];
  stats: {
    family: StatsFamily;
    test: TestName;
    chosen_by: "recommendation_accepted" | "user_override" | "default" | "describe_only";
    alternatives_offered: string[];
    assumption_checks: { check: string; per: string }[];
    alpha: number;
    report: string[];
  };
  annotations: { significance_brackets: "auto"; show_n: boolean };
  style: { preset: string; overrides: StyleOverrides };
  engine_snapshot: Record<string, string>;
}

export interface Check {
  check: string; group: string; ok: boolean;
  W?: number; p?: number; n?: number; reason?: string;
}
export interface StatsDecision {
  recommended: string;
  chosen: string;
  chosen_by: "recommendation_accepted" | "user_override";
  reason: string;
  options: string[];
}

export interface StatsResult {
  levels: string[];
  checks: Check[];
  recommendation: { test: string; reason: string };
  chosen_by: string;
  /* §5 guided picker: each question's recommendation + what was chosen. Present
     for group comparisons; absent for the other families. */
  decision?: {
    structural: StatsDecision;
    assumption: StatsDecision;
  };
  result: {
    test: string; p?: number; t?: number; df?: number; U?: number; W?: number;
    mean_diff?: number; mean_diff_ci?: [number, number];
    r?: number; n?: number; chi2?: number; dof?: number; odds_ratio?: number;
    mean?: number; sd?: number; median?: number; q1?: number; q3?: number;
    min?: number; max?: number;
    /* multi-group (>2 levels): omnibus stat + per-pair corrected comparisons */
    F?: number; df_between?: number; df_within?: number; H?: number; k?: number;
    pairwise?: PairwiseComparison[]; correction?: string;
    effect: { name: string; value: number; ci: [number, number] | null };
  };
  regression?: { slope: number; intercept: number };
  summaries: { group: string; n: number; mean: number; sd: number; ci95_half: number }[];
  alpha: number;
  methods_text: string;
}
/* A point group's k-th drawn mark maps to row_ids[k]. Hierarchy redesign:
   an entry is the chained list of raw row-ids behind that mark (a coarse mark
   aggregates many rows); a bare string is shorthand for a single raw row. */
export type PointRowIds = (string | string[])[];
export interface AnalyzeResponse {
  figure: { svg: string; point_groups: { gid: string; row_ids: PointRowIds }[] };
  stats: StatsResult;
  stat_model: StatModel;
  issues: Issue[];
  engine_snapshot: Record<string, string>;
}

/* Upgrade a serialized analysis to spec_version 2.0. Legacy reduce shapes become
   the ordered steps[] pipeline (filter/select only — aggregation moved to the
   data hierarchy); legacy mappings become encodings; legacy {mark, options|stat}
   layers become {geom, params}. Lossless: the engine does the same normalization
   server-side. */
export function migrateSpec(an: Record<string, unknown>): AnalysisSpec {
  if ((an as { spec_version?: string }).spec_version === "2.0") {
    return an as unknown as AnalysisSpec;
  }
  const base = an as Record<string, unknown>;

  /* --- reduce: legacy {filter} -> steps[] --- */
  const steps: ReduceStep[] = [];
  const r = base.reduce as
    | { filter?: FilterCond[]; steps?: ReduceStep[] }
    | undefined;
  let reduce: ReduceSpec;
  if (r?.steps) reduce = { steps: r.steps };
  else {
    if (r?.filter && r.filter.length) steps.push({ kind: "filter", conditions: r.filter });
    reduce = { steps };
  }

  /* --- mappings -> encodings --- */
  const m = (base.mappings ?? {}) as Record<string, { column: string } | null>;
  const encodings = {
    x: m.x ?? null, y: m.y ?? null, color: m.color ?? null,
    size: null, shape: null,
  };

  /* --- {mark, options|stat} -> {geom, params} --- */
  const legacyLayers = (base.layers ?? []) as
    { mark: Geom; options?: Record<string, unknown>; stat?: unknown }[];
  const layers: Layer[] = legacyLayers.map((l) => ({
    geom: l.mark, params: { ...(l.options ?? {}) }, level: RAW_LEVEL,
  }));

  const st = (base.stats ?? {}) as AnalysisSpec["stats"];
  const { mappings, ...rest } = base; // drop the legacy key, now folded into encodings
  void mappings;
  return {
    ...rest,
    spec_version: "2.0",
    reduce, encodings, layers,
    facet: { row: null, col: null, share_x: true, share_y: true },
    hierarchy: { ...EMPTY_HIERARCHY },
    stats: st,
  } as AnalysisSpec;
}

/* a loaded .viz: table + the analyses (raw specs, pre-migration) + provenance
   (the exclusion log). Mirrors document.load_document's payload. */
export interface LoadedDocument {
  manifest: unknown;
  schema: Schema;
  rows: Row[];                         // first window only; the engine owns the rest
  analyses: Record<string, unknown>[];
  provenance: { exclusions?: { row_id: string; excluded: boolean; at: string }[] } | null;
  id: string;                          // session handle for the loaded table
  n: number;
  version: number;
  counts: TableCounts;
}

/* ---------------- import wizard ---------------- */

export interface ReshapeOptions {
  value_columns: string[];
  var_name: string;
  value_name: string;
}
export interface ImportOptions {
  delimiter?: string | null;
  decimal?: string | null;
  header?: boolean;
  sheet?: string | null;
  types?: Record<string, ColumnDef["type"]>;
  reshape?: ReshapeOptions | null;
}
export interface ImportColumn {
  name: string;
  label: string;
  type: ColumnDef["type"];
  /* full-data stats are absent on the headers-first (provisional) pass and
     filled in by the subsequent full preview */
  n_missing?: number;
  n_distinct?: number;
  n_unparsed?: number;
  levels?: string[];
  examples: string[];
  /* a 0/1 column: stays numeric by default but the wizard suggests bool */
  suggest_bool?: boolean;
}
export interface ImportPreview {
  options: {
    kind: "csv" | "excel";
    delimiter: string | null;
    decimal: string;
    encoding: string | null;
    header: boolean;
    sheet: string | null;
    sheets: string[] | null;
    reshape?: ReshapeOptions | null;
  };
  columns: ImportColumn[];
  rows: Row[];
  /* null until the full parse completes (headers-first pass doesn't count rows) */
  n_rows: number | null;
  /* true on the fast headers-first pass: columns/types known, stats still loading */
  provisional?: boolean;
}

/* ---------------- protocol client ---------------- */

declare global {
  interface Window {
    /* present when running inside the Tauri shell (withGlobalTauri) */
    __TAURI__?: { core: { invoke<T>(cmd: string): Promise<T> } };
  }
}

/* Dev mode uses a fixed port; under the shell the port is chosen at runtime
   (collision handling) and fetched from the `engine_port` command. */
const baseUrl: Promise<string> = (async () => {
  if (window.__TAURI__) {
    try {
      const port = await window.__TAURI__.core.invoke<number>("engine_port");
      return `http://127.0.0.1:${port}`;
    } catch {
      /* fall through to the dev default */
    }
  }
  return `http://127.0.0.1:${(import.meta as any).env?.VITE_ENGINE_PORT ?? 8765}`;
})();

async function get<T>(path: string): Promise<T> {
  const r = await fetch((await baseUrl) + path);
  if (!r.ok) throw new Error(r.statusText);
  return r.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch((await baseUrl) + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail ?? r.statusText);
  return r.json();
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/* a request may carry the full table inline, or reference one already uploaded
   via /table by its content token (cheap on large tables) */
export type TableRef = Table | { token: string };
const tableField = (t: TableRef) =>
  "token" in t ? { table_token: t.token } : { table: t };

export const engine = {
  health: () => get<{ engine_snapshot: Record<string, string>; registry: Registry }>("/health"),
  /* a frozen sidecar takes a few seconds to boot; poll instead of giving up */
  waitForHealth: async (attempts = 30, delayMs = 500) => {
    for (let i = 0; ; i++) {
      try {
        return await engine.health();
      } catch (e) {
        if (i >= attempts - 1) throw e;
        await sleep(delayMs);
      }
    }
  },
  sample: (): Promise<Table> => get<Table>("/sample"),
  createSession: (table: Table) =>
    post<{ id: string; n: number; version: number; schema: Schema; counts: TableCounts }>(
      "/table/create", { table }),
  rowsWindow: (id: string, start: number, end: number) =>
    post<{ rows: Row[]; n: number; version: number }>(
      `/table/${id}/rows`, { start, end }),
  editCell: (id: string, rowId: string, column: string, value: unknown) =>
    post<{ version: number; counts: TableCounts }>(`/table/${id}/edit`,
      { row_id: rowId, column, value }),
  toggleExclude: (id: string, rowId: string) =>
    post<{ excluded: boolean; version: number; counts: TableCounts }>(`/table/${id}/exclude`,
      { row_id: rowId }),
  distinct: (id: string, column: string) =>
    post<{ values: string[] }>(`/table/${id}/distinct`, { column }),
  analyze: (t: TableRef, spec: AnalysisSpec) =>
    post<AnalyzeResponse>("/analyze", { ...tableField(t), spec }),
  reduce: (t: TableRef, steps: ReduceStep[], hierarchy?: Hierarchy, level?: string) =>
    post<ReducePreview>("/reduce", { ...tableField(t), steps, hierarchy, level }),
  hierarchy: (t: TableRef, spine: string[], classifiers: string[]) =>
    post<HierarchyInfo>("/hierarchy", { ...tableField(t), spine, classifiers }),
  export: (t: TableRef, spec: AnalysisSpec, format: "svg" | "pdf" | "png") =>
    post<{ filename: string; data_base64: string }>(
      "/export", { ...tableField(t), spec, format, dpi: 300 }),
  saveDocument: (tableId: string, analyses: AnalysisSpec[], provenance: unknown) =>
    post<{ filename: string; data_base64: string }>(
      "/document/save", { table_id: tableId, analyses, provenance }),
  /* read back a saved .viz; analyses come as raw specs (run through migrateSpec) */
  loadDocument: (dataBase64: string) =>
    post<LoadedDocument>("/document/load", { data_base64: dataBase64 }),
  /* upload a file's bytes once; preview/commit then reference it by token so
     wizard edits don't re-ship the whole file (see ImportSource) */
  importUpload: (filename: string, dataBase64: string) =>
    post<{ token: string }>("/import/upload", { filename, data_base64: dataBase64 }),
  /* fast first pass: column names + a provisional type guess from a head
     sample, so the wizard paints before the whole file is parsed */
  importHeaders: (src: ImportSource, options: ImportOptions = {}) =>
    post<ImportPreview>("/import/headers", { ...src, options }),
  importPreview: (src: ImportSource, options: ImportOptions = {}) =>
    post<ImportPreview>("/import/preview", { ...src, options }),
  importCommit: (src: ImportSource, options: ImportOptions,
                 columns: { name: string; label: string; type: ColumnDef["type"] }[]) =>
    post<ColumnarTable & { token: string }>("/import/commit", { ...src, options, columns }),
};

/* an import file is referenced either inline (small typed entries) or, once
   uploaded, by its content token (large picked files) */
export type ImportSource =
  | { filename: string; data_base64: string }
  | { filename: string; file_token: string };

export function fileToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function downloadBase64(filename: string, b64: string) {
  const a = document.createElement("a");
  a.href = "data:application/octet-stream;base64," + b64;
  a.download = filename;
  a.click();
}
