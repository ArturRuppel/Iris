import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useAtomValue } from "jotai";
import { analysisAtom, autoPlotAreaAtom, DEFAULT_PALETTE, effectiveSchemaAtom } from "../../state";
import { familyForMappingsRef } from "../../channels";
import type { StyleKnob } from "../../types";
import { plotSizeMm, setPlotSize, type PlotSizeMm } from "../../plotArea";
import { controlFor, formatFraction, unitFor } from "./knobs";
import type { KnobTarget, StyleEditor } from "./useStyleEditor";

/* ---- the row frame: [dot] label | control ---- */

/** The "this knob is customised" mark. Clicking it deletes the override. */
export function ResetDot({ onReset, what }: { onReset: () => void; what: string }) {
  return (
    <button type="button" className="insp-dot" title="Reset to default"
      aria-label={`Reset ${what} to default`} onClick={onReset} />
  );
}

export function Row({ label, labelFor, labelId, set, onReset, children, className }: {
  label: ReactNode; labelFor?: string; labelId?: string;
  set?: boolean; onReset?: () => void; children: ReactNode; className?: string;
}) {
  const text = typeof label === "string" ? label : undefined;
  return (
    <div className={`insp-row${className ? ` ${className}` : ""}`}>
      {set && onReset && <ResetDot onReset={onReset} what={text ?? "this"} />}
      <label className="insp-label" htmlFor={labelFor} id={labelId} title={text}>{label}</label>
      <div className="insp-ctl">{children}</div>
    </div>
  );
}

/* ---- primitive controls ---- */

/** A segmented choice: one button per option, the chosen one inverted. */
export function Seg({ options, value, onChange, labelledBy, fill }: {
  options: string[]; value: string; onChange: (v: string) => void;
  labelledBy?: string; fill?: boolean;
}) {
  return (
    <div className={`insp-seg${fill ? " fill" : ""}`} role="group" aria-labelledby={labelledBy}>
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={o === value}
          onClick={() => { if (o !== value) onChange(o); }}>{o}</button>
      ))}
    </div>
  );
}

/** A typed number. While focused it keeps the raw text so partial input
 *  ("0.", "-") is not clobbered; each valid keystroke commits (clamped), an
 *  empty field commits `undefined` (back to the default). */
export function NumberField({ id, value, min, max, step, unit, placeholder, onCommit, fill }: {
  id?: string; value: number | undefined; min?: number; max?: number; step?: number;
  unit?: string; placeholder?: string; onCommit: (n: number | undefined) => void; fill?: boolean;
}) {
  const [buf, setBuf] = useState<string | null>(null);
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const commit = (s: string) => {
    if (s.trim() === "") return onCommit(undefined);
    const n = Number(s);
    if (!Number.isNaN(n)) onCommit(clamp(n));
  };
  return (
    <span className={`insp-num${fill ? " fill" : ""}`}>
      <input id={id} type="number" inputMode="decimal" min={min} max={max} step={step ?? "any"}
        placeholder={placeholder}
        value={buf ?? (value == null || Number.isNaN(value) ? "" : String(value))}
        onChange={(e) => { setBuf(e.target.value); commit(e.target.value); }}
        onBlur={() => setBuf(null)} />
      {unit && <span className="insp-unit">{unit}</span>}
    </span>
  );
}

/* ---- a registry knob's control ---- */

/** The control for one registry knob, without its row (the Axes grid puts two
 *  of these in one row). `fill` stretches it to its cell. */
