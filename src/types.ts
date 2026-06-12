/* Shared types mirroring the frozen analysis-spec schema (v1.0). */

export interface ColumnDef {
  name: string;
  type: "numeric" | "categorical" | "identifier";
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

export type StatsFamily = "group_comparison" | "correlation" | "descriptive";
export type TestName =
  | "welch_t" | "mann_whitney" | "pearson" | "spearman" | "descriptive";
export type Mark =
  | "dot" | "summary" | "box" | "violin" | "bar"
  | "scatter" | "regression" | "histogram" | "density";

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
  spec_version: "1.1"; // 1.1 adds mark and test enum values (additive)
  id: string;
  title: string;
  data: { filter: unknown[]; respect_exclusions: boolean };
  mappings: {
    x: { column: string };
    y: { column: string };
    color: { column: string } | null;
    pair_by: null;
    facet: null;
  };
  layers: { mark: Mark; options?: Record<string, unknown>; stat?: unknown }[];
  stats: {
    family: StatsFamily;
    test: TestName;
    chosen_by: "recommendation_accepted" | "user_override" | "default";
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
export interface StatsResult {
  levels: string[];
  checks: Check[];
  recommendation: { test: string; reason: string };
  chosen_by: string;
  result: {
    test: string; p?: number; t?: number; df?: number; U?: number;
    mean_diff?: number; mean_diff_ci?: [number, number];
    r?: number; n?: number;
    mean?: number; sd?: number; median?: number; q1?: number; q3?: number;
    min?: number; max?: number;
    effect: { name: string; value: number; ci: [number, number] | null };
  };
  regression?: { slope: number; intercept: number };
  summaries: { group: string; n: number; mean: number; sd: number; ci95_half: number }[];
  alpha: number;
  methods_text: string;
}
export interface AnalyzeResponse {
  figure: { svg: string; point_groups: { gid: string; row_ids: string[] }[] };
  stats: StatsResult;
  engine_snapshot: Record<string, string>;
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
  n_missing: number;
  n_distinct: number;
  n_unparsed?: number;
  levels?: string[];
  examples: string[];
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
  n_rows: number;
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

export const engine = {
  health: () => get<{ engine_snapshot: Record<string, string> }>("/health"),
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
  analyze: (table: Table, spec: AnalysisSpec) =>
    post<AnalyzeResponse>("/analyze", { table, spec }),
  export: (table: Table, spec: AnalysisSpec, format: "svg" | "pdf" | "png") =>
    post<{ filename: string; data_base64: string }>("/export", { table, spec, format, dpi: 300 }),
  saveDocument: (table: Table, analyses: AnalysisSpec[], provenance: unknown) =>
    post<{ filename: string; data_base64: string }>("/document/save", { table, analyses, provenance }),
  importPreview: (filename: string, dataBase64: string, options: ImportOptions = {}) =>
    post<ImportPreview>("/import/preview", { filename, data_base64: dataBase64, options }),
  importCommit: (filename: string, dataBase64: string, options: ImportOptions,
                 columns: { name: string; label: string; type: ColumnDef["type"] }[]) =>
    post<Table>("/import/commit", { filename, data_base64: dataBase64, options, columns }),
};

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
