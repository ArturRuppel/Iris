# Shared color+shape metric & repeatable geoms — design

Covers TODO items **J** (color and shape may map the same metric, with one merged
legend entry per label) and **K** (a geom may appear more than once in a layer
stack, e.g. small raw dots + big aggregate dots). They are grouped because both
are "the model already half-supports this; lift an over-eager uniqueness
assumption and make the legend/style follow."

Date: 2026-06-22.

---

## J. Color and shape on the same metric → one merged legend entry

### What actually happens today

There is **no hard block** in the obvious places:

- `EncodingsCard` (`src/components/EncodingsCard.tsx`) only excludes the *other
  axis* column (X hides Y's column and vice versa). Color/Size/Shape are
  independent selects with no cross-exclusion, so the UI already lets you pick
  the same column on Color and Shape.
- `state.ts` `buildSpec` writes each channel straight through
  (`color`/`size`/`shape` → `encodings.{color,size,shape}`); no collision check.
- The renderer copes: `Scales` (`engine/iris_engine/scales.py`) resolves color
  and shape independently, both keyed on their column's level order; `_geom_dot`
  (`compiler.py:810`) splits each group into one scatter call per *shape* marker
  while colour is vectorized — colour and shape can be the same column with no
  conflict in the draw path.

So "cannot use the same metric" is a **symptom, not a literal block**, and step 0
is to reproduce it and find where it bites. Two strong candidates:

1. **The legend looks broken / redundant.** `Scales.legend_entries()`
   (`scales.py:123`) emits **one entry per channel independently**. Mapping the
   same column to color and shape yields two legend blocks with the *same title*
   and the *same level values* — one showing color swatches, one showing marker
   swatches. That reads as "it doesn't work" even though both channels drew. This
   is the core of what the user is asking to fix: collapse to one block whose
   each row shows the color **and** the marker together.
2. **A guard or cardinality path double-counts.** `guards.py` iterates
   `("color","size","shape")` (lines 54, 185) and could warn twice for the shared
   column, or the palette/marker cap interaction could surface a confusing
   blocking issue. Confirm during repro whether a guard is the thing that
   actually suppresses the render.

> Action: **start with `systematic-debugging`** — build the exact spec (same
> categorical column on color + shape, a dot/scatter layer) and observe the real
> failure before editing. The fix below assumes the legend-redundancy diagnosis;
> adjust if repro shows a true block.

### The fix — a merged color+shape legend

The single source of truth is `Scales.legend_entries()`. Today each channel is
its own entry. Introduce the notion of a **combined entry** when two (or more)
channels map the *same column* and share the *same level set*:

- In `legend_entries()`, detect `color_col == shape_col` (categorical color
  only — numeric color is a colorbar and can't merge with discrete markers).
  When they match, emit **one** entry whose `swatches` carry both a `color` and
  a `marker` per level, e.g.
  `{"value": lv, "color": self._color_map[lv], "marker": self.marker_for(lv)}`,
  and tag it `"channel": "color+shape"` (or `channels: ["color","shape"]`).
  Suppress the separate shape entry.
- Generalize gently: size is continuous, so size never merges into this block; it
  stays its own entry. Only the two discrete level-keyed channels (color, shape)
  can fuse.

Then teach the legend *renderer* to build a combined handle. In
`compiler.py:_draw_legend` (around line 346) the handles are currently built per
entry assuming a single visual attribute. For a `color+shape` entry, build each
handle as a `Line2D`/marker proxy that sets **both** `markerfacecolor=swatch.color`
**and** `marker=swatch.marker` (and `linestyle="none"`), so one row shows the
colored marker shape. One title, one row per label. Verify the swatch the legend
draws matches what `_geom_dot` actually drew (the whole point of `Scales` being
shared).

Keep the non-shared case exactly as-is (two distinct columns → two legend
blocks, unchanged).

### Should the UI nudge this?

Optional, low priority: when the user maps the same column to both color and
shape, that's a deliberate redundant-encoding choice (common in print figures for
colorblind safety). No block, no warning needed. If anything, a future tooltip
("color + shape share this metric — shown as one legend entry") but not in v1.

### Tests (engine, headless)

- `Scales.legend_entries()`: same column on color+shape → exactly one entry,
  `channel == "color+shape"`, each swatch has both `color` and `marker`; distinct
  columns → two entries (regression guard).
- An SVG-level test (mirror the existing legend probes in `test_aesthetics` /
  `validation/svgstruct.py`): render a dot plot with color==shape, assert the
  legend has **one** title `<text>` for that metric and N marker handles, not 2N.
- Numeric color + shape on different columns still produces a colorbar + a shape
  legend (no accidental merge).

---

## K. A geom may appear more than once (repeated layers)

### What blocks it today

The data model already supports it: `Layer` (`types.ts:92`) is
`{ id?, geom, level, params? }` with a client-only stable `id`, and the engine
draws layers in order. The block is a **UI-level uniqueness assumption** in
`LayerRail.tsx`:

- `const used = new Set(layers.map((l) => l.geom))` (line 95) and
  `notUsed = allGeoms.filter((g) => !used.has(g))` (line 101) — a geom already in
  the stack is removed from the add menu.
- `retypeOptions` (line 110) likewise excludes geoms used by *other* layers.

So you can't add a second `dot`. Lift that: allow a geom to be added again. The
classic superplot the user wants — faint small dots at the raw level + bold large
dots at the unit/experiment level — is two `dot` layers at different `level`s with
different sizes.

### The real design question: per-instance style

Item C's shipped design (`2026-06-17-rationalize-plot-style-design.md`) made
per-layer style fold into a **geom-keyed** section: `style.overrides.geoms.<geom>`,
resolved by `resolve_geom_style(style, geom)` (`style.py:278`, used at
`compiler.py:828`). That assumes **one section per geom** — exactly the assumption
K breaks. Two `dot` layers would share one `geoms.dot` block and could not differ
in `marker_size`/`alpha`, which defeats the small-vs-big-dots use case.

This is the crux of K and must be reconciled deliberately. Options:

**Option 1 — per-layer style override keyed by layer `id` (recommended).**
Keep `geoms.<geom>` as the shared default for that geom, and add an *optional*
per-layer override layer: `style.overrides.layers.<layer.id>.<key>`. Resolution
becomes: registry default → `geoms.<geom>` → `layers.<id>` (most specific wins).
`resolve_geom_style` gains the layer id and merges the third tier when present.
The StylePane, when a layer is selected, writes to `layers.<id>`; the geom-level
block stays the "applies to all instances of this geom" default. This preserves
item C's single Style surface while giving repeated instances independent knobs.
Cost: a new override tier threaded through `resolve_geom_style` callers and the
`.iris` round-trip; `layer.id` becomes load-bearing (it's currently
client-only — the engine must now read it, so it has to be serialized and stable
across save/load, which `fromSpec` already backfills at `state.ts:453`).

**Option 2 — revive `Layer.params` as the per-instance carrier.** `params` exists
on `Layer` but is "legacy, migration only." Reviving it for per-instance knobs
overlaps confusingly with item C's geom-keyed model and would re-introduce the
4-way drift item C just killed. **Not recommended.**

> Recommend Option 1. Use `brainstorming` with the user to confirm the
> style-precedence model (does a per-layer knob fully override, or only the knobs
> the user touched? — "only touched keys, merged over the geom default" matches
> how overrides already work) before building, since it touches the just-shipped
> style architecture.

### Changes

Frontend:
- `LayerRail.tsx`: drop the `used`/`notUsed` exclusion so any geom can be added
  again; keep `geomAddable` type-gating. `retypeOptions` no longer needs to
  exclude used geoms. Remove the "all geoms added" empty-state copy (it can no
  longer happen) or repurpose it.
- The layer list already uses `layer.id ?? i` as the React key (line 129) and
  `addLayerAtom` (`state.ts:718`) already mints a fresh `nextLayerId()` per add —
  so two `dot` layers get distinct ids for free. Good.
- StylePane: when editing a selected layer, write per-instance knobs to
  `layers.<id>` (per Option 1). Surface which layer is being styled.
- Sensible defaults so the superplot is one or two clicks: a second `dot` added
  at a coarse level could default to a larger `marker_size` / full alpha, but
  keep that a *default*, not magic — leave it editable.

Engine:
- `resolve_geom_style(style, geom, layer_id=None)` merges the optional
  `layers.<id>` tier. Update the call site in `_geom_dot` and any other geom
  draw fn to pass the current layer's id (the layer dict is already in scope as
  `layer` at `compiler.py:810`).
