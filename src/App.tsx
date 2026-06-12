import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { DataEntry } from "./components/DataEntry";
import { DataTable } from "./components/DataTable";
import { FigurePane } from "./components/FigurePane";
import { ImportWizard } from "./components/ImportWizard";
import { StatsPanel } from "./components/StatsPanel";
import {
  analysisAtom, engineErrorAtom, engineSnapshotAtom, exclusionLogAtom,
  mappingsAtom, overrideAtom, plotTypeAtom, presetAtom, rowsAtom, schemaAtom,
  specAtom, styleAtom, PLOT_TYPES, type PlotType,
} from "./state";
import { downloadBase64, engine } from "./types";

export default function App() {
  const [schema, setSchema] = useAtom(schemaAtom);
  const [rows, setRows] = useAtom(rowsAtom);
  const [mappings, setMappings] = useAtom(mappingsAtom);
  const [preset, setPreset] = useAtom(presetAtom);
  const [plotType, setPlotType] = useAtom(plotTypeAtom);
  const setOverride = useSetAtom(overrideAtom);
  const spec = useAtomValue(specAtom);
  const setAnalysis = useSetAtom(analysisAtom);
  const setError = useSetAtom(engineErrorAtom);
  const setSnapshot = useSetAtom(engineSnapshotAtom);
  const exclusionLog = useAtomValue(exclusionLogAtom);
  const style = useAtomValue(styleAtom);
  const error = useAtomValue(engineErrorAtom);
  const [engineUp, setEngineUp] = useState<boolean | null>(null);
  const [showSpec, setShowSpec] = useState(false);
  const timer = useRef<number>();

  useEffect(() => {
    engine.waitForHealth()
      .then((h) => { setSnapshot(h.engine_snapshot); setEngineUp(true); })
      .then(() => engine.sample())
      .then((t) => { setSchema(t.schema); setRows(t.rows); })
      .catch(() => setEngineUp(false));
  }, []);

  const numericCols = schema?.columns.filter((c) => c.type === "numeric") ?? [];
  const catCols = schema?.columns.filter((c) => c.type === "categorical") ?? [];
  const xKind = PLOT_TYPES[plotType].xKind;
  const xCols = xKind === "numeric" ? numericCols.filter((c) => c.name !== mappings.y) : catCols;

  /* switching plot family invalidates the test override and may need a
     different kind of x column */
  const switchPlotType = (next: PlotType) => {
    if (PLOT_TYPES[next].family !== PLOT_TYPES[plotType].family) setOverride(null);
    const kind = PLOT_TYPES[next].xKind;
    const valid = kind === "numeric"
      ? numericCols.filter((c) => c.name !== mappings.y)
      : catCols;
    if (kind !== "none" && !valid.some((c) => c.name === mappings.x))
      setMappings({ ...mappings, x: valid[0]?.name ?? "" });
    setPlotType(next);
  };

  /* the reactive loop: any change to rows/spec → debounced engine round trip */
  useEffect(() => {
    if (!schema || !spec || rows.length === 0) return;
    if (xKind !== "none" && !spec.mappings.x.column) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        const res = await engine.analyze({ schema, rows }, spec);
        setAnalysis(res); setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 200);
    return () => window.clearTimeout(timer.current);
  }, [rows, mappings, spec?.stats.test, preset, schema, plotType, style]);

  const doExport = async (format: "svg" | "pdf" | "png") => {
    if (!schema || !spec) return;
    const f = await engine.export({ schema, rows }, spec, format);
    downloadBase64(f.filename, f.data_base64);
  };
  const doSave = async () => {
    if (!schema || !spec) return;
    const f = await engine.saveDocument({ schema, rows }, [spec],
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
        <div className="controls">
          <ImportWizard />
          <DataEntry />
          <label>Plot
            <select value={plotType}
              onChange={(e) => switchPlotType(e.target.value as PlotType)}>
              {(Object.keys(PLOT_TYPES) as PlotType[]).map((t) => (
                <option key={t} value={t}>{PLOT_TYPES[t].label}</option>
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
          <span className="spacer" />
          <button onClick={() => doExport("svg")}>SVG</button>
          <button onClick={() => doExport("pdf")}>PDF</button>
          <button onClick={() => doExport("png")}>PNG</button>
          <button className="primary" onClick={doSave}>Save .viz</button>
        </div>
      </header>
      {error && <div className="error-bar">{error}</div>}
      <main>
        <DataTable />
        <FigurePane />
        <StatsPanel />
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
