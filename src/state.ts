import { atom, type Getter, type Setter } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { dataFingerprint, snapshotStateKey } from "./autosave";
import type {
  AnalysisSpec, AnalyzeResponse, ColumnDef, CollapsePlan, DocumentManifest, GrainKey, Hierarchy, Layer, LevelFn, LoadedTable, Registry, SaveTable, Schema,
  StatsFamily, StyleKnob, StyleOverrides, Table, TableHandle, TestName, ReduceSpec,
  ReduceStep, ReduceStepKind, ReducePreview, EngineReduceStep,
} from "./types";
import { RAW_LEVEL, engine } from "./types";
import { defaultPlan, grainKey, planGrains } from "./collapse";
import { familyForMappingsRef, type RateOpts } from "./channels";
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
  /* Count-rate (GLM) family: the choice is the count MODEL (nb/poisson/auto,
     carried in stats.model via the plottable's rate opt-in), not a test
     override — so no override tests round-trip, like timeseries. The engine
     reports nb_glm / poisson_glm as the resolved test id. */
  rate: [],
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
  /* count-rate opt-in: when non-null, a categorical-x/numeric-y plot is the
     `rate` family — each group's counts fed to a Poisson/NB GLM with
     log(exposure) as offset, estimate ± model CI. Like `reference`, this is a
     design the column types can't imply, so it is stored, not derived. Mutually
     exclusive with `reference` (the TestPicker enforces it). */
  rate: RateOpts | null;
  describeOnly: boolean;    // user asked to render without a test
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
/* distribute Omit over a union so each member keeps its own (key-stripped) shape;
   a plain Omit<A|B, …> would collapse to the members' common keys only. */
type StripKey<T> = T extends unknown ? Omit<T, "_key"> : never;
const stripStepKey = <T extends { kind: string }>(s: T): StripKey<T> => {
  const { _key, ...rest } = s as T & { _key?: string };
  void _key;
  return rest as StripKey<T>;
};

type RightCache = Record<string, { version: number; table: Table }>;

/* full rows of pool tables referenced by a join, fetched from their sessions and
   keyed by handle version so an edit re-materializes (design §5, §11). Session-only. */
export const materializedTablesAtom = atom<RightCache>({});

/* a stable string of (tableId → version) over the materialized cache: the live
   preview / shape-count / node-fetch effects fold this into their dep keys so they
   re-run once a referenced join's rows land (and again on a version bump). One
   definition so the call sites can't drift out of sync. */
export const materializedVersionKeyAtom = atom((get) =>
  JSON.stringify(Object.entries(get(materializedTablesAtom)).map(([id, v]) => [id, v.version])));

/* derived view of the above, for the App materialization effect to read directly. */
export const tablesNeedingMaterializeAtom = atom((get) =>
  tablesNeedingMaterialize(get(tablesAtom), get(plottablesAtom), get(materializedTablesAtom)));

/* pool tables referenced by some analysis's join that are absent from the
   materialized cache or stale (handle version moved) — these must be fetched so
   the engine boundary can inline their full rows. Pure over its inputs. */
export function tablesNeedingMaterialize(
  pool: WorkspaceTable[], plottables: Plottable[], cache: RightCache): WorkspaceTable[] {
  const referenced = new Set<string>();
  for (const p of plottables)
    for (const s of p.reduce.steps)
      if (s.kind === "join" && s.rightTableId) referenced.add(s.rightTableId);
  return pool.filter((t) => referenced.has(t.id)
    && (!cache[t.id] || cache[t.id].version !== t.handle.version));
}

/* a join is runnable once its right is materialized AND it has at least one key;
   unset/unmaterialized/keyless joins are skipped (display degrades gracefully
   until the fetch lands / a key is picked — a keyless join is still being
   authored, and sending it would flash the engine's "join needs on keys" error
   mid-edit). The spec keeps the step so its editor card and the open "missing"
   circle persist; it just isn't sent until filled. */
export function runnableSteps(steps: ReduceStep[], cache: RightCache): ReduceStep[] {
  return steps.filter((s) => s.kind !== "join"
    || (!!s.rightTableId && s.on.length > 0 && !!cache[s.rightTableId]));
}

/* map internal steps to engine-facing steps, inlining each runnable join's right
   table from the cache. Filters via runnableSteps first, so every remaining join
   is materialized (the cache access below is therefore safe). */
export function resolveEngineSteps(steps: ReduceStep[], cache: RightCache): EngineReduceStep[] {
  return runnableSteps(steps, cache).map((s) =>
    s.kind === "join"
      ? { kind: "join", on: s.on, how: s.how, right: cache[s.rightTableId].table }
      : s);
}

/* SAVE serialization (Plan B): a FILLED join serializes as a REFERENCE to its
   right pool table (`right_table_id`), not inline rows — the engine reads the
   right's full rows from its session when it saves the table pool. An UNSET join
   (no rightTableId) has nothing to reference and is dropped. No cache, no inline. */
export function resolveSaveSteps(steps: ReduceStep[]): EngineReduceStep[] {
  return steps
    .filter((s) => s.kind !== "join" || s.rightTableId.length > 0)
    .map((s) => (s.kind === "join"
      ? { kind: "join" as const, on: s.on, how: s.how, right_table_id: s.rightTableId }
      : s));
}