export function KnobInput({ knob, ed, target, id, labelledBy, fill }: {
  knob: StyleKnob; ed: StyleEditor; target?: KnobTarget;
  id?: string; labelledBy?: string; fill?: boolean;
}) {
  const t = target ?? {};
  const cur = ed.read(knob, t);
  const w = knob.widget;
  const write = (v: unknown) => ed.write(knob, v, t);
  switch (controlFor(knob)) {
    case "segmented":
      return <Seg options={w.options ?? []} value={String(cur ?? "")} onChange={write}
        labelledBy={labelledBy} fill={fill} />;
    case "select":
      return (
        <select id={id} className={`insp-select${fill ? " fill" : ""}`}
          value={String(cur ?? "")} onChange={(e) => write(e.target.value)}>
          {(w.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case "bool":
      return <input id={id} type="checkbox" className="hm-check insp-check"
        checked={Boolean(cur)} onChange={(e) => write(e.target.checked)} />;
    case "text":
      return <input id={id} type="text" className="insp-text"
        placeholder={knob.default === "" || knob.default == null
          ? (knob.key === "title" ? "none" : "auto") : String(knob.default)}
        value={String(cur ?? "")} onChange={(e) => write(e.target.value || undefined)} />;
    case "fraction": {
      const v = Number(cur ?? w.min ?? 0);
      return (
        <span className="insp-frac">
          <input id={id} type="range" className="hm-range" min={w.min ?? 0} max={w.max ?? 1}
            step={w.step ?? 0.01} value={v} onChange={(e) => write(Number(e.target.value))} />
          <span className="insp-val">{formatFraction(v, w.step)}</span>
        </span>
      );
    }
    case "number":
      return <NumberField id={id} value={cur == null ? undefined : Number(cur)}
        min={w.min} max={w.max} step={w.step} unit={unitFor(knob.key)}
        placeholder={knob.default == null ? "auto" : undefined}
        onCommit={write} fill={fill} />;
    default:
      return null;
  }
}

/** One registry knob as a labelled row, gated by its visible_when. */
export function KnobRow({ knob, ed, target, label }: {
  knob: StyleKnob; ed: StyleEditor; target?: KnobTarget; label?: string;
}) {
  const id = useId();
  if (!ed.visible(knob, target)) return null;
  const kind = controlFor(knob);
  return (
    <Row label={label ?? knob.label} labelFor={kind === "segmented" ? undefined : id}
      labelId={`${id}-l`} set={ed.isSet(knob, target)}
      onReset={() => ed.write(knob, undefined, target)}>
      <KnobInput knob={knob} ed={ed} target={target} id={id} labelledBy={`${id}-l`} />
    </Row>
  );
}

/* ---- anchored popovers (colour picker, ⋯ menu) ---- */

/** Places a fixed popover under its anchor, flipping above / shifting left to
 *  stay on screen. `align: "end"` lines its right edge up with the anchor's. */
export function useAnchoredPos(anchor: DOMRect | null, ref: RefObject<HTMLElement | null>,
                               align: "start" | "end" = "start") {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor || !ref.current) { setPos(null); return; }
    const M = 8;
    const { width, height } = ref.current.getBoundingClientRect();
    let top = anchor.bottom + 4;
    if (top + height > window.innerHeight - M) top = Math.max(M, anchor.top - 4 - height);
    let left = align === "end" ? anchor.right - width : anchor.left;
    if (left + width > window.innerWidth - M) left = window.innerWidth - M - width;
    setPos({ left: Math.max(M, left), top });
  }, [anchor, ref, align]);
  return pos;
}

const PRESET_SWATCHES = [
  "#0e7490", "#c2410c", "#4d7c0f", "#7c3aed", "#be123c", "#0369a1",
  "#a16207", "#15803d", "#9333ea", "#b91c1c", "#0891b2", "#475569",
];

