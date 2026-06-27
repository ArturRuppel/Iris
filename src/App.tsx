import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useEffect, useRef, useState } from "react";
import irisMark from "./assets/iris-mark.svg";
import { DataEntry } from "./components/DataEntry";
import { DataTable } from "./components/DataTable";
import { HierarchyPanel } from "./components/HierarchyPanel";
import { ImportWizard } from "./components/ImportWizard";
import { PlottableSidebar } from "./components/PlottableSidebar";
import { Guide } from "./examples/Guide";
import { WorkbenchCanvas } from "./workbench/WorkbenchCanvas";
import { clearWorkbenchAtom } from "./workbench/state";
import exampleManifest from "./examples/assets/manifest.json";
import {
  activePlottableAtom, activePlottableIdAtom, allSpecsAtom, analysisAtom,
  analysisKeyByIdAtom, analyzeStatusAtom, cacheKey, dataLoadingAtom,
  effectiveSchemaAtom, engineErrorAtom, engineSnapshotAtom,
  hierarchyAtom, loadDocumentAtom, loadTableAtom, pickStaleSpec, registryAtom, styleRegistryAtom,
  reducePreviewByIdAtom, renderErrorAtom, schemaAtom, selectedNodeIdAtom, setAnalysisByIdAtom,
  setAnalysisResultAtom, setReducePreviewByIdAtom, specAtom, tableHandleAtom,
  touchAnalysisAtom, viewModeAtom, effectivePlanAtom, effectiveTestGrainAtom,
  tablesNeedingMaterializeAtom, materializedTablesAtom, allSaveSpecsAtom, plottablesAtom,
} from "./state";
import { base64ToBytes, downloadBase64, engine, fileToBase64, hasFsAccess, migrateSpec, pickFileFallback } from "./types";
import type { NodeShape, AnalysisSpec } from "./types";
import { shapeCountsAtom, guardsAtom, explorerGraphAtom } from "./explorer/graphAtom";

const EXAMPLE_IRIS = import.meta.glob("./examples/assets/*.iris", {
  query: "?url", import: "default", eager: true,
}) as Record<string, string>;

/* Tells the user, at a glance, whether the figure is current, being computed,
   or failed — so a long render never reads as a freeze or a crash. */
function RenderIndicator({ dataLoading }: { dataLoading: boolean }) {
  const status = useAtomValue(analyzeStatusAtom);
  if (dataLoading)
    return <span className="render-status loading"><span className="dot" />Loading data…</span>;
  if (status === "running")
    return <span className="render-status running"><span className="dot" />Rendering…</span>;
  if (status === "error")
    return <span className="render-status error">⚠ Render failed</span>;
  if (status === "ok")
    return <span className="render-status ok">✓ Up to date</span>;
  return null;
}

