import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type {
  AnalysisSpec, AnalyzeResponse, ColumnDef, CollapsePlan, GrainKey, Hierarchy, Layer, LevelFn, Registry, Schema, Row,
  StatsFamily, StyleKnob, StyleOverrides, Table, TableCounts, TableHandle, TestName, ReduceSpec,
  ReduceStep, ReduceStepKind, ReducePreview,
} from "./types";
import { RAW_LEVEL, engine } from "./types";
import { defaultPlan, grainKey, planGrains } from "./collapse";
import { familyForMappingsRef } from "./channels";
import type { StyleSheet } from "./style/sheet";
import { applyStyleSheet } from "./style/sheet";
import { byId, upsertTable, seedTableName, type WorkspaceTable } from "./tables";
export type { WorkspaceTable } from "./tables";

/* The three single-table globals are no longer primitive state: they are
   read-only views onto the ACTIVE ANALYSIS's pool table (analysisTableAtom),
   so the ~20 analysis read sites keep working while the pool owns the truth.
   Writers (loadTableAtom, setColumnRoleAtom, …) edit the pool entry, not these.
   Defined as forward closures off analysisTableAtom (declared below). */
export const schemaAtom = atom<Schema | null>((get) => get(analysisTableAtom)?.schema ?? null);
/* The browser no longer owns the dataset: the engine does, behind this handle
   (id + version + schema + row count). The grid pulls row windows by id; nothing
   in the browser holds all N rows. */
export const tableHandleAtom = atom<TableHandle | null>((get) => get(analysisTableAtom)?.handle ?? null);
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

/* the style registry (also fetched once from /health); drives the style pane */
export const styleRegistryAtom = atom<StyleKnob[]>([]);

/* the data hierarchy is a property of the TABLE (defined in the Data tab), shared
   by every analysis: identifier columns form the ordered nesting spine, classifier
   (categorical) columns attach at their home levels. Layers/preview pick a level
   from it. Spine order is stored here; membership mirrors which columns are typed
   `identifier`. */
export const hierarchyAtom = atom<Hierarchy>((get) =>
  get(analysisTableAtom)?.hierarchy ?? { spine: [], fn: {} });

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

/* must match scales.PALETTE (Okabe–Ito + Paul Tol) so the swatches shown in the
   style panel for an unset palette are the exact colors the engine draws; the
   style panel edits copies of it */
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

/* ---- style sheets (item F): capture, reuse, share a plot's look ---- */

/** In-session clipboard: set by Copy style, consumed by Paste style. */
export const styleClipboardAtom = atom<StyleSheet | null>(null);

/** Named library persisted to localStorage — survives restarts, spans files. */
export const styleLibraryAtom = atomWithStorage<StyleSheet[]>(
  "iris.styleLibrary", []);

/** Multi-selection of analyses (insertion-ordered ids).  Plain click resets to
 *  one; Cmd/Ctrl-click toggles; Shift-click selects a range.  The *active*
 *  (edited) plottable stays single — this set drives batch style ops only. */
export const selectedPlottableIdsAtom = atom<string[]>([]);

/** Writer: apply a style sheet to every selected plottable.  Returns the count
 *  of analyses touched. */
export const pasteStyleAtom = atom(null,
  (get, set, sheet: StyleSheet) => {
    const registry = get(styleRegistryAtom);
    const sel = get(selectedPlottableIdsAtom);
    const ids = new Set(sel);
    set(plottablesAtom, get(plottablesAtom).map((p) => {
      if (!ids.has(p.id)) return p;
      return { ...p, style: applyStyleSheet(p.style, sheet, registry) };
    }));
  });

/* the tests each family offers, mirrored for cheap lookups when building the
   spec and filtering override choices */