/** The palette knob: one row per series with its swatch, a popover to pick. */
export function PaletteRows({ knob, ed }: { knob: StyleKnob; ed: StyleEditor }) {
  const analysis = useAtomValue(analysisAtom);
  const schema = useAtomValue(effectiveSchemaAtom);
  const [menu, setMenu] = useState<{ anchor: DOMRect; index: number } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const pos = useAnchoredPos(menu?.anchor ?? null, popRef);
  const active = ed.active;
  const family = active ? familyForMappingsRef(active.mappings, schema, active.reference) : "group_comparison";
  const grouped = family === "group_comparison" || family === "location";
  const names = grouped ? (analysis?.stats.levels ?? []) : ["Series"];
  const palette = (ed.style.palette ?? DEFAULT_PALETTE) as string[];
  const colorOf = (i: number) => palette[i % palette.length];
  const setColor = (i: number, color: string) =>
    ed.setFigure({ palette: names.map((_, k) => (k === i ? color : colorOf(k))) });
  const set = ed.isSet(knob);
  if (!names.length) return null;

  return (
    <>
      <div className="insp-sec">
        {set && <ResetDot onReset={() => ed.write(knob, undefined)} what="colours" />}
        <span>{knob.label}</span>
      </div>
      {names.map((name, i) => (
        <Row key={`${name}-${i}`} label={String(name)}>
          <button type="button" className="color-swatch-btn insp-swatch"
            style={{ background: colorOf(i) }} aria-label={`Colour of ${name}`}
            onClick={(e) => setMenu({ anchor: e.currentTarget.getBoundingClientRect(), index: i })} />
          <span className="insp-val mono">{colorOf(i)}</span>
        </Row>
      ))}
      {menu && (
        <>
          <div className="menu-backdrop" onClick={() => setMenu(null)} />
          <div ref={popRef} className="context-menu color-popover"
            style={{ left: pos?.left ?? menu.anchor.left, top: pos?.top ?? menu.anchor.bottom + 4,
              visibility: pos ? "visible" : "hidden" }}>
            <input type="text" className="color-hex" value={colorOf(menu.index)}
              onChange={(e) => setColor(menu.index, e.target.value)} />
            <div className="color-swatch-grid">
              {PRESET_SWATCHES.map((c) => (
                <button key={c} type="button" className="color-swatch-btn" aria-label={c}
                  style={{ background: c }}
                  onClick={() => { setColor(menu.index, c); setMenu(null); }} />
              ))}
            </div>
            <button onClick={() => setMenu(null)}>Done</button>
          </div>
        </>
      )}
    </>
  );
}

/** The plot area (the axes box): its size in mm. Where it sits is not a
 *  parameter — the engine places it where its labels fit, and the canvas size
 *  supplies the room around it. Sized by the layout until a dimension is typed
 *  or the corner grip dragged: the automatic numbers show as the fields'
 *  values, read off the rendered figure; typing one pins that dimension, an
 *  empty field (or its dot) frees it, "Automatic" frees both. */
export function PlotSizeRows({ ed }: { ed: StyleEditor }) {
  const id = useId();
  const pinned = plotSizeMm(ed.style, ed.canvasDefaults);
  const auto = useAtomValue(autoPlotAreaAtom);
  const onChange = (s: PlotSizeMm | null) => ed.setStyle(setPlotSize(ed.style, s));
  const field = (key: keyof PlotSizeMm, label: string) => {
    const set = pinned?.[key] != null;
    const value = pinned?.[key] ?? auto?.[key];
    return (
      <Row key={key} label={label} labelFor={`${id}-${key}`} set={set}
        onReset={() => onChange({ ...pinned, [key]: undefined })}>
        {value != null
          ? <NumberField id={`${id}-${key}`} value={value} min={5} step={1} unit="mm"
              onCommit={(n) => onChange({ ...pinned, [key]: n })} />
          : <span className="insp-hint">—</span>}
      </Row>
    );
  };
  return (
    <>
      <Row label="Plot area">
        {pinned
          ? <button type="button" className="insp-btn" onClick={() => onChange(null)}
              title="Let the layout size the plot area again">Automatic</button>
          : <span className="insp-hint">Sized by the layout — type a size or drag the plot's corner</span>}
      </Row>
      {field("width", "Plot width")}{field("height", "Plot height")}
    </>
  );
}
