# Composable Grammar of Graphics — Design Spec

Date: 2026-06-15

## Why

A plot in Triad is today one of six fixed `PLOT_TYPES` (`state.ts:22`), chosen
from a dropdown. Picking one does two things at once: it sets a hardcoded stack
of marks (`layers`) **and** it welds the figure to a statistics family
(`group_comparison` / `correlation` / `descriptive`), which in turn drives the
recommended test and the significance annotation. The user cannot add, remove,
reorder, or configure the marks; and they cannot encode a third variable (color,
size) or split the figure into small multiples.

The engine is already *half* composable but doesn't expose it. `spec.layers` is
an ordered list of `{mark, stat|options}`, and `build_comparison_figure`
genuinely overlays marks — violin + box + bar + dot + summary stack
(`compiler.py:233, 253–301`). But it collapses the list into a **set of mark
names** (`marks = {layer["mark"] for layer in spec.layers}`), discarding order
and every per-layer option; per-mark settings come from the global `style` block
instead. So the layered model exists in the data but is thrown away at render.

This coupling also caused the concrete failure that started this work: "Dots +
mean ± CI" on an 82,241-row table emits a **13.8 MB SVG with 82,241 interactive
points**, freezing the browser. There is no per-mark notion of "this geom can't
draw that many points," because marks aren't first-class.

This unit reworks plots into a **bounded grammar of graphics**: composable geom
layers, aesthetic mappings (color/size/shape ← a column), and faceting — with
**statistics inferred from the encodings, surfaced in plain language, and
overridable**, and with **validity guards as first-class parts of the grammar**.
It is delivered in three phases; **Phase 1 (Layers) is the implementable unit of
this spec.** Phases 2 (Aesthetics) and 3 (Facets) are scoped here so the schema
is built to accommodate them, but each gets its own spec → plan → implementation
cycle.

## Scope decisions (locked, from brainstorming)

1. **Destination is a *bounded* grammar of graphics (option "C"), not infinite
   ggplot.** A defined set of geoms × aesthetics (x, y, color, size, shape) × 1–2
   facet dimensions. We are not building free stat-transform layers, arbitrary
   coordinate systems, or a general charting library. (Rejected: option "B",
   free geoms with stats merely decoupled — it adds real complexity for little
   gain over the composable-marks work, because marks already overlay and the
   test is already overridable.)