export default function App() {
  const [schema] = useAtom(schemaAtom);
  const [active] = useAtom(activePlottableAtom);
  const activeId = useAtomValue(activePlottableIdAtom);
  const [viewMode, setViewMode] = useAtom(viewModeAtom);
  const loadTable = useSetAtom(loadTableAtom);
  const loadDocument = useSetAtom(loadDocumentAtom);
  const store = useStore();
  const spec = useAtomValue(specAtom);
  const allSpecs = useAtomValue(allSpecsAtom);
  const setAnalysisById = useSetAtom(setAnalysisByIdAtom);
  const setAnalysisResult = useSetAtom(setAnalysisResultAtom);
  const touchAnalysis = useSetAtom(touchAnalysisAtom);
  const analysisKeyById = useAtomValue(analysisKeyByIdAtom);
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
  const timer = useRef<number>();
  const previewTimer = useRef<number>();
  const shapeTimer = useRef<number>();
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
      .then((h) => { setSnapshot(h.engine_snapshot); setRegistry(h.registry); setStyleRegistry(h.style_registry ?? []); setEngineUp(true); })
      .catch(() => setEngineUp(false));
  }, []);

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
  useEffect(() => {
    if (!schema || !spec || !handle) return;
    /* nothing to render yet (no Y mapped, no layer added), or a mapped column
       the pipeline drops — show no render error (the mapping/empty state
       speaks for itself), clear any stale figure from a removed layer, and go
       idle. An empty X is fine: it's simply the descriptive (histogram) case. */
    if (!spec.encodings.y?.column || spec.layers.length === 0 || mappingError) {
      setStatus("idle"); setRenderError(null);
      setAnalysisById({ id: spec.id, res: null });
      return;
    }
    /* freshness short-circuit: the cached figure was computed from this exact
       data + spec, so show it instantly with no re-render. (Guards above run
       first, so a non-renderable plottable never reaches here.) Touch recency so
       a plot the user keeps returning to survives eviction once they leave it. */
    const key = cacheKey(handle.id, handle.version, spec);
    if (analysisKeyById[spec.id] === key) {
      setStatus("ok"); setRenderError(null); touchAnalysis(spec.id);
      return;
    }
    window.clearTimeout(timer.current);
    /* a change is pending the moment deps settle — show it immediately so the
       debounce + request window never reads as "hung" or "crashed" */
    setStatus("running");
    /* capture the target plottable at dispatch so a late-resolving result lands
       in the plottable it was computed for, not whichever is active on return */
    const targetId = spec.id;
    timer.current = window.setTimeout(async () => {
      try {
        const res = await engine.analyze({ token: handle.id }, spec);
        setAnalysisResult({ id: targetId, key, res }); setRenderError(null);
        setStatus("ok");
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        /* a config change invalidated the plot and the recompute failed: drop
           the now-stale figure/stats for this plottable so the error shows
           instead of a figure that no longer matches the config (item 11). */
        setAnalysisById({ id: targetId, res: null });
        setRenderError(m);
        setStatus("error");
      }
    }, 200);
    return () => window.clearTimeout(timer.current);
    // analysisKeyById is intentionally NOT a dep: the active plottable's cached
    // key only ever changes via its own render here (the background loop skips it
    // and eviction never drops it), so the short-circuit's read is always current
    // under the existing deps — and re-running on every background completion
    // would needlessly reset this loop's debounce.
  }, [handle?.id, handle?.version, specKey, schemaKey, mappingError]);

  /* live reduced-table preview for the active plottable, recomputed as the
     pipeline changes. Independent of the analyze loop and valid before any
     mapping is set, so the Reduced-table section updates while you build steps. */
  const hierarchy = useAtomValue(hierarchyAtom);
  const stepsKey = active
    ? JSON.stringify([active.reduce.steps, hierarchy, active.previewLevel])
    : null;
  useEffect(() => {
    if (!handle || !active) return;
    window.clearTimeout(previewTimer.current);
    const targetId = active.id;
    const steps = active.reduce.steps;
    const level = active.previewLevel;
    previewTimer.current = window.setTimeout(async () => {
      try {
        const preview = await engine.reduce({ token: handle.id }, steps, hierarchy, level);
        setReducePreviewById({ id: targetId, preview }); setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 200);
    return () => window.clearTimeout(previewTimer.current);
  }, [handle?.id, handle?.version, stepsKey, activeId]);

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
  const xIsNumeric = effectiveSchema?.columns
    .find((c) => c.name === mappings.x)?.type === "numeric";
  const qualifier = (xIsNumeric ? mappings.y : mappings.x) || active?.color || null;
  const collapseKey = JSON.stringify([collapsePlan, testGrain, qualifier]);
  useEffect(() => {
    if (!handle || !active) return;
    window.clearTimeout(shapeTimer.current);
    const steps = active.reduce.steps;
    shapeTimer.current = window.setTimeout(async () => {
      try {
        const sc = await engine.shapeCounts({ token: handle.id }, steps, hierarchy,
          { collapse: collapsePlan, test_grain: testGrain, qualifier });
        const counts: Record<string, NodeShape> = { source: sc.source };
        sc.steps.forEach((c, i) => { counts[`step:${i}`] = c; });
        /* grain-keyed counts map onto the graph's `grain:<key>` nodes. The raw
           grain ("") is the source/last-step node, already counted above. */
        for (const [key, c] of Object.entries(sc.grains ?? {})) {
          if (key !== "") counts[`grain:${key}`] = c;
        }
        /* per-join right-table descriptors map onto the binary-join `source:<i>`
           nodes the graph draws. */
        for (const [i, c] of Object.entries(sc.joins ?? {})) {
          counts[`source:${i}`] = c;
        }
        setShapeCounts(counts);
        setGuards(sc.guards ?? null);
      } catch {
        setShapeCounts(null);
        setGuards(null);
      }
    }, 200);
    return () => window.clearTimeout(shapeTimer.current);
  }, [handle?.id, handle?.version, stepsKey, activeId, collapseKey]);

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
  useEffect(() => { setSelectedNode(null); clearWorkbench(); }, [activeId, setSelectedNode, clearWorkbench]);

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
    const target = pickStaleSpec(allSpecs, {
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
  }, [handle?.id, handle?.version, allSpecsKey, analysisKeyById, analyzeStatus,
      activeId, bgTick]);

  const doExport = async (format: "svg" | "pdf" | "png") => {
    if (!schema || !spec || !handle) return;
    const f = await engine.export({ token: handle.id }, spec, format);
    downloadBase64(f.filename, f.data_base64);
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
     handle. The frontend never holds the full table, so save can fail if the
     session was evicted (409) — that now surfaces instead of being swallowed. */
  // Before saving, fetch any join-referenced table that is missing/stale in the
  // cache (the live effect usually has them already), so every filled join inlines
  // its FULL rows — never the 500-row preview, never a silently dropped join.
  const collectSaveSpecs = async (): Promise<AnalysisSpec[]> => {
    for (let guard = 0; guard < 50; guard++) {
      const need = store.get(tablesNeedingMaterializeAtom);
      if (need.length === 0) break;
      for (const t of need) {
        const res = await engine.rowsWindow(t.handle.id, 0, t.handle.n);
        store.set(materializedTablesAtom, (prev) => ({ ...prev,
          [t.id]: { version: t.handle.version, table: { schema: t.schema, rows: res.rows } } }));
      }
    }
    // Plan A ships one main-table session: warn if analyses span multiple roots.
    const roots = new Set(store.get(plottablesAtom).map((p) => p.tableId));
    if (roots.size > 1)
      window.alert("This workspace has analyses rooted in different tables. "
        + "Plan A saves them all against the active table; multi-root save needs Plan B.");
    return store.get(allSaveSpecsAtom);
  };
  const writeIris = async (fh: FileSystemFileHandle) => {
    const specs = await collectSaveSpecs();
    const f = await engine.saveDocument(handle!.id, specs, {});
    const w = await fh.createWritable();
    await w.write(new Blob([base64ToBytes(f.data_base64)]));
    await w.close();
  };
  // No FS Access API (Firefox/Safari): we can't write back to a bound file, so
  // every save is just a download. Both Save and Save As funnel through here.
  const downloadIris = async () => {
    const specs = await collectSaveSpecs();
    const f = await engine.saveDocument(handle!.id, specs, {});
    downloadBase64("document.iris", f.data_base64);
  };
  // Guard the shipped examples: overwriting one makes the Examples gallery
  // documentation no longer match the file it links to. True when the target is
  // an example and the user declines to clobber it. Applies to every save path.
  const clobbersExample = (fh: FileSystemFileHandle) =>
    exampleFilenames.has(fh.name) &&
    !window.confirm(`"${fh.name}" is an example file that ships with Iris. `
      + `Overwriting it means the Examples documentation will no longer `
      + `match this file. Save anyway?`);
  const doSave = async () => {
    if (!schema || allSpecs.length === 0 || !handle) return;
    try {
      if (!hasFsAccess()) return void await downloadIris();
      const bound = fileHandleRef.current;
      // Reuse the handle only if it belongs to the table we're looking at;
      // otherwise the first Save is really a Save As (pick a file).
      let fh = bound && bound.tableId === handle.id ? bound.fh : null;
      if (!fh)
        fh = await window.showSaveFilePicker({ suggestedName: "document.iris", types: IRIS_FILE_TYPES });
      if (clobbersExample(fh)) return;
      await writeIris(fh);
      fileHandleRef.current = { fh, tableId: handle.id };
    } catch (e) { surfaceUnlessAbort(e); }
  };
  const doSaveAs = async () => {
    if (!schema || allSpecs.length === 0 || !handle) return;
    try {
      if (!hasFsAccess()) return void await downloadIris();
      const fh = await window.showSaveFilePicker({ suggestedName: "document.iris", types: IRIS_FILE_TYPES });
      if (clobbersExample(fh)) return;
      await writeIris(fh);
      fileHandleRef.current = { fh, tableId: handle.id };   // later Save writes back here
    } catch (e) { surfaceUnlessAbort(e); }
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
        schema: doc.schema, rows: doc.rows,
        analyses: doc.analyses.map(migrateSpec),   // tolerate older .viz specs
        id: doc.id, n: doc.n, version: doc.version, counts: doc.counts,
      });
      setViewMode(doc.analyses.length ? "workbench" : "data");
      if (fh) fileHandleRef.current = { fh, tableId: doc.id };   // a later Save writes back here
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
        schema: doc.schema, rows: doc.rows,
        analyses: doc.analyses.map(migrateSpec),
        id: doc.id, n: doc.n, version: doc.version, counts: doc.counts,
      });
      fileHandleRef.current = null;                 // force Save -> Save As
      setViewMode(doc.analyses.length ? "workbench" : "data");
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
      <header>
        <h1 className="brand">
          <img className="brand-mark" src={irisMark} alt="" width="26" height="26" />
          Iris <span className="tag">tier 2</span>
        </h1>
        <div className="mode-toggle">
          <button className={viewMode === "data" ? "active" : ""} onClick={() => setViewMode("data")}>Data</button>
          <button className={viewMode === "workbench" ? "active" : ""} onClick={() => setViewMode("workbench")}>Workbench</button>
          <button className={viewMode === "guide" ? "active" : ""} onClick={() => setViewMode("guide")}>Guide</button>
        </div>
        <div className="controls">
          <ImportWizard />
          <DataEntry />
          <RenderIndicator dataLoading={dataLoading} />
          <span className="spacer" />
          <button onClick={() => doExport("svg")}>SVG</button>
          <button onClick={() => doExport("pdf")}>PDF</button>
          <button onClick={() => doExport("png")}>PNG</button>
          <button onClick={doLoad}>Load .iris</button>
          <button className="primary" onClick={doSave}>Save .iris</button>
          <button onClick={doSaveAs}>Save As…</button>
        </div>
      </header>
      {error ? <div className="error-bar">{error}</div>
        : mappingError ? <div className="error-bar warn-bar">{mappingError}</div>
        : renderError ? <div className="error-bar">{renderError}</div>
        : warnIssue ? <div className="error-bar warn-bar">{warnIssue.message}</div>
        : null}
      <main>
        {viewMode === "guide" ? (
          <div className="examples-mode"><Guide onOpen={handleOpenExample} /></div>
        ) : viewMode === "data" ? (
          <div className="data-mode"><HierarchyPanel /><DataTable /></div>
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
      <footer>
        <button className="link" onClick={() => setShowSpec((s) => !s)}>
          {showSpec ? "Hide" : "Show"} analysis spec
        </button>
        {showSpec && <pre>{JSON.stringify(spec, null, 2)}</pre>}
      </footer>
    </div>
  );
}
