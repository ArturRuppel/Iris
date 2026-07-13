import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useEffect, useRef, useState } from "react";
import irisMark from "./assets/iris-mark.svg";
import { DataView } from "./components/DataView";
import { HierarchyPanel } from "./components/HierarchyPanel";
import { ImportWizard, type ImportWizardHandle } from "./components/ImportWizard";
import { PlottableSidebar } from "./components/PlottableSidebar";
import { TableList } from "./components/TableList";
import { Guide } from "./examples/Guide";
import { TutorialOverlay } from "./tutorial/TutorialOverlay";
import { startTutorialAtom } from "./tutorial/state";
import { WorkbenchCanvas } from "./workbench/WorkbenchCanvas";
import { clearWorkbenchAtom, seedDefaultStashAtom } from "./workbench/state";
import exampleManifest from "./examples/assets/manifest.json";
import {
  activePlottableAtom, activePlottableIdAtom, allSpecsAtom, analysisAtom,
  analysisKeyByIdAtom, analyzeStatusAtom, cacheKey, cacheKeysFingerprintAtom, dataLoadingAtom,
  effectiveSchemaAtom, engineErrorAtom, engineSnapshotAtom,
  hierarchyAtom, loadDocumentAtom, newDocumentAtom, pickStaleSpec, registryAtom, styleRegistryAtom,
  reducePreviewByIdAtom, renderErrorAtom, schemaAtom, selectedNodeIdAtom, setAnalysisByIdAtom,
  setAnalysisResultAtom, setReducePreviewByIdAtom, specAtom, tableHandleAtom,
  touchAnalysisAtom, viewModeAtom, effectivePlanAtom, effectiveTestGrainAtom,
  tablesNeedingMaterializeAtom, materializedTablesAtom, materializedVersionKeyAtom, allSaveSpecsAtom, plottablesAtom,
  resolveEngineSteps, saveTablesFor, tablesAtom, clearSpecHistoryAtom,
  autosaveBaselineAtom, autosaveKeyAtom, dataFingerprintAtom,
  activeReduceDagAtom, reduceStoreAtom,
} from "./state";
import { base64ToBytes, downloadBase64, engine, fileToBase64, hasFsAccess, migrateSpec, pickFileFallback } from "./types";
import type { AutosaveStatus, NodeShape } from "./types";
import { colType } from "./channels";
import { shapeCountsAtom, guardsAtom, explorerGraphAtom } from "./explorer/graphAtom";
import { useDebouncedAsync } from "./useDebouncedAsync";

const EXAMPLE_IRIS = import.meta.glob("./examples/assets/*.iris", {
  query: "?url", import: "default", eager: true,
}) as Record<string, string>;

/* Small geometric top-bar glyphs (currentColor, ~15px). Recreated from the
   design handoff; kept inline so they inherit the button's ink/active colour. */
const G = { width: 15, height: 15, viewBox: "0 0 16 16", fill: "none" } as const;
const DataGlyph = () => (
  <svg {...G}><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" /><line x1="1.5" y1="6.2" x2="14.5" y2="6.2" stroke="currentColor" strokeWidth="1.4" /><line x1="6" y1="6.2" x2="6" y2="13.5" stroke="currentColor" strokeWidth="1.4" /></svg>
);
const WorkbenchGlyph = () => (
  <svg {...G}><circle cx="3.2" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.4" /><circle cx="12.8" cy="3.4" r="2.1" stroke="currentColor" strokeWidth="1.4" /><circle cx="12.8" cy="12.6" r="2.1" stroke="currentColor" strokeWidth="1.4" /><line x1="5" y1="7.1" x2="11" y2="4.2" stroke="currentColor" strokeWidth="1.4" /><line x1="5" y1="8.9" x2="11" y2="11.8" stroke="currentColor" strokeWidth="1.4" /></svg>
);
const GuideGlyph = () => (
  <svg {...G}><rect x="2" y="3" width="12" height="10.5" rx="1.2" stroke="currentColor" strokeWidth="1.4" /><line x1="8" y1="3.4" x2="8" y2="13.2" stroke="currentColor" strokeWidth="1.4" /></svg>
);
const SunGlyph = () => (
  <svg {...G}><circle cx="8" cy="8" r="3.1" stroke="currentColor" strokeWidth="1.4" /><g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><line x1="8" y1="1.5" x2="8" y2="3" /><line x1="8" y1="13" x2="8" y2="14.5" /><line x1="1.5" y1="8" x2="3" y2="8" /><line x1="13" y1="8" x2="14.5" y2="8" /><line x1="3.4" y1="3.4" x2="4.4" y2="4.4" /><line x1="11.6" y1="11.6" x2="12.6" y2="12.6" /><line x1="12.6" y1="3.4" x2="11.6" y2="4.4" /><line x1="4.4" y1="11.6" x2="3.4" y2="12.6" /></g></svg>
);
const MoonGlyph = () => (
  <svg {...G}><path d="M13 9.6A5.5 5.5 0 0 1 6.4 3 5.5 5.5 0 1 0 13 9.6Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
);

/* Tells the user, at a glance, whether the figure is current, being computed,
   or failed — so a long render never reads as a freeze or a crash. Rendered as
   a status pill in the top bar (dot + label, colour keyed to the state). */
