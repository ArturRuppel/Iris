/* Phase 3 — data-first encodings.
 *
 * The figure is no longer chosen by picking a plot type that secretly sets a
 * `family`; instead the user maps columns to channels and the *column types*
 * drive (a) which primitives are offerable, (b) the derived stats family, and
 * (c) which channel/type pairs the engine can render today. This module holds
 * the pure helpers behind that inversion: the support matrix, the family
 * selector, and the offer/gate rules. No React, no atoms — just data + logic so
 * the rules live in one place and can't drift between UI and spec.
 */
import type { ColumnDef, GeomMeta, Registry, Schema, StatsFamily } from "./types";

/* the two column types a channel can carry; "identifier" columns are never
   mapped to a visual channel, so they don't appear here */
export type ColType = "categorical" | "numeric";
export type Channel = "x" | "y" | "color" | "size" | "shape";

/* What the engine RENDERS today, per channel × column type. `true` = drawn;
   `{reason}` = a mapping we let the user express but can't draw yet (shown
   disabled-with-reason); a missing key = not applicable to that channel at all
   (e.g. categorical size — size is continuous marker area, full stop).
   This is the single place a later chunk (3b–3d) flips a flag, and it is kept
   in sync with the engine guard (engine/iris_engine/guards.py UNRENDERABLE). */
export type Support = true | { reason: string };
export const RENDERABLE: Record<Channel, Partial<Record<ColType, Support>>> = {
  x: { categorical: true, numeric: true },
  y: { categorical: { reason: "needs a horizontal or tile geom (3c/3d)" },
       numeric: true },
  color: { categorical: true,
           numeric: { reason: "continuous color coming soon (3b)" } },
  size: { numeric: true }, // categorical size is not offered at all
  shape: { categorical: true,
           numeric: { reason: "shape can't be continuous" } },
};

/* the type of a column in a schema, or null when the column is absent/unmapped
   or an identifier (never a visual channel). */
export function colType(schema: Schema | null, name: string): ColType | null {
  if (!schema || !name) return null;
  const c = schema.columns.find((c) => c.name === name);
  return c && (c.type === "numeric" || c.type === "categorical") ? c.type : null;
}

/* the derived stats family — the label the stats engine reads — computed from
   the mapped axis types rather than stored on the plottable. The fall-through
   ("none") is the describe-only case: a combination the geoms might draw but the
   stats engine can't read (e.g. categorical-vs-categorical). */
export function familyFor(
  xType: ColType | null, yType: ColType | null,
): StatsFamily | "none" {
  if (yType !== "numeric") return "none";
  if (xType === "categorical") return "group_comparison";
  if (xType === "numeric") return "correlation";
  if (xType === null) return "descriptive";
  return "none";
}

/* the axis types of a plottable's current mappings (x may be empty = absent). */
export function axisTypes(
  mappings: { x: string; y: string }, schema: Schema | null,
): { xType: ColType | null; yType: ColType | null } {
  return { xType: colType(schema, mappings.x), yType: colType(schema, mappings.y) };
}

/* the family of a plottable's current mappings; a real StatsFamily (never
   "none") for the spec's stats clause and TEST_BY_FAMILY lookups, falling back
   to "descriptive" for the degenerate describe-only case. The engine re-derives
   the model from the encodings regardless, so this only feeds the serialized
   recommendation/test choice. */
export function familyForMappings(
  mappings: { x: string; y: string }, schema: Schema | null,
): StatsFamily {
  const { xType, yType } = axisTypes(mappings, schema);
  const f = familyFor(xType, yType);
  return f === "none" ? "descriptive" : f;
}

/* --- the offer rule (§4): a channel offers a column type iff some installed
   geom consumes that type on that channel. For x/y this is registry-derived, so
   adding a geom (e.g. a tile with y_type "categorical") makes Y offer
   categoricals with no UI change. For the aesthetic channels the registry only
   says *which* channels a geom takes (its `aes`), so type acceptance comes from
   the support matrix above. --- */
function geomConsumes(geoms: Record<string, GeomMeta>, axis: "x" | "y", type: ColType): boolean {
  return Object.values(geoms).some((g) => (axis === "x" ? g.x_type : g.y_type) === type);
}

export function isOfferable(reg: Registry | null, channel: Channel, type: ColType): boolean {
  if (channel === "x" || channel === "y") {
    // before the registry loads, offer both so the pickers aren't empty
    return reg ? geomConsumes(reg.geoms, channel, type) : true;
  }
  return type in RENDERABLE[channel];
}

/* renderability for an offerable mapping: "ok" (drawn), {reason} (offerable but
   not renderable today → disabled-with-reason), or null (not offerable). */
export function renderStatus(
  reg: Registry | null, channel: Channel, type: ColType,
): "ok" | { reason: string } | null {
  if (!isOfferable(reg, channel, type)) return null;
  const r = RENDERABLE[channel][type];
  return r === true ? "ok" : (r ?? null);
}

/* --- primitive gating (§"Frontend: primitive gating"): a geom is enabled iff
   the current (xType, yType) satisfies its (x_type, y_type) requirement.
   Returns null when compatible, else a teaching reason for the disabled state. --- */
function typeSatisfied(required: string, actual: ColType | null): boolean {
  if (required === "none") return actual === null;
  return required === actual;
}

function axisReason(axis: "X" | "Y", required: string): string {
  if (required === "none") return `needs ${axis} empty`;
  return `needs a ${required} ${axis}`;
}

export function geomGateReason(
  meta: GeomMeta, xType: ColType | null, yType: ColType | null,
): string | null {
  if (!typeSatisfied(meta.x_type, xType)) return axisReason("X", meta.x_type);
  if (!typeSatisfied(meta.y_type, yType)) return axisReason("Y", meta.y_type);
  return null;
}

/* the columns offerable on a channel, split into selectable (renderable) and
   disabled-with-reason (offerable but not drawn today). Identifier columns are
   excluded by colType returning null. */
export function offeredColumns(
  reg: Registry | null, channel: Channel, columns: ColumnDef[],
): { selectable: ColumnDef[]; disabled: { col: ColumnDef; reason: string }[] } {
  const selectable: ColumnDef[] = [];
  const disabled: { col: ColumnDef; reason: string }[] = [];
  for (const c of columns) {
    const t = c.type === "numeric" || c.type === "categorical" ? c.type : null;
    if (!t) continue;
    const st = renderStatus(reg, channel, t);
    if (st === "ok") selectable.push(c);
    else if (st) disabled.push({ col: c, reason: st.reason });
  }
  return { selectable, disabled };
}