export const TEST_BY_FAMILY: Record<StatsFamily, TestName[]> = {
  /* §5 two-group grid: independent (welch_t / mann_whitney) and paired
     (paired_t / wilcoxon). The paired cells are only valid when the data has a
     pairing structure (see model.pairing); the panel gates them on that, and the
     engine errors if a paired test is forced without it. */
  /* >2 levels switch to the omnibus pair (one_way_anova / kruskal); these are
     listed so a user override of the omnibus round-trips through buildSpec. The
     TestPicker offers the right subset per group count (FAMILY_TESTS there). */
  group_comparison: ["welch_t", "mann_whitney", "paired_t", "wilcoxon",
                     "one_way_anova", "kruskal"],
  /* vs-reference (one-sample) family: each group's per-replicate values tested
     against a constant (chance/control/unity) rather than against each other.
     Parametric one-sample t ↔ robust Wilcoxon signed-rank; the engine's
     rank-floor guard falls back to the t at tiny n (where the signed-rank test
     has zero power). The correct design when groups are not independent — e.g.
     contact-type fractions that sum to 1, where a between-group comparison is
     partly tautological (iris_engine/stats.location). */
  location: ["one_sample_t", "wilcoxon_signed"],
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

/* ---- Plottable: one analysis bundled with its visual + reduce config ---- */

export interface Plottable {
  id: string;
  name: string;
  tableId: string;  // the main table's pool id (design §4.2)
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
  /* vs-reference opt-in: when non-null, a categorical-x/numeric-y (or ungrouped
     numeric) plot is the `location` family — each group tested against this
     constant (chance/control/unity) instead of against each other. null = the
     ordinary type-derived family. This is the one family the column types can't
     imply, so it is stored, not derived (see channels.familyForMappingsRef). */
  reference: number | null;
  describeOnly: boolean;    // user asked to render without a test
  /* which level the reduced-table preview shows ("" = raw reduced rows). The
     hierarchy itself is table-level (hierarchyAtom), shared by all analyses. */
  previewLevel: string;
  style: StyleOverrides;
  reduce: ReduceSpec;
  /* un-forcing the nesting: per-analysis collapse plan + chosen test grain.
     Absent -> the default chain generated from the table-level spine. */
  collapse?: CollapsePlan;
  testGrain?: GrainKey;
}

let _pid = 0;
const nextId = () => `pt_${Date.now().toString(36)}_${_pid++}`;
/* stable per-layer key for React lists, so reordering layers keeps each card's
   local state (collapsed/expanded) glued to its own layer. Client-only. */
let _lid = 0;
export const nextLayerId = () => `ly_${Date.now().toString(36)}_${_lid++}`;
/* stable per-step key for React lists, so reordering/deleting steps keeps each
   card's local state (collapsed/expanded) glued to its own step. Client-only:
   stripped in buildSpec, so it never reaches the engine or a saved .viz. */
let _sk = 0;
const nextStepKey = () => `sk_${Date.now().toString(36)}_${_sk++}`;
const stripStepKey = ({ _key, ...s }: ReduceStep): ReduceStep => s;

/* the steps that are actually runnable: a freshly-authored join carries the
   EMPTY_RIGHT sentinel until its right table is wired, and POSTing an
   under-specified join to the engine errors. Drop those when building the
   request — the spec keeps the step so its editor card and the open "missing"
   circle persist; it just isn't sent until filled. */
export function runnableSteps(steps: ReduceStep[]): ReduceStep[] {
  return steps.filter((s) => s.kind !== "join" || s.right.schema.columns.length > 0);
}

/* a brand-new plottable starts completely blank: no preselected mapping, no
   preselected geom. The user picks x/y and adds layers explicitly. */
export function makeDefaultPlottable(schema: Schema, tableId = ""): Plottable {
  return {
    id: nextId(), name: "Analysis 1", tableId,
    mappings: { x: "", y: "" },
    color: "", size: "", shape: "",
    facetRow: "", facetCol: "", shareX: true, shareY: true,
    layers: [],
    override: null, reference: null, describeOnly: false,
    previewLevel: RAW_LEVEL,
    style: {},
    /* a fresh reduce per plottable — never share the EMPTY_REDUCE singleton,
       so an in-place mutation could never alias across plottables.
       Empty steps == the full table (today's default). */
    reduce: { steps: [] },
  };
}

export const plottablesAtom = atom<Plottable[]>([]);
export const activePlottableIdAtom = atom<string | null>(null);
export const viewModeAtom = atom<"data" | "workbench" | "guide">("data");

/* a pending in-page jump for the Guide tab: set by the stats pane's "Why this
   test?" link to a heading slug, consumed (and cleared) by the Guide once it
   mounts so it scrolls straight to the relevant rules section. */
export const guideAnchorAtom = atom<string | null>(null);

export const activePlottableAtom = atom(
  (get): Plottable | null => {
    const id = get(activePlottableIdAtom);
    return get(plottablesAtom).find((p) => p.id === id) ?? null;
  },
  (get, set, next: Plottable) => {
    set(plottablesAtom, get(plottablesAtom).map((p) => (p.id === next.id ? next : p)));
  },
);

/* the workspace pool: every loaded input table (design §4.1). Import accumulates
   into it; analyses reference entries by id. */
export const tablesAtom = atom<WorkspaceTable[]>([]);
/* which pool table the Data tab is currently viewing / editing. */
export const activeTableIdAtom = atom<string | null>(null);

/* the table the Data tab edits (its preview, spine, column roles). */
export const activeTableAtom = atom((get) => byId(get(tablesAtom), get(activeTableIdAtom)));
/* the table the ACTIVE ANALYSIS computes against (its main table). */
export const analysisTableAtom = atom((get) =>
  byId(get(tablesAtom), get(activePlottableAtom)?.tableId ?? null));

/* bump the active pool table's handle (a data edit / version change). The grid's
   cell edit goes through here so the new version refetches the affected block and
   re-runs compute. (Replaces the old `set(tableHandleAtom, …)` now that the three
   globals are read-only views off the pool.) */
export const bumpActiveHandleAtom = atom(null, (get, set, h: TableHandle) => {
  const t = get(activeTableAtom); if (!t) return;
  set(tablesAtom, upsertTable(get(tablesAtom), { ...t, handle: h }));
});

export const analysisByIdAtom = atom<Record<string, AnalyzeResponse>>({});

/* Per plottable, the key the cached result in analysisByIdAtom was computed from:
   `${handle.id}:${handle.version}:${JSON.stringify(spec)}` — a complete freshness
   fingerprint (spec embeds encodings/layers/style/reduce/hierarchy/snapshot,
   handle.version captures data edits). Written ONLY on a
   successful render (setAnalysisResultAtom); reset with analysisByIdAtom on data /
   document load. A fresh key means "the cached figure already matches" → no
   re-render. */
export const analysisKeyByIdAtom = atom<Record<string, string>>({});

/* LRU recency for the byte-budget cache: plottable ids ordered least- → most-
   recently used (touched on every cache write and on every cache hit). Eviction
   drops from the front. */
export const analysisRecencyAtom = atom<string[]>([]);

/* the complete freshness fingerprint for a plottable's spec under the current
   table handle. Must match the key the active analyze loop compares against. */
export const cacheKey = (handleId: string, version: number, spec: AnalysisSpec): string =>
  `${handleId}:${version}:${JSON.stringify(spec)}`;

/* approximate bytes for one cached analysis, cheap and serialization-free: the
   SVG string length (the dominant cost now that dots draw as plain vector marks
   with no per-point row-id payload) plus a small fixed overhead for stats /
   stat_model / issues. A monotone proxy for real heap cost, not an exact
   measurement — all the LRU needs. */
const ENTRY_OVERHEAD = 4096;    // stats / stat_model / issues, flat
export function estimateBytes(res: AnalyzeResponse): number {
  return res.figure.svg.length + ENTRY_OVERHEAD;
}

/* default cache budget — a single tunable knob. Hundreds of typical plots fit
   comfortably; eviction only engages on the pathological tail (every plot a heavy
   superplot attributing all raw rows). Sized to keep an older / low-RAM machine
   out of swap, well below the JS engine's own OOM ceiling. */
export const CACHE_BUDGET_BYTES = 300 * 1024 * 1024;

/* the live budget the LRU enforces, seeded from the default constant. An atom so
   it can be tuned at runtime (and driven to a tiny value in tests). */
export const cacheBudgetAtom = atom<number>(CACHE_BUDGET_BYTES);

/* The same gate the active analyze loop uses, applied to a background plottable's
   spec: a Y encoding, ≥1 layer, and no mapping error (every mapped axis survives
   the post-reduction schema). When no effective schema is known for the plottable
   we cannot check survival here — the engine will 422 and the background loop
   records it in failedKeys, so allowing it through is safe. */
export function isSpecRenderable(spec: AnalysisSpec, schema: Schema | null): boolean {
  if (!spec.encodings.y?.column || spec.layers.length === 0) return false;
  if (!schema) return true;
  const survives = (col?: string | null) =>
    !col || schema.columns.some((c) => c.name === col);
  return survives(spec.encodings.x?.column) && survives(spec.encodings.y?.column);
}

/* Pick the first plottable the background loop should warm: not the active one
   (the active loop owns it and its status), renderable, stale (its cached key no
   longer matches), and not already failed at this exact key. Returns the spec plus
   the key its result must be stored under, or null when nothing is stale. Pure, so
   the drain logic is unit-testable without the React effect. */
export function pickStaleSpec(specs: AnalysisSpec[], opts: {
  activeId: string | null;
  handleId: string;
  version: number;
  keyById: Record<string, string>;
  failedKeys: Set<string>;
  schemaFor: (id: string) => Schema | null;
}): { spec: AnalysisSpec; key: string } | null {
  for (const spec of specs) {
    if (spec.id === opts.activeId) continue;
    if (!isSpecRenderable(spec, opts.schemaFor(spec.id))) continue;
    const key = cacheKey(opts.handleId, opts.version, spec);
    if (opts.keyById[spec.id] === key) continue;                 // fresh
    if (opts.failedKeys.has(`${spec.id}:${key}`)) continue;      // already failed
    return { spec, key };
  }
  return null;
}

/* Store a successful render: result + the key it was computed from, mark the
   plottable most-recently-used, then enforce the byte budget by evicting
   least-recently-used entries (dropping both the result and its key) until back
   under budget. Never evicts the active plottable nor the entry just written, so
   the figure the user is looking at is always present. */
export const setAnalysisResultAtom = atom(null,
  (get, set, arg: { id: string; key: string; res: AnalyzeResponse }) => {
    const byId = { ...get(analysisByIdAtom), [arg.id]: arg.res };
    const keyById = { ...get(analysisKeyByIdAtom), [arg.id]: arg.key };
    // most-recently-used at the end
    const recency = [...get(analysisRecencyAtom).filter((x) => x !== arg.id), arg.id];
    const activeId = get(activePlottableIdAtom);
    const budget = get(cacheBudgetAtom);
    let total = Object.keys(byId).reduce((s, id) => s + estimateBytes(byId[id]), 0);
    // evict from the front (LRU), skipping the active plottable and the entry we
    // just inserted — both are pinned. The inserted/active entry alone may exceed
    // the budget; that is accepted, never evicted.
    for (const victim of recency) {
      if (total <= budget) break;
      if (victim === activeId || victim === arg.id) continue;
      if (!(victim in byId)) continue;
      total -= estimateBytes(byId[victim]);
      delete byId[victim];
      delete keyById[victim];
    }
    set(analysisByIdAtom, byId);
    set(analysisKeyByIdAtom, keyById);
    set(analysisRecencyAtom, recency.filter((id) => id in byId));
  });

/* mark a cached plottable most-recently-used without rewriting its result — used
   when the active loop shows a plot straight from cache (a freshness hit), so a
   plot the user keeps returning to is not the first evicted once they leave it. */
export const touchAnalysisAtom = atom(null, (get, set, id: string) => {
  const rec = get(analysisRecencyAtom);
  if (rec[rec.length - 1] === id || !(id in get(analysisByIdAtom))) return;
  set(analysisRecencyAtom, [...rec.filter((x) => x !== id), id]);
});

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
    if (arg.res) { map[arg.id] = arg.res; }
    else {
      // clearing a figure (no Y / no layer / mapping error / failed active
      // render) must also drop its freshness key and recency slot, so the
      // background loop never sees a key with no backing result behind it.
      delete map[arg.id];
      const keys = { ...get(analysisKeyByIdAtom) }; delete keys[arg.id];
      set(analysisKeyByIdAtom, keys);
      set(analysisRecencyAtom, get(analysisRecencyAtom).filter((x) => x !== arg.id));
    }
    set(analysisByIdAtom, map);
  });

