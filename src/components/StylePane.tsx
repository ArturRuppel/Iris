import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  activePlottableAtom, analysisAtom, DEFAULT_PALETTE, effectiveSchemaAtom,
  styleRegistryAtom, styleClipboardAtom, styleLibraryAtom,
} from "../state";
import { familyForMappings } from "../channels";
import type { Geom, StyleKnob, StyleOverrides } from "../types";
import { captureStyle, serializeStyleSheet, parseStyleSheet } from "../style/sheet";
import type { StyleSheet } from "../style/sheet";
import { fileToBase64 } from "../types";

const PRESET_SWATCHES = [
  "#0e7490", "#c2410c", "#4d7c0f", "#7c3aed", "#be123c", "#0369a1",
  "#a16207", "#15803d", "#9333ea", "#b91c1c", "#0891b2", "#475569",
];

/* human-readable group labels for registry group keys */
const GROUP_LABELS: Record<string, string> = {
  figure: "Size & frame",
  axes: "Axes & ticks",
  text: "Text",
  annotations: "Annotations",
};

/** Generic registry-driven style pane.
 *
 *  Every control is rendered from the style_registry served by /health.
 *  Figure-scope knobs write `style.<key>`; geom-scope knobs write
 *  `style.geoms.<geom>.<key>`. The registry declares groups, widgets,
 *  defaults, and visibility predicates — the pane is just a renderer. */
