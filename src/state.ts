import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type {
  AnalysisSpec, AnalyzeResponse, ColumnDef, Hierarchy, Layer, LevelFn, Registry, Schema, Row,
  StatsFamily, StyleOverrides, Table, TableCounts, TableHandle, TestName, ReduceSpec, ReduceStep,
  ReduceStepKind, ReducePreview,
} from "./types";
import { RAW_LEVEL, engine } from "./types";
import { familyForMappings } from "./channels";

export const schemaAtom = atom<Schema | null>(null);
/* The browser no longer owns the dataset: the engine does, behind this handle
   (id + version + schema + row count + included/excluded split). The grid pulls
   row windows by id; nothing in the browser holds all N rows. */
export const tableHandleAtom = atom<TableHandle | null>(null);
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

/* the data hierarchy is a property of the TABLE (defined in the Data tab), shared
   by every analysis: identifier columns form the ordered nesting spine, classifier
   (categorical) columns attach at their home levels. Layers/preview pick a level
   from it. Spine order is stored here; membership mirrors which columns are typed
   `identifier`. */
export const hierarchyAtom = atom<Hierarchy>({ spine: [], fn: {} });

/* identifier columns of the current (master) schema, in schema order — the
   canonical spine membership the stored order is reconciled against. */
function identifierCols(schema: Schema | null): string[] {
  return schema ? schema.columns.filter((c) => c.type === "identifier").map((c) => c.name) : [];
}
/* keep the stored spine order but drop columns no longer identifiers and append
   newly-identifier columns at the end (finest). */
function reconcileSpine(order: string[], ids: string[]): string[] {
  const set = new Set(ids);
  return [...order.filter((s) => set.has(s)), ...ids.filter((c) => !order.includes(c))];
}

/* must match compiler.PALETTE (Okabe–Ito) so the swatches shown in the style
   panel for an unset palette are the exact colors the engine draws; the style
   panel edits copies of it */
export const DEFAULT_PALETTE = ["#E69F00", "#56B4E9", "#009E73", "#F0E442",
  "#0072B2", "#D55E00", "#CC79A7", "#000000",
  "#332288", "#117733", "#88CCEE", "#882255",
  "#999933", "#AA4499", "#44AA99", "#661100"];

/* App-level colour coding for column data types, shown in the table overview.
   Configurable (and persisted) so a user can match their own convention; the
   key set must stay in sync with ColumnDef["type"]. */
export type ColumnType = ColumnDef["type"];
export const DEFAULT_TYPE_COLORS: Record<ColumnType, string> = {
  numeric: "#0e7490",      // teal — measurements
  categorical: "#9333ea",  // purple — classifiers
  identifier: "#64748b",   // slate — nesting keys
  bool: "#c2410c",         // rust — stochastic-event flags (true/false)
};
export const typeColorsAtom = atomWithStorage<Record<ColumnType, string>>(
  "iris.typeColors", DEFAULT_TYPE_COLORS);

/* figure-side point selection (click); exclusion goes via right-click menu */
export const selectedRowIdAtom = atom<string | null>(null);

/* the tests each family offers, mirrored for cheap lookups when building the
   spec and filtering override choices */
export const TEST_BY_FAMILY: Record<StatsFamily, TestName[]> = {
  /* §5 two-group grid: independent (welch_t / mann_whitney) and paired
     (paired_t / wilcoxon). The paired cells are only valid when the data has a
     pairing structure (see model.pairing); the panel gates them on that, and the
     engine errors if a paired test is forced without it. */
  /* >2 levels switch to the omnibus pair (one_way_anova / kruskal); these are
     listed so a user override of the omnibus round-trips through buildSpec. The
     StatsPanel offers the right subset per group count (FAMILY_TESTS there). */
  group_comparison: ["welch_t", "mann_whitney", "paired_t", "wilcoxon",
                     "one_way_anova", "kruskal"],
  correlation: ["pearson", "spearman"],
  descriptive: ["descriptive"],
  /* §5 independent contingency cell: chi-square (default) ↔ Fisher's exact (2×2).
     The engine picks via the expected-count rule and falls back to chi-square if
     Fisher is overridden on a non-2×2 table. */
  contingency: ["chi_square", "fisher_exact"],
  /* Time series is describe-only in the first cut (no inferential test on time
     courses — that needs mixed-effects / functional-data methods). No override
     tests to round-trip. */
  timeseries: [],
};