/* swap in a freshly imported (or loaded) table and reset everything that
   referred to the old one: plottables, analysis */
export const loadTableAtom = atom(null, async (get, set,
    table: Table & { token?: string }) => {
  // The engine owns the table behind a session handle, created here from the
  // rows the importer handed us. The browser keeps the handle, not the dataset.
  set(dataLoadingAtom, true);
  const inline = { schema: table.schema, rows: table.rows };
  let s;
  try {
    // a freshly imported table is already cached engine-side: seed the session
    // from its token instead of re-uploading every row (table.token), falling
    // back to the inline rows for manually-entered / tokenless tables.
    //
    // The token is only a hint: the engine's table cache is bounded (it can
    // evict between commit and here), and a stale engine predating the
    // table_token wiring rejects it outright. Either way the seed would
    // silently produce an empty session (0 rows). Since we still hold every
    // row, fall back to shipping them inline — slower, but correct — rather
    // than load a phantom empty table.
    s = table.token
      ? await engine.createSession({ token: table.token })
          .catch(() => engine.createSession(inline))
      : await engine.createSession(inline);
  } finally {
    set(dataLoadingAtom, false);
  }
  const handle: TableHandle = {
    id: s.id, n: s.n, version: s.version, schema: s.schema, counts: s.counts,
  };
  // import ACCUMULATES into the pool (design §4.1): append a new pool entry and
  // select it for the Data tab. The hierarchy spine seeds from the imported
  // identifier columns (coarsest → finest by schema order); the user refines it.
  const id = seedTableName(get(tablesAtom), (table as { name?: string }).name);
  const entry: WorkspaceTable = {
    id, name: id, schema: table.schema,
    hierarchy: { spine: identifierCols(table.schema), fn: {} }, handle,
  };
  set(tablesAtom, upsertTable(get(tablesAtom), entry));
  set(activeTableIdAtom, id);
  set(engineErrorAtom, null);
  set(analysisByIdAtom, {});
  set(analysisKeyByIdAtom, {});
  set(analysisRecencyAtom, []);
  set(reducePreviewByIdAtom, {});
  // add a default analysis bound to the new table (do NOT reset existing ones).
  const first = makeDefaultPlottable(table.schema, id);
  set(plottablesAtom, [...get(plottablesAtom), first]);
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
  const merged: Layer = { geom: "distribution", level: base.level };
  let placed = false;
  const out: Layer[] = [];
  for (const l of layers) {
    if (!legacy(l.geom)) out.push(l);
    else if (!placed) { out.push(merged); placed = true; }
  }
  return out;
}

/* Migrate any layer-level params into style.overrides.geoms (same as the
   engine's specnorm._migrate_layer_params, so the FE and engine agree).
   Also hoists legacy histogram/density dist_render into distribution overrides.
   Mutates the style object in place; returns the cleaned layers. */
function migrateLayerParams(layers: Layer[], style: StyleOverrides): Layer[] {
  const geoms: Record<string, Record<string, unknown>> = style.geoms ? { ...style.geoms } : {};
  let migrated = false;
  // handle legacy dist layers (histogram/density → distribution knobs)
  const hist = layers.find((l) => l.geom === "histogram");
  const dens = layers.find((l) => l.geom === "density");
  if (hist || dens) {
    const dest = geoms.distribution = { ...(geoms.distribution ?? {}) };
    const base = hist ?? dens!;
    const params = base.params ?? {};
    for (const [k, v] of Object.entries(params))
      dest[k] ??= v;
    if (hist && dens) { dest.dist_render ??= "bars"; dest.overlay_smooth ??= true; }
    else dest.dist_render ??= hist ? "bars" : "smooth";
    migrated = true;
  }
  // hoist params from all layers
  for (const l of layers) {
    if (!l.params || Object.keys(l.params).length === 0) continue;
    const dest = geoms[l.geom] = { ...(geoms[l.geom] ?? {}) };
    for (const [k, v] of Object.entries(l.params))
      dest[k] ??= v;
    migrated = true;
  }
  if (migrated) style.geoms = geoms;
  return layers.map(({ params: _p, ...rest }) => rest);
}

/* Inverse of buildSpec: reconstruct the editable Plottable from a saved analysis
   spec so a loaded .viz comes back fully editable, not just renderable. The spec
   carries everything the Plottable needs except previewLevel (a transient UI
   preview state), which resets to raw. */
export function plottableFromSpec(spec: AnalysisSpec): Plottable {
  const s = spec.stats;
  const style: StyleOverrides = { ...(spec.style?.overrides ?? {}) };
  const layers = migrateLayerParams(
    migrateDistLayers(spec.layers ?? []),
    style,
  ).map((l) => ({ ...l, id: l.id ?? nextLayerId() }));
  return {
    id: spec.id || nextId(),
    name: spec.title || "Analysis",
    tableId: (spec as { table_id?: string }).table_id ?? "",
    mappings: { x: spec.encodings.x?.column ?? "", y: spec.encodings.y?.column ?? "" },
    color: spec.encodings.color?.column ?? "",
    size: spec.encodings.size?.column ?? "",
    shape: spec.encodings.shape?.column ?? "",
    facetRow: spec.facet?.row?.column ?? "",
    facetCol: spec.facet?.col?.column ?? "",
    shareX: spec.facet?.share_x ?? true,
    shareY: spec.facet?.share_y ?? true,
    layers,
    // the user's pinned test; null = run the recommendation.
    override: s?.override ?? null,
    /* restore the vs-reference opt-in so a saved `location` doc round-trips
       instead of being re-derived as a group comparison on open. The constant
       rides in stats.reference; older files that only set the reference line fall
       back to style.reference_value, else 0. */
    reference: s?.family === "location"
      ? (s?.reference ?? (style.reference_value as number | null | undefined) ?? 0)
      : null,
    describeOnly: s?.describe_only ?? false,
    previewLevel: RAW_LEVEL,
    style,
    reduce: { steps: (spec.reduce?.steps ?? []).map((s) => ({ ...s, _key: nextStepKey() })) },
    collapse: spec.collapse,
    testGrain: spec.test_grain,
  };
}

export interface LoadedDoc {
  schema: Schema;
  rows: Row[];                              // first window only (preview)
  analyses: AnalysisSpec[];                 // already migrated to the current spec
  id: string;                              // session handle the loader created
  n: number;
  version: number;
  counts: TableCounts;
}

/* swap in a loaded .viz: like loadTableAtom but restores the saved analyses
   (rebuilt as editable plottables) and the shared hierarchy instead of starting
   blank. */
export const loadDocumentAtom = atom(null, (get, set, doc: LoadedDoc) => {
  // the engine created the session as it read the .iris; adopt its handle.
  const handle: TableHandle = {
    id: doc.id, n: doc.n, version: doc.version, schema: doc.schema, counts: doc.counts,
  };
  // the hierarchy is table-level; take it off the first saved spec, falling back
  // to the identifier columns for older files.
  const saved = doc.analyses[0]?.hierarchy;
  const hierarchy: Hierarchy = saved && saved.spine?.length
    ? { spine: saved.spine, fn: saved.fn ?? {} }
    : { spine: identifierCols(doc.schema), fn: {} };
  // Seed ONE pool entry from the doc (full multi-table join-migration is Task 9).
  const id = seedTableName(get(tablesAtom), undefined);
  const entry: WorkspaceTable = { id, name: id, schema: doc.schema, hierarchy, handle };
  set(tablesAtom, upsertTable(get(tablesAtom), entry));
  set(activeTableIdAtom, id);
  set(engineErrorAtom, null);
  set(analysisByIdAtom, {});
  set(analysisKeyByIdAtom, {});
  set(analysisRecencyAtom, []);
  set(reducePreviewByIdAtom, {});
  // bind the restored analyses to the seeded pool entry (they were saved with
  // no table_id, or a stale one); a fresh doc gets one default analysis.
  const plottables = doc.analyses.length
    ? doc.analyses.map((spec) => ({ ...plottableFromSpec(spec), tableId: id }))
    : [makeDefaultPlottable(doc.schema, id)];
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
  // location family: carry the tested constant and, unless the user already set
  // one, default the reference line to it so the figure draws the chance line the
  // one-sample test is measured against.
  const reference = family === "location" ? (p.reference ?? 0) : null;
  const style: StyleOverrides = reference != null && p.style.reference_value == null
    ? { ...p.style, reference_value: reference }
    : p.style;
  return {
    spec_version: "2.1",
    id: p.id,
    title: p.name,
    data: { filter: [] },
    reduce: { steps: runnableSteps(p.reduce.steps).map(stripStepKey) },
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
    /* Decisions only. The engine re-derives the recommendation, the deviation
       label, and the assumption-check outcomes on open. */
    stats: {
      family, test,
      // the user's pinned test; null when nothing is pinned.
      override: p.override,
      /* the vs-reference constant — engine reads it for the location family; null
         (omitted in effect) for every other family. */
      ...(reference != null ? { reference } : {}),
      // describe-only is a decision; omit when false to keep specs clean.
      ...(p.describeOnly ? { describe_only: true } : {}),
      alpha: 0.05,
    },
    annotations: { significance_brackets: "auto", show_n: true },
    style: { overrides: style },
    engine_snapshot: snapshot,
    ...(p.collapse ? { collapse: p.collapse } : {}),
    ...(p.testGrain ? { test_grain: p.testGrain } : {}),
  };
}

/* the keystone: spec derived live from the active plottable. The stats family is
   derived from the post-reduction column types so the test offered matches the
   data actually mapped. */
export const specAtom = atom<AnalysisSpec | null>((get) => {
  const schema = get(schemaAtom);
  const p = get(activePlottableAtom);
  if (!schema || !p) return null;
  const family = familyForMappingsRef(p.mappings, get(effectiveSchemaAtom), p.reference);
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
  // mirror specAtom: derive each plottable's family from ITS post-reduction
  // schema (the reduce preview, when present) so the saved family/test matches
  // what the live spec computes, falling back to the master schema.
  const previews = get(reducePreviewByIdAtom);
  return get(plottablesAtom).map((p) => {
    const eff = previews[p.id]?.preview.schema ?? schema;
    const family = familyForMappingsRef(p.mappings, eff, p.reference);
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
    tableId: src.tableId,
    mappings: { ...src.mappings },
    layers: src.layers.map((l) => ({ id: nextLayerId(), geom: l.geom,
                                     level: l.level })),
    style: structuredClone(src.style),
    reduce: { steps: structuredClone(src.reduce.steps).map((s) => ({ ...s, _key: nextStepKey() })) },
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
  const keys = { ...get(analysisKeyByIdAtom) }; delete keys[id];
  set(analysisKeyByIdAtom, keys);
  set(analysisRecencyAtom, get(analysisRecencyAtom).filter((x) => x !== id));
  const prev = { ...get(reducePreviewByIdAtom) }; delete prev[id];
  set(reducePreviewByIdAtom, prev);
});

/* ---- reduce-step CRUD + reorder on the ACTIVE plottable ---- */

/* the unfilled right-side sentinel for a freshly-created join: an empty-schema
   table. A join whose `right.schema.columns` is empty is "missing its right
   input" — rendered as the open circle on the canvas and skipped on the run
   path (it is not yet a runnable step). */
export const EMPTY_RIGHT: Table = { schema: { schema_version: "1.0", columns: [] }, rows: [] };

export function makeStep(kind: ReduceStepKind): ReduceStep {
  const _key = nextStepKey();
  switch (kind) {
    case "drop": return { _key, kind, columns: [] };
    case "filter": return { _key, kind, conditions: [] };
    case "derive": return { _key, kind, column: "", expr: "" };
    case "recode": return { _key, kind, column: "", map: {} };
    case "pivot":
      return { _key, kind, index: [], column: "", values: "", agg: "sum", fill: 0, names: {} };
    case "grid_complete":
      return { _key, kind, by: [], column: "", levels: [], count: true,
        count_unique: null, fill: 0, count_name: "n" };
    case "join":
      // starts with an EMPTY right — the unfilled "missing input" state, filled
      // by dragging a data node onto its open circle.
      return { _key, kind, on: [], how: "inner", right: EMPTY_RIGHT };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export const addStepAtom = atom(null, (get, set, kind: ReduceStepKind) => {
  const p = get(activePlottableAtom); if (!p) return;
  set(activePlottableAtom,
    { ...p, reduce: { ...p.reduce, steps: [...p.reduce.steps, makeStep(kind)] } });
});

/* splice a blank step in immediately AFTER `afterIndex` (the source node's step
   index; Source = -1 → insert at 0). Append and insert are the same operation at
   different positions — a node's `+` adds after it, splicing if a downstream
   neighbour exists. */
export const insertStepAtom = atom(null,
  (get, set, arg: { afterIndex: number; kind: ReduceStepKind }) => {
    const p = get(activePlottableAtom); if (!p) return;
    const steps = [...p.reduce.steps];
    steps.splice(arg.afterIndex + 1, 0, makeStep(arg.kind));
    set(activePlottableAtom, { ...p, reduce: { ...p.reduce, steps } });
  });

export const updateStepAtom = atom(null,
  (get, set, arg: { index: number; step: ReduceStep }) => {
    const p = get(activePlottableAtom); if (!p) return;
    set(activePlottableAtom, { ...p, reduce: { ...p.reduce, steps:
      p.reduce.steps.map((s, i) => (i === arg.index ? arg.step : s)) } });
  });

export const removeStepAtom = atom(null, (get, set, index: number) => {
  const p = get(activePlottableAtom); if (!p) return;
  set(activePlottableAtom,
    { ...p, reduce: { ...p.reduce, steps: p.reduce.steps.filter((_, i) => i !== index) } });
});

export const moveStepAtom = atom(null,
  (get, set, arg: { index: number; dir: -1 | 1 }) => {
    const p = get(activePlottableAtom); if (!p) return;
    const steps = [...p.reduce.steps];
    const j = arg.index + arg.dir;
    if (j < 0 || j >= steps.length) return;
    [steps[arg.index], steps[j]] = [steps[j], steps[arg.index]];
    set(activePlottableAtom, { ...p, reduce: { ...p.reduce, steps } });
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
  // a new layer draws the raw reduced rows by default; the user binds it to a
  // coarser level (one mark per grain) to build the superplot's bold marks.
  // Geom knobs live in style.overrides.geoms, not on the layer.
  set(activePlottableAtom,
    { ...p, layers: [...p.layers, { id: nextLayerId(), geom, level: RAW_LEVEL }] });
});

/* ---- table-level hierarchy: column roles + spine order (Data tab) ---- */

/* Assign a column a role: "identifier" (a nesting/spine level) or "classifier"
   (a categorical qualifier). Changes the column TYPE on the master schema and
   reconciles the spine membership, so the hierarchy stays fully defined — every
   non-numeric column is one or the other. A schema change re-uploads the table,
   so the engine sees the new types on the next analyze/preview. */
export const setColumnRoleAtom = atom(null,
  async (get, set, arg: { name: string; role: "identifier" | "classifier" }) => {
    const t = get(activeTableAtom); if (!t) return;
    const schema = t.schema;
    const handle = t.handle;
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
    const nextHierarchy = {
      ...t.hierarchy, spine: reconcileSpine(t.hierarchy.spine, identifierCols(nextSchema)),
    };
    set(tablesAtom, upsertTable(get(tablesAtom),
      { ...t, schema: nextSchema, hierarchy: nextHierarchy }));
  });

/* reorder the spine (coarsest → finest). Table-level: shared by all analyses. */
export const moveSpineAtom = atom(null,
  (get, set, arg: { index: number; dir: -1 | 1 }) => {
    const t = get(activeTableAtom); if (!t) return;
    const spine = [...t.hierarchy.spine];
    const j = arg.index + arg.dir;
    if (j < 0 || j >= spine.length) return;
    [spine[arg.index], spine[j]] = [spine[j], spine[arg.index]];
    set(tablesAtom, upsertTable(get(tablesAtom),
      { ...t, hierarchy: { ...t.hierarchy, spine } }));
  });

/* set the aggregate fn for a spine level — how finer rows collapse into that
   grain. Table-level: shared by every analysis/layer and the preview that draw
   the level. Unset means mean (the engine's default). */
export const setLevelFnAtom = atom(null,
  (get, set, arg: { level: string; fn: LevelFn }) => {
    const t = get(activeTableAtom); if (!t) return;
    set(tablesAtom, upsertTable(get(tablesAtom),
      { ...t, hierarchy: { ...t.hierarchy, fn: { ...t.hierarchy.fn, [arg.level]: arg.fn } } }));
  });

/* ---- per-analysis collapse plan + test grain (un-forcing the nesting) ----
   The plan lives on the active plottable; absent -> the default prefix chain
   generated from the table-level spine. The effective atoms resolve that fallback
   so consumers (the graph, the /shape_counts caller) never branch on presence. */
export const effectivePlanAtom = atom<CollapsePlan>((get) => {
  const p = get(activePlottableAtom);
  const h = get(hierarchyAtom);
  return p?.collapse ?? defaultPlan(h.spine, h.fn);
});
export const effectiveTestGrainAtom = atom<GrainKey>((get) => {
  const p = get(activePlottableAtom);
  const plan = get(effectivePlanAtom);
  const coarsest = plan.length ? grainKey(plan[plan.length - 1].keep) : "";
  // clamp a stored grain to the current plan: a plan edit can drop the chosen
  // node, and a stale key would silently degrade to the wrong grain downstream.
  return p?.testGrain && planGrains(plan).includes(p.testGrain) ? p.testGrain : coarsest;
});
const patchActive = (
  get: (a: typeof activePlottableAtom) => Plottable | null,
  set: (a: typeof activePlottableAtom, v: Plottable) => void,
  patch: Partial<Plottable>,
) => {
  const p = get(activePlottableAtom);
  if (p) set(activePlottableAtom, { ...p, ...patch });
};
export const setCollapsePlanAtom = atom(null, (get, set, next: CollapsePlan) =>
  patchActive(get, set, { collapse: next }));
export const setTestGrainAtom = atom(null, (get, set, grain: GrainKey) =>
  patchActive(get, set, { testGrain: grain }));
export const resetCollapseAtom = atom(null, (get, set) =>
  patchActive(get, set, { collapse: undefined, testGrain: undefined }));

/* ---- transformation explorer: the selected node's id (UI-only) ---- */

/* The explorer node the data tab is showing. null = no explicit selection; the
   data tab then defaults to the final reduced table (the plot node). Reset
   when the active plottable changes so a stale id from another analysis never
   sticks. UI-only: never persisted to a .iris. */
export const selectedNodeIdAtom = atom<string | null>(null);

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