/* the SAVE table pool: every pool table some analysis roots in (its main table) or
   references through a filled join, once each, in first-seen order. The engine
   reads each table's FULL rows from its live session (`handle.id`) and writes them
   under the pool id (`name`), so a saved .iris carries the whole pool by reference. */
export function saveTablesFor(plottables: Plottable[], pool: WorkspaceTable[]): SaveTable[] {
  const ids = new Set<string>();
  for (const p of plottables) {
    if (p.tableId) ids.add(p.tableId);
    for (const s of p.reduce.steps)
      if (s.kind === "join" && s.rightTableId) ids.add(s.rightTableId);
  }
  return [...ids]
    .map((id) => pool.find((t) => t.id === id))
    .filter((t): t is WorkspaceTable => !!t)
    .map((t) => ({ name: t.id, table_id: t.handle.id, hierarchy: t.hierarchy }));
}

/* a brand-new plottable starts completely blank: no preselected mapping, no
   preselected geom. The user picks x/y and adds layers explicitly. */
export function makeDefaultPlottable(tableId = ""): Plottable {
  return {
    id: nextId(), name: "Analysis 1", tableId,
    mappings: { x: "", y: "" },
    color: "", size: "", shape: "",
    facetRow: "", facetCol: "", shareX: true, shareY: true,
    layers: [],
    override: null, reference: null, rate: null, describeOnly: false,
    style: {},
    /* a fresh reduce per plottable — never share a singleton, so an in-place
       mutation could never alias across plottables.
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

/* ---- undo history (spec mutations only) ----
   Every edit to the active plottable funnels through activePlottableAtom's write
   (the reduce/layer/stats writers via updateActive; the encoding, stats-config
   and style cards via setActive). We record an undo point there for SPEC changes
   only — a style-only edit (a geom knob, colour, legend move: everything under
   `p.style`) is high-frequency, reverts via the style pane, and would otherwise
   bury structural changes under it. Node positions live in nodePositionsAtom, off
   the plottable, so they are excluded for free. Snapshots are the prior plottable,
   tagged by id; undo/redo restore by writing plottablesAtom DIRECTLY so they never
   re-enter this capture. The stacks clear on a switch of active analysis. */
const HISTORY_LIMIT = 50;
export const specHistoryAtom = atom<Plottable[]>([]);
export const specRedoAtom = atom<Plottable[]>([]);

/* a change touching anything but `p.style` is a spec mutation. Both sides are
   built by spreading the same prior plottable, so the key order is stable and a
   style-blanked JSON compare is a reliable structural diff for this heuristic. */
const specSignature = (p: Plottable): string => JSON.stringify({ ...p, style: null });

export const activePlottableAtom = atom(
  (get): Plottable | null => {
    const id = get(activePlottableIdAtom);
    return get(plottablesAtom).find((p) => p.id === id) ?? null;
  },
  (get, set, next: Plottable) => {
    const prev = get(plottablesAtom).find((p) => p.id === next.id);
    if (prev && prev !== next && specSignature(prev) !== specSignature(next)) {
      set(specHistoryAtom, [...get(specHistoryAtom).slice(-(HISTORY_LIMIT - 1)), prev]);
      set(specRedoAtom, []);   // a fresh edit prunes the redo branch
    }
    set(plottablesAtom, get(plottablesAtom).map((p) => (p.id === next.id ? next : p)));
  },
);

/* restore the active plottable to its previous spec. Writes plottablesAtom
   directly (bypassing the capture above) and moves the current state onto the
   redo stack. canUndo/canRedo are the read halves, for the toolbar buttons. */
/* restore the snapshot's SPEC but keep the CURRENT style — undo moves structure,
   never styling, so a colour/legend tweak made after a step survives undoing the
   step. (style is excluded from capture, so it has no undo timeline of its own.) */
const restoreSpec = (target: Plottable, cur: Plottable | undefined): Plottable =>
  cur ? { ...target, style: cur.style } : target;

export const undoSpecAtom = atom(
  (get) => get(specHistoryAtom).length > 0,
  (get, set) => {
    const hist = get(specHistoryAtom);
    const prev = hist[hist.length - 1];
    if (!prev) return;
    const cur = get(plottablesAtom).find((p) => p.id === prev.id);
    set(specHistoryAtom, hist.slice(0, -1));
    if (cur) set(specRedoAtom, [...get(specRedoAtom), cur]);
    const restored = restoreSpec(prev, cur);
    set(plottablesAtom, get(plottablesAtom).map((p) => (p.id === prev.id ? restored : p)));
    set(activePlottableIdAtom, prev.id);
  },
);
export const redoSpecAtom = atom(
  (get) => get(specRedoAtom).length > 0,
  (get, set) => {
    const redo = get(specRedoAtom);
    const target = redo[redo.length - 1];
    if (!target) return;
    const cur = get(plottablesAtom).find((p) => p.id === target.id);
    set(specRedoAtom, redo.slice(0, -1));
    if (cur) set(specHistoryAtom, [...get(specHistoryAtom), cur]);
    const restored = restoreSpec(target, cur);
    set(plottablesAtom, get(plottablesAtom).map((p) => (p.id === target.id ? restored : p)));
    set(activePlottableIdAtom, target.id);
  },
);
export const clearSpecHistoryAtom = atom(null, (_get, set) => {
  set(specHistoryAtom, []);
  set(specRedoAtom, []);
});

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

/* the Data tab edits the table it is currently on (its selection), which may differ
   from the active analysis's table — so it reads these, not the analysis-derived globals. */
export const activeSchemaAtom = atom((get) => get(activeTableAtom)?.schema ?? null);
export const activeHierarchyAtom = atom((get) => get(activeTableAtom)?.hierarchy ?? { spine: [], fn: {} });
export const activeHandleAtom = atom((get) => get(activeTableAtom)?.handle ?? null);

/* bump the active pool table's handle (a data edit / version change). The grid's
   cell edit goes through here so the new version refetches the affected block and
   re-runs compute. (Replaces the old `set(tableHandleAtom, …)` now that the three
   globals are read-only views off the pool.) */
export const bumpActiveHandleAtom = atom(null, (get, set, h: TableHandle) => {
  const t = get(activeTableAtom); if (!t) return;
  set(tablesAtom, upsertTable(get(tablesAtom), { ...t, handle: h }));
});

/* ---- figure cache: ONE atom owning, per analysis, the rendered result, the
   freshness key it was computed from, and the LRU recency together, so the three
   can never desync — a key with no backing result was a real bug class. The
   reduce PREVIEW stays separate (reducePreviewByIdAtom): different lifecycle
   (rewritten per keystroke, never evicted, gates the background drain). ---- */
interface CacheEntry { res: AnalyzeResponse; key: string }
interface FigureCache {
  byId: Record<string, CacheEntry>;
  /* LRU recency, least- → most-recently used; invariant: every id is in byId. */
  recency: string[];
}
export const figureCacheAtom = atom<FigureCache>({ byId: {}, recency: [] });

/* Read-only projections so every existing consumer (and test) reads the same
   shapes as before. Each derives from `byId` alone, so a recency-only touch
   doesn't change what a key/result reader sees. */
export const analysisByIdAtom = atom((get) => {
  const { byId } = get(figureCacheAtom);
  const out: Record<string, AnalyzeResponse> = {};
  for (const id in byId) out[id] = byId[id].res;
  return out;
});
/* Per plottable, the freshness key its cached result was computed from
   (`${handle.id}:${handle.version}:${JSON.stringify(spec)}`, spec embeds
   encodings/layers/style/reduce/hierarchy/snapshot, handle.version captures data
   edits). A fresh key means "the cached figure already matches" → no re-render. */
export const analysisKeyByIdAtom = atom((get) => {
  const { byId } = get(figureCacheAtom);
  const out: Record<string, string> = {};
  for (const id in byId) out[id] = byId[id].key;
  return out;
});
/* LRU recency (least- → most-recently used); eviction drops from the front. */
export const analysisRecencyAtom = atom((get) => get(figureCacheAtom).recency);

/* An identity-stable string of (id → key): an effect that must react to "did any
   freshness key change" (the background drain) deps on this instead of the
   derived key map, so it doesn't re-run on a recency-only touch. */
export const cacheKeysFingerprintAtom = atom((get) => {
  const { byId } = get(figureCacheAtom);
  return Object.keys(byId).sort().map((id) => `${id}:${byId[id].key}`).join("|");
});

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

/* Pure reducers over the figure cache — unit-testable without a store.
   cachePut inserts result+key, marks it most-recently-used, then evicts LRU
   entries until back under `budget` (never the pinned/active id nor the entry
   just written — both stay even if alone they exceed the budget). cacheTouch
   bumps recency; cacheDrop removes one entry. All keep the invariant that every
   recency id is present in byId. */
export function cachePut(
  c: FigureCache, arg: { id: string; key: string; res: AnalyzeResponse },
  pinnedId: string | null, budget: number,
): FigureCache {
  const byId: Record<string, CacheEntry> = { ...c.byId, [arg.id]: { res: arg.res, key: arg.key } };
  const recency = [...c.recency.filter((x) => x !== arg.id), arg.id];
  let total = Object.values(byId).reduce((s, e) => s + estimateBytes(e.res), 0);
  for (const victim of recency) {
    if (total <= budget) break;
    if (victim === pinnedId || victim === arg.id) continue;
    if (!(victim in byId)) continue;
    total -= estimateBytes(byId[victim].res);
    delete byId[victim];
  }
  return { byId, recency: recency.filter((id) => id in byId) };
}
export function cacheTouch(c: FigureCache, id: string): FigureCache {
  if (c.recency[c.recency.length - 1] === id || !(id in c.byId)) return c;
  return { byId: c.byId, recency: [...c.recency.filter((x) => x !== id), id] };
}
export function cacheDrop(c: FigureCache, id: string): FigureCache {
  if (!(id in c.byId)) return c;
  const byId = { ...c.byId }; delete byId[id];
  return { byId, recency: c.recency.filter((x) => x !== id) };
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
    set(figureCacheAtom, cachePut(get(figureCacheAtom), arg,
      get(activePlottableIdAtom), get(cacheBudgetAtom)));
  });

/* mark a cached plottable most-recently-used without rewriting its result — used
   when the active loop shows a plot straight from cache (a freshness hit), so a
   plot the user keeps returning to is not the first evicted once they leave it. */
export const touchAnalysisAtom = atom(null, (get, set, id: string) => {
  set(figureCacheAtom, cacheTouch(get(figureCacheAtom), id));
});

/* analysisAtom: derived read-only convenience for the ACTIVE plottable */
export const analysisAtom = atom((get) => {
  const id = get(activePlottableIdAtom);
  return id ? (get(figureCacheAtom).byId[id]?.res ?? null) : null;
});

/* Write a result into an EXPLICIT plottable's slot. The caller captures the
   target id at dispatch time, so a result that resolves after the user has
   switched plottables still lands in the plottable it was computed for (not
   whichever happens to be active when the network call returns). */
export const setAnalysisByIdAtom = atom(
  null, (get, set, arg: { id: string; res: AnalyzeResponse | null }) => {
    if (arg.res) {
      // seed/replace a result, preserving any existing freshness key. A direct
      // insert (no eviction) — the app renders via setAnalysisResultAtom; only a
      // test injects a result here, sometimes a partial one with no figure.
      const cur = get(figureCacheAtom);
      const key = cur.byId[arg.id]?.key ?? "";
      set(figureCacheAtom, {
        byId: { ...cur.byId, [arg.id]: { res: arg.res, key } },
        recency: [...cur.recency.filter((x) => x !== arg.id), arg.id],
      });
    } else {
      // clearing a figure (no Y / no layer / mapping error / failed active render)
      // drops its result, freshness key, and recency slot together, so the
      // background loop never sees a key with no backing result. The reduce
      // preview is independent and left untouched.
      set(figureCacheAtom, cacheDrop(get(figureCacheAtom), arg.id));
    }
  });

/* ---- lifecycle verbs: the ONLY places the analysis caches are reset/dropped, so
   no call site can forget one of them. clear = whole-workspace replace (import /
   document load); drop = one analysis removed (delete). Both cover the figure
   cache AND the reduce preview. ---- */
export const clearAnalysisCachesAtom = atom(null, (_get, set) => {
  set(figureCacheAtom, { byId: {}, recency: [] });
  set(reducePreviewByIdAtom, {});
});
export const dropAnalysisAtom = atom(null, (get, set, id: string) => {
  set(figureCacheAtom, cacheDrop(get(figureCacheAtom), id));
  const prev = { ...get(reducePreviewByIdAtom) }; delete prev[id];
  set(reducePreviewByIdAtom, prev);
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
  set(clearAnalysisCachesAtom);
  // add a default analysis bound to the new table (do NOT reset existing ones).
  const first = makeDefaultPlottable(id);
  set(plottablesAtom, [...get(plottablesAtom), first]);
  set(activePlottableIdAtom, first.id);
});

/* Inverse of buildSpec: reconstruct the editable Plottable from a saved analysis
   spec so a loaded .viz comes back fully editable, not just renderable. The spec
   carries everything the Plottable needs. Geom knobs live in style.overrides.geoms
   (the canonical location the engine compiler reads), never on the layer. */
/* A recode/pivot relabel map is an ordered [from,to] array in memory (types.ts),
   but older saved specs stored it as a dict. Accept either shape on load. */
const toPairs = (
  m: Array<[string, string]> | Record<string, string> | undefined,
): Array<[string, string]> =>
  Array.isArray(m) ? m : Object.entries(m ?? {});

/* one saved step → the internal (keyed) shape; shared by the main and the
   post-collapse phases so the two adoptions can't drift. */
const adoptStep = (s: EngineReduceStep): ReduceStep => {
  if (s.kind === "join")
    return { kind: "join" as const, on: s.on, how: s.how,
      rightTableId: (s as { right_table_id?: string }).right_table_id ?? "", _key: nextStepKey() };
  if (s.kind === "recode")
    return { ...s, map: toPairs(s.map), _key: nextStepKey() };
  if (s.kind === "pivot")
    return { ...s, names: toPairs(s.names), _key: nextStepKey() };
  return { ...s, _key: nextStepKey() };
};

export function plottableFromSpec(spec: AnalysisSpec): Plottable {
  const s = spec.stats;
  const style: StyleOverrides = { ...(spec.style?.overrides ?? {}) };
  // tolerate (and drop) a vestigial `params` key on a layer — no spec carries geom
  // knobs there anymore; they ride in style.overrides.geoms.
  const layers = (spec.layers ?? []).map((l) => {
    const { params: _drop, ...rest } = l as Layer & { params?: unknown };
    return { ...rest, id: rest.id ?? nextLayerId() };
  });
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
    /* restore the count-rate opt-in the same way, so a saved `rate` doc
       round-trips instead of re-deriving as a group comparison on open. */
    rate: s?.family === "rate"
      ? { exposure: s?.exposure ?? "", model: s?.model ?? "nb" }
      : null,
    describeOnly: s?.describe_only ?? false,
    style,
    /* a saved join step REFERENCES its right pool table by id (right_table_id),
       adopted straight into the internal rightTableId; an absent id starts "" (an
       unfilled or hand-edited join). Key every step for React. The post-collapse
       phase (reduce.post) is adopted too — the UI can't author it yet, but a
       loaded doc that carries one must round-trip, not silently lose it. */
    reduce: {
      steps: (spec.reduce?.steps ?? []).map(adoptStep),
      ...(spec.reduce?.post?.length ? { post: spec.reduce.post.map(adoptStep) } : {}),
    },
    collapse: spec.collapse,
    testGrain: spec.test_grain,
  };
}