2. **Statistics is inferred from the encodings, not from a plot type.** Today the
   relationship is `plot-type → test` (a fixed table baked into `PLOT_TYPES`). It
   inverts to `encodings → an inferred statistical model`. The inferred model is
   **shown to the user in plain language** ("because you mapped color = condition,
   I'm treating it as a second factor"), is **overridable**, and **never runs
   silently** when the design is ambiguous. (Rejected: keeping the fixed
   plot-type→family table; it cannot survive free aesthetics + facets without
   producing misleading tests.)

3. **When the statistical design is ambiguous, default to *describe, don't
   test*.** If the engine cannot unambiguously read a model from the encodings
   (e.g. a categorical color could be a grouping factor or just a hue), it renders
   the figure and offers the test as an explicit opt-in with the model spelled
   out, rather than guessing. A visible "describe only — run no test" control is
   always available.

4. **Guards are part of the grammar, not bolted on.** Each geom declares its own
   validity constraints; the inferred model declares its own. The user's original
   "guard per plot type" request generalizes into two guard layers: **geom-level**
   (e.g. point/jitter cannot draw more than ~N raw points; bar implies an
   aggregation that must be stated) and **model-level** (facet multiplicity forces
   a multiple-comparisons choice; too few observations per group blocks the test).
   Guards surface before render, reusing the amber warn-bar already added this
   session (`App.tsx`, `.warn-bar` in `index.css`). Guards distinguish **blocking**
   (figure cannot render / test cannot run) from **warning** (renders, but flagged).

5. **Build on what exists; phase by capability, each phase shippable.**
   - **Phase 1 — Layers:** geoms become first-class objects with declared
     aesthetics, defaults, and guards; `spec.layers` becomes a true ordered list
     the compiler honors (stop flattening to a set); the plot-type dropdown becomes
     a **layer rail** modeled on the existing reduction `PipelineRail` / `StepCards`
     (`components/PipelineRail.tsx`, `StepCards.tsx`). The 82k-point freeze is fixed
     here by the geom-level point guard. Stats keeps today's family inference but is
     routed through a new explicit `stat_model` object that is displayed — the seam
     Phases 2–3 extend.
   - **Phase 2 — Aesthetics:** `color` / `size` / `shape` ← a column, as real
     encodings with scales, palette, and a legend. Stats inference extends: a
     categorical color becomes a candidate second factor, surfaced for approval.
   - **Phase 3 — Facets:** `facet_row` / `facet_col` ← a column, rendered as a
     matplotlib subplot grid with a shared-scale option. Stats inference extends:
     per-facet tests with a **mandatory** family-wise correction choice.

6. **The six presets survive as templates, not types.** "Dots + mean ± CI",
   "Box + dots", etc. become one-click seeds that populate a layer stack +
   encodings, so the fast start is preserved, but they are no longer a closed set
   the user is locked into. (Rejected: deleting them — they are good defaults and
   onboarding.)

7. **Reduction is unchanged and still runs first.** The composable-reduction
   pipeline this builds on (`reduce.py`, the `/reduce` preview) is untouched.
   Aesthetic/facet encodings and geoms operate on the *reduced* schema, which ties
   into the column-survival fix from this session: encoding pickers offer only
   columns the pipeline keeps.

## Spec schema (the grammar)

The analysis spec gains a real grammar and a version bump (`spec_version` 1.3 →
2.0). The keystone change is replacing the flat `mappings` + welded-`layers`
shape with three orthogonal blocks: **encodings**, **layers**, and a derived
**stat_model**, plus a `facet` block (populated in Phase 3).

```
spec.encodings = {
  x:     { column } | null,
  y:     { column } | null,
  color: { column } | null,   // Phase 2
  size:  { column } | null,   // Phase 2
  shape: { column } | null,   // Phase 2
}
spec.facet = { row: { column } | null, col: { column } | null,   // Phase 3
               share_x: bool, share_y: bool }
spec.layers = [ Layer, ... ]   // ORDERED; drawn bottom→top
spec.stat_model = StatModel    // inferred server-side, echoed in response, overridable
```

A `Layer` is a geom instance:

```
Layer = {
  geom: GeomName,             // "point" | "jitter" | "box" | "violin" | "bar"
                              // | "line" | "errorbar" | "summary" | "smooth"
                              // | "histogram" | "density" | ...
  params: { ... },            // per-geom options (jitter width, box width, bins,
                              //   error_type, fill alpha) — honored per layer,
                              //   NOT pulled from global style
  aes: { ... } | null,        // optional per-layer aesthetic overrides (Phase 2+)
}
```

### Geom registry

A single source of truth (engine-authoritative, mirrored to the frontend, ideally
generated or validated against the engine) where each geom declares:

- **required / optional aesthetics** (e.g. `point` needs x+y; `bar` needs x +
  an aggregated y; `histogram` needs one numeric mapped to x).
- **whether it aggregates** rows (bar/summary/errorbar do; point/jitter don't).
- **default params**.
- **guards** — predicates over the resolved data that return blocking/warning
  issues (see Guards).
- **default stat** it implies, used by inference.

The registry is the mechanism that makes both composition and guarding
first-class: the layer rail reads it to know which geoms are addable and how to
configure them; the compiler reads it to render; the guard pass reads it to
validate.

## Statistics: inference engine

A new engine module takes the **encodings + the reduced schema** and produces a
`StatModel`:

```
StatModel = {
  design: string,          // plain-language description shown to the user
  family: "comparison" | "correlation" | "descriptive" | "two_way" | "none",
  factors: [ { column, role } ],
  test: TestName | null,
  facet_handling: { per_facet: bool, correction: "holm" | "bonferroni" | "none" } | null,
  chosen_by: "inferred" | "user_override" | "describe_only",
  issues: [ ValidityIssue, ... ],
}
```

Inference rules (Phase 1 reproduces today's behavior through this object; 2–3
extend it):

- numeric **y** + categorical **x** → `comparison` (current behavior).
- numeric **x** + numeric **y** → `correlation`.
- one numeric mapped, no grouping x → `descriptive`.
- *(Phase 2)* + categorical **color** distinct from x → `two_way` (color as a
  second factor), **surfaced for approval**; if the user declines, color is a
  pure visual hue and the model falls back to the one-factor reading.
- *(Phase 3)* any **facet** → `per_facet = true`, `correction` defaulted to
  `holm` and **required** to be acknowledged.
- ambiguous / unmapped → `family: "none"`, `chosen_by: "describe_only"`.

The model is returned in the analyze response and rendered in the stats panel as
the design sentence + the test + the controls (`[override ▾]`, the correction
picker, and `[describe only]`). It is the single legible place the user confirms
"this is the right test for this picture."

## Guards (validity)

Two tiers, both surfaced before/with render through the existing error/warn bar,
each issue tagged `blocking` or `warning`:

**Geom-level** (declared in the registry, evaluated against resolved data):
- `point` / `jitter`: more than ~**3,000** raw marks → **blocking**, with the
  message pattern we drafted ("82,241 points is too many to draw individually —
  add a Collapse step or use a summarizing geom"). This is the 82k-freeze fix.
  (Exact cap is an open question; ~2–3k keeps the SVG small and the DOM
  responsive — see the 0.26 MB / 1,383-point measurement from this session.)
- `bar` / `summary` / `errorbar`: require an aggregating stat; on raw,
  unaggregated data, state the implied aggregation (warning) rather than silently
  averaging.
- `box` / `violin`: minimum observations per group (warning/blocking below a
  threshold).

**Model-level** (declared by the stat_model):
- facet multiplicity → must choose a correction (forced control, not a silent
  default).
- too few observations per group → blocking the test (figure still renders).
- single-level factor (e.g. only one `condition`) → no comparison possible.

A guard pass runs server-side during analyze (authoritative, has the full reduced
data) and a cheap mirror runs client-side off the reduce preview's schema +
row-count so the rail can warn live without a round trip.

## Rendering (compiler refactor)

`build_figure` today dispatches on `stats.family` to one of three monolithic
builders (`compiler.py:213`). It becomes a **layered renderer**:

1. Resolve encodings + reduced data into a draw context (positions, group levels,
   color/size scales).
2. *(Phase 3)* establish the subplot grid from `facet`; otherwise a single axes.
3. For each `Layer` in order, call that geom's render function with its own
   `params` and the resolved aesthetics. Geoms that draw per-row marks emit
   `point_groups` (gid → row_ids) exactly as today, so click-to-exclude keeps
   working; aggregating geoms emit none.
4. Apply axes/style/decoration (the existing `_apply_axes`, `_decorate`,
   `resolve_style`, WYSIWYG mm sizing, gid-tagged draggable labels) — unchanged.

Each existing mark branch (violin/box/bar/dot/summary, scatter/regression,
histogram/density) becomes a geom render function reading `layer["params"]`
instead of the global `style` set-membership test. This is a refactor of code
that already exists, not new plotting from scratch.

## Data flow

```
reduced table (existing /reduce, unchanged)
        │
        ▼
encodings + layers + facet  ──►  /analyze
        │                         ├─ infer stat_model from encodings + schema
        │                         ├─ run guard pass (geom + model)  ──► issues
        │                         ├─ if blocking issue: return issues, no render
        │                         ├─ run test (unless describe_only)
        │                         └─ layered compiler → SVG + point_groups
        ▼
frontend: layer rail + encoding pickers + stat_model panel + guard bar
```

Client-side, a cheap guard mirror runs off the reduce preview so the rail flags
"too many points / pick another geom" the instant a geom is added, before any
analyze round trip — analogous to the live reduced-table preview.

## Migration / back-compat

- `.viz` documents and in-flight specs use `spec_version` 1.3 (`mappings` +
  `PLOT_TYPES` `layers`). A translation layer maps each old preset to its
  equivalent `{encodings, layers}` (the six presets already encode this mapping),
  bumping to 2.0 on load. Old documents keep opening.
- `buildSpec` (`state.ts:168`) and the `specAtom` keystone are reworked to emit
  the new shape; the six `PLOT_TYPES` entries become template seeds for the layer
  rail rather than the live source of `layers`.

## Testing

**Engine**
- Geom registry: each geom's required-aesthetic and guard predicates (golden
  cases), including the point cap producing a blocking issue at >cap and rendering
  at ≤cap; assert SVG size / point count stay bounded.
- Stat-model inference: a table of (encodings, schema) → expected StatModel,
  covering each family, the describe-only ambiguous case, and (2/3) two-way and
  per-facet/correction cases.
- Layered compiler: every geom renders alone; representative overlays stack in
  order; `point_groups` map to the right rows for per-row geoms; aggregating geoms
  emit none. (2/3) color/size scales and the facet grid.
- Back-compat: each of the six 1.3 presets translates to a 2.0 spec that renders
  identically (SVG diff or structural check).

**Frontend**
- Layer rail: add / remove / reorder / configure honors order and per-layer
  params (mirrors the PipelineRail tests, `e2e/plottables_test.mjs` style).
- Encoding pickers offer only columns the reduction keeps (extends the
  column-survival fix from this session).
- Stat-model panel renders the design sentence + test, and override / describe-only
  / correction controls round-trip into the spec.
- Guard bar shows blocking vs warning correctly and suppresses the doomed analyze
  on a blocking issue.

## Scope / YAGNI

- **Implementation plan covers Phase 1 only.** Aesthetics (2) and facets (3) are
  designed into the schema so there is no rework, but are deferred to their own
  specs.
- Bounded geom set in Phase 1: the marks that already exist
  (point/jitter, box, violin, bar, errorbar, summary, scatter→point, smooth→
  regression, histogram, density). No new geoms invented in Phase 1.
- One `stat_model` object; Phase 1 reproduces current inference through it without
  yet adding two-way/facet logic.
- No free stat-transform layers, no coordinate systems, no general charting.

## Open questions / decisions for the plan

1. **Point-cap threshold.** ~2–3k proposed (0.26 MB / 1,383 pts rendered fine;
   13.8 MB / 82k froze). Pick a default; make it a guard constant.
2. **Geom-registry duplication.** Engine-authoritative — generated into the
   frontend, or hand-mirrored with a contract test? Prefer a single generated
   artifact to avoid drift.
3. **`spec_version` 2.0 cutover.** Confirm the translation layer is load-time
   only (no dual-write) and that exports/saves always emit 2.0.
