import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { DataEntry } from "./components/DataEntry";
import { DataTable } from "./components/DataTable";
import { FigurePane } from "./components/FigurePane";
import { ImportWizard } from "./components/ImportWizard";
import { PipelineRail } from "./components/PipelineRail";
import { LayerRail } from "./components/LayerRail";
import { PlottableSidebar } from "./components/PlottableSidebar";
import { ReducedTable } from "./components/ReducedTable";
import { StatsPanel } from "./components/StatsPanel";
import {
  activePlottableAtom, activePlottableIdAtom, allSpecsAtom, analysisAtom,
  applyTemplateAtom, engineErrorAtom, engineSnapshotAtom, exclusionLogAtom,
  loadTableAtom, registryAtom, reducePreviewAtom, rowsAtom, schemaAtom,
  setAnalysisByIdAtom, setReducePreviewByIdAtom, specAtom, tableTokenAtom,
  viewModeAtom, TEMPLATES, type TemplateName,
} from "./state";
import { downloadBase64, engine } from "./types";

function Section({ title, defaultOpen, children }:
  { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <section className="triad-section">
      <button className="section-header" onClick={() => setOpen((o) => !o)}>
        <span className="chevron">{open ? "▾" : "▸"}</span> {title}
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

export default function App() {
  const [schema] = useAtom(schemaAtom);
  const [rows] = useAtom(rowsAtom);
  const [active, setActive] = useAtom(activePlottableAtom);
  const activeId = useAtomValue(activePlottableIdAtom);
  const [viewMode, setViewMode] = useAtom(viewModeAtom);
  const loadTable = useSetAtom(loadTableAtom);
  const spec = useAtomValue(specAtom);
  const allSpecs = useAtomValue(allSpecsAtom);
  const setAnalysisById = useSetAtom(setAnalysisByIdAtom);
  const setReducePreviewById = useSetAtom(setReducePreviewByIdAtom);
  const [tableToken, setTableToken] = useAtom(tableTokenAtom);
  const setError = useSetAtom(engineErrorAtom);
  const setSnapshot = useSetAtom(engineSnapshotAtom);
  const exclusionLog = useAtomValue(exclusionLogAtom);
  const reducePreview = useAtomValue(reducePreviewAtom);
  const setRegistry = useSetAtom(registryAtom);
  const applyTemplate = useSetAtom(applyTemplateAtom);
  const warnIssue = (useAtomValue(analysisAtom)?.issues ?? [])
    .find((i) => i.level === "warning");
  const error = useAtomValue(engineErrorAtom);
  const [engineUp, setEngineUp] = useState<boolean | null>(null);
  const [showSpec, setShowSpec] = useState(false);
  const [tableEpoch, setTableEpoch] = useState(0);
  const timer = useRef<number>();
  const previewTimer = useRef<number>();

  /* derived from active plottable */
  const mappings = active?.mappings ?? { x: "", y: "" };
  const family = active?.family ?? "group_comparison";
  const preset = active?.preset ?? "demo_default";
  const xKind: "categorical" | "numeric" | "none" =
    family === "group_comparison" ? "categorical"
    : family === "correlation" ? "numeric" : "none";

  const setMappings = (m: { x: string; y: string }) =>
    active && setActive({ ...active, mappings: m });
  const setPreset = (p: string) => active && setActive({ ...active, preset: p });

  useEffect(() => {
    engine.waitForHealth()
      .then((h) => { setSnapshot(h.engine_snapshot); setRegistry(h.registry); setEngineUp(true); })
      .then(() => engine.sample())
      .then((t) => loadTable(t))
      .catch(() => setEngineUp(false));
  }, []);

  /* the X/Y pickers must offer the columns that SURVIVE the reduction, not the
     master columns — otherwise you can map X to a column the pipeline drops and
     analyze 422s ("x column not found in schema"). The reduce preview carries
     the post-reduction schema (and runs even with zero steps, where it equals
     the master schema), so it's the source of truth; fall back to the master
     schema only for the brief moment before the first preview resolves. */
  const effectiveSchema = reducePreview?.preview.schema ?? schema;
  const numericCols = effectiveSchema?.columns.filter((c) => c.type === "numeric") ?? [];
  const catCols = effectiveSchema?.columns.filter((c) => c.type === "categorical") ?? [];
  const xCols = xKind === "numeric" ? numericCols.filter((c) => c.name !== mappings.y) : catCols;

  /* a stable signature of the surviving columns, so effects that must react to a
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
    : xKind !== "none" && mappings.x && !survives(mappings.x)
      ? `X column “${mappings.x}” is removed by this analysis’s reduction pipeline. `
        + `Add it to a Collapse “Group by” step, or pick a column the pipeline keeps.`
    : mappings.y && !survives(mappings.y)
      ? `Y column “${mappings.y}” is removed by this analysis’s reduction pipeline. `
        + `Aggregate it in the Collapse step, or pick a column the pipeline keeps.`
    : null;

  /* upload the master table once per data change and remember its content
     token; subsequent pipeline/mapping edits then ride as a small token instead
     of re-sending the whole (potentially hundreds of MB) table each round trip.
     The token is cleared the moment the data changes so the analyze/preview
     loops wait for the fresh upload rather than referencing a stale table. */
  useEffect(() => {
    if (!schema || rows.length === 0) { setTableToken(null); return; }
    setTableToken(null);
    let cancelled = false;
    const t = window.setTimeout(async () => {
      try {
        const { token } = await engine.putTable({ schema, rows });
        if (!cancelled) setTableToken(token);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }, 150);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [rows, schema, tableEpoch]);

  /* the reactive loop: figure + stats for the active plottable. Depends on the
     table token (a data edit re-runs it) and a stable spec string (a pipeline or
     mapping edit re-runs it). `spec` is rebuilt every recompute, so depending on
     it directly would never converge; the string key settles once the
     recommendation does. A stale-cache 409 bumps the epoch to re-upload. */
  const specKey = spec ? JSON.stringify(spec) : null;
  useEffect(() => {
    if (!schema || !spec || !tableToken) return;
    if (xKind !== "none" && !spec.encodings.x?.column) return;
    if (mappingError) return; // a mapped column the pipeline drops — don't ship a doomed analyze
    window.clearTimeout(timer.current);
    /* capture the target plottable at dispatch so a late-resolving result lands
       in the plottable it was computed for, not whichever is active on return */
    const targetId = spec.id;
    timer.current = window.setTimeout(async () => {
      try {
        const res = await engine.analyze({ token: tableToken }, spec);
        setAnalysisById({ id: targetId, res }); setError(null);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (/not cached/i.test(m)) { setTableEpoch((x) => x + 1); return; }
        setError(m);
      }
    }, 200);
    return () => window.clearTimeout(timer.current);
  }, [tableToken, specKey, schemaKey, mappingError]);

  /* live reduced-table preview for the active plottable, recomputed as the
     pipeline changes. Independent of the analyze loop and valid before any
     mapping is set, so the Reduced-table section updates while you build steps. */
  const stepsKey = active ? JSON.stringify(active.reduce.steps) : null;
  useEffect(() => {
    if (!tableToken || !active) return;
    window.clearTimeout(previewTimer.current);
    const targetId = active.id;
    const steps = active.reduce.steps;
    previewTimer.current = window.setTimeout(async () => {
      try {
        const preview = await engine.reduce({ token: tableToken }, steps);
        setReducePreviewById({ id: targetId, preview }); setError(null);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (/not cached/i.test(m)) { setTableEpoch((x) => x + 1); return; }
        setError(m);
      }
    }, 200);
    return () => window.clearTimeout(previewTimer.current);
  }, [tableToken, stepsKey, activeId]);

  const doExport = async (format: "svg" | "pdf" | "png") => {
    if (!schema || !spec) return;
    const ref = tableToken ? { token: tableToken } : { schema, rows };
    const f = await engine.export(ref, spec, format);
    downloadBase64(f.filename, f.data_base64);
  };
  const doSave = async () => {
    if (!schema || allSpecs.length === 0) return;
    const f = await engine.saveDocument({ schema, rows }, allSpecs,
      { exclusions: exclusionLog });
    downloadBase64(f.filename, f.data_base64);
  };

  if (engineUp === false) return (
    <div className="engine-down">
      <h1>Engine not reachable</h1>
      <p>Start it with <code>python -m triad_engine.main</code> in <code>engine/</code>, then reload.</p>
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
        <h1>Triad <span className="tag">tier 2</span></h1>
        <div className="mode-toggle">
          <button className={viewMode === "data" ? "active" : ""} onClick={() => setViewMode("data")}>Data</button>
          <button className={viewMode === "analyses" ? "active" : ""} onClick={() => setViewMode("analyses")}>Analyses</button>
        </div>
        <div className="controls">
          <ImportWizard />
          <DataEntry />
          {viewMode === "analyses" && (
            <>
              <label>Plot
                <select value=""
                  onChange={(e) => { if (e.target.value) applyTemplate(e.target.value as TemplateName); }}>
                  <option value="">Start from…</option>
                  {(Object.keys(TEMPLATES) as TemplateName[]).map((t) => (
                    <option key={t} value={t}>{TEMPLATES[t].label}</option>
                  ))}
                </select>
              </label>
              {xKind !== "none" && (
                <label>X
                  <select value={mappings.x}
                    onChange={(e) => setMappings({ ...mappings, x: e.target.value })}>
                    {xCols.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
                  </select>
                </label>
              )}
              <label>{xKind === "none" ? "Variable" : "Y"}
                <select value={mappings.y}
                  onChange={(e) => setMappings({ ...mappings, y: e.target.value })}>
                  {numericCols.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
                </select>
              </label>
              <label>Size
                <select value={preset} onChange={(e) => setPreset(e.target.value)}>
                  <option value="demo_default">Screen (140 mm)</option>
                  <option value="nature_single_column">Nature single (89 mm)</option>
                  <option value="nature_double_column">Nature double (183 mm)</option>
                </select>
              </label>
            </>
          )}
          <span className="spacer" />
          <button onClick={() => doExport("svg")}>SVG</button>
          <button onClick={() => doExport("pdf")}>PDF</button>
          <button onClick={() => doExport("png")}>PNG</button>
          <button className="primary" onClick={doSave}>Save .viz</button>
        </div>
      </header>
      {error ? <div className="error-bar">{error}</div>
        : mappingError ? <div className="error-bar warn-bar">{mappingError}</div>
        : warnIssue ? <div className="error-bar warn-bar">{warnIssue.message}</div>
        : null}
      <main>
        {viewMode === "data" ? (
          <div className="data-mode"><DataTable /></div>
        ) : (
          <div className="analyses-mode">
            <PlottableSidebar />
            <PipelineRail />
            <LayerRail />
            <div className="triad">
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