export interface LoadedDoc {
  manifest?: DocumentManifest;
  analyses: AnalysisSpec[];                 // already migrated to the current spec
  provenance?: Record<string, unknown> | null;
  tables: LoadedTable[];                    // the full pool the engine rebuilt
  /* autosave: a restore-from-snapshot loads through this same atom but the
     recovered work still has no explicit save — keep it counting as unsaved
     (skip the baseline capture below) so autosaving resumes immediately. */
  keepDirty?: boolean;
}

/* ---- autosave dirtiness (see autosave.ts for the key semantics) ----
   The baseline is the state key at the last moment everything was persisted:
   app start (empty workspace), a document load, an explicit Save. The autosave
   loop in App runs only while the live key differs from it. */
export const autosaveBaselineAtom = atom<string>(snapshotStateKey([], []));
export const autosaveKeyAtom = atom((get) =>
  snapshotStateKey(get(plottablesAtom), get(tablesAtom)));
export const dataFingerprintAtom = atom((get) => dataFingerprint(get(tablesAtom)));

/* swap in a loaded .iris: like loadTableAtom but rebuilds the FULL table pool from
   the doc's `tables[]`, then restores the saved analyses (rebuilt as editable
   plottables, each bound to its saved `table_id` and joining by reference) instead
   of starting blank. */
