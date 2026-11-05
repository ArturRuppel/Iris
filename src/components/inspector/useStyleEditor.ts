import { useAtom, useAtomValue } from "jotai";
import { activePlottableAtom, styleRegistryAtom } from "../../state";
import type { StyleKnob, StyleOverrides } from "../../types";
import { resizeCanvas } from "../../plotArea";

/** Where a knob reads and writes. Figure-scope knobs live at `style.<key>`.
 *  A geom knob lives at `style.geoms.<geom>.<key>` (shared by every layer of
 *  that geom) or, when `layerId` is given (item K: the geom appears more than
 *  once), at `style.layers.<layerId>.<key>` for that one instance. */
export interface KnobTarget { geom?: string; layerId?: string }

export type StyleEditor = ReturnType<typeof useStyleEditor>;

/** Read/write access to the active plot's style overrides, mirroring the
 *  engine's 3-tier resolve (registry default → geoms.<geom> → layers.<id>). */
export function useStyleEditor() {
  const [active, setActive] = useAtom(activePlottableAtom);
  const registry = useAtomValue(styleRegistryAtom);
  const style: StyleOverrides = active?.style ?? {};

  const setStyle = (next: StyleOverrides) => {
    if (active) setActive({ ...active, style: next });
  };

  const setFigure = (patch: StyleOverrides) => {
    const next: Record<string, unknown> = { ...style, ...patch };
    for (const k of Object.keys(next))
      if (next[k] === undefined || next[k] === "") delete next[k];
    setStyle(next as StyleOverrides);
  };

  const setGeom = (geom: string, key: string, value: unknown) => {
    const geoms = { ...(style.geoms ?? {}) };
    const dest = { ...(geoms[geom] ?? {}) };
    if (value === undefined || value === "") delete dest[key];
    else dest[key] = value;
    geoms[geom] = dest;
    setStyle({ ...style, geoms } as StyleOverrides);
  };

  const setLayer = (layerId: string, key: string, value: unknown) => {
    const layers = { ...(style.layers ?? {}) };
    const dest = { ...(layers[layerId] ?? {}) };
    if (value === undefined || value === "") delete dest[key];
    else dest[key] = value;
    if (Object.keys(dest).length) layers[layerId] = dest;
    else delete layers[layerId];
    setStyle({ ...style, layers } as StyleOverrides);
  };

  const figVal = (key: string, def: unknown): unknown =>
    (style as Record<string, unknown>)[key] ?? def;

  const geomVal = (geom: string, key: string, def: unknown, layerId?: string): unknown => {
    if (layerId && style.layers?.[layerId]?.[key] !== undefined)
      return style.layers[layerId][key];
    return style.geoms?.[geom]?.[key] ?? def;
  };

  const read = (knob: StyleKnob, t: KnobTarget = {}): unknown =>
    knob.scope === "geom" && t.geom
      ? geomVal(t.geom, knob.key, knob.default, t.layerId)
      : figVal(knob.key, knob.default);

  /** the knob is overridden at the tier this control edits */
  const isSet = (knob: StyleKnob, t: KnobTarget = {}): boolean => {
    if (knob.scope === "geom" && t.geom) {
      if (t.layerId) return style.layers?.[t.layerId]?.[knob.key] !== undefined;
      return style.geoms?.[t.geom]?.[knob.key] !== undefined;
    }
    return (style as Record<string, unknown>)[knob.key] !== undefined;
  };

  /* the canvas defaults the engine fills in (registry), for mm conversions */
  const canvasDefaults = {
    w: Number(registry.find((k) => k.key === "width_mm")?.default ?? 140),
    h: Number(registry.find((k) => k.key === "height_mm")?.default ?? 100),
  };

  /** write a knob; `undefined` (or "") deletes the override, back to default */
  const write = (knob: StyleKnob, value: unknown, t: KnobTarget = {}) => {
    if (!active) return;
    if (knob.key === "width_mm" || knob.key === "height_mm") {
      /* a canvas change keeps a pinned plot area's size in mm */
      const v = value === undefined || value === "" ? undefined : Number(value);
      const w = knob.key === "width_mm" ? v : style.width_mm;
      const h = knob.key === "height_mm" ? v : style.height_mm;
      setStyle(resizeCanvas(style, w, h, canvasDefaults));
      return;
    }
    if (knob.scope === "geom" && t.geom) {
      if (t.layerId) setLayer(t.layerId, knob.key, value);
      else setGeom(t.geom, knob.key, value);
    } else setFigure({ [knob.key]: value } as StyleOverrides);
  };

  /** the knob's visible_when predicate, read in the same scope/tier */
  const visible = (knob: StyleKnob, t: KnobTarget = {}): boolean => {
    const vw = knob.visible_when;
    if (!vw) return true;
    const ref = registry.find((k) => k.key === vw.key
      && k.scope === knob.scope
      && (knob.scope === "figure" || k.group === knob.group))
      ?? ({ key: vw.key, default: undefined } as StyleKnob);
    const v = read(ref, t);
    if ("equals" in vw) return v === vw.equals;
    if ("not_equals" in vw) return v !== vw.not_equals;
    return true;
  };

  /** the figure-scope knob for a key (figure keys are unique in the registry) */
  const figureKnob = (key: string) =>
    registry.find((k) => k.key === key && k.scope === "figure");

  return {
    active, registry, style, canvasDefaults,
    setStyle, setFigure, read, write, isSet, visible, figureKnob,
  };
}
