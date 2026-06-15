# Composable Grammar of Graphics — Phase 3: Data-First Encodings — Design Spec

Date: 2026-06-16

> This is the **third** grammar cycle, landing **before** Phase 4 (*Facets*) so
> faceting rides the cleaner encoding model rather than the reverse. Phases 1
> (*Layers*) and 2 (*Aesthetics*) shipped; their design is in
> `2026-06-15-composable-grammar-plots-design.md`.

## Why

Phase 1 inverted **statistics** from `plot-type → test` to `encodings → an
inferred model`. But the **figure** is still chosen the old way: the user picks a
plot type, which secretly sets a `family`
(`group_comparison` / `correlation` / `descriptive`) stored on the `Plottable`
(`state.ts` `Plottable.family`), and that hidden family — not the data — decides
what the x-axis may hold and which primitives are offerable:

- `EncodingsCard` derives `xKind` from `family` (`family === "group_comparison"`
  → categorical x; `"correlation"` → numeric x; `"descriptive"` → no x).
- `LayerRail` filters addable / retypeable geoms by
  `registry.geoms[g].family === active.family`.
- `seedPrimitiveAtom` sets `family` from the picked primitive.
- the aesthetic channels are welded to a single type each: color/shape
  categorical-only, size numeric-only (`EncodingsCard` `CHANNELS`,
  `scales.py`).

The result is a backwards mental model — *pick a picture, then pour data into the
shape it dictates* — and a rigid one: a numeric column can never be a color
gradient, a categorical pair can never be a heatmap, and the five channels do not
behave alike.

Phase 3 **finishes the inversion for the figure itself**: the user maps columns
to channels, and the **column types drive which primitives are offered**.
`family` stops being a stored user choice and becomes a derived label the stats
engine reads. This is the data-first grammar the tool has been heading toward
since Phase 1.

## Scope decisions (locked, from brainstorming)

1. **Data-first, type-driven.** A channel's type is inherited from the mapped
   column's schema `type` (`numeric` / `categorical`), never a separate toggle.
   "Every channel accepts both types" is satisfied simply by letting any eligible
   column land on any slot. The **combination** of mapped types determines the
   legal primitives.

2. **`family` becomes derived, not stored.** Removed from `Plottable`; computed
   from the encoding types for the stats engine:
   - `categorical x + numeric y` → `group_comparison`
   - `numeric x + numeric y` → `correlation`
   - `no x + numeric y` → `descriptive`
   - anything the geoms can draw but stats can't read → no test (`describe_only`).

3. **Per-channel type acceptance is honest, not uniform.** The original "every
   channel takes both types" narrowed during brainstorming to the types that
   actually mean something:

   | channel | categorical | numeric |
   |---|---|---|
   | x | ✅ | ✅ |
   | y | — *(needs a geom that consumes it; 3c/3d)* | ✅ |
   | color | ✅ discrete palette | ⛔ "continuous color coming soon" → ✅ in 3b |
   | size | — *(discrete size dropped by decision)* | ✅ marker area |
   | shape | ✅ | ⛔ "shape can't be continuous" |

   - **Discrete/categorical size is dropped entirely** — not "coming soon", just
     N/A. Size is continuous marker area, full stop.
   - **Categorical y is in the vision but inert until a geom consumes it.** Every
     categorical-y plot needs a geom that does not exist yet (horizontal box/bar
     in 3c, tile/heatmap in 3d). So in 3a, Y offers numerics only; categorical-Y
     turns on automatically when those geoms land (see the offer rule below).

4. **The offer rule (future-proof mechanism).** A channel offers a column type
   **iff some installed geom requires/accepts that type on that channel.** Derived
   from the registry, so capability and UI never drift: add a tile geom with
   `y_type: "categorical"` and Y immediately offers categoricals, no UI change.

5. **Incompatible primitives are disabled-with-reason, not hidden.** When the
   current encoding types don't satisfy a geom's `x_type`/`y_type`, the primitive
   stays visible but disabled with a reason ("needs a categorical X"). The picker
   teaches the rule instead of hiding options. (Scope choice: "model now, build
   incrementally" — every channel/type combo is representable; combos the engine
   can't render yet are disabled with a reason, and the gap is a flag to flip
   later.)

6. **Shape stays** as the fifth channel (categorical-only; continuous shape is
   meaningless).

7. **Numeric-as-categorical coercion is out of scope.** Treating a numeric `dose`
   as groups (so it could box-plot, not only scatter) is a natural extension but
   deferred; noted in §Open questions as the most likely follow-up.

8. **No `spec_version` bump.** The 2.0 encoding slots (x/y/color/size/shape)
   already exist. New geoms (tile) are new enum strings; horizontal adds an
   `orient` param. Consistent with Phase 2, which also added no bump.