export const loadDocumentAtom = atom(null, (get, set, doc: LoadedDoc) => {
  applyLoadedDoc(get, set, doc);
  /* a freshly loaded document IS the persisted state — nothing to autosave
     until the user edits. Captured after the body so every exit path (empty
     doc, no analyses, full restore) rebaselines consistently. */
  if (!doc.keepDirty)
    set(autosaveBaselineAtom, snapshotStateKey(get(plottablesAtom), get(tablesAtom)));
});

function applyLoadedDoc(get: Getter, set: Setter, doc: LoadedDoc) {
  // Load REPLACES the workspace: clear the pool + materialized cache first so a
  // prior import/load leaves no orphan tables and no stale rows (spec §6.2 — one
  // in-memory shape after load). loadTableAtom accumulates; loadDocument does not.
  set(tablesAtom, []);
  set(materializedTablesAtom, {});
  // a malformed / hand-written file with no tables can't seed a pool; bail rather
  // than crash on doc.tables[0] below (the workspace is already cleared).
  if (!doc.tables.length) return;
  // Rebuild the pool from the doc's tables, preserving order; the engine recreated
  // a session per table as it read the .iris, so adopt each handle. A table keeps
  // its saved name as its pool id (what each analysis's table_id references).
  const firstHierarchy = doc.analyses[0]?.hierarchy;
  for (const lt of doc.tables) {
    // hierarchy is table-level: prefer the table's own (a 2.1 table carries it),
    // else (a table saved without an explicit spine) fall back to the first saved
    // spec's hierarchy, then to the identifier columns.
    const hierarchy: Hierarchy = lt.hierarchy && lt.hierarchy.spine?.length
      ? { spine: lt.hierarchy.spine, fn: lt.hierarchy.fn ?? {} }
      : firstHierarchy && firstHierarchy.spine?.length
        ? { spine: firstHierarchy.spine, fn: firstHierarchy.fn ?? {} }
        : { spine: identifierCols(lt.schema), fn: {} };
    const entry: WorkspaceTable = {
      id: lt.name, name: lt.name, schema: lt.schema, hierarchy,
      handle: { id: lt.id, n: lt.n, version: lt.version, schema: lt.schema, counts: lt.counts },
    };
    set(tablesAtom, upsertTable(get(tablesAtom), entry));
  }
  set(activeTableIdAtom, doc.tables[0].name);
  set(engineErrorAtom, null);
  set(clearAnalysisCachesAtom);
  // a fresh doc with no saved analyses gets a single default plottable bound to
  // the first pool table.
  if (!doc.analyses.length) {
    const first = makeDefaultPlottable(doc.tables[0].name);
    set(plottablesAtom, [first]);
    set(activePlottableIdAtom, first.id);
    return;
  }
  // Restore each analysis. A join carries its right_table_id (adopted by
  // plottableFromSpec into rightTableId, pointing at a pool table seeded above),
  // so analyses bind by reference — no row migration.
  const restored: Plottable[] = [];
  for (const spec of doc.analyses) {
    const p = plottableFromSpec(spec);
    // bind to the saved table_id when it names a real pool table. A non-empty
    // table_id that is NOT in the pool is a dangling reference — bind to pool[0]
    // so the doc still opens, but warn loudly (integrity via guidance, not a wall).
    const pool = get(tablesAtom);
    let tableId = pool[0].id;
    if (p.tableId) {
      if (pool.some((t) => t.id === p.tableId)) tableId = p.tableId;
      else console.warn(`analysis "${p.name}" references unknown table "${p.tableId}"; binding to "${pool[0].id}"`);
    }
    // a join may reference a right table that isn't in the pool (a hand-edited or
    // partial file): the live path degrades gracefully (the cache never holds it,
    // so the join is dropped), but surface it so the missing right isn't silent.
    for (const s of p.reduce.steps)
      if (s.kind === "join" && s.rightTableId && !pool.some((t) => t.id === s.rightTableId))
        console.warn(`analysis "${p.name}" joins unknown table "${s.rightTableId}"; the join will be skipped until it is present`);
    restored.push({ ...p, tableId });
  }
  set(plottablesAtom, restored);
  set(activePlottableIdAtom, restored[0].id);
}

