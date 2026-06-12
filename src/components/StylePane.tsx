import { useAtom, useAtomValue } from "jotai";
import { analysisAtom, DEFAULT_PALETTE, plotTypeAtom, PLOT_TYPES, styleAtom } from "../state";
import type { StyleOverrides } from "../types";

/* engine defaults; shown when no override is set so the controls never jump */
const D = {
  font_size_pt: 9, marker_size: 22, marker_alpha: 0.55, jitter: 0.18,
  axis_linewidth: 0.8, line_width: 1.4,
};

/** The style drawer under the figure. Comprehensive but grouped: text,
 *  markers, lines & frame, colors, size. Every control writes one key of
 *  spec.style.overrides; the engine owns the defaults. */
export function StylePane() {
  const [style, setStyle] = useAtom(styleAtom);
  const analysis = useAtomValue(analysisAtom);
  const plotType = useAtomValue(plotTypeAtom);
  const grouped = PLOT_TYPES[plotType].family === "group_comparison";

  /* unset (undefined / "") keys are pruned so {} really means "preset look" */
  const set = (patch: StyleOverrides) => {
    const next: Record<string, unknown> = { ...style, ...patch };
    for (const k of Object.keys(next))
      if (next[k] === undefined || next[k] === "") delete next[k];
    setStyle(next as StyleOverrides);
  };
  const setText = (key: "title" | "x_label" | "y_label", v: string) =>
    set({ [key]: v });

  const seriesNames = grouped ? (analysis?.stats.levels ?? []) : ["Series"];
  const palette = style.palette ?? DEFAULT_PALETTE;
  const colorOf = (i: number) => palette[i % palette.length];
  const setColor = (i: number, color: string) => {
    const next = seriesNames.map((_, k) => (k === i ? color : colorOf(k)));
    set({ palette: next });
  };

  const num = (v: string) => (v === "" ? undefined : Number(v));
  const dirty = Object.keys(style).length > 0;

  return (
    <details className="style-pane">
      <summary>Style{dirty && <em className="dim"> · customized</em>}</summary>

      <div className="style-groups">
        <fieldset>
          <legend>Text</legend>
          <label>Title
            <input type="text" placeholder="none" value={style.title ?? ""}
              onChange={(e) => setText("title", e.target.value)} />
          </label>
          <label>X label
            <input type="text" placeholder="auto" value={style.x_label ?? ""}
              onChange={(e) => setText("x_label", e.target.value)} />
          </label>
          <label>Y label
            <input type="text" placeholder="auto" value={style.y_label ?? ""}
              onChange={(e) => setText("y_label", e.target.value)} />
          </label>
          <label>Font size
            <input type="number" min={5} max={16} step={0.5}
              value={style.font_size_pt ?? D.font_size_pt}
              onChange={(e) => set({ font_size_pt: num(e.target.value) })} />
            <span className="dim">pt</span>
          </label>
        </fieldset>

        <fieldset>
          <legend>Markers</legend>
          <label>Size
            <input type="range" min={4} max={100} step={2}
              value={style.marker_size ?? D.marker_size}
              onChange={(e) => set({ marker_size: Number(e.target.value) })} />
            <span className="dim">{style.marker_size ?? D.marker_size}</span>
          </label>
          <label>Opacity
            <input type="range" min={0.1} max={1} step={0.05}
              value={style.marker_alpha ?? D.marker_alpha}
              onChange={(e) => set({ marker_alpha: Number(e.target.value) })} />
            <span className="dim">{(style.marker_alpha ?? D.marker_alpha).toFixed(2)}</span>
          </label>
          {grouped && (
            <label>Jitter
              <input type="range" min={0} max={0.4} step={0.02}
                value={style.jitter ?? D.jitter}
                onChange={(e) => set({ jitter: Number(e.target.value) })} />
              <span className="dim">{(style.jitter ?? D.jitter).toFixed(2)}</span>
            </label>
          )}
        </fieldset>

        <fieldset>
          <legend>Lines &amp; frame</legend>
          <label>Axis width
            <input type="range" min={0.3} max={2.5} step={0.1}
              value={style.axis_linewidth ?? D.axis_linewidth}
              onChange={(e) => set({ axis_linewidth: Number(e.target.value) })} />
            <span className="dim">{(style.axis_linewidth ?? D.axis_linewidth).toFixed(1)}</span>
          </label>
          <label>Stat lines
            <input type="range" min={0.5} max={3} step={0.1}
              value={style.line_width ?? D.line_width}
              onChange={(e) => set({ line_width: Number(e.target.value) })} />
            <span className="dim">{(style.line_width ?? D.line_width).toFixed(1)}</span>
          </label>
          <label>Frame
            <select value={style.frame ?? "open"}
              onChange={(e) => set({ frame: e.target.value as "open" | "closed" })}>
              <option value="open">open (L-shape)</option>
              <option value="closed">closed (box)</option>
            </select>
          </label>
          <label>
            <input type="checkbox" checked={style.grid ?? true}
              onChange={(e) => set({ grid: e.target.checked })} />
            grid lines
          </label>
        </fieldset>

        <fieldset>
          <legend>Colors</legend>
          {seriesNames.map((name, i) => (
            <label key={name}>{name}
              <input type="color" value={colorOf(i)}
                onChange={(e) => setColor(i, e.target.value)} />
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>Size</legend>
          <label>Width
            <input type="number" min={40} max={300} placeholder="preset"
              value={style.width_mm ?? ""}
              onChange={(e) => set({ width_mm: num(e.target.value) })} />
            <span className="dim">mm</span>
          </label>
          <label>Height
            <input type="number" min={30} max={250} placeholder="preset"
              value={style.height_mm ?? ""}
              onChange={(e) => set({ height_mm: num(e.target.value) })} />
            <span className="dim">mm</span>
          </label>
        </fieldset>
      </div>

      <div className="btn-row style-foot">
        <button onClick={() => set({ offsets: undefined })}
          disabled={!style.offsets || Object.keys(style.offsets).length === 0}>
          Reset label positions
        </button>
        <button onClick={() => setStyle({})} disabled={!dirty}>Reset all</button>
      </div>
    </details>
  );
}
