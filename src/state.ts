import { atom } from "jotai";
import type {
  AnalysisSpec, AnalyzeResponse, Geom, Layer, Registry, Schema, Row, StatsFamily,
  StyleOverrides, Table, TestName, ReduceSpec, ReduceStep, ReduceStepKind,
  ReducePreview,
} from "./types";
import { familyForMappings } from "./channels";

export const schemaAtom = atom<Schema | null>(null);
export const rowsAtom = atom<Row[]>([]);
export const engineErrorAtom = atom<string | null>(null);
export const engineSnapshotAtom = atom<Record<string, string> | null>(null);

/* render lifecycle, surfaced to the user so a long /analyze never looks hung:
   "running" while a figure/stats request is in flight, "ok" once it lands,
   "error" if it fails. */
export type RenderStatus = "idle" | "running" | "ok" | "error";
export const analyzeStatusAtom = atom<RenderStatus>("idle");
/* the analyze loop's own error channel, separate from engineErrorAtom: the
   figure and the live reduce preview run as two independent loops, and a single
   shared error atom let the (frequently-succeeding) reduce loop's setError(null)
   wipe the analyze loop's block message — leaving a blank figure with no reason.
   Keeping them separate means each loop owns, and only clears, its own error. */
export const renderErrorAtom = atom<string | null>(null);
/* true while the (potentially hundreds-of-MB) master table is being serialized
   and uploaded — the one moment the UI can stall on large data. */
export const dataLoadingAtom = atom<boolean>(false);

/* the geom registry, fetched once from /health at startup; drives the rail */
export const registryAtom = atom<Registry | null>(null);

/* must match compiler.PALETTE; the style panel edits copies of it */
export const DEFAULT_PALETTE = ["#0e7490", "#c2410c", "#4d7c0f", "#7c3aed"];

/* figure-side point selection (click); exclusion goes via right-click menu */
export const selectedRowIdAtom = atom<string | null>(null);

/* Template seeds: one-click starting points that populate a layer stack +
   encoding kind. They are NO LONGER a closed set the user is locked into — the
   layer rail can add/remove/reorder geoms freely afterwards. */
/* Templates seed a layer stack + the axis types the seed expects; `xKind` is the
   column type the default x should have (or "none" for the descriptive seed). The
   stats family is no longer stored — it's derived from the seeded mappings. */
export type TemplateName = "dots" | "box" | "violin" | "bar" | "scatter" | "histogram";
export const TEMPLATES: Record<TemplateName, {
  label: string;
  layers: Layer[];
  xKind: "categorical" | "numeric" | "none";
}> = {
  dots: { label: "Dots + mean ± CI", xKind: "categorical",
    layers: [{ geom: "dot", params: { jitter: 0.18 } },
             { geom: "summary", params: { error_type: "ci95" } }] },
  box: { label: "Box + dots", xKind: "categorical",
    layers: [{ geom: "box", params: {} }, { geom: "dot", params: { jitter: 0.18 } }] },
  violin: { label: "Violin + dots", xKind: "categorical",
    layers: [{ geom: "violin", params: {} }, { geom: "dot", params: { jitter: 0.18 } }] },
  bar: { label: "Bar ± CI", xKind: "categorical",
    layers: [{ geom: "bar", params: { error_type: "ci95" } }] },
  scatter: { label: "Scatter + regression", xKind: "numeric",
    layers: [{ geom: "scatter", params: {} }, { geom: "regression", params: {} }] },
  histogram: { label: "Histogram + density", xKind: "none",
    layers: [{ geom: "histogram", params: {} }, { geom: "density", params: {} }] },
};

/* "Start from…" seeds: the base/primitive plot types only. Overlays (mean ± CI,
   regression, density) are built up afterwards via "+ Add layer" or by mutating
   a layer's plot type in place — so the seed menu stays composite-free. */
export const PRIMITIVES: { geom: Geom; label: string }[] = [
  { geom: "dot", label: "Dots" },
  { geom: "box", label: "Box" },
  { geom: "violin", label: "Violin" },
  { geom: "bar", label: "Bar" },
  { geom: "scatter", label: "Scatter" },
  { geom: "histogram", label: "Histogram" },
];

/* the tests each family offers, mirrored for cheap lookups when building the
   spec and filtering override choices */