/* Pure builder: a plottable + its derived stats family + (optional) recommended
   test + engine snapshot → an analysis spec. `family` is derived by the caller
   from the encoding column types (channels.familyForMappings) — it is no longer
   stored on the plottable. Shared by the live `specAtom` (active plottable) and
   the save path (every plottable), so the two can never drift. */
export function buildSpec(p: Plottable, family: StatsFamily,
                          rec: TestName | undefined,
                          snapshot: Record<string, string>,
                          hierarchy: Hierarchy,
                          cache: RightCache): AnalysisSpec {
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
    reduce: {
      steps: resolveEngineSteps(p.reduce.steps, cache).map(stripStepKey),
      // the UI can't author post steps yet, but a loaded doc carrying them must
      // keep running (and re-saving) them, not silently drop the phase.
      ...(p.reduce.post?.length
        ? { post: resolveEngineSteps(p.reduce.post, cache).map(stripStepKey) } : {}),
    },
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
      /* the rate family's inputs — exposure column (null = exposure 1) and the
         count model. Only emitted when the family IS rate, mirroring reference. */
      ...(family === "rate" ? {
        exposure: p.rate?.exposure ? p.rate.exposure : null,
        model: p.rate?.model ?? "nb",
      } : {}),
      // describe-only is a decision; omit when false to keep specs clean.
      ...(p.describeOnly ? { describe_only: true } : {}),
      alpha: 0.05,
    },
    style: { overrides: style },
    engine_snapshot: snapshot,
    ...(p.collapse ? { collapse: p.collapse } : {}),
    ...(p.testGrain ? { test_grain: p.testGrain } : {}),
  };
}