function RenderIndicator({ dataLoading }: { dataLoading: boolean }) {
  const status = useAtomValue(analyzeStatusAtom);
  const state = dataLoading ? "loading"
    : status === "running" ? "running"
    : status === "error" ? "error"
    : status === "ok" ? "ok" : null;
  if (!state) return null;
  const label = state === "loading" ? "Loading data…"
    : state === "running" ? "Rendering…"
    : state === "error" ? "Render failed" : "Up to date";
  return <span className={`render-status ${state}`}><span className="dot" />{label}</span>;
}

export default function App() {
  const [schema] = useAtom(schemaAtom);
  const [active] = useAtom(activePlottableAtom);
  const activeId = useAtomValue(activePlottableIdAtom);
  // the active analysis's reduce steps (its branch of the shared table pool).
  const activeSteps = useAtomValue(activeReduceDagAtom)?.steps ?? [];
  const [viewMode, setViewMode] = useAtom(viewModeAtom);
  const loadDocument = useSetAtom(loadDocumentAtom);
  const startTutorial = useSetAtom(startTutorialAtom);
  const plottables = useAtomValue(plottablesAtom);
  const store = useStore();
  const spec = useAtomValue(specAtom);
  const allSpecs = useAtomValue(allSpecsAtom);
  const setAnalysisById = useSetAtom(setAnalysisByIdAtom);
  const setAnalysisResult = useSetAtom(setAnalysisResultAtom);
  const touchAnalysis = useSetAtom(touchAnalysisAtom);
  const analysisKeyById = useAtomValue(analysisKeyByIdAtom);
  const cacheKeysFingerprint = useAtomValue(cacheKeysFingerprintAtom);
  const reducePreviews = useAtomValue(reducePreviewByIdAtom);
  const setReducePreviewById = useSetAtom(setReducePreviewByIdAtom);
  const handle = useAtomValue(tableHandleAtom);
  const setError = useSetAtom(engineErrorAtom);
  const setSnapshot = useSetAtom(engineSnapshotAtom);
  const effectiveSchema = useAtomValue(effectiveSchemaAtom);
  const setRegistry = useSetAtom(registryAtom);
  const setStyleRegistry = useSetAtom(styleRegistryAtom);
  const setStatus = useSetAtom(analyzeStatusAtom);
  const analyzeStatus = useAtomValue(analyzeStatusAtom);
  const setRenderError = useSetAtom(renderErrorAtom);
  const renderError = useAtomValue(renderErrorAtom);
  const dataLoading = useAtomValue(dataLoadingAtom);
  const explorerGraph = useAtomValue(explorerGraphAtom);
  const warnIssue = (useAtomValue(analysisAtom)?.issues ?? [])
    .find((i) => i.level === "warning");
  const error = useAtomValue(engineErrorAtom);
  const [engineUp, setEngineUp] = useState<boolean | null>(null);
  const [showSpec, setShowSpec] = useState(false);
  /* Appearance: light default, persisted, applied as data-theme on the document
     root so portalled popovers (menus, tooltips) inherit the dark token set too. */
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    (typeof localStorage !== "undefined" && localStorage.getItem("iris:theme") === "dark")
      ? "dark" : "light");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("iris:theme", theme); } catch { /* private mode */ }
  }, [theme]);
  /* which top-bar dropdown is open; closes on outside-click (a backdrop) or Escape. */
  const [openMenu, setOpenMenu] = useState<null | "export" | "overflow">(null);
  const importRef = useRef<ImportWizardHandle>(null);
  const newDocument = useSetAtom(newDocumentAtom);
  useEffect(() => {
    if (!openMenu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenMenu(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openMenu]);
  const didInit = useRef(false);
  /* The .iris file the document is bound to: a real OS file handle (File System
     Access API) so Save writes back to the same file, tagged with the table id it
     belongs to. Null until saved-as/loaded from disk — then Save falls through to
     Save As. The tableId guard means that after loading A.iris and importing fresh
     data, Save prompts for a new file instead of silently overwriting A.iris. */
  const fileHandleRef = useRef<{ fh: FileSystemFileHandle; tableId: string } | null>(null);
  /* background-render loop: exactly one /analyze in flight at a time (matplotlib
     is treated as not thread-safe, so renders are serialized client-side), and a
     set of `${id}:${key}` configs whose render already failed, so a 422-ing plot
     is attempted once per key rather than re-hammered. */
  const bgInFlight = useRef(false);
  const failedKeys = useRef<Set<string>>(new Set());
  const [bgTick, setBgTick] = useState(0);

  /* derived from active plottable */
  const mappings = active?.mappings ?? { x: "", y: "" };

  useEffect(() => {
    /* run exactly once. React 18 StrictMode double-invokes mount effects in dev;
       without this guard the health check fires twice for no reason. */
    if (didInit.current) return;
    didInit.current = true;
    engine.waitForHealth()
      .then((h) => {
        setSnapshot(h.engine_snapshot); setRegistry(h.registry);
        setStyleRegistry(h.style_registry ?? []); setEngineUp(true);
        /* a populated autosave slot means a previous session ended with
           unsaved work (explicit Save clears it) — surface the restore offer.
           A failed status check is not worth blocking startup over. */
        engine.autosaveStatus()
          .then((s) => { if (s.exists) setRecovery(s); })
          .catch(() => {});
      })
      .catch(() => setEngineUp(false));
  }, []);

  /* ---- autosave / crash recovery (design: docs/superpowers/specs/
     2026-07-02-autosave-crash-recovery-design.md). The engine owns the on-disk
     snapshot slot; this loop refreshes it while the semantic state key differs
     from the baseline captured at load / explicit save — i.e. only while there
     is real unsaved work. */
  const pool = useAtomValue(tablesAtom);
  const autosaveKey = useAtomValue(autosaveKeyAtom);
  const [autosaveBaseline, setAutosaveBaseline] = useAtom(autosaveBaselineAtom);
  const [recovery, setRecovery] = useState<AutosaveStatus | null>(null);
  /* the offer only shows (and only blocks autosave) while the workspace is
     still empty: if the user ignores it and imports/loads instead, the banner
     yields and the new session's autosaves may overwrite the single slot. */
  const recoveryPending = recovery !== null && pool.length === 0;
  const autosaveTimer = useRef<number>();
  const autosaveInFlight = useRef<Promise<unknown> | null>(null);
  const pushAutosave = (keepalive: boolean) => {
    const tables = saveTablesFor(store.get(plottablesAtom), store.get(reduceStoreAtom), store.get(tablesAtom));
    // no referenced tables ⇒ nothing restorable (mirrors doSave's guard)
    if (tables.length === 0) return Promise.resolve();
    const p = engine.autosaveSnapshot(
      tables,
      store.get(allSaveSpecsAtom),
      store.get(dataFingerprintAtom),
      { keepalive },
    ).catch((e) => console.warn("autosave failed:", e));
    autosaveInFlight.current = p;
    return p;
  };
  useEffect(() => {
    if (engineUp !== true || recoveryPending) return;
    if (autosaveKey === autosaveBaseline || pool.length === 0) return;
    autosaveTimer.current = window.setTimeout(() => void pushAutosave(false), 1500);
    return () => window.clearTimeout(autosaveTimer.current);
  }, [autosaveKey, autosaveBaseline, engineUp, recoveryPending, pool.length === 0]);
  /* the debounce loses the last ~1.5 s on an accidental tab close — flush on
     pagehide / tab-hide with a keepalive request (the snapshot endpoint is
     preflight-free, so it can complete during teardown). Registered once; the
     ref keeps the guards reading live state. */
  const autosaveFlushRef = useRef<() => void>(() => {});
  autosaveFlushRef.current = () => {
    if (engineUp !== true || recoveryPending) return;
    if (autosaveKey === autosaveBaseline || pool.length === 0) return;
    window.clearTimeout(autosaveTimer.current);
    void pushAutosave(true);
  };
  useEffect(() => {
    const flush = () => autosaveFlushRef.current();
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  /* an explicit Save supersedes the snapshot: cancel the pending debounce,
     let an in-flight snapshot land (so the clear below can't lose the race),
     rebaseline, then empty the slot. */
  const markSaved = async () => {
    window.clearTimeout(autosaveTimer.current);
    await autosaveInFlight.current;
    setAutosaveBaseline(store.get(autosaveKeyAtom));
    await engine.autosaveClear().catch(() => {});
  };
  const doRestore = async () => {
    try {
      const doc = await engine.autosaveRestore();
      await loadDocument({
        manifest: doc.manifest,
        analyses: doc.analyses.map(migrateSpec),
        provenance: doc.provenance,
        tables: doc.tables,
        keepDirty: true,      // recovered work still has no explicit save
      });
      fileHandleRef.current = null;   // no bound file: next Save prompts
      setViewMode(doc.analyses.length ? "workbench" : "data");
    } catch (e) { surfaceUnlessAbort(e); }
    setRecovery(null);
  };
  const doDiscard = () => {
    setRecovery(null);
    void engine.autosaveClear().catch(() => {});
  };

  /* The X/Y pickers (now in the Encoding card) offer only the columns that
     SURVIVE the reduction; the post-reduction schema lives in effectiveSchemaAtom.
     a stable signature of the surviving columns, so effects that must react to a
     pipeline edit (which changes the schema but not necessarily the spec string)
     have something concrete to depend on */
  const schemaKey = effectiveSchema?.columns.map((c) => `${c.name}:${c.type}`).join(",") ?? "";

  /* If a mapped axis points at a column the pipeline drops, say so precisely and
     skip the analyze (below) rather than (a) shipping a doomed request that 422s
     with "x column not found", or (b) silently repointing the axis at some
     surviving column the user never chose — which can cascade into an unrelated
     error (e.g. a single-level group). The dropdowns already only list surviving
     columns; this covers the stale stored value behind them. */
  const survives = (name: string) =>
    !effectiveSchema || effectiveSchema.columns.some((c) => c.name === name);
  const mappingError =
    !active ? null
    : mappings.x && !survives(mappings.x)
      ? `X column “${mappings.x}” is removed by this analysis’s reduction pipeline. `
        + `Add it to a Collapse “Group by” step, or pick a column the pipeline keeps.`
    : mappings.y && !survives(mappings.y)
      ? `Y column “${mappings.y}” is removed by this analysis’s reduction pipeline. `
        + `Aggregate it in the Collapse step, or pick a column the pipeline keeps.`
    : null;

  /* the reactive loop: figure + stats for the active plottable. The engine owns
     the table behind a session handle; compute references it by id. Depends on
     the handle (id + version, so a data edit re-runs it) and a stable spec string
     (a pipeline or mapping edit re-runs it). `spec` is rebuilt every recompute, so
     depending on it directly would never converge; the string key settles once
     the recommendation does. */
  const specKey = spec ? JSON.stringify(spec) : null;
  /* renderable: a Y mapping, ≥1 layer, no mapped column the pipeline dropped. The
     key its result must be stored under, and whether the cache already holds a
     fresh one — read here so both the synchronous settle and the debounced render
     share one definition. */
  const renderable = !!(schema && spec && handle
    && spec.encodings.y?.column && spec.layers.length > 0 && !mappingError);
  const analyzeKey = renderable ? cacheKey(handle!.id, handle!.version, spec!) : null;
  const cacheFresh = renderable && analysisKeyById[spec!.id] === analyzeKey;
  /* synchronous settle (no debounce): go idle + clear when there's nothing to
     render, or show the cached figure instantly on a freshness hit (touching
     recency so a plot the user returns to survives eviction). A cache MISS falls
     through — the debounced render below owns it. analysisKeyById is intentionally
     NOT a dep: the active plottable's key only changes via its own render here, so
     the fresh read is current, and re-running on every background completion would
     needlessly churn. */
  useEffect(() => {
    if (!schema || !spec || !handle) return;
    if (!renderable) {
      setStatus("idle"); setRenderError(null);
      setAnalysisById({ id: spec.id, res: null });
    } else if (analysisKeyById[spec.id] === cacheKey(handle.id, handle.version, spec)) {
      setStatus("ok"); setRenderError(null); touchAnalysis(spec.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle?.id, handle?.version, specKey, schemaKey, mappingError]);
  /* the reactive render for a cache MISS: figure + stats for the active plottable.
     `start` shows "running" the moment deps settle so the debounce never reads as
     a freeze; the result is id-routed (commit, always) so a late result lands in
     the plottable it was computed for; status is global (only-if-fresh) so a
     superseded run never paints the active plot's status/error. */
  useDebouncedAsync({
    when: renderable && !cacheFresh,
    deps: [handle?.id, handle?.version, specKey, schemaKey, mappingError],
    start: () => setStatus("running"),
    run: () => engine.analyze({ token: handle!.id }, spec!),
    commit: (o) => o.ok
      ? setAnalysisResult({ id: spec!.id, key: analyzeKey!, res: o.value })
      // the config changed and the recompute failed: drop the now-stale figure so
      // the error shows, not a figure that no longer matches the config.
      : setAnalysisById({ id: spec!.id, res: null }),
    status: (o) => o.ok
      ? (setRenderError(null), setStatus("ok"))
      : (setRenderError(o.error), setStatus("error")),
  });

  /* live reduced-table preview for the active plottable, recomputed as the
     pipeline changes. Independent of the analyze loop and valid before any
     mapping is set, so the Reduced-table section updates while you build steps. */
  const hierarchy = useAtomValue(hierarchyAtom);
  const materialized = useAtomValue(materializedTablesAtom);
  /* cheap re-run key for the join cache: a step references a right by id, whose
     rows land in materialized asynchronously (and bump on a version change). Key
     on the id→version map so the preview re-fetches once the right is inlined,
     without stringifying every joined row each render. */
  const materializedKey = useAtomValue(materializedVersionKeyAtom);
  const stepsKey = active
    ? JSON.stringify([activeSteps, hierarchy, materializedKey])
    : null;
  useDebouncedAsync({
    when: !!(handle && active),
    deps: [handle?.id, handle?.version, stepsKey, activeId],
    // inline each filled join's right from the materialized cache (mirrors specAtom);
    // an uncached/unset join is dropped until its rows land, so the preview never
    // ships a rightTableId the engine can't resolve.
    run: () => engine.reduce({ token: handle!.id },
      resolveEngineSteps(activeSteps, materialized), hierarchy),
    // the preview is id-routed (safe even when superseded); the global engine
    // error is written only while still fresh (mirrors the analyze loop).
    commit: (o) => { if (o.ok) setReducePreviewById({ id: active!.id, preview: o.value }); },
    status: (o) => setError(o.ok ? null : o.error),
  });

  /* per-node row×col counts for the transformation explorer, fetched in one shot
     via /shape_counts. Advisory only: on error we clear the counts and NEVER
     surface it, so a failed count never blocks or alarms. Mirrors the preview
     effect's deps + debounce. */
  const setShapeCounts = useSetAtom(shapeCountsAtom);
  const setGuards = useSetAtom(guardsAtom);
  const collapsePlan = useAtomValue(effectivePlanAtom);
  const testGrain = useAtomValue(effectiveTestGrainAtom);
  /* the grouping column the pairing-flip guard reads — the SAME column the test
     pairs on (render's `cat_col`: x, unless x is numeric, then y), falling back to
     color; null when unmapped. Sending `color` alone missed the common SuperPlot
     (groups on x, color unset), leaving guard #2 inert. */
  // colType (not a raw type check) so a bool measurement on X counts as numeric
  // here exactly as render's cat_col selection treats it — otherwise the qualifier
  // resolved to the bool X instead of Y and the pairing-flip guard got the wrong one.
  const xIsNumeric = colType(effectiveSchema ?? null, mappings.x) === "numeric";
  const qualifier = (xIsNumeric ? mappings.y : mappings.x) || active?.color || null;
  const collapseKey = JSON.stringify([collapsePlan, testGrain, qualifier]);
  useDebouncedAsync({
    when: !!(handle && active),
    deps: [handle?.id, handle?.version, stepsKey, activeId, collapseKey],
    // inline filled joins from the materialized cache, as the reduce preview does.
    run: () => engine.shapeCounts({ token: handle!.id },
      resolveEngineSteps(activeSteps, materialized), hierarchy,
      { collapse: collapsePlan, test_grain: testGrain, qualifier }),
    // advisory + GLOBAL (not id-routed), so write via `status` (only-if-fresh): a
    // superseded fetch must never clobber a newer run's counts — the old effect
    // had no stale guard, closing that latent race. A failure clears, never alarms.
    status: (o) => {
      if (!o.ok) { setShapeCounts(null); setGuards(null); return; }
      const sc = o.value;
      const counts: Record<string, NodeShape> = { source: sc.source };
      sc.steps.forEach((c, i) => { counts[`step:${i}`] = c; });
      /* grain-keyed counts map onto the graph's `grain:<key>` nodes. The raw grain
         ("") is the source/last-step node, already counted above. */
      for (const [key, c] of Object.entries(sc.grains ?? {})) {
        if (key !== "") counts[`grain:${key}`] = c;
      }
      /* per-join right-table descriptors map onto the binary-join `source:<i>` nodes. */
      for (const [i, c] of Object.entries(sc.joins ?? {})) {
        counts[`source:${i}`] = c;
      }
      setShapeCounts(counts);
      setGuards(sc.guards ?? null);
    },
  });

  /* keep the materialized cache populated: whenever a join references a pool table,
     fetch that table's FULL rows from its session and write them at the table's
     current handle version. The selector goes quiet once each referenced table is
     cached at its current version, so this fetches once per (table, version). */
  const needMaterialize = useAtomValue(tablesNeedingMaterializeAtom);
  const setMaterialized = useSetAtom(materializedTablesAtom);
  useEffect(() => {
    if (needMaterialize.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const t of needMaterialize) {
        const res = await engine.rowsWindow(t.handle.id, 0, t.handle.n);   // FULL rows, no preview cap
        if (cancelled) return;
        setMaterialized((prev) => ({ ...prev,
          [t.id]: { version: t.handle.version, table: { schema: t.schema, rows: res.rows } } }));
      }
    })();
    return () => { cancelled = true; };
  }, [needMaterialize, setMaterialized]);

  /* clear the explorer's selected node when the active analysis changes, so a
     node id from a different analysis never drives the wrong data tab. */
  const setSelectedNode = useSetAtom(selectedNodeIdAtom);
  const clearWorkbench = useSetAtom(clearWorkbenchAtom);
  const seedDefaultStash = useSetAtom(seedDefaultStashAtom);
  const clearSpecHistory = useSetAtom(clearSpecHistoryAtom);
  useEffect(() => {
    // clear, then re-seed the stash with the analysis's default table/plot/stats
    // trio (the structured landing view, now expressed as the stash's default
    // fill). Order matters: clearWorkbench empties the stash, seed refills it.
    setSelectedNode(null); clearWorkbench(); seedDefaultStash(); clearSpecHistory();
  }, [activeId, setSelectedNode, clearWorkbench, seedDefaultStash, clearSpecHistory]);

  /* background loop: a self-draining sequential queue that warms every OTHER
     plottable's cache so even a never-opened analysis is instant on first visit.
     It yields while the active loop is rendering and never runs two /analyze at
     once (one figure in flight, always), and it never touches analyzeStatus /
     renderError — those stay active-plot-only, so the indicator keeps meaning
     "the plot you are looking at." A stable JSON key mirrors the active loop's
     specKey so a spec edit re-triggers the drain. */
  const allSpecsKey = JSON.stringify(allSpecs);
  useEffect(() => {
    if (!handle || allSpecs.length === 0) return;
    if (analyzeStatus === "running" || bgInFlight.current) return;  // one at a time
    const schemaFor = (id: string) => reducePreviews[id]?.preview.schema ?? schema ?? null;
    // Only warm analyses rooted in the ACTIVE table — they share `handle` (its
    // session). A plottable bound to a different pool table must NOT be analyzed
    // against this session (wrong rows / spurious 422s); it warms when the user
    // switches to its table. (Plan A's single-root limitation; Plan B generalizes.)
    const activeTableId = active?.tableId;
    const sameTable = allSpecs.filter((s) =>
      plottables.find((p) => p.id === s.id)?.tableId === activeTableId);
    if (sameTable.length === 0) return;
    const target = pickStaleSpec(sameTable, {
      activeId, handleId: handle.id, version: handle.version,
      keyById: analysisKeyById, failedKeys: failedKeys.current, schemaFor,
    });
    if (!target) return;
    bgInFlight.current = true;
    const { id } = handle;
    void (async () => {
      try {
        const res = await engine.analyze({ token: id }, target.spec);
        // store under the key it was computed from; a stale-version result simply
        // reads as not-fresh and is re-rendered, never shown as up to date.
        setAnalysisResult({ id: target.spec.id, key: target.key, res });
      } catch {
        // not the plot the user is looking at: swallow, record, move on. If they
        // later switch to it, the active loop attempts it and surfaces the error.
        failedKeys.current.add(`${target.spec.id}:${target.key}`);
      } finally {
        bgInFlight.current = false;
        // a success bumps analysisKeyById (re-triggering this effect for the next
        // stale plottable); a failure changes no state, so nudge the drain along.
        setBgTick((t) => t + 1);
      }
    })();
    // dep on the string fingerprint of (id → key), not the derived key map: the
    // map's identity now moves on a recency-only touch, but the fingerprint only
    // moves when a freshness key actually changes (a render landed) — the one
    // thing that should re-trigger the drain.
  }, [handle?.id, handle?.version, allSpecsKey, cacheKeysFingerprint, analyzeStatus,
      activeId, active?.tableId, bgTick]);

  const doExport = async (format: "svg" | "pdf" | "png") => {
    if (!schema || !spec || !handle) return;
    const f = await engine.export({ token: handle.id }, spec, format);
    downloadBase64(f.filename, f.data_base64);
  };
  /* Whole-document methods paragraph (.md) or statistics table (.csv). Sends the
     LIVE specs (joins inlined) so the engine can run each analysis, and the pool
     tables so it can resolve each one's main table. */
  const doExportMethods = async (format: "md" | "csv") => {
    if (!schema) return;
    try {
      const f = await engine.exportMethods(
        saveTablesFor(store.get(plottablesAtom), store.get(reduceStoreAtom), store.get(tablesAtom)),
        store.get(allSpecsAtom), format);
      downloadBase64(f.filename, f.data_base64);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const IRIS_FILE_TYPES = [{
    description: "Iris document",
    accept: { "application/octet-stream": [".iris"] },
  }];
  const exampleFilenames = new Set(
    (exampleManifest as { filename: string }[]).map((e) => e.filename));
  /* Cancelling a file picker rejects with AbortError — that's a no-op, not a
     failure to surface. Anything else is a real save/load error for the bar. */
  const surfaceUnlessAbort = (e: unknown) => {
    if (e instanceof DOMException && e.name === "AbortError") return;
    setError(e instanceof Error ? e.message : String(e));
  };
  /* Ask the engine for the document bytes, then write them through the OS file
     handle. Plan B saves the whole table POOL by reference: every analysis's main
     table and every filled join's right serialize as references, and the engine
     reads each table's full rows from its live session — no client-side
     materialization, no single-main-table restriction. Save can still fail if a
     session was evicted (409), which surfaces instead of being swallowed. */
  const saveDoc = () =>
    engine.saveDocument(
      saveTablesFor(store.get(plottablesAtom), store.get(reduceStoreAtom), store.get(tablesAtom)),
      store.get(allSaveSpecsAtom), {});
  const writeIris = async (fh: FileSystemFileHandle) => {
    const f = await saveDoc();
    const w = await fh.createWritable();
    await w.write(new Blob([base64ToBytes(f.data_base64)]));
    await w.close();
  };
  // No FS Access API (Firefox/Safari): we can't write back to a bound file, so
  // every save is just a download. Both Save and Save As funnel through here.
  const downloadIris = async () => {
    const f = await saveDoc();
    downloadBase64("document.iris", f.data_base64);
    await markSaved();
  };
  // Guard the shipped examples: overwriting one makes the Examples gallery
  // documentation no longer match the file it links to. True when the target is
  // an example and the user declines to clobber it. Applies to every save path.
  const clobbersExample = (fh: FileSystemFileHandle) =>
    exampleFilenames.has(fh.name) &&
    !window.confirm(`"${fh.name}" is an example file that ships with Iris. `
      + `Overwriting it means the Examples documentation will no longer `
      + `match this file. Save anyway?`);
  // The document is identified by its first pool table's session id (mirrors load,
  // which tags the bound file with doc.tables[0].id). Save needs analyses to write
  // and a non-empty pool to reference — not the old single global handle.
  const docTableId = () => store.get(tablesAtom)[0]?.handle.id ?? null;
  const doSave = async () => {
    const docId = docTableId();
    if (allSpecs.length === 0 || !docId) return;
    try {
      if (!hasFsAccess()) return void await downloadIris();
      const bound = fileHandleRef.current;
      // Reuse the handle only if it belongs to the document we're looking at;
      // otherwise the first Save is really a Save As (pick a file).
      let fh = bound && bound.tableId === docId ? bound.fh : null;
      if (!fh)
        fh = await window.showSaveFilePicker({ suggestedName: "document.iris", types: IRIS_FILE_TYPES });
      if (clobbersExample(fh)) return;
      await writeIris(fh);
      fileHandleRef.current = { fh, tableId: docId };
      await markSaved();
    } catch (e) { surfaceUnlessAbort(e); }
  };
  const doSaveAs = async () => {
    const docId = docTableId();
    if (allSpecs.length === 0 || !docId) return;
    try {
      if (!hasFsAccess()) return void await downloadIris();
      const fh = await window.showSaveFilePicker({ suggestedName: "document.iris", types: IRIS_FILE_TYPES });
      if (clobbersExample(fh)) return;
      await writeIris(fh);
      fileHandleRef.current = { fh, tableId: docId };   // later Save writes back here
      await markSaved();
    } catch (e) { surfaceUnlessAbort(e); }
  };
  /* Start a fresh, empty document. Discards the current one, so guard real
     unsaved work first (same dirty test the autosave loop uses: the semantic
     key has diverged from the baseline AND the pool actually holds something).
     Resets the workspace atoms, drops the bound file handle so the next Save
     prompts for a location, empties the on-disk autosave slot, and lands in the
     Data view ready for an import. */
  const doNew = async () => {
    const dirty = store.get(autosaveKeyAtom) !== autosaveBaseline && pool.length > 0;
    if (dirty && !window.confirm(
      "Start a new document? Unsaved changes to the current one will be lost.")) return;
    newDocument();
    clearWorkbench(); clearSpecHistory();
    fileHandleRef.current = null;
    setViewMode("data");
    await engine.autosaveClear().catch(() => {});
  };
  const doLoad = async () => {
    try {
      // Prefer the FS Access API (lets a later Save write back to the same file);
      // otherwise fall back to a plain <input>, which yields no reusable handle.
      let file: File;
      let fh: FileSystemFileHandle | null = null;
      if (hasFsAccess()) {
        [fh] = await window.showOpenFilePicker({ types: IRIS_FILE_TYPES, multiple: false });
        file = await fh.getFile();
      } else {
        const picked = await pickFileFallback(".iris");
        if (!picked) return;   // user dismissed the dialog
        file = picked;
      }
      const doc = await engine.loadDocument(fileToBase64(await file.arrayBuffer()));
      await loadDocument({
        manifest: doc.manifest,
        analyses: doc.analyses.map(migrateSpec),   // tolerate older .iris specs
        provenance: doc.provenance,
        tables: doc.tables,
      });
      setViewMode(doc.analyses.length ? "workbench" : "data");
      // a malformed file with no tables can't bind a save handle.
      if (fh && doc.tables.length) fileHandleRef.current = { fh, tableId: doc.tables[0].id };   // a later Save writes back here
    } catch (e) { surfaceUnlessAbort(e); }
  };

  /* Open a bundled example into the current session. Unlike doLoad there is no
     OS file handle, and we explicitly clear any retained one, so the next Save
     prompts for a location (Save As) — the shipped example is never overwritten
     in place. */
  const handleOpenExample = async (caseId: string) => {
    try {
      const url = EXAMPLE_IRIS[`./examples/assets/${caseId}.iris`];
      if (!url) throw new Error(`example "${caseId}" is not bundled`);
      const buf = await (await fetch(url)).arrayBuffer();
      const doc = await engine.loadDocument(fileToBase64(buf));
      await loadDocument({
        manifest: doc.manifest,
        analyses: doc.analyses.map(migrateSpec),
        provenance: doc.provenance,
        tables: doc.tables,
      });
      fileHandleRef.current = null;                 // force Save -> Save As
      setViewMode(doc.analyses.length ? "workbench" : "data");
    } catch (e) { surfaceUnlessAbort(e); }
  };

  /* Launch the interactive tutorial: seed the two-species Fisher-iris table with
     NO analyses (a genuinely raw start the user builds a plot from), then hand off
     to the overlay. Reuses the same load path as an example open. */
  const handleStartTutorial = async () => {
    try {
      const url = EXAMPLE_IRIS["./examples/assets/tutorial-quickstart.iris"];
      if (!url) throw new Error("tutorial seed is not bundled");
      const buf = await (await fetch(url)).arrayBuffer();
      const doc = await engine.loadDocument(fileToBase64(buf));
      await loadDocument({
        manifest: doc.manifest,
        analyses: [],                               // raw table — the user builds the analysis
        provenance: doc.provenance,
        tables: doc.tables,
      });
      fileHandleRef.current = null;                 // never overwrite the seed in place
      startTutorial();
    } catch (e) { surfaceUnlessAbort(e); }
  };

  if (engineUp === false) return (
    <div className="engine-down">
      <h1>Engine not reachable</h1>
      <p>Start it with <code>python -m iris_engine.main</code> in <code>engine/</code>, then reload.</p>
    </div>
  );
  if (engineUp === null) return (
    <div className="engine-down">
      <h1>Starting engine…</h1>
    </div>
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="tb-left">
          <div className="tb-brand">
            <span className="tb-mark"><img src={irisMark} alt="" width="27" height="27" /></span>
            <span className="tb-word">Iris</span>
          </div>
          <div className="tb-div" />
          {/* File-manipulation cluster, next to the logo: document lifecycle
              (New / Load / Save), then a divider, then data in / figure out. */}
          <div className="tb-fileactions">
            <button className="tb-ghost" onClick={doNew}>New</button>
            <button className="tb-ghost" onClick={doLoad}>Load</button>
            <button className="tb-primary" onClick={doSave}>Save</button>
            <div className="tb-div sm" />
            <button className="tb-btn" onClick={() => importRef.current?.open()}>+ Add data</button>
            <div className="tb-menuwrap">
              <button className="tb-btn" onClick={() => setOpenMenu((m) => m === "export" ? null : "export")}>
                Export <span className="caret">▾</span></button>
              {openMenu === "export" && (
                <div className="tb-menu">
                  <button onClick={() => { setOpenMenu(null); void doExport("svg"); }}>SVG</button>
                  <button onClick={() => { setOpenMenu(null); void doExport("pdf"); }}>PDF</button>
                  <button onClick={() => { setOpenMenu(null); void doExport("png"); }}>PNG</button>
                  <div className="tb-menu-sep" />
                  <button onClick={() => { setOpenMenu(null); void doExportMethods("md"); }}
                    title="Methods paragraph + stats table (Markdown)">Methods (.md)</button>
                  <button onClick={() => { setOpenMenu(null); void doExportMethods("csv"); }}
                    title="Statistics table (CSV)">Statistics (.csv)</button>
                </div>
              )}
            </div>
          </div>
        </div>
        <nav className="tb-modes">
          <div className="tb-seg">
            <button data-tour="mode-data" className={viewMode === "data" ? "active" : ""}
              onClick={() => setViewMode("data")}><DataGlyph />Data</button>
            <button data-tour="mode-workbench" className={viewMode === "workbench" ? "active" : ""}
              onClick={() => setViewMode("workbench")}><WorkbenchGlyph />Workbench</button>
            <button className={viewMode === "guide" ? "active" : ""}
              onClick={() => setViewMode("guide")}><GuideGlyph />Guide</button>
          </div>
        </nav>
        <div className="tb-right">
          <RenderIndicator dataLoading={dataLoading} />
          <div className="tb-div sm" />
          <div className="tb-menuwrap">
            <button className="tb-icon" aria-label="More actions"
              onClick={() => setOpenMenu((m) => m === "overflow" ? null : "overflow")}>⋯</button>
            {openMenu === "overflow" && (
              <div className="tb-menu tb-menu-right">
                <div className="tb-menu-label">Appearance</div>
                <button className={`tb-menu-item ${theme === "light" ? "active" : ""}`}
                  onClick={() => { setTheme("light"); setOpenMenu(null); }}>
                  <SunGlyph /><span className="grow">Light</span>
                  {theme === "light" && <span className="check">✓</span>}</button>
                <button className={`tb-menu-item ${theme === "dark" ? "active" : ""}`}
                  onClick={() => { setTheme("dark"); setOpenMenu(null); }}>
                  <MoonGlyph /><span className="grow">Dark</span>
                  {theme === "dark" && <span className="check">✓</span>}</button>
                <div className="tb-menu-sep" />
                <button className="tb-menu-item" onClick={() => { setOpenMenu(null); void doSaveAs(); }}>
                  <span style={{ width: 15 }} /><span className="grow">Save As…</span></button>
                <button className="tb-menu-item" onClick={() => { setOpenMenu(null); setShowSpec((s) => !s); }}>
                  <span style={{ width: 15 }} /><span className="grow">{showSpec ? "Hide" : "Show"} analysis spec</span></button>
              </div>
            )}
          </div>
        </div>
      </header>
      {openMenu && <div className="tb-backdrop" onClick={() => setOpenMenu(null)} />}
      {/* the import modal is opened directly from the "+ Add data" button. */}
      <ImportWizard ref={importRef} hideTrigger />
      {recoveryPending && recovery && (
        <div className="recovery-bar">
          <span>
            Unsaved work from a previous session
            {recovery.written ? ` (${new Date(recovery.written).toLocaleString()})` : ""}
            {" — "}{recovery.n_analyses} {recovery.n_analyses === 1 ? "analysis" : "analyses"}
            {recovery.tables.length ? ` on ${recovery.tables.join(", ")}` : ""}. Restore it?
          </span>
          <button className="primary" onClick={doRestore}>Restore</button>
          <button onClick={doDiscard}>Discard</button>
        </div>
      )}
      {error ? <div className="error-bar">{error}</div>
        : mappingError ? <div className="error-bar warn-bar">{mappingError}</div>
        : renderError ? <div className="error-bar">{renderError}</div>
        : warnIssue ? <div className="error-bar warn-bar">{warnIssue.message}</div>
        : null}
      <main>
        {viewMode === "guide" ? (
          <div className="examples-mode"><Guide onOpen={handleOpenExample} onStartTutorial={handleStartTutorial} /></div>
        ) : viewMode === "data" ? (
          <div className="data-mode" data-tour="data-types"><TableList /><HierarchyPanel /><DataView /></div>
        ) : dataLoading ? (
          <div className="analyses-loading">
            <span className="spinner" />
            <span>Loading data…</span>
          </div>
        ) : !active ? (
          <div className="analyses-empty">
            <span>No data yet — import a file or enter data to start an analysis.</span>
          </div>
        ) : (
          <div className="workbench-mode">
            <PlottableSidebar />
            {explorerGraph
              ? <WorkbenchCanvas graph={explorerGraph} />
              : <div className="analyses-empty"><span>Build a step or add a layer to see the graph.</span></div>}
          </div>
        )}
      </main>
      {showSpec && (
        <footer>
          <pre>{JSON.stringify(spec, null, 2)}</pre>
        </footer>
      )}
      <TutorialOverlay />
    </div>
  );
}
