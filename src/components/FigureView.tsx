import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import {
  activePlottableIdAtom, figureAtom, figurePanelsAtom, figureRequestAtom,
  plottablesAtom, setTagAtom, viewModeAtom,
} from "../state";
import { FIGURE_DEFAULTS, movePanel, nextTag, type FigureAssembly } from "../figure";
import { engine, type FigureRenderResponse } from "../types";
import { useDebouncedAsync } from "../useDebouncedAsync";

/* A number field that commits on blur / Enter, so typing "1" on the way to "12"
   does not re-render the figure for every keystroke. Empty = null (auto). */
function NumField({ value, onChange, min, max, step = 1, placeholder, label }: {
  value: number | null; onChange: (v: number | null) => void;
  min: number; max: number; step?: number; placeholder?: string; label: string;
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  useEffect(() => setDraft(value == null ? "" : String(value)), [value]);
  const commit = () => {
    const t = draft.trim();
    if (t === "") return onChange(null);
    const v = Number(t);
    if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
    else setDraft(value == null ? "" : String(value));
  };
  return (
    <input type="number" inputMode="decimal" aria-label={label} min={min} max={max} step={step}
      placeholder={placeholder} value={draft}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
  );
}

/* The Figure view: the document's tagged analyses drawn as the panels of one
   figure, with its layout controls. Tapping a panel opens that analysis in the
   workbench. */
export function FigureView() {
  const plottables = useAtomValue(plottablesAtom);
  const panels = useAtomValue(figurePanelsAtom);
  const request = useAtomValue(figureRequestAtom);
  const [stored, setFigure] = useAtom(figureAtom);
  const setTag = useSetAtom(setTagAtom);
  const setActive = useSetAtom(activePlottableIdAtom);
  const setViewMode = useSetAtom(viewModeAtom);
  const figure = stored ?? FIGURE_DEFAULTS;
  const update = (patch: Partial<FigureAssembly>) => setFigure({ ...figure, ...patch });
  const letters = (patch: Partial<FigureAssembly["letters"]>) =>
    update({ letters: { ...figure.letters, ...patch } });

  const [result, setResult] = useState<FigureRenderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = JSON.stringify([request, figure]);
  useDebouncedAsync({
    when: request.length > 0,
    deps: [key],
    delay: 250,
    start: () => setBusy(true),
    run: () => engine.figureRender(request, figure),
    status: (o) => {
      setBusy(false);
      if (o.ok) { setResult(o.value); setError(null); } else setError(o.error);
    },
  });
  useEffect(() => { if (request.length === 0) { setResult(null); setError(null); } }, [request.length]);

  const src = useMemo(() => result
    ? URL.createObjectURL(new Blob([result.svg], { type: "image/svg+xml" })) : null, [result]);
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);

  const open = (id: string) => { setActive(id); setViewMode("workbench"); };
  const untagged = plottables.filter((p) => !p.tag?.trim());
  const usedTags = panels.map((p) => p.tag ?? "");
  // every analysis becomes a panel, lettered in list order
  const addAll = () => {
    const used = [...usedTags];
    for (const p of untagged) { const tag = nextTag(used); used.push(tag); setTag({ id: p.id, tag }); }
  };
  const rows = figure.direction === "rows";
  const custom = figure.sizes !== null;

  return (
    <div className="figure-mode">
      <aside className="figure-controls">
        <section>
          <h3>Panels</h3>
          {panels.length === 0 && (
            <>
              <p className="fig-hint">
                A figure is built from analyses: each one you add becomes a panel
                with a letter. Add them one at a time with +, or all at once.
              </p>
              {untagged.length > 1 && (
                <button className="chip fig-add-all" onClick={addAll}>
                  Add all {untagged.length} as A, B, C…</button>
              )}
            </>
          )}
          <ol className="fig-panels">
            {panels.map((p, i) => (
              <li key={p.id}>
                <input className="fig-tag" aria-label={`Tag of ${p.name}`} value={p.tag ?? ""}
                  maxLength={4} onChange={(e) => setTag({ id: p.id, tag: e.target.value })} />
                <button className="fig-name" title={`Open ${p.name}`} onClick={() => open(p.id)}>{p.name}</button>
                {custom && (
                  <NumField label={`Size of ${p.name}`} min={0.05} max={100} step={0.25}
                    value={figure.sizes?.[p.id] ?? 1}
                    onChange={(v) => update({ sizes: { ...figure.sizes, [p.id]: v ?? 1 } })} />
                )}
                <button className="icon" aria-label="Move up" disabled={i === 0}
                  onClick={() => setFigure(movePanel(figure, plottables, p.id, -1))}>{rows ? "↑" : "←"}</button>
                <button className="icon" aria-label="Move down" disabled={i === panels.length - 1}
                  onClick={() => setFigure(movePanel(figure, plottables, p.id, 1))}>{rows ? "↓" : "→"}</button>
                <button className="icon" aria-label={`Remove ${p.name} from the figure`}
                  onClick={() => setTag({ id: p.id, tag: "" })}>×</button>
              </li>
            ))}
          </ol>
          {untagged.length > 0 && (
            <ul className="fig-untagged">
              {untagged.map((p) => (
                <li key={p.id}>
                  <button className="icon" aria-label={`Add ${p.name} to the figure`}
                    onClick={() => setTag({ id: p.id, tag: nextTag(usedTags) })}>+</button>
                  <span className="fig-name dim" title={p.name}>{p.name}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3>Layout</h3>
          <div className="tb-seg fig-seg">
            <button className={rows ? "active" : ""} onClick={() => update({ direction: "rows" })}>Stacked</button>
            <button className={!rows ? "active" : ""} onClick={() => update({ direction: "columns", share_x: false })}>Side by side</button>
          </div>
          <label>Width (mm)
            <NumField label="Width (mm)" min={10} max={2000} value={figure.width_mm}
              placeholder={result ? `${Math.round(result.width_mm)}` : "auto"}
              onChange={(v) => update({ width_mm: v })} /></label>
          <label>Height (mm)
            <NumField label="Height (mm)" min={10} max={2000} value={figure.height_mm}
              placeholder={result ? `${Math.round(result.height_mm)}` : "auto"}
              onChange={(v) => update({ height_mm: v })} /></label>
          <label>Gap (mm)
            <NumField label="Gap (mm)" min={0} max={100} step={0.5} value={figure.gap_mm}
              onChange={(v) => update({ gap_mm: v ?? FIGURE_DEFAULTS.gap_mm })} /></label>
          <label className="fig-check">
            <input type="checkbox" checked={custom}
              onChange={(e) => update({ sizes: e.target.checked ? {} : null })} />
            Relative panel sizes</label>
          <label className={`fig-check ${rows ? "" : "disabled"}`}
            title="One x range; x tick labels and x label on the bottom panel only">
            <input type="checkbox" checked={figure.share_x && rows} disabled={!rows}
              onChange={(e) => update({ share_x: e.target.checked })} />
            Shared x axis</label>
        </section>

        <section>
          <h3>Letters</h3>
          <label className="fig-check">
            <input type="checkbox" checked={figure.letters.show}
              onChange={(e) => letters({ show: e.target.checked })} />
            Show panel letters</label>
          <label>Size (pt)
            <NumField label="Letter size (pt)" min={4} max={48} step={0.5} value={figure.letters.size_pt}
              onChange={(v) => letters({ size_pt: v ?? FIGURE_DEFAULTS.letters.size_pt })} /></label>
          <label>Weight
            <select value={figure.letters.weight}
              onChange={(e) => letters({ weight: e.target.value as "bold" | "normal" })}>
              <option value="bold">Bold</option><option value="normal">Normal</option>
            </select></label>
          <label>Position
            <select value={figure.letters.position}
              onChange={(e) => letters({ position: e.target.value as "outside" | "inside" })}>
              <option value="outside">Above the panel</option><option value="inside">Inside the plot</option>
            </select></label>
        </section>
      </aside>

      <section className="figure-preview" aria-busy={busy}>
        {error && <div className="error-bar" role="alert">{error}</div>}
        {request.length === 0 ? (
          <div className="analyses-empty"><span>No panels yet. Add analyses on the left to build the figure.</span></div>
        ) : src && result ? (
          <div className="fig-sheet" style={{ aspectRatio: `${result.width_mm} / ${result.height_mm}`,
            width: `min(100%, ${result.width_mm * 96 / 25.4}px)` }}>
            <img src={src} alt="The assembled figure" draggable={false} />
            {result.panels.map((p) => (
              <button key={p.id} className={`fig-hit ${p.error ? "failed" : ""}`}
                title={p.error ? `${p.tag}: ${p.error}` : `Open panel ${p.tag}`}
                aria-label={`Open panel ${p.tag}`}
                style={{ left: `${p.box[0] * 100}%`, top: `${p.box[1] * 100}%`,
                  width: `${(p.box[2] - p.box[0]) * 100}%`, height: `${(p.box[3] - p.box[1]) * 100}%` }}
                onClick={() => open(p.id)} />
            ))}
          </div>
        ) : (
          <div className="analyses-loading"><span className="spinner" /><span>Assembling the figure…</span></div>
        )}
        {busy && result && <span className="fig-busy">Updating…</span>}
      </section>
    </div>
  );
}
