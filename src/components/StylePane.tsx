import { useAtom, useAtomValue } from "jotai";
import { activePlottableAtom, analysisAtom, DEFAULT_PALETTE, PLOT_TYPES } from "../state";
import type { StyleOverrides } from "../types";

/* engine defaults; shown when no override is set so the controls never jump */
const D = {
  font_size_pt: 9, marker_size: 22, marker_alpha: 0.55, jitter: 0.18,
  axis_linewidth: 0.8, line_width: 1.4, tick_length: 3.5,
  outlier_size: 3, capsize: 3, x_tick_rotation: 0,
};

const OUTLIER_LABELS = {
  o: "circle", D: "diamond", x: "cross", "+": "plus", none: "hidden",
} as const;

/** The style drawer under the figure. Comprehensive but grouped: text,
 *  markers, axes & ticks, lines & frame, plot-specific options, colors,
 *  size. Every control writes one key of spec.style.overrides; the engine
 *  owns the defaults, and mark options only appear for the active plot. */
export function StylePane() {
  const [active, setActive] = useAtom(activePlottableAtom);
  const style = active?.style ?? {};
  const plotType = active?.plotType ?? "dots";
  const analysis = useAtomValue(analysisAtom);
  const pt = PLOT_TYPES[plotType];
  const grouped = pt.family === "group_comparison";
  const marks = new Set(pt.layers.map((l) => l.mark));
  const xNumeric = pt.xKind === "numeric" || plotType === "histogram";

  /* unset (undefined / "") keys are pruned so {} really means "preset look" */
  const set = (patch: StyleOverrides) => {
    if (!active) return;
    const next: Record<string, unknown> = { ...style, ...patch };
    for (const k of Object.keys(next))
      if (next[k] === undefined || next[k] === "") delete next[k];
    setActive({ ...active, style: next as StyleOverrides });
  };
  const setText = (key: "title" | "x_label" | "y_label", v: string) =>
    set({ [key]: v });
  const num = (v: string) => (v === "" ? undefined : Number(v));

  const seriesNames = grouped ? (analysis?.stats.levels ?? []) : ["Series"];
  const palette = style.palette ?? DEFAULT_PALETTE;
  const colorOf = (i: number) => palette[i % palette.length];
  const setColor = (i: number, color: string) =>
    set({ palette: seriesNames.map((_, k) => (k === i ? color : colorOf(k))) });

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
          <label>X tick rotation
            <input type="number" min={0} max={90} step={15}
              value={style.x_tick_rotation ?? D.x_tick_rotation}
              onChange={(e) => set({ x_tick_rotation: num(e.target.value) })} />
            <span className="dim">°</span>
          </label>
        </fieldset>

        {(marks.has("dot") || marks.has("scatter")) && (
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
        )}

        <fieldset>
          <legend>Axes &amp; ticks</legend>
          <label>Ticks
            <select value={style.tick_direction ?? "out"}
              onChange={(e) => set({ tick_direction: e.target.value as StyleOverrides["tick_direction"] })}>
              <option value="out">outside</option>
              <option value="in">inside</option>
              <option value="inout">both</option>
            </select>
          </label>
          <label>Tick length
            <input type="range" min={0} max={8} step={0.5}
              value={style.tick_length ?? D.tick_length}
              onChange={(e) => set({ tick_length: Number(e.target.value) })} />
            <span className="dim">{(style.tick_length ?? D.tick_length).toFixed(1)}</span>
          </label>
          <label>X ticks on
            <select value={style.x_tick_side ?? "bottom"}
              onChange={(e) => set({ x_tick_side: e.target.value as StyleOverrides["x_tick_side"] })}>
              <option value="bottom">bottom</option>
              <option value="top">top</option>
            </select>
          </label>
          <label>Y ticks on
            <select value={style.y_tick_side ?? "left"}
              onChange={(e) => set({ y_tick_side: e.target.value as StyleOverrides["y_tick_side"] })}>
              <option value="left">left</option>
              <option value="right">right</option>
            </select>
          </label>
          {xNumeric && (
            <label>X tick every
              <input type="number" min={0} step="any" placeholder="auto"
                value={style.x_tick_spacing ?? ""}
                onChange={(e) => set({ x_tick_spacing: num(e.target.value) || undefined })} />
            </label>
          )}
          <label>Y tick every
            <input type="number" min={0} step="any" placeholder="auto"
              value={style.y_tick_spacing ?? ""}
              onChange={(e) => set({ y_tick_spacing: num(e.target.value) || undefined })} />
          </label>
          <label>
            <input type="checkbox" checked={style.minor_ticks ?? false}
              onChange={(e) => set({ minor_ticks: e.target.checked })} />
            minor ticks
          </label>
          <label>Y scale
            <select value={style.y_scale ?? "linear"}
              onChange={(e) => set({ y_scale: e.target.value as StyleOverrides["y_scale"] })}>
              <option value="linear">linear</option>
              <option value="log">log</option>
            </select>
          </label>
          {xNumeric && (
            <label>X scale
              <select value={style.x_scale ?? "linear"}
                onChange={(e) => set({ x_scale: e.target.value as StyleOverrides["x_scale"] })}>
                <option value="linear">linear</option>
                <option value="log">log</option>
              </select>
            </label>
          )}
          <label>Y range
            <input type="number" step="any" placeholder="auto" className="narrow"
              value={style.y_min ?? ""}
              onChange={(e) => set({ y_min: num(e.target.value) })} />
            <span className="dim">to</span>
            <input type="number" step="any" placeholder="auto" className="narrow"
              value={style.y_max ?? ""}
              onChange={(e) => set({ y_max: num(e.target.value) })} />
          </label>
          {xNumeric && (
            <label>X range
              <input type="number" step="any" placeholder="auto" className="narrow"
                value={style.x_min ?? ""}
                onChange={(e) => set({ x_min: num(e.target.value) })} />
              <span className="dim">to</span>
              <input type="number" step="any" placeholder="auto" className="narrow"
                value={style.x_max ?? ""}
                onChange={(e) => set({ x_max: num(e.target.value) })} />
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
            <input type="checkbox"
              checked={style.grid_y ?? true}
              onChange={(e) => set({ grid_y: e.target.checked })} />
            horizontal grid
          </label>
          <label>
            <input type="checkbox"
              checked={style.grid_x ?? (plotType === "scatter")}
              onChange={(e) => set({ grid_x: e.target.checked })} />
            vertical grid
          </label>
        </fieldset>

        {(marks.has("box") || marks.has("violin") || marks.has("bar")
          || marks.has("summary") || marks.has("histogram")) && (
          <fieldset>
            <legend>{pt.label.split(" ")[0]} options</legend>
            {marks.has("box") && (
              <>
                <label>
                  <input type="checkbox" checked={style.notch ?? false}
                    onChange={(e) => set({ notch: e.target.checked })} />
                  notches (median CI)
                </label>
                <label>Outliers
                  <select value={style.outlier_marker ?? "o"}
                    onChange={(e) => set({ outlier_marker: e.target.value as StyleOverrides["outlier_marker"] })}>
                    {(Object.keys(OUTLIER_LABELS) as (keyof typeof OUTLIER_LABELS)[]).map((m) => (
                      <option key={m} value={m}>{OUTLIER_LABELS[m]}</option>
                    ))}
                  </select>
                </label>
                {style.outlier_marker !== "none" && (
                  <label>Outlier size
                    <input type="range" min={1} max={8} step={0.5}
                      value={style.outlier_size ?? D.outlier_size}
                      onChange={(e) => set({ outlier_size: Number(e.target.value) })} />
                    <span className="dim">{(style.outlier_size ?? D.outlier_size).toFixed(1)}</span>
                  </label>
                )}
              </>
            )}
            {(marks.has("box") || marks.has("violin") || marks.has("bar")) && (
              <label>Width
                <input type="range" min={0.1} max={0.9} step={0.04}
                  value={style.mark_width ?? (marks.has("violin") ? 0.7 : marks.has("bar") ? 0.6 : 0.42)}
                  onChange={(e) => set({ mark_width: Number(e.target.value) })} />
                <span className="dim">{(style.mark_width ?? (marks.has("violin") ? 0.7 : marks.has("bar") ? 0.6 : 0.42)).toFixed(2)}</span>
              </label>
            )}
            {(marks.has("summary") || marks.has("bar")) && (
              <>
                <label>Error bars
                  <select value={style.error_type ?? "ci95"}
                    onChange={(e) => set({ error_type: e.target.value as StyleOverrides["error_type"] })}>
                    <option value="ci95">95% CI</option>
                    <option value="sem">SEM</option>
                    <option value="sd">SD</option>
                  </select>
                </label>
                <label>Cap size
                  <input type="range" min={0} max={8} step={0.5}
                    value={style.capsize ?? D.capsize}
                    onChange={(e) => set({ capsize: Number(e.target.value) })} />
                  <span className="dim">{(style.capsize ?? D.capsize).toFixed(1)}</span>
                </label>
              </>
            )}
            {marks.has("histogram") && (
              <label>Bins
                <input type="number" min={2} max={200} placeholder="auto"
                  value={style.hist_bins ?? ""}
                  onChange={(e) => set({ hist_bins: num(e.target.value) || undefined })} />
              </label>
            )}
          </fieldset>
        )}

        <fieldset>
          <legend>Annotations</legend>
          {grouped && (
            <>
              <label>
                <input type="checkbox" checked={style.show_n ?? true}
                  onChange={(e) => set({ show_n: e.target.checked })} />
                n per group
              </label>
              <label>
                <input type="checkbox" checked={style.show_significance ?? true}
                  onChange={(e) => set({ show_significance: e.target.checked })} />
                significance bracket
              </label>
            </>
          )}
          {!grouped && (
            <label>
              <input type="checkbox" checked={style.show_annotation ?? true}
                onChange={(e) => set({ show_annotation: e.target.checked })} />
              {plotType === "histogram" ? "median line + label" : "r / p annotation"}
            </label>
          )}
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
          <span className="dim">or drag the figure corner</span>
        </fieldset>
      </div>

      <div className="btn-row style-foot">
        <button onClick={() => set({ offsets: undefined })}
          disabled={!style.offsets || Object.keys(style.offsets).length === 0}>
          Reset label positions
        </button>
        <button onClick={() => active && setActive({ ...active, style: {} })} disabled={!dirty}>Reset all</button>
      </div>
    </details>
  );
}