/* save spec (Plan B): the buildSpec result, but with `table_id` set (which pool
   table the analysis roots in) and every FILLED join serialized as a REFERENCE
   (right_table_id) instead of inline rows — the full pool is saved separately, by
   reference. `cache` is unused here (kept so buildAllSpecs can call buildSpec and
   specForSave through one builder signature). */
export function specForSave(p: Plottable, family: StatsFamily, rec: TestName | undefined,
  snapshot: Record<string, string>, hierarchy: Hierarchy, cache: RightCache): AnalysisSpec {
  void cache;
  const base = buildSpec(p, family, rec, snapshot, hierarchy, {});
  return {
    ...base,
    table_id: p.tableId,
    reduce: {
      steps: resolveSaveSteps(p.reduce.steps).map(stripStepKey),
      ...(p.reduce.post?.length
        ? { post: resolveSaveSteps(p.reduce.post).map(stripStepKey) } : {}),
    },
  };
}

/* the keystone: spec derived live from the active plottable. The stats family is
   derived from the post-reduction column types so the test offered matches the
   data actually mapped. */
export const specAtom = atom<AnalysisSpec | null>((get) => {
  const schema = get(schemaAtom);
  const p = get(activePlottableAtom);
  if (!schema || !p) return null;
  const family = familyForMappingsRef(p.mappings, get(effectiveSchemaAtom), p.reference, p.rate);
  const tests = TEST_BY_FAMILY[family];
  const recRaw = get(analysisAtom)?.stats.recommendation.test as TestName | undefined;
  const rec = recRaw && tests.includes(recRaw) ? recRaw : undefined;
  return buildSpec(p, family, rec, get(engineSnapshotAtom) ?? {}, get(hierarchyAtom),
    get(materializedTablesAtom));
});

/* shared core of allSpecsAtom / allSaveSpecsAtom: build a spec per plottable,
   each with its own derived family/recommended-test, via the given builder. */
