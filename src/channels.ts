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

/* the two column types a channel can carry. "identifier" columns are not a
   ColType: they never drive axes/stats and aren't mapped to most channels. The
   one exception is color, where a spine identifier is treated as a discrete
   categorical (see offeredColumns) so per-grain dots can be colored by grain. */
export type ColType = "categorical" | "numeric";
export type Channel = "x" | "y" | "color" | "size" | "shape"
                     | "facet_row" | "facet_col";

/* What the engine RENDERS today, per channel × column type. `true` = drawn;
   `{reason}` = a mapping we let the user express but can't draw yet (shown
   disabled-with-reason); a missing key = not applicable to that channel at all
   (e.g. categorical size — size is continuous marker area, full stop).
   This is the single place a later chunk (3b–3d) flips a flag, and it is kept
   in sync with the engine guard (engine/iris_engine/guards.py UNRENDERABLE). */
export type Support = true | { reason: string };
export const RENDERABLE: Record<Channel, Partial<Record<ColType, Support>>> = {
  x: { categorical: true, numeric: true },
  // Phase 3c: categorical y is now renderable via horizontal group-comparison geoms
  y: { categorical: true, numeric: true },
  color: { categorical: true, numeric: true }, // numeric → continuous colormap (3b)
  size: { numeric: true }, // categorical size is not offered at all
  shape: { categorical: true,
           numeric: { reason: "shape can't be continuous" } },
  // Phase 4: small multiples — categorical-only, no numeric faceting in v1
  facet_row: { categorical: true },
  facet_col: { categorical: true },
};

/* the type of a column in a schema, or null when the column is absent/unmapped
   or an identifier (never a visual channel). */
export function colType(schema: Schema | null, name: string): ColType | null {
  if (!schema || !name) return null;
  const c = schema.columns.find((c) => c.name === name);
  if (!c) return null;
  // a bool is a stochastic-event flag: it plots/analyzes as numeric 1/0 (the
  // fraction of trues), so every channel treats it as numeric.
  if (c.type === "numeric" || c.type === "bool") return "numeric";
  return c.type === "categorical" ? "categorical" : null;
}

/* the derived stats family — the label the stats engine reads — computed from
   the mapped axis types rather than stored on the plottable. The fall-through
   ("none") is the describe-only case: a combination the geoms might draw but the
   stats engine can't read (e.g. categorical-vs-categorical).
   Phase 3c adds the horizontal case: numeric x + categorical y is still a
   group comparison (the grouping factor is y; the measurement is x). */