- `style.py` `resolve_style`: pass through `overrides["layers"]` alongside the
  existing `geoms` stash (`style.py:273`).
- Confirm the draw loop already iterates layers independently (it does — each
  layer builds its own level table and calls its geom fn), so two `dot` layers at
  different levels already draw as two passes; only the style resolution needs
  the id.

### Interaction with the merged-legend work (J)

With repeated dot layers, the legend should still show one block per *metric*, not
per *layer*. The `Scales` are resolved once per figure from the encodings (not per
layer), so `legend_entries()` is already layer-agnostic — J's merge and K's repeat
don't collide. Just verify the legend doesn't gain duplicate entries when two
layers map the same scales.

### Tests

- `state.ts`/`LayerRail`: adding `dot` twice yields two layers with distinct ids;
  retype menu still type-gates. (FE unit test in `state.test.ts` style.)
- Engine `resolve_geom_style`: a `layers.<id>` override wins over `geoms.<geom>`
  wins over registry default; absent layer override falls back cleanly.
- Engine render: a spec with two `dot` layers (raw level small, unit level large)
  produces two scatter passes with different marker sizes; the existing
  `test_n_labels` two-grain superplot fixture is a good basis.
- `.iris` round-trip: per-layer overrides survive save/load (layer ids stable).

---

## Sequencing

1. **J first** — smaller and self-contained (one `Scales` method + one legend
   builder branch), and it makes the shared-metric case *look* correct, which is
   what the user reported. Start with `systematic-debugging` to confirm the
   symptom is the redundant legend (not a hidden block).
2. **K second** — bigger because it touches the just-shipped style architecture.
   Gate the per-instance-style precedence decision behind a quick `brainstorming`
   pass with the user before editing `resolve_geom_style` and the `.iris` schema.

Both are engine-verifiable headlessly except the StylePane/LayerRail UX, which
folds into the existing browser-verification batch.