## The model

```
            columns mapped to channels  (types inherited from schema)
                          │
                          ▼
   (x_type, y_type, color_type, size_type, shape_type, which-present)
                          │
            ┌─────────────┼──────────────────────────┐
            ▼             ▼                          ▼
   legal primitives   derived family            channel×type support
   (registry type-    (for the stats           (engine renders it? else
    match gate)        engine)                   disabled / warn-bar reason)
```

The user maps columns first; the type tuple (a) lights up the legal primitives,
(b) derives the stats family, and (c) gates which channel/type pairs the engine
can actually render today.

## Geom registry change (engine-authoritative)

`GeomDef` (`engine/triad_engine/geoms.py`) gains two fields, exposed through
`registry_payload()` exactly like `needs` / `aes` / `params` already are:

```python
x_type: str   # "categorical" | "numeric" | "none"   ("none" = x must be absent)
y_type: str   # "categorical" | "numeric" | "none"
```

Initial values (today's geoms — no behaviour change, just made explicit):

| geom | x_type | y_type | family (kept as a label) |
|---|---|---|---|
| dot, summary, box, violin, bar | categorical | numeric | group_comparison |
| scatter, regression | numeric | numeric | correlation |
| histogram, density | none | numeric | descriptive |

`family` stays on each `GeomDef` (the stats engine still wants the label) but no
longer gates the UI — the type-match does. The frontend `Registry`/`GeomMeta`
types (`types.ts`) gain the two fields.

## Frontend: channel × type support matrix

A small declarative table (frontend, e.g. `channels.ts`) of what the engine
*renders today*, each gap carrying a reason — the single place a later chunk
flips a flag:

```ts
// channel → which column type renders, with a reason for the gap
support = {
  x:     { categorical: ok,  numeric: ok },
  y:     { categorical: { reason: "needs a horizontal or tile geom (3c/3d)" },
           numeric: ok },
  color: { categorical: ok,  numeric: { reason: "continuous color coming soon (3b)" } },
  size:  { numeric: ok },                       // categorical: not offered at all
  shape: { categorical: ok,  numeric: { reason: "shape can't be continuous" } },
}
```

Two distinct notions of "supported" fall out of this, and the UI keeps them
separate:

- **Offerable** (the §4 offer rule): does *any* installed geom consume this type
  on this channel? Drives whether a column of that type appears in the dropdown.
- **Renderable** (this matrix): does the engine draw it today? Drives the
  disabled/warn-bar reason on an otherwise-offerable mapping.

## Frontend: unified `EncodingsCard`

Today `EncodingsCard` special-cases X/Y (driven by `xKind` from `family`, with a
"Variable" relabel for descriptive) and treats color/size/shape with fixed kinds.
It becomes five uniform channel rows — **X, Y, Color, Size, Shape** — each a
single column dropdown:

- each row offers all **offerable** columns for that channel (numeric +
  categorical as the registry allows), grouped by prefix as today, plus
  "— none —" (Y is the one channel that defaults to mapped).
- the X "Variable"/descriptive relabel disappears: histogram is simply "Y mapped,
  X empty" — cleaner, no special case.
- when a mapped column's type is offerable but **not renderable** for that
  channel, the row shows the reason inline and rides the existing amber warn-bar
  (added in Phase 2) rather than silently misrendering.

The `colorTracksX` default (color follows x for a group comparison) is preserved.

## Frontend: primitive gating

`LayerRail`'s `inFamily` filter (`registry.geoms[g].family === active.family`) is
replaced by a **type-match** against the current encodings, applied in all three
places it gates today:

- **"Start from…"** (the `PRIMITIVES` seed dropdown)
- **"+ Add layer"** (the addable list)
- **per-layer retype** (the in-place geom swap)

A geom is enabled iff the current `(x_type, y_type)` satisfies its
`(x_type, y_type)` requirement. Incompatible geoms render **disabled with a
reason** ("needs a categorical X", "needs a numeric Y"). `seedPrimitiveAtom` no
longer sets `family` (it's derived); picking an incompatible primitive is simply
not possible until the encoding matches — consistent with §5.

`makeDefaultPlottable` keeps seeding a sensible default (so the picker is never
all-disabled on a fresh table) but derives family from the columns it maps rather
than storing it.

## Engine: guard safeguard

Unsupported combos can still arrive (a saved `.viz`, a column retyped after
mapping). The guard pass (`guards.py`) gains one rule: an **unrenderable
`(channel, type)` pairing emits a warning and the channel is dropped before
render**, so the compiler never tries to draw, e.g., a continuous color it can't
yet. Cheap insurance that keeps "model now, build later" safe. The client mirror
of the guard (the live warn-bar) shows the same reason without a round trip.

## New capability the inversion unlocks (later chunks)

Designed here so the schema and registry accommodate them; each is its own
chunk = "flip a ⛔/— to ✅ + build the scale/geom".

- **3b — Continuous color.** A numeric `color` resolves through a continuous
  colormap instead of the discrete palette; `Scales` (`scales.py`) gains a
  numeric branch and the legend emits a **colorbar** instead of swatches. Flips
  `color × numeric` to ✅.
- **3c — Horizontal orientation.** A categorical `y` + numeric `x` draws
  horizontal box/bar/violin/dot via an `orient` geom param; the comparison
  builder gains an axis-swap. Flips `y × categorical` to ✅ for those geoms.
- **3d — Tile/heatmap geom + count stat.** A new `tile` geom (`x_type` &
  `y_type` categorical) with a count aggregation renders a contingency tile
  (fill = count), the one encoding that makes categorical-vs-categorical worth
  offering; a balloon/bubble variant is a possible sibling. This is the geom that
  makes categorical-Y broadly real.

## Chunks (delivery)

- **3a — Type-driven core (the implementable unit of this spec).** Registry
  `x_type`/`y_type`; derived family; unified `EncodingsCard`; type-match primitive
  gating with disabled-with-reason; the channel×type support matrix + offer rule;
  the guard safeguard; migration. **Uses today's renderers only** — ships the
  rationalized, honest data-selection UX standalone. Foundation for 3b–3d.
- **3b — Continuous color** (above).
- **3c — Horizontal orientation** (above).
- **3d — Tile geom + count stat** (above).

Each is independently shippable; **this spec's implementation plan covers 3a
only.** 3b–3d get their own plans.

## Migration / back-compat

- `Plottable.family` is removed; a derived `familyFor(encodings)` selector
  replaces every read (`buildSpec`, `specAtom`, `allSpecsAtom`, `TEST_BY_FAMILY`
  lookups). Saved `.viz` specs are unaffected — `spec.stats.family` is already
  serialized and the engine already re-derives the model server-side; on load the
  derived family must agree with the stored one for today's specs (asserted in a
  back-compat test).
- No `spec_version` change. The encoding slots and stats clause are unchanged in
  shape; only the *source* of `family` moves from stored to derived.
- `seedPrimitiveAtom` / `TEMPLATES` / `PRIMITIVES` keep working as seeds; they
  set encodings + layers, and family falls out.

## Testing

**Engine**
- `registry_payload()` exposes `x_type`/`y_type` for every geom; values match the
  table above (golden).
- Guard safeguard: an unrenderable `(channel, type)` (e.g. numeric color in 3a)
  yields a **warning** and the channel is absent from the draw context; the figure
  still renders.
- No render regression: every existing geom renders identically (the 3a change is
  metadata + gating, not new plotting). SVG structural check against current
  output.

**Frontend**
- `familyFor`: a table of `(x_type, y_type)` → expected family, incl. the
  describe-only fall-through.
- Offer rule: with today's registry, Y offers numerics only; X offers both; color
  offers categoricals (numeric shown disabled-with-reason); size offers numerics;
  shape offers categoricals. Add a synthetic geom with `y_type: "categorical"` →
  Y now offers categoricals (proves the mechanism).
- Primitive gating: with categorical x + numeric y, group geoms enabled and
  scatter/regression disabled-with-reason; with numeric x + numeric y, the
  reverse; descriptive geoms enabled when x is empty.
- Unified `EncodingsCard`: five rows render; an unrenderable mapping surfaces the
  reason on the warn-bar; the `colorTracksX` default still tracks x.
- Back-compat: each current preset/template still produces a spec whose derived
  family equals what it stored before.

## Scope / YAGNI

- **Plan covers 3a only.** 3b/3c/3d are designed into the registry/matrix so
  there is no rework, but are deferred to their own specs/plans.
- No numeric-as-categorical coercion (Open questions).
- No new geoms in 3a — only `tile` later (3d). No new stats families in 3a.
- The support matrix is a frontend constant in 3a (kept in sync by hand with a
  comment); promoting it to engine-derived is a possible later cleanup, not 3a.

## Open questions / decisions for the plan

1. **Numeric-as-categorical coercion.** The most likely follow-up: a per-channel
   "treat as categorical" so a numeric `dose` can be a grouping factor (box per
   dose), not only a scatter axis. In/out for 3a? (Recommended: out — it's a
   distinct feature, not part of the inversion.)
2. **Support-matrix home.** Frontend constant (proposed for 3a) vs. engine-derived
   flag on the registry. Frontend is faster now; engine-derived removes a
   hand-sync risk when 3b–3d flip flags.
3. **Disabled-primitive affordance.** Greyed + tooltip reason, or greyed + inline
   reason text? (Mirror whatever the existing warn-bar/guard UI does for
   consistency.)