export const TEST_BY_FAMILY: Record<StatsFamily, TestName[]> = {
  group_comparison: ["welch_t", "mann_whitney"],
  correlation: ["pearson", "spearman"],
  descriptive: ["descriptive"],
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
  /* aesthetic channels (Phase 2), "" = unmapped. color defaults to x for a
     group comparison (today's look); a color ≠ x dodges a second factor. */
  color: string;
  size: string;
  shape: string;
  /* `family` is no longer stored — it is derived from the encoding column types
     (see channels.familyForMappings). The stats engine still re-derives its own
     model server-side from the encodings. */
  layers: Layer[];          // the editable, ordered geom stack
  override: TestName | null;
  describeOnly: boolean;    // user asked to render without a test
  preset: string;
  style: StyleOverrides;
  reduce: ReduceSpec;
}

let _pid = 0;
const nextId = () => `pt_${Date.now().toString(36)}_${_pid++}`;

export function makeDefaultPlottable(schema: Schema): Plottable {
  const cats = schema.columns.filter((c) => c.type === "categorical");
  const nums = schema.columns.filter((c) => c.type === "numeric");
  let template: TemplateName = "dots";
  if (cats.length === 0) template = nums.length >= 2 ? "scatter" : "histogram";
  const t = TEMPLATES[template];
  const y = nums[nums.length - 1]?.name ?? "";
  const x = t.xKind === "numeric"
    ? (nums.find((c) => c.name !== y)?.name ?? y)
    : (cats[0]?.name ?? "");
  return {
    id: nextId(), name: "Analysis 1",
    mappings: { x, y },
    /* color = x reproduces today's per-group palette + no legend (only when x is
       a categorical group); size/shape start unmapped. */
    color: t.xKind === "categorical" ? x : "", size: "", shape: "",
    layers: t.layers.map((l) => ({ geom: l.geom, params: { ...l.params } })),
    override: null, describeOnly: false,
    preset: "demo_default", style: {},
    /* a fresh reduce per plottable — never share the EMPTY_REDUCE singleton,
       so an in-place mutation could never alias across plottables.
       Empty steps == the full table (today's default). */
    reduce: { steps: [] },
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

/* analysisAtom: derived read-only convenience for the ACTIVE plottable */
export const analysisAtom = atom((get) => {
  const id = get(activePlottableIdAtom);
  return id ? (get(analysisByIdAtom)[id] ?? null) : null;
});

/* Write a result into an EXPLICIT plottable's slot. The caller captures the
   target id at dispatch time, so a result that resolves after the user has
   switched plottables still lands in the plottable it was computed for (not
   whichever happens to be active when the network call returns). */
export const setAnalysisByIdAtom = atom(
  null, (get, set, arg: { id: string; res: AnalyzeResponse | null }) => {
    const map = { ...get(analysisByIdAtom) };
    if (arg.res) map[arg.id] = arg.res; else delete map[arg.id];
    set(analysisByIdAtom, map);
  });

/* swap in a freshly imported (or loaded) table and reset everything that
   referred to the old one: plottables, analysis, exclusion log */
export const loadTableAtom = atom(null, (get, set, table: Table) => {
  set(schemaAtom, table.schema);
  set(rowsAtom, table.rows);
  set(exclusionLogAtom, []);
  set(engineErrorAtom, null);
  set(selectedRowIdAtom, null);
  set(analysisByIdAtom, {});
  set(reducePreviewByIdAtom, {});
  set(tableTokenAtom, null);
  const first = makeDefaultPlottable(table.schema);
  set(plottablesAtom, [first]);
  set(activePlottableIdAtom, first.id);
});

/* Pure builder: a plottable + its derived stats family + (optional) recommended
   test + engine snapshot → an analysis spec. `family` is derived by the caller
   from the encoding column types (channels.familyForMappings) — it is no longer
   stored on the plottable. Shared by the live `specAtom` (active plottable) and
   the save path (every plottable), so the two can never drift. */
export function buildSpec(p: Plottable, family: StatsFamily,
                          rec: TestName | undefined,
                          snapshot: Record<string, string>): AnalysisSpec {
  const tests = TEST_BY_FAMILY[family];
  const recOk = rec && tests.includes(rec) ? rec : undefined;
  const test = (p.override && tests.includes(p.override) ? p.override : null)
    ?? recOk ?? tests[0];
  const usedOverride = p.override !== null && test === p.override && test !== recOk;
  const chosen_by = p.describeOnly ? "describe_only"
    : usedOverride ? "user_override"
    : recOk ? "recommendation_accepted" : "default";
  return {
    spec_version: "2.0",
    id: p.id,
    title: p.name,
    data: { filter: [], respect_exclusions: true },
    reduce: p.reduce,
    encodings: {
      /* x is simply "mapped or not" now — an empty x is the descriptive case
         (histogram), no longer a special family branch. */
      x: p.mappings.x ? { column: p.mappings.x } : null,
      y: p.mappings.y ? { column: p.mappings.y } : null,
      color: p.color ? { column: p.color } : null,
      size: p.size ? { column: p.size } : null,
      shape: p.shape ? { column: p.shape } : null,
    },
    facet: { row: null, col: null, share_x: true, share_y: true },
    layers: p.layers,
    stats: {
      family, test, chosen_by,
      alternatives_offered: tests.filter((t) => t !== test),
      assumption_checks: [{ check: "shapiro_wilk",
                            per: family === "group_comparison" ? "group" : "variable" }],
      alpha: 0.05,
      report: ["effect_size", "ci", "n_per_group"],
    },
    annotations: { significance_brackets: "auto", show_n: true },
    style: { preset: p.preset, overrides: p.style },
    engine_snapshot: snapshot,
  };
}

/* the keystone: spec derived live from the active plottable. The stats family is
   derived from the post-reduction column types so the test offered matches the
   data actually mapped. */
export const specAtom = atom<AnalysisSpec | null>((get) => {
  const schema = get(schemaAtom);
  const p = get(activePlottableAtom);
  if (!schema || !p) return null;
  const family = familyForMappings(p.mappings, get(effectiveSchemaAtom));
  const tests = TEST_BY_FAMILY[family];
  const recRaw = get(analysisAtom)?.stats.recommendation.test as TestName | undefined;
  const rec = recRaw && tests.includes(recRaw) ? recRaw : undefined;
  return buildSpec(p, family, rec, get(engineSnapshotAtom) ?? {});
});

/* every plottable's spec, each carrying its own recommended test — the save
   path serializes all of these into the document's analyses[] */
export const allSpecsAtom = atom((get): AnalysisSpec[] => {
  const schema = get(schemaAtom);
  if (!schema) return [];
  const snap = get(engineSnapshotAtom) ?? {};
  const byId = get(analysisByIdAtom);
  return get(plottablesAtom).map((p) => {
    const family = familyForMappings(p.mappings, schema);
    const tests = TEST_BY_FAMILY[family];
    const recRaw = byId[p.id]?.stats.recommendation.test as TestName | undefined;
    const rec = recRaw && tests.includes(recRaw) ? recRaw : undefined;
    return buildSpec(p, family, rec, snap);
  });
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
    mappings: { ...src.mappings },
    layers: src.layers.map((l) => ({ geom: l.geom, params: { ...l.params } })),
    style: structuredClone(src.style),
    reduce: { steps: structuredClone(src.reduce.steps) },
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
  const prev = { ...get(reducePreviewByIdAtom) }; delete prev[id];
  set(reducePreviewByIdAtom, prev);
});

/* ---- reduce-step CRUD + reorder on the ACTIVE plottable ---- */

export function makeStep(kind: ReduceStepKind): ReduceStep {
  if (kind === "select") return { kind, columns: [] };  // starts blank, by design
  if (kind === "filter") return { kind, conditions: [] };
  return { kind: "collapse", group_by: [], aggregate: {} };
}

export const addStepAtom = atom(null, (get, set, kind: ReduceStepKind) => {
  const p = get(activePlottableAtom); if (!p) return;
  set(activePlottableAtom,
    { ...p, reduce: { steps: [...p.reduce.steps, makeStep(kind)] } });
});

export const updateStepAtom = atom(null,
  (get, set, arg: { index: number; step: ReduceStep }) => {
    const p = get(activePlottableAtom); if (!p) return;
    set(activePlottableAtom, { ...p, reduce: { steps:
      p.reduce.steps.map((s, i) => (i === arg.index ? arg.step : s)) } });
  });

export const removeStepAtom = atom(null, (get, set, index: number) => {
  const p = get(activePlottableAtom); if (!p) return;
  set(activePlottableAtom,
    { ...p, reduce: { steps: p.reduce.steps.filter((_, i) => i !== index) } });
});

export const moveStepAtom = atom(null,
  (get, set, arg: { index: number; dir: -1 | 1 }) => {
    const p = get(activePlottableAtom); if (!p) return;
    const steps = [...p.reduce.steps];
    const j = arg.index + arg.dir;
    if (j < 0 || j >= steps.length) return;
    [steps[arg.index], steps[j]] = [steps[j], steps[arg.index]];
    set(activePlottableAtom, { ...p, reduce: { steps } });
  });

/* ---- live /reduce preview + master-table content token ---- */

/* content token for the master table; lets a large table upload once (via
   /table) and ride as a token on analyze/reduce/export instead of re-sending
   ~hundreds of MB on every pipeline edit */
export const tableTokenAtom = atom<string | null>(null);

/* the active plottable's reduced-table preview, keyed per plottable so a
   late-resolving fetch lands in the plottable it was computed for */
export const reducePreviewByIdAtom = atom<Record<string, ReducePreview>>({});
export const setReducePreviewByIdAtom = atom(null,
  (get, set, arg: { id: string; preview: ReducePreview | null }) => {
    const map = { ...get(reducePreviewByIdAtom) };
    if (arg.preview) map[arg.id] = arg.preview; else delete map[arg.id];
    set(reducePreviewByIdAtom, map);
  });
export const reducePreviewAtom = atom((get) => {
  const id = get(activePlottableIdAtom);
  return id ? (get(reducePreviewByIdAtom)[id] ?? null) : null;
});

/* the columns the figure actually sees: the post-reduction schema from the live
   /reduce preview (which equals the master schema when the pipeline is empty),
   falling back to the master schema before the first preview resolves. The X/Y
   pickers must offer THESE, not master columns the pipeline may have dropped. */
export const effectiveSchemaAtom = atom((get) => {
  const rp = get(reducePreviewAtom);
  return rp?.preview.schema ?? get(schemaAtom);
});

/* ---- layer CRUD + reorder on the ACTIVE plottable (mirrors reduce steps) ---- */

export const addLayerAtom = atom(null, (get, set, geom: Layer["geom"]) => {
  const p = get(activePlottableAtom); if (!p) return;
  const reg = get(registryAtom);
  const params = { ...(reg?.geoms[geom]?.params ?? {}) };
  set(activePlottableAtom, { ...p, layers: [...p.layers, { geom, params }] });
});

export const updateLayerAtom = atom(null,
  (get, set, arg: { index: number; layer: Layer }) => {
    const p = get(activePlottableAtom); if (!p) return;
    set(activePlottableAtom, { ...p, layers:
      p.layers.map((l, i) => (i === arg.index ? arg.layer : l)) });
  });

export const removeLayerAtom = atom(null, (get, set, index: number) => {
  const p = get(activePlottableAtom); if (!p) return;
  set(activePlottableAtom,
    { ...p, layers: p.layers.filter((_, i) => i !== index) });
});

export const moveLayerAtom = atom(null,
  (get, set, arg: { index: number; dir: -1 | 1 }) => {
    const p = get(activePlottableAtom); if (!p) return;
    const layers = [...p.layers];
    const j = arg.index + arg.dir;
    if (j < 0 || j >= layers.length) return;
    [layers[arg.index], layers[j]] = [layers[j], layers[arg.index]];
    set(activePlottableAtom, { ...p, layers });
  });

/* seed from a single primitive: swap to a one-layer stack of that geom, dropping
   any prior layers. The encodings (and therefore the derived family) are not
   touched — primitive gating already ensures only geoms compatible with the
   current encodings are offerable, so the family can't change here. Composites
   are built up from this seed. */
export const seedPrimitiveAtom = atom(null, (get, set, geom: Geom) => {
  const p = get(activePlottableAtom); if (!p) return;
  if (!PRIMITIVES.some((x) => x.geom === geom)) return;
  const reg = get(registryAtom);
  const params = { ...(reg?.geoms[geom]?.params ?? {}) };
  set(activePlottableAtom, { ...p, describeOnly: false, layers: [{ geom, params }] });
});
