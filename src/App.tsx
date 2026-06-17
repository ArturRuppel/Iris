import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { DataEntry } from "./components/DataEntry";
import { DataTable } from "./components/DataTable";
import { HierarchyPanel } from "./components/HierarchyPanel";
import { FigurePane } from "./components/FigurePane";
import { ImportWizard } from "./components/ImportWizard";
import { LayerRail } from "./components/LayerRail";
import { PlottableSidebar } from "./components/PlottableSidebar";
import { ReducedTable } from "./components/ReducedTable";
import { StatsPanel } from "./components/StatsPanel";
import {
  activePlottableAtom, activePlottableIdAtom, allSpecsAtom, analysisAtom,
  analysisKeyByIdAtom, analyzeStatusAtom, cacheKey, dataLoadingAtom,
  effectiveSchemaAtom, engineErrorAtom, engineSnapshotAtom, exclusionLogAtom,
  hierarchyAtom, loadDocumentAtom, loadTableAtom, pickStaleSpec, registryAtom,
  reducePreviewByIdAtom, renderErrorAtom, schemaAtom, setAnalysisByIdAtom,
  setAnalysisResultAtom, setReducePreviewByIdAtom, specAtom, tableHandleAtom,
  touchAnalysisAtom, viewModeAtom,
} from "./state";
import { downloadBase64, engine, fileToBase64, migrateSpec } from "./types";

function Section({ title, defaultOpen, children }:
  { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <section className="iris-section">
      <button className="section-header" onClick={() => setOpen((o) => !o)}>
        <span className="chevron">{open ? "▾" : "▸"}</span> {title}
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

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
  const exclusionLog = useAtomValue(exclusionLogAtom);
  const effectiveSchema = useAtomValue(effectiveSchemaAtom);
  const setRegistry = useSetAtom(registryAtom);
  const setStatus = useSetAtom(analyzeStatusAtom);
  const analyzeStatus = useAtomValue(analyzeStatusAtom);
  const setRenderError = useSetAtom(renderErrorAtom);
  const renderError = useAtomValue(renderErrorAtom);
  const dataLoading = useAtomValue(dataLoadingAtom);
  const warnIssue = (useAtomValue(analysisAtom)?.issues ?? [])
    .find((i) => i.level === "warning");
  const error = useAtomValue(engineErrorAtom);
  const [engineUp, setEngineUp] = useState<boolean | null>(null);
  const [showSpec, setShowSpec] = useState(false);
  const timer = useRef<number>();
  const previewTimer = useRef<number>();
  const didInit = useRef(false);
  const loadFileRef = useRef<HTMLInputElement>(null);
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
      .then((h) => { setSnapshot(h.engine_snapshot); setRegistry(h.registry); setEngineUp(true); })
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
  const doSave = async () => {
    if (!schema || allSpecs.length === 0 || !handle) return;
    const f = await engine.saveDocument(handle.id, allSpecs,
      { exclusions: exclusionLog });
    downloadBase64(f.filename, f.data_base64);
  };
  const doLoad = async (file: File) => {
    try {
      const doc = await engine.loadDocument(fileToBase64(await file.arrayBuffer()));
      loadDocument({
        schema: doc.schema, rows: doc.rows,
        analyses: doc.analyses.map(migrateSpec),   // tolerate older .viz specs
        exclusions: doc.provenance?.exclusions ?? [],
        id: doc.id, n: doc.n, version: doc.version, counts: doc.counts,
      });
      setViewMode(doc.analyses.length ? "analyses" : "data");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (loadFileRef.current) loadFileRef.current.value = "";   // allow re-pick
    }
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
        <h1>Iris <span className="tag">tier 2</span></h1>
        <div className="mode-toggle">
          <button className={viewMode === "data" ? "active" : ""} onClick={() => setViewMode("data")}>Data</button>
          <button className={viewMode === "analyses" ? "active" : ""} onClick={() => setViewMode("analyses")}>Analyses</button>
        </div>
        <div className="controls">
          <ImportWizard />
          <DataEntry />
          <RenderIndicator dataLoading={dataLoading} />
          <span className="spacer" />
          <button onClick={() => doExport("svg")}>SVG</button>
          <button onClick={() => doExport("pdf")}>PDF</button>
          <button onClick={() => doExport("png")}>PNG</button>
          <button onClick={() => loadFileRef.current?.click()}>Load .iris</button>
          <input ref={loadFileRef} type="file" hidden accept=".iris"
            onChange={(e) => e.target.files?.[0] && void doLoad(e.target.files[0])} />
          <button className="primary" onClick={doSave}>Save .iris</button>
        </div>
      </header>
      {error ? <div className="error-bar">{error}</div>
        : mappingError ? <div className="error-bar warn-bar">{mappingError}</div>
        : renderError ? <div className="error-bar">{renderError}</div>
        : warnIssue ? <div className="error-bar warn-bar">{warnIssue.message}</div>
        : null}
      <main>
        {viewMode === "data" ? (
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
          <div className="analyses-mode">
            <PlottableSidebar />
            <LayerRail />
            <div className="iris">
              <Section title="Reduced table" defaultOpen><ReducedTable /></Section>
              <Section title="Figure" defaultOpen><FigurePane /></Section>
              <Section title="Statistics" defaultOpen><StatsPanel /></Section>
            </div>
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