/* provenance: every exclusion toggle is logged, never silently applied */
export interface ExclusionEvent { row_id: string; excluded: boolean; at: string }
export const exclusionLogAtom = atom<ExclusionEvent[]>([]);

/* Exclusion state lives server-side now: toggle the row on the session table,
   then bump the handle (version drives the grid refetch + a recompute) and log
   the provenance event with the authoritative new state the server returned. */
export const toggleExclusionAtom = atom(null, async (get, set, rowId: string) => {
  const handle = get(tableHandleAtom);
  if (!handle) return;
  const { excluded, version, counts } = await engine.toggleExclude(handle.id, rowId);
  set(tableHandleAtom, { ...handle, version, counts });
  set(exclusionLogAtom, [...get(exclusionLogAtom),
    { row_id: rowId, excluded, at: new Date().toISOString() }]);
});

/* ---- Plottable: one analysis bundled with its visual + reduce config ---- */

export interface Plottable {
  id: string;
  name: string;
  mappings: { x: string; y: string };
  /* aesthetic channels (Phase 2), "" = unmapped. Each is an independent,
     explicit choice — color is never auto-derived from x. */
  color: string;
  size: string;
  shape: string;
  /* Phase 4: small multiples. "" = unmapped; mapping either forces
     describe-only server-side (no per-facet inferential test, v1). */
  facetRow: string;
  facetCol: string;
  shareX: boolean;
  shareY: boolean;
  /* `family` is no longer stored — it is derived from the encoding column types
     (see channels.familyForMappings). The stats engine still re-derives its own
     model server-side from the encodings. */
  layers: Layer[];          // the editable, ordered geom stack
  override: TestName | null;
  describeOnly: boolean;    // user asked to render without a test
  /* which level the reduced-table preview shows ("" = raw reduced rows). The
     hierarchy itself is table-level (hierarchyAtom), shared by all analyses. */
  previewLevel: string;
  preset: string;
  style: StyleOverrides;
  reduce: ReduceSpec;
}

let _pid = 0;
const nextId = () => `pt_${Date.now().toString(36)}_${_pid++}`;

/* a brand-new plottable starts completely blank: no preselected mapping, no
   preselected geom. The user picks x/y and adds layers explicitly. */