function buildAllSpecs(get: Getter,
  build: (p: Plottable, family: StatsFamily, rec: TestName | undefined,
          snapshot: Record<string, string>, hierarchy: Hierarchy, cache: RightCache) => AnalysisSpec
): AnalysisSpec[] {
  const schema = get(schemaAtom);
  if (!schema) return [];
  const snap = get(engineSnapshotAtom) ?? {};
  const hierarchy = get(hierarchyAtom);
  const byId = get(analysisByIdAtom);
  const cache = get(materializedTablesAtom);
  // mirror specAtom: derive each plottable's family from ITS post-reduction
  // schema (the reduce preview, when present) so the saved family/test matches
  // what the live spec computes, falling back to the master schema.
  const previews = get(reducePreviewByIdAtom);
  return get(plottablesAtom).map((p) => {
    const eff = previews[p.id]?.preview.schema ?? schema;
    const family = familyForMappingsRef(p.mappings, eff, p.reference, p.rate);
    const tests = TEST_BY_FAMILY[family];
    const recRaw = byId[p.id]?.stats.recommendation.test as TestName | undefined;
    const rec = recRaw && tests.includes(recRaw) ? recRaw : undefined;
    return build(p, family, rec, snap, hierarchy, cache);
  });
}

/* every plottable's spec, each carrying its own recommended test — the live
   background render loop reads these (graceful join drop). */
export const allSpecsAtom = atom((get): AnalysisSpec[] => buildAllSpecs(get, buildSpec));

/* the save variant: identical, but inlines every filled join (no drop) so a
   saved .iris never loses a join. The save path serializes these. */
export const allSaveSpecsAtom = atom((get): AnalysisSpec[] => buildAllSpecs(get, specForSave));

/* ---- CRUD atoms for managing the plottables list ---- */

export const addPlottableAtom = atom(null, (get, set) => {
  const schema = get(schemaAtom);
  if (!schema) return;
  // bind the new analysis to the table the active analysis is on (guaranteed
  // non-empty whenever the schema guard above passes — see design §4.2).
  const p = makeDefaultPlottable(get(activePlottableAtom)?.tableId ?? "");
  p.name = `Analysis ${get(plottablesAtom).length + 1}`;
  set(plottablesAtom, [...get(plottablesAtom), p]);
  set(activePlottableIdAtom, p.id);
});