export function StylePane() {
  const [active, setActive] = useAtom(activePlottableAtom);
  const registry = useAtomValue(styleRegistryAtom);
  const [colorMenu, setColorMenu] = useState<{ anchor: DOMRect; index: number } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [popPos, setPopPos] = useState<{ left: number; top: number } | null>(null);
  const style = active?.style ?? {};
  const analysis = useAtomValue(analysisAtom);
  const schema = useAtomValue(effectiveSchemaAtom);
  const family = active ? familyForMappings(active.mappings, schema) : "group_comparison";
  const grouped = family === "group_comparison";
  const marks = new Set((active?.layers ?? []).map((l) => l.geom));

  /* ---- style sheet hooks ---- */
  const [clipboard, setClipboard] = useAtom(styleClipboardAtom);
  const [librarySheets, setLibrarySheets] = useAtom(styleLibraryAtom);
  const [saveName, setSaveName] = useState("");
  const [showSave, setShowSave] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  /* ---- writers ---- */

  const setFigure = (patch: StyleOverrides) => {
    if (!active) return;
    const next: Record<string, unknown> = { ...style, ...patch };
    for (const k of Object.keys(next))
      if (next[k] === undefined || next[k] === "") delete next[k];
    setActive({ ...active, style: next as StyleOverrides });
  };

  const setGeom = (geom: string, key: string, value: unknown) => {
    if (!active) return;
    const geoms = { ...(style.geoms ?? {}) };
    const dest = { ...(geoms[geom] ?? {}) };
    if (value === undefined || value === "") delete dest[key];
    else dest[key] = value;
    geoms[geom] = dest;
    setActive({ ...active, style: { ...style, geoms } as StyleOverrides });
  };

  /* ---- read helpers ---- */

  const figVal = (key: string, def: unknown): unknown =>
    (style as Record<string, unknown>)[key] ?? def;

  const geomVal = (geom: string, key: string, def: unknown): unknown =>
    style.geoms?.[geom]?.[key] ?? def;

  const readVal = (knob: StyleKnob, geom?: string): unknown =>
    knob.scope === "geom" && geom
      ? geomVal(geom, knob.key, knob.default)
      : figVal(knob.key, knob.default);

  const writeVal = (knob: StyleKnob, value: unknown, geom?: string) => {
    if (knob.scope === "geom" && geom) setGeom(geom, knob.key, value);
    else setFigure({ [knob.key]: value } as StyleOverrides);
  };

  /* ---- color swatch helpers (palette is a special figure-scope knob) ---- */

  const seriesNames = grouped ? (analysis?.stats.levels ?? []) : ["Series"];
  const palette = (style.palette ?? DEFAULT_PALETTE) as string[];
  const colorOf = (i: number) => palette[i % palette.length];
  const setColor = (i: number, color: string) =>
    setFigure({ palette: seriesNames.map((_, k) => (k === i ? color : colorOf(k))) });

  useLayoutEffect(() => {
    if (!colorMenu || !popRef.current) { setPopPos(null); return; }
    const M = 8;
    const { width, height } = popRef.current.getBoundingClientRect();
    const a = colorMenu.anchor;
    let top = a.bottom + 4;
    if (top + height > window.innerHeight - M)
      top = Math.max(M, a.top - 4 - height);
    let left = a.left;
    if (left + width > window.innerWidth - M)
      left = Math.max(M, window.innerWidth - M - width);
    setPopPos({ left, top });
  }, [colorMenu]);

  /* ---- visibility gating ---- */

  const isVisible = (knob: StyleKnob, geom?: string): boolean => {
    const vw = knob.visible_when;
    if (!vw) return true;
    const ref = readVal(
      registry.find((k) => k.key === vw.key
        && k.scope === knob.scope
        && (knob.scope === "figure" || k.group === knob.group)) ?? { key: vw.key, default: undefined } as StyleKnob,
      geom,
    );
    if ("equals" in vw) return ref === vw.equals;
    if ("not_equals" in vw) return ref !== vw.not_equals;
    return true;
  };

  /* ---- group the registry into (group → knobs[]) ---- */

  const { figGroups, geomGroups } = useMemo(() => {
    const fg: Record<string, StyleKnob[]> = {};
    const gg: Record<string, StyleKnob[]> = {};
    for (const knob of registry) {
      if (knob.scope === "figure") {
        (fg[knob.group] ??= []).push(knob);
      } else {
        (gg[knob.group] ??= []).push(knob);
      }
    }
    return { figGroups: fg, geomGroups: gg };
  }, [registry]);

  /* ---- generic knob renderer ---- */

  const num = (v: string) => (v === "" ? undefined : Number(v));

  const renderKnob = (knob: StyleKnob, geom?: string) => {
    if (!isVisible(knob, geom)) return null;
    const cur = readVal(knob, geom);
    const w = knob.widget;

    if (w.type === "swatch") {
      // palette swatch — custom rendering
      return seriesNames.map((name, i) => (
        <label key={`${knob.key}-${name}`}>{name}
          <button type="button" className="color-swatch-btn"
            style={{ background: colorOf(i) }}
            onClick={(e) =>
              setColorMenu({ anchor: e.currentTarget.getBoundingClientRect(), index: i })} />
        </label>
      ));
    }

    if (w.type === "text") {
      return (
        <label key={knob.key}>{knob.label}
          <input type="text" placeholder={knob.default === "" ? (knob.key === "title" ? "none" : "auto") : String(knob.default ?? "")}
            value={String(cur ?? "")}
            onChange={(e) => writeVal(knob, e.target.value || undefined, geom)} />
        </label>
      );
    }

    if (w.type === "bool") {
      return (
        <label key={knob.key}>
          <input type="checkbox" checked={Boolean(cur ?? knob.default)}
            onChange={(e) => writeVal(knob, e.target.checked, geom)} />
          {knob.label}
        </label>
      );
    }

    if (w.type === "select") {
      return (
        <label key={knob.key}>{knob.label}
          <select value={String(cur ?? knob.default ?? "")}
            onChange={(e) => writeVal(knob, e.target.value, geom)}>
            {(w.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      );
    }

    if (w.type === "number") {
      const isRange = w.min != null && w.max != null;
      const val = cur != null ? Number(cur) : (knob.default != null ? Number(knob.default) : "");
      if (isRange) {
        return (
          <label key={knob.key}>{knob.label}
            <input type="range" min={w.min} max={w.max} step={w.step ?? 1}
              value={Number(val || 0)}
              onChange={(e) => writeVal(knob, Number(e.target.value), geom)} />
            <span className="dim">{typeof val === "number" ? (Number.isInteger(w.step ?? 1) ? val : val.toFixed(2)) : ""}</span>
          </label>
        );
      }
      return (
        <label key={knob.key}>{knob.label}
          <input type="number" min={w.min} max={w.max} step={w.step ?? "any"}
            placeholder="auto"
            value={val === "" || val == null ? "" : val}
            onChange={(e) => writeVal(knob, num(e.target.value), geom)} />
        </label>
      );
    }

    return null;
  };

  /* ---- determine which geom groups are relevant (active layers) ---- */

  const activeGeomGroups = useMemo(() => {
    const out: { group: string; geom: string; knobs: StyleKnob[] }[] = [];
    for (const [group, knobs] of Object.entries(geomGroups)) {
      // group key = the geom name (dot, box, scatter, etc.)
      const geom = group;
      if (marks.has(geom as Geom)) {
        out.push({ group, geom, knobs });
      }
    }
    return out;
  }, [geomGroups, marks]);

  const dirty = Object.keys(style).length > 0;

  /* ---- style sheet actions ---- */

  function doSaveAsStyle() {
    if (!active) return;
    const name = saveName.trim();
    if (!name) return;
    const sheet: StyleSheet = {
      iris_style_version: "1.0",
      name,
      style: captureStyle(active.style, registry),
    };
    setLibrarySheets([...librarySheets, sheet]);
    setShowSave(false);
    setSaveName("");
  }

  function doExport() {
    if (!active) return;
    const sheet: StyleSheet = {
      iris_style_version: "1.0",
      name: active.name,
      style: captureStyle(active.style, registry),
    };
    const json = serializeStyleSheet(sheet);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${active.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.iris-style`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function doImport(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const sheet = parseStyleSheet(reader.result as string);
        setClipboard(sheet);
        // offer to save — for now, just put it on the clipboard so the user
        // can paste it from the sidebar context menu.
      } catch (e) {
        console.error("Failed to import .iris-style:", e);
      }
    };
    reader.readAsText(file);
  }

  return (
    <details className="style-pane">
      <summary>Style{dirty && <em className="dim"> · customized</em>}</summary>

      <div className="style-groups">
        {Object.entries(figGroups).map(([group, knobs]) => (
          <fieldset key={group}>
            <legend>{GROUP_LABELS[group] ?? group}</legend>
            {knobs.map((k) => renderKnob(k))}
          </fieldset>
        ))}

        {activeGeomGroups.map(({ group, geom, knobs }) => (
          <fieldset key={group}>
            <legend>{group} options</legend>
            {knobs.map((k) => renderKnob(k, geom))}
          </fieldset>
        ))}
      </div>

      <div className="btn-row style-foot">
        <button onClick={() => setFigure({ offsets: undefined })}
          disabled={!style.offsets || Object.keys(style.offsets).length === 0}>
          Reset label positions
        </button>
        <button onClick={() => active && setActive({ ...active, style: {} })} disabled={!dirty}>Reset all</button>
      </div>

      <div className="btn-row style-foot">
        {showSave ? (
          <span className="save-style-inline">
            <input type="text" placeholder="Style name…" value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doSaveAsStyle(); else if (e.key === "Escape") setShowSave(false); }}
              autoFocus />
            <button disabled={!saveName.trim()} onClick={doSaveAsStyle}>Save</button>
            <button onClick={() => setShowSave(false)}>Cancel</button>
          </span>
        ) : (
          <button onClick={() => setShowSave(true)}>Save as style…</button>
        )}
        <button onClick={doExport}>Export…</button>
        <button onClick={() => importRef.current?.click()}>Import…</button>
        <input ref={importRef} type="file" accept=".iris-style,.json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) doImport(f);
            e.target.value = "";
          }} />
      </div>

      {colorMenu && (
        <>
          <div className="menu-backdrop" onClick={() => setColorMenu(null)} />
          <div ref={popRef} className="context-menu color-popover"
            style={{ left: popPos?.left ?? colorMenu.anchor.left, top: popPos?.top ?? colorMenu.anchor.bottom + 4,
              visibility: popPos ? "visible" : "hidden" }}>
            <input type="text" className="color-hex" value={colorOf(colorMenu.index)}
              onChange={(e) => setColor(colorMenu.index, e.target.value)} />
            <div className="color-swatch-grid">
              {PRESET_SWATCHES.map((c) => (
                <button key={c} type="button" className="color-swatch-btn"
                  style={{ background: c }}
                  onClick={() => { setColor(colorMenu.index, c); setColorMenu(null); }} />
              ))}
            </div>
            <button onClick={() => setColorMenu(null)}>Done</button>
          </div>
        </>
      )}
    </details>
  );
}