export function makeDefaultPlottable(schema: Schema): Plottable {
  return {
    id: nextId(), name: "Analysis 1",
    mappings: { x: "", y: "" },
    color: "", size: "", shape: "",
    facetRow: "", facetCol: "", shareX: true, shareY: true,
    layers: [],
    override: null, describeOnly: false,
    previewLevel: RAW_LEVEL,
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
export const loadTableAtom = atom(null, async (get, set,
    table: Table & { token?: string }) => {
  set(schemaAtom, table.schema);
  // The engine owns the table behind a session handle, created here from the
  // rows the importer handed us. The browser keeps the handle, not the dataset.
  set(dataLoadingAtom, true);
  let s;
  try {
    s = await engine.createSession({ schema: table.schema, rows: table.rows });
  } finally {
    set(dataLoadingAtom, false);
  }
  const handle: TableHandle = {
    id: s.id, n: s.n, version: s.version, schema: s.schema, counts: s.counts,
  };
  set(tableHandleAtom, handle);
  // seed the hierarchy spine from the imported identifier columns (coarsest →
  // finest by schema order); the user refines it in the Data tab.
  set(hierarchyAtom, { spine: identifierCols(table.schema), fn: {} });
  set(exclusionLogAtom, []);
  set(engineErrorAtom, null);
  set(selectedRowIdAtom, null);
  set(analysisByIdAtom, {});
  set(reducePreviewByIdAtom, {});
  const first = makeDefaultPlottable(table.schema);
  set(plottablesAtom, [first]);
  set(activePlottableIdAtom, first.id);
});

/* Fold the retired histogram/density geoms of an older .viz into the unified
   `distribution` geom (bars / smooth, or bars+overlay when both were present),
   mirroring the engine's specnorm so a loaded document edits like a fresh one.
   Idempotent for documents already on `distribution`. */
export function migrateDistLayers(layers: Layer[]): Layer[] {
  const legacy = (g: string) => g === "histogram" || g === "density";
  if (!layers.some((l) => legacy(l.geom))) return layers;
  const hist = layers.find((l) => l.geom === "histogram");
  const dens = layers.find((l) => l.geom === "density");
  const base = hist ?? dens!;
  const params: Record<string, unknown> = { ...base.params };
  if (hist && dens) { params.dist_render ??= "bars"; params.overlay_smooth = true; }
  else params.dist_render ??= hist ? "bars" : "smooth";
  const merged: Layer = { geom: "distribution", params, level: base.level };
  let placed = false;
  const out: Layer[] = [];
  for (const l of layers) {
    if (!legacy(l.geom)) out.push(l);
    else if (!placed) { out.push(merged); placed = true; }
  }
  return out;
}

/* Inverse of buildSpec: reconstruct the editable Plottable from a saved analysis
   spec so a loaded .viz comes back fully editable, not just renderable. The spec
   carries everything the Plottable needs except previewLevel (a transient UI
   preview state), which resets to raw. */
export function plottableFromSpec(spec: AnalysisSpec): Plottable {
  const s = spec.stats;
  return {
    id: spec.id || nextId(),
    name: spec.title || "Analysis",
    mappings: { x: spec.encodings.x?.column ?? "", y: spec.encodings.y?.column ?? "" },
    color: spec.encodings.color?.column ?? "",
    size: spec.encodings.size?.column ?? "",
    shape: spec.encodings.shape?.column ?? "",
    facetRow: spec.facet?.row?.column ?? "",
    facetCol: spec.facet?.col?.column ?? "",
    shareX: spec.facet?.share_x ?? true,
    shareY: spec.facet?.share_y ?? true,
    layers: migrateDistLayers(spec.layers ?? []),
    override: s?.chosen_by === "user_override" ? s.test : null,
    describeOnly: s?.chosen_by === "describe_only",
    previewLevel: RAW_LEVEL,
    preset: spec.style?.preset ?? "demo_default",
    style: spec.style?.overrides ?? {},
    reduce: spec.reduce ?? { steps: [] },
  };
}

export interface LoadedDoc {
  schema: Schema;
  rows: Row[];                              // first window only (preview)
  analyses: AnalysisSpec[];                 // already migrated to the current spec
  exclusions: ExclusionEvent[];
  id: string;                              // session handle the loader created
  n: number;
  version: number;
  counts: TableCounts;
}

/* swap in a loaded .viz: like loadTableAtom but restores the saved analyses
   (rebuilt as editable plottables), the shared hierarchy, and the exclusion log
   instead of starting blank. */
export const loadDocumentAtom = atom(null, (get, set, doc: LoadedDoc) => {
  set(schemaAtom, doc.schema);
  // the engine created the session as it read the .iris; adopt its handle.
  set(tableHandleAtom, {
    id: doc.id, n: doc.n, version: doc.version, schema: doc.schema, counts: doc.counts,
  });
  // the hierarchy is table-level (shared by every analysis); take it off the
  // first saved spec, falling back to the identifier columns for older files.
  const saved = doc.analyses[0]?.hierarchy;
  set(hierarchyAtom, saved && saved.spine?.length
    ? { spine: saved.spine, fn: saved.fn ?? {} }
    : { spine: identifierCols(doc.schema), fn: {} });
  set(exclusionLogAtom, doc.exclusions);
  set(engineErrorAtom, null);
  set(selectedRowIdAtom, null);
  set(analysisByIdAtom, {});
  set(reducePreviewByIdAtom, {});
  const plottables = doc.analyses.length
    ? doc.analyses.map(plottableFromSpec)
    : [makeDefaultPlottable(doc.schema)];
  set(plottablesAtom, plottables);
  set(activePlottableIdAtom, plottables[0].id);
});

/* Pure builder: a plottable + its derived stats family + (optional) recommended
   test + engine snapshot → an analysis spec. `family` is derived by the caller
   from the encoding column types (channels.familyForMappings) — it is no longer
   stored on the plottable. Shared by the live `specAtom` (active plottable) and
   the save path (every plottable), so the two can never drift. */
export function buildSpec(p: Plottable, family: StatsFamily,
                          rec: TestName | undefined,
                          snapshot: Record<string, string>,
                          hierarchy: Hierarchy): AnalysisSpec {
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
    facet: {
      row: p.facetRow ? { column: p.facetRow } : null,
      col: p.facetCol ? { column: p.facetCol } : null,
      share_x: p.shareX, share_y: p.shareY,
    },
    hierarchy,
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
  return buildSpec(p, family, rec, get(engineSnapshotAtom) ?? {}, get(hierarchyAtom));
});

/* every plottable's spec, each carrying its own recommended test — the save
   path serializes all of these into the document's analyses[] */
export const allSpecsAtom = atom((get): AnalysisSpec[] => {
  const schema = get(schemaAtom);
  if (!schema) return [];
  const snap = get(engineSnapshotAtom) ?? {};
  const hierarchy = get(hierarchyAtom);
  const byId = get(analysisByIdAtom);
  return get(plottablesAtom).map((p) => {
    const family = familyForMappings(p.mappings, schema);
    const tests = TEST_BY_FAMILY[family];
    const recRaw = byId[p.id]?.stats.recommendation.test as TestName | undefined;
    const rec = recRaw && tests.includes(recRaw) ? recRaw : undefined;
    return buildSpec(p, family, rec, snap, hierarchy);
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
    layers: src.layers.map((l) => ({ geom: l.geom, params: { ...l.params },
                                     level: l.level })),
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
  return { kind: "filter", conditions: [] };
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

/* ---- live /reduce preview ---- */

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
  // a new layer draws the raw reduced rows by default; the user binds it to a
  // coarser level (one mark per grain) to build the superplot's bold marks.
  set(activePlottableAtom,
    { ...p, layers: [...p.layers, { geom, params, level: RAW_LEVEL }] });
});

/* ---- table-level hierarchy: column roles + spine order (Data tab) ---- */

/* Assign a column a role: "identifier" (a nesting/spine level) or "classifier"
   (a categorical qualifier). Changes the column TYPE on the master schema and
   reconciles the spine membership, so the hierarchy stays fully defined — every
   non-numeric column is one or the other. A schema change re-uploads the table,
   so the engine sees the new types on the next analyze/preview. */
export const setColumnRoleAtom = atom(null,
  async (get, set, arg: { name: string; role: "identifier" | "classifier" }) => {
    const schema = get(schemaAtom); if (!schema) return;
    const handle = get(tableHandleAtom);
    const newType: "identifier" | "categorical" =
      arg.role === "identifier" ? "identifier" : "categorical";
    // a column becoming a classifier needs levels for the editor / ordering;
    // derive them from the server-owned table (not a browser-side row copy).
    const target = schema.columns.find((c) => c.name === arg.name);
    const fetched = newType === "categorical" && target && !target.levels && handle
      ? (await engine.distinct(handle.id, arg.name)).values
      : undefined;
    const columns = schema.columns.map((c) => {
      if (c.name !== arg.name) return c;
      const levels = newType === "categorical" && !c.levels ? fetched : c.levels;
      return { ...c, type: newType, levels };
    });
    const nextSchema = { ...schema, columns };
    set(schemaAtom, nextSchema);
    const h = get(hierarchyAtom);
    set(hierarchyAtom, { ...h, spine: reconcileSpine(h.spine, identifierCols(nextSchema)) });
  });

/* reorder the spine (coarsest → finest). Table-level: shared by all analyses. */
export const moveSpineAtom = atom(null,
  (get, set, arg: { index: number; dir: -1 | 1 }) => {
    const h = get(hierarchyAtom);
    const spine = [...h.spine];
    const j = arg.index + arg.dir;
    if (j < 0 || j >= spine.length) return;
    [spine[arg.index], spine[j]] = [spine[j], spine[arg.index]];
    set(hierarchyAtom, { ...h, spine });
  });

/* set the aggregate fn for a spine level — how finer rows collapse into that
   grain. Table-level: shared by every analysis/layer and the preview that draw
   the level. Unset means mean (the engine's default). */
export const setLevelFnAtom = atom(null,
  (get, set, arg: { level: string; fn: LevelFn }) => {
    const h = get(hierarchyAtom);
    set(hierarchyAtom, { ...h, fn: { ...h.fn, [arg.level]: arg.fn } });
  });

export const setPreviewLevelAtom = atom(null, (get, set, level: string) => {
  const p = get(activePlottableAtom); if (!p) return;
  set(activePlottableAtom, { ...p, previewLevel: level });
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