export const duplicatePlottableAtom = atom(null, (get, set, id: string) => {
  const src = get(plottablesAtom).find((p) => p.id === id);
  if (!src) return;
  /* layers get fresh ids, so StyleOverrides.layers (keyed by layer id) must be
     re-keyed to follow them or the copy loses its per-layer styling. */
  const layerIdMap = new Map<string, string>();
  const layers = src.layers.map((l) => {
    const nid = nextLayerId();
    if (l.id) layerIdMap.set(l.id, nid);
    return { id: nid, geom: l.geom, level: l.level };
  });
  const style = structuredClone(src.style);
  if (style.layers) {
    style.layers = Object.fromEntries(
      Object.entries(style.layers).flatMap(([k, v]) => {
        const nk = layerIdMap.get(k);
        return nk ? [[nk, v] as const] : [];
      }));
  }
  const copy: Plottable = {
    ...src, id: nextId(), name: `${src.name} copy`,
    tableId: src.tableId,
    mappings: { ...src.mappings },
    rate: src.rate ? { ...src.rate } : null,
    layers,
    style,
    reduce: {
      steps: structuredClone(src.reduce.steps).map((s) => ({ ...s, _key: nextStepKey() })),
      ...(src.reduce.post?.length
        ? { post: structuredClone(src.reduce.post).map((s) => ({ ...s, _key: nextStepKey() })) } : {}),
    },
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
  set(dropAnalysisAtom, id);
});

/* ---- reduce-step CRUD + reorder on the ACTIVE plottable ---- */

export function makeStep(kind: ReduceStepKind): ReduceStep {
  const _key = nextStepKey();
  switch (kind) {
    case "drop": return { _key, kind, columns: [] };
    case "filter": return { _key, kind, conditions: [] };
    case "derive": return { _key, kind, column: "", expr: "" };
    case "recode": return { _key, kind, column: "", map: [] };
    case "pivot":
      return { _key, kind, index: [], column: "", values: "", agg: "sum", fill: 0, names: [] };
    case "grid_complete":
      return { _key, kind, by: [], column: "", levels: [],
        count_unique: null, fill: 0, count_name: "n" };
    case "join":
      // starts with an empty rightTableId — the unfilled "missing input" state,
      // filled by dragging a data node onto its open circle.
      return { _key, kind, on: [], how: "inner", rightTableId: "" };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/* the ~12 writers below all derive the next active plottable from the current one
   under the same `get → guard → set` shape; updateActive is the functional sibling
   of patchActive (which takes a flat patch). reorder swaps neighbours in place,
   returning null when the move falls off either end so the writer no-ops. */
type ActiveGet = (a: typeof activePlottableAtom) => Plottable | null;
type ActiveSet = (a: typeof activePlottableAtom, v: Plottable) => void;
const updateActive = (get: ActiveGet, set: ActiveSet, fn: (p: Plottable) => Plottable) => {
  const p = get(activePlottableAtom);
  if (!p) return;
  const next = fn(p);
  // a transform that returns the same reference (e.g. an out-of-bounds reorder) is
  // a no-op; skip the write so it never churns plottablesAtom or re-renders.
  if (next !== p) set(activePlottableAtom, next);
};
const reorder = <T>(arr: T[], index: number, dir: -1 | 1): T[] | null => {
  const j = index + dir;
  if (j < 0 || j >= arr.length) return null;
  const out = [...arr];
  [out[index], out[j]] = [out[j], out[index]];
  return out;
};

export const addStepAtom = atom(null, (get, set, kind: ReduceStepKind) =>
  updateActive(get, set, (p) =>
    ({ ...p, reduce: { ...p.reduce, steps: [...p.reduce.steps, makeStep(kind)] } })));

/* splice a blank step in immediately AFTER `afterIndex` (the source node's step
   index; Source = -1 → insert at 0). Append and insert are the same operation at
   different positions — a node's `+` adds after it, splicing if a downstream
   neighbour exists. */
export const insertStepAtom = atom(null,
  (get, set, arg: { afterIndex: number; kind: ReduceStepKind }) =>
    updateActive(get, set, (p) => {
      const steps = [...p.reduce.steps];
      steps.splice(arg.afterIndex + 1, 0, makeStep(arg.kind));
      return { ...p, reduce: { ...p.reduce, steps } };
    }));

export const updateStepAtom = atom(null,
  (get, set, arg: { index: number; step: ReduceStep }) =>
    updateActive(get, set, (p) => ({ ...p, reduce: { ...p.reduce, steps:
      p.reduce.steps.map((s, i) => (i === arg.index ? arg.step : s)) } })));

export const removeStepAtom = atom(null, (get, set, index: number) =>
  updateActive(get, set, (p) =>
    ({ ...p, reduce: { ...p.reduce, steps: p.reduce.steps.filter((_, i) => i !== index) } })));

export const moveStepAtom = atom(null,
  (get, set, arg: { index: number; dir: -1 | 1 }) =>
    updateActive(get, set, (p) => {
      const steps = reorder(p.reduce.steps, arg.index, arg.dir);
      return steps ? { ...p, reduce: { ...p.reduce, steps } } : p;
    }));

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

export const addLayerAtom = atom(null, (get, set, geom: Layer["geom"]) =>
  // a new layer draws the raw reduced rows by default; the user binds it to a
  // coarser level (one mark per grain) to build the superplot's bold marks.
  // Geom knobs live in style.overrides.geoms, not on the layer.
  updateActive(get, set, (p) =>
    ({ ...p, layers: [...p.layers, { id: nextLayerId(), geom, level: RAW_LEVEL }] })));

/* ---- table-level hierarchy: column roles + spine order (Data tab) ---- */

/* Assign a column a role: "identifier" (a nesting/spine level) or "classifier"
   (a categorical qualifier). Changes the column TYPE on the master schema and
   reconciles the spine membership, so the hierarchy stays fully defined — every
   non-numeric column is one or the other. The retyped schema is pushed to the
   engine session (POST /table/{id}/schema): the engine's test inference reads the
   session schema, so without this the engine keeps the old types and can disagree
   with the frontend about which test ran. The version the engine bumps flows back
   onto the handle, invalidating the analyze cache so the next render re-infers. */
export const setColumnRoleAtom = atom(null,
  async (get, set, arg: { name: string; role: "identifier" | "classifier" }) => {
    const t = get(activeTableAtom); if (!t) return;
    const tableId = t.id;
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
    // Retype the engine session in place (data untouched) so its inference sees
    // the new types; the bumped version invalidates every result cache keyed on it.
    const patched = handle ? await engine.setSchema(handle.id, nextSchema) : null;
    const nextHandle: TableHandle | undefined = handle && patched
      ? { ...handle, version: patched.version, schema: patched.schema }
      : handle;
    // Re-read by id after the awaits: a pool write in between (a cell edit, a
    // second role toggle) must not be clobbered by this stale snapshot's handle.
    const cur = byId(get(tablesAtom), tableId) ?? t;
    set(tablesAtom, upsertTable(get(tablesAtom),
      { ...cur, schema: nextSchema, hierarchy: nextHierarchy, handle: nextHandle }));
  });

/* reorder the spine (coarsest → finest). Table-level: shared by all analyses. */
export const moveSpineAtom = atom(null,
  (get, set, arg: { index: number; dir: -1 | 1 }) => {
    const t = get(activeTableAtom); if (!t) return;
    const spine = reorder(t.hierarchy.spine, arg.index, arg.dir);
    if (!spine) return;
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
const patchActive = (get: ActiveGet, set: ActiveSet, patch: Partial<Plottable>) =>
  updateActive(get, set, (p) => ({ ...p, ...patch }));
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
  (get, set, arg: { index: number; layer: Layer }) =>
    updateActive(get, set, (p) => ({ ...p, layers:
      p.layers.map((l, i) => (i === arg.index ? arg.layer : l)) })));

export const removeLayerAtom = atom(null, (get, set, index: number) =>
  updateActive(get, set, (p) => ({ ...p, layers: p.layers.filter((_, i) => i !== index) })));

export const moveLayerAtom = atom(null,
  (get, set, arg: { index: number; dir: -1 | 1 }) =>
    updateActive(get, set, (p) => {
      const layers = reorder(p.layers, arg.index, arg.dir);
      return layers ? { ...p, layers } : p;
    }));
