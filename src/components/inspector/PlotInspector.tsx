import { forwardRef, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { atom, useAtom } from "jotai";
import { styleClipboardAtom, styleLibraryAtom } from "../../state";
import type { StyleKnob } from "../../types";
import { captureStyle, serializeStyleSheet, parseStyleSheet } from "../../style/sheet";
import type { StyleSheet } from "../../style/sheet";
import { EncodingsCard } from "../EncodingsCard";
import { LayerStrip } from "../LayerStrip";
import { INSPECTOR_TABS, tabFor, type InspectorTab } from "./knobs";
import { KnobInput, KnobRow, PaletteRows, PlotSizeRows, ResetDot, useAnchoredPos } from "./KnobControls";
import { useStyleEditor, type StyleEditor } from "./useStyleEditor";

/** The inspector's selected tab, kept for the session (default Encoding). */
export const inspectorTabAtom = atom<InspectorTab>("encoding");

/* the figure-scope knobs a tab lays out by hand; any other knob of that tab is
   appended after them, so a new registry knob still shows up somewhere. */
const AXIS_PAIRS: { label: string; x: string; y: string | null }[] = [
  { label: "Scale", x: "x_scale", y: "y_scale" },
  { label: "Min", x: "x_min", y: "y_min" },
  { label: "Max", x: "x_max", y: "y_max" },
  { label: "Tick every", x: "x_tick_spacing", y: "y_tick_spacing" },
  { label: "Ticks on", x: "x_tick_side", y: "y_tick_side" },
  { label: "Rotation", x: "x_tick_rotation", y: null },
  { label: "Grid", x: "grid_x", y: "grid_y" },
];
const AXES_BELOW = ["tick_direction", "tick_length", "minor_ticks", "frame"];
const TEXT_TOP = ["title", "x_label", "y_label", "font_pt"];
const LAYOUT_TOP = ["width_mm", "height_mm"];
const PLOT_SIZE = ["plot_w_mm", "plot_h_mm"];
const LAYOUT_BELOW = ["axis_linewidth", "line_width"];
const PLACED = new Set([
  ...AXIS_PAIRS.flatMap((p) => [p.x, p.y]).filter((k): k is string => !!k),
  ...AXES_BELOW, ...TEXT_TOP, ...LAYOUT_TOP, ...PLOT_SIZE, ...LAYOUT_BELOW, "palette",
]);

/** figure-scope knobs of a tab that no hand-laid row places */
const leftovers = (registry: StyleKnob[], tab: InspectorTab) =>
  registry.filter((k) => k.scope === "figure" && tabFor(k) === tab && !PLACED.has(k.key));

function Rows({ keys, ed }: { keys: string[]; ed: StyleEditor }) {
  return <>{keys.map((key) => {
    const k = ed.figureKnob(key);
    return k ? <KnobRow key={key} knob={k} ed={ed} /> : null;
  })}</>;
}

function KnobList({ knobs, ed }: { knobs: StyleKnob[]; ed: StyleEditor }) {
  return <>{knobs.map((k) => <KnobRow key={k.key} knob={k} ed={ed} />)}</>;
}

/* ---- Axes: X | Y grid ---- */

function AxisCell({ keyName, ed, labelledBy }: { keyName: string | null; ed: StyleEditor; labelledBy: string }) {
  const k = keyName ? ed.figureKnob(keyName) : undefined;
  if (!k) return <div className="insp-cell insp-none" aria-hidden>—</div>;
  if (!ed.visible(k)) return <div className="insp-cell" />;
  return (
    <div className="insp-cell">
      {ed.isSet(k) && <ResetDot onReset={() => ed.write(k, undefined)} what={k.label} />}
      <KnobInput knob={k} ed={ed} labelledBy={labelledBy} fill />
    </div>
  );
}

function AxesTab({ ed }: { ed: StyleEditor }) {
  const id = useId();
  const rows = AXIS_PAIRS.filter((p) => ed.figureKnob(p.x) || (p.y && ed.figureKnob(p.y)));
  return (
    <>
      <div className="insp-grid" role="table" aria-label="Axes">
        <div className="insp-grid-row insp-grid-head" role="row">
          <span role="columnheader" />
          <span role="columnheader" id={`${id}-x`}>X</span>
          <span role="columnheader" id={`${id}-y`}>Y</span>
        </div>
        {rows.map((p, i) => (
          <div className="insp-grid-row" role="row" key={p.label}>
            <span className="insp-label" role="rowheader" id={`${id}-r${i}`}>{p.label}</span>
            <AxisCell keyName={p.x} ed={ed} labelledBy={`${id}-r${i} ${id}-x`} />
            <AxisCell keyName={p.y} ed={ed} labelledBy={`${id}-r${i} ${id}-y`} />
          </div>
        ))}
      </div>
      <Rows keys={AXES_BELOW} ed={ed} />
      <KnobList knobs={leftovers(ed.registry, "axes")} ed={ed} />
    </>
  );
}

function TextTab({ ed }: { ed: StyleEditor }) {
  const rest = leftovers(ed.registry, "text");
  const annotations = rest.filter((k) => k.group === "annotations");
  const other = rest.filter((k) => k.group !== "annotations");
  return (
    <>
      <Rows keys={TEXT_TOP} ed={ed} />
      <KnobList knobs={other} ed={ed} />
      {annotations.length > 0 && <div className="insp-sec"><span>Annotations</span></div>}
      <KnobList knobs={annotations} ed={ed} />
    </>
  );
}

function LayoutTab({ ed }: { ed: StyleEditor }) {
  const offsets = ed.style.offsets;
  return (
    <>
      <Rows keys={LAYOUT_TOP} ed={ed} />
      <PlotSizeRows ed={ed} />
      <Rows keys={LAYOUT_BELOW} ed={ed} />
      <KnobList knobs={leftovers(ed.registry, "layout")} ed={ed} />
      <div className="insp-foot">
        <button type="button" className="insp-btn"
          onClick={() => ed.setFigure({ offsets: undefined })}
          disabled={!offsets || Object.keys(offsets).length === 0}>
          Reset label positions
        </button>
      </div>
    </>
  );
}

function EncodingTab({ ed }: { ed: StyleEditor }) {
  const palette = ed.figureKnob("palette");
  return (
    <>
      <EncodingsCard />
      {palette && <PaletteRows knob={palette} ed={ed} />}
      <KnobList knobs={leftovers(ed.registry, "encoding")} ed={ed} />
    </>
  );
}

/* ---- the ⋯ menu: style-sheet actions ---- */

function StyleMenu({ ed }: { ed: StyleEditor }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const pos = useAnchoredPos(anchor, menuRef, "end");
  const [, setClipboard] = useAtom(styleClipboardAtom);
  const [library, setLibrary] = useAtom(styleLibraryAtom);
  const { active, registry } = ed;
  const dirty = Object.keys(ed.style).length > 0;
  const close = () => { setAnchor(null); setSaving(false); setName(""); };

  const saveAsStyle = () => {
    if (!active || !name.trim()) return;
    const sheet: StyleSheet = { iris_style_version: "1.0", name: name.trim(),
      style: captureStyle(active.style, registry) };
    setLibrary([...library, sheet]);
    close();
  };
  const exportSheet = () => {
    if (!active) return;
    const sheet: StyleSheet = { iris_style_version: "1.0", name: active.name,
      style: captureStyle(active.style, registry) };
    const blob = new Blob([serializeStyleSheet(sheet)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${active.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.iris-style`;
    a.click();
    URL.revokeObjectURL(url);
    close();
  };
  const importSheet = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        // onto the style clipboard, to paste from the sidebar's context menu
        setClipboard(parseStyleSheet(reader.result as string));
      } catch (e) {
        console.error("Failed to import .iris-style:", e);
      }
    };
    reader.readAsText(file);
  };

  return (
    <>
      <button type="button" className="insp-more" title="Style sheet actions"
        aria-label="Style sheet actions" aria-haspopup="menu" aria-expanded={!!anchor}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())}>⋯</button>
      <input ref={importRef} type="file" accept=".iris-style,.json" hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importSheet(f);
          e.target.value = "";
        }} />
      {anchor && (
        <>
          <div className="menu-backdrop" onClick={close} />
          <div ref={menuRef} role="menu" className="context-menu insp-menu"
            style={{ left: pos?.left ?? anchor.left, top: pos?.top ?? anchor.bottom + 4,
              visibility: pos ? "visible" : "hidden" }}>
            {saving ? (
              <div className="save-style-inline">
                <input type="text" placeholder="Style name…" value={name} autoFocus
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveAsStyle(); else if (e.key === "Escape") close(); }} />
                <button disabled={!name.trim()} onClick={saveAsStyle}>Save</button>
              </div>
            ) : (
              <>
                <button role="menuitem" disabled={!dirty}
                  onClick={() => { ed.setStyle({}); close(); }}>Reset all</button>
                <button role="menuitem" onClick={() => setSaving(true)}>Save as style…</button>
                <button role="menuitem" onClick={exportSheet}>Export…</button>
                <button role="menuitem" onClick={() => { importRef.current?.click(); close(); }}>Import…</button>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}

/** The plot card's inspector: one tab bar, then flat label | control rows.
 *  Everything is drawn from the style registry (see ./knobs.ts for which tab
 *  and control each knob gets); writes follow the engine's 3-tier style. */
export const PlotInspector = forwardRef<HTMLDivElement, { addLayer: ReactNode }>(
  function PlotInspector({ addLayer }, ref) {
    const [tab, setTab] = useAtom(inspectorTabAtom);
    const ed = useStyleEditor();
    const id = useId();
    return (
      <div className="plot-inspector" ref={ref}>
        <div className="insp-bar">
          <div className="insp-tabs" role="tablist" aria-label="Plot settings">
            {INSPECTOR_TABS.map((t) => (
              <button key={t.id} type="button" role="tab" id={`${id}-${t.id}`}
                aria-selected={tab === t.id} aria-controls={`${id}-panel`}
                onClick={() => setTab(t.id)}>{t.label}</button>
            ))}
          </div>
          <StyleMenu ed={ed} />
        </div>
        <div className="insp-panel" role="tabpanel" id={`${id}-panel`}
          aria-labelledby={`${id}-${tab}`} data-tab={tab}>
          {tab === "encoding" && <EncodingTab ed={ed} />}
          {tab === "layers" && <LayerStrip addSlot={addLayer} />}
          {tab === "axes" && <AxesTab ed={ed} />}
          {tab === "text" && <TextTab ed={ed} />}
          {tab === "layout" && <LayoutTab ed={ed} />}
        </div>
      </div>
    );
  },
);