export function familyFor(
  xType: ColType | null, yType: ColType | null,
): StatsFamily | "none" {
  if (xType === "categorical" && yType === "numeric") return "group_comparison";
  // Phase 3c: horizontal orientation
  if (xType === "numeric" && yType === "categorical") return "group_comparison";
  if (xType === "numeric" && yType === "numeric") return "correlation";
  if (xType === null && yType === "numeric") return "descriptive";
  // categorical × categorical → contingency tile + chi-square / Fisher (§5)
  if (xType === "categorical" && yType === "categorical") return "contingency";
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

/* As familyForMappings, but honoring an explicit vs-reference (one-sample) opt-in.
   The column types alone cannot tell a *location* test (each group's values vs a
   constant — chance/control/unity) from an ordinary group comparison: both are
   categorical-x / numeric-y. So `location` is the one family that is not
   type-derivable; the user pins it by setting a numeric `reference`, and only the
   shapes that support it — a numeric readout grouped by a categorical x, or an
   ungrouped single sample — flip to `location`. Any other mapping ignores the
   reference and keeps its derived family. Mirrors the engine, where
   `stats.family == "location"` overrides the otherwise-inferred group comparison
   (iris_engine/statmodel.infer). */
export function familyForMappingsRef(
  mappings: { x: string; y: string }, schema: Schema | null,
  reference: number | null,
): StatsFamily {
  const base = familyForMappings(mappings, schema);
  if (reference != null && (base === "group_comparison" || base === "descriptive"))
    return "location";
  return base;
}

/* --- the offer rule (§4): a channel offers a column type iff some installed
   geom consumes that type on that channel. For x/y this is registry-derived, so
   adding a geom (e.g. a tile with y_type "categorical") makes Y offer
   categoricals with no UI change. For the aesthetic channels the registry only
   says *which* channels a geom takes (its `aes`), so type acceptance comes from
   the support matrix above. --- */
function geomConsumes(geoms: Record<string, GeomMeta>, axis: "x" | "y", type: ColType): boolean {
  return Object.values(geoms).some((g) => {
    const primary = axis === "x" ? g.x_type : g.y_type;
    if (primary === type) return true;
    // Phase 3c: h_orient geoms also consume the swapped axis types so the offer
    // rule surfaces categorical Y and numeric X without new geom keys.
    if (g.h_orient) {
      if (axis === "y" && type === "categorical") return true;
      if (axis === "x" && type === "numeric") return true;
    }
    return false;
  });
}

export function isOfferable(reg: Registry | null, channel: Channel, type: ColType): boolean {
  if (channel === "x" || channel === "y") {
    // before the registry loads, offer both so the pickers aren't empty
    return reg ? geomConsumes(reg.geoms, channel, type) : true;
  }
  return type in RENDERABLE[channel];
}

/* A continuous (numeric) colour is a colormap over per-row values, so it renders
   only on a per-point geom (dot/scatter). An aggregate geom (box/violin/bar/
   summary) collapses rows and takes a categorical/identifier colour only — it
   dodges each x group into sub-marks (see `aes` in geoms.py). So numeric colour
   is renderable iff some active layer is a per-point geom that takes colour. */
function activeAcceptsNumericColor(activeGeoms: GeomMeta[]): boolean {
  return activeGeoms.some((g) => !g.aggregates && g.aes.includes("color"));
}

/* renderability for an offerable mapping: "ok" (drawn), {reason} (offerable but
   not renderable today → disabled-with-reason), or null (not offerable). When
   `activeGeoms` is given, a numeric colour is gated on the active layers having
   a per-point geom — box/violin/bar take a categorical/ID colour only. */
export function renderStatus(
  reg: Registry | null, channel: Channel, type: ColType,
  activeGeoms?: GeomMeta[],
): "ok" | { reason: string } | null {
  if (!isOfferable(reg, channel, type)) return null;
  if (channel === "color" && type === "numeric"
      && activeGeoms && activeGeoms.length > 0
      && !activeAcceptsNumericColor(activeGeoms)) {
    return { reason: "needs a point/scatter layer (box/violin/bar take a categorical color)" };
  }
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
  // Phase 3c: h_orient geoms also accept the horizontal pair (numeric x, categorical y)
  if (meta.h_orient && xType === "numeric" && yType === "categorical") return null;
  if (!typeSatisfied(meta.x_type, xType)) return axisReason("X", meta.x_type);
  if (!typeSatisfied(meta.y_type, yType)) return axisReason("Y", meta.y_type);
  return null;
}

/* --- geom-first entry point: a geom can be chosen *before* its axes are mapped,
   then it narrows what the encoding offers (the inverse of geomGateReason /
   the add-menu filter). The two helpers below power that direction. --- */

/* an axis requirement is satisfiable when the axis is still UNMAPPED (null — the
   geom will constrain it) or already matches; only a *mapped* wrong type fails. */
function axisSatisfiable(required: string, actual: ColType | null): boolean {
  return actual === null || typeSatisfied(required, actual);
}

/* Whether a geom can be ADDED given the (possibly empty) current encoding. Unlike
   geomGateReason, an unmapped axis doesn't block — so a fresh plottable with no
   columns mapped still offers every geom, and the user can pick a geom first.
   A geom is ruled out only when a mapped axis is the wrong type for every
   orientation the geom supports. */
export function geomAddable(
  meta: GeomMeta, xType: ColType | null, yType: ColType | null,
): boolean {
  const vertical = axisSatisfiable(meta.x_type, xType)
                && axisSatisfiable(meta.y_type, yType);
  if (!meta.h_orient) return vertical;
  // h_orient geoms also draw horizontally (numeric x, categorical y)
  const horizontal = axisSatisfiable("numeric", xType)
                  && axisSatisfiable("categorical", yType);
  return vertical || horizontal;
}

/* The column types an axis should offer once geoms are chosen — the geom→encoding
   narrowing. Union over the active geoms of the orientations they support; an
   h_orient geom adds the swapped orientation (vertical box = categorical x /
   numeric y; horizontal box = numeric x / categorical y).

   `otherType` is the type the OTHER axis currently carries. When it is given
   (the axis is mapped) only orientations whose other component matches it
   contribute — this preserves the *joint* X/Y constraint that a per-axis union
   would lose. The decisive case: with a box and a numeric X already mapped, the
   only consistent orientation is horizontal, so Y narrows to categorical alone
   and a numeric/numeric pair (which would silently fall through to a scatter)
   can never be expressed. When `otherType` is null/undefined (the other axis is
   unmapped) every orientation is still open. Empty when no geoms are present, so
   the caller falls back to the registry-wide offer rule (encoding-first). */
export function geomAxisColTypes(
  activeGeoms: GeomMeta[], axis: "x" | "y", otherType?: ColType | null,
): Set<ColType> {
  const out = new Set<ColType>();
  for (const g of activeGeoms) {
    // the (xType, yType) orientations this geom supports — vertical, plus the
    // swapped pair for h_orient geoms (horizontal group comparison).
    const pairs: [string, string][] = [[g.x_type, g.y_type]];
    if (g.h_orient) pairs.push([g.y_type, g.x_type]);
    for (const [px, py] of pairs) {
      const mine = axis === "x" ? px : py;
      const other = axis === "x" ? py : px;
      if (mine !== "categorical" && mine !== "numeric") continue; // "none": no offer
      // a mapped other axis must match this orientation for it to contribute;
      // unmapped (null/undefined) leaves every orientation open.
      if (otherType != null && other !== otherType) continue;
      out.add(mine);
    }
  }
  return out;
}

/* channels that treat a spine identifier (a replicate id like `date`) as a
   discrete categorical: color draws it as a palette and shape draws it as a
   marker cycle (both the superplot idiom of distinguishing per-grain marks by
   grain — and, mapped together, they merge into one per-grain legend), while the
   facets split a small-multiples grid by it (one panel per date/position). Every
   other channel excludes identifiers (colType returns null). High-cardinality ids
   are caught downstream — the palette-exhausted / marker-exhausted warning for
   color/shape, the blocking facet-cell cap. */
const ID_AS_CATEGORICAL: ReadonlySet<Channel> =
  new Set(["color", "shape", "facet_row", "facet_col"]);

/* the columns offerable on a channel, split into selectable (renderable) and
   disabled-with-reason (offerable but not drawn today). */
export function offeredColumns(
  reg: Registry | null, channel: Channel, columns: ColumnDef[],
  activeGeoms?: GeomMeta[],
): { selectable: ColumnDef[]; disabled: { col: ColumnDef; reason: string }[] } {
  const selectable: ColumnDef[] = [];
  const disabled: { col: ColumnDef; reason: string }[] = [];
  for (const c of columns) {
    const t: ColType | null =
      c.type === "numeric" || c.type === "bool" ? "numeric"
      : c.type === "categorical" ? "categorical"
      : c.type === "identifier" && ID_AS_CATEGORICAL.has(channel) ? "categorical"
      : null;
    if (!t) continue;
    const st = renderStatus(reg, channel, t, activeGeoms);
    if (st === "ok") selectable.push(c);
    else if (st) disabled.push({ col: c, reason: st.reason });
  }
  return { selectable, disabled };
}
