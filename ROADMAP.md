# Iris — Product & Engineering Roadmap

> **Name:** The project is named **Iris** (formerly the working title
> "Triad"). Iris is the Greek goddess of the rainbow and the messenger of the
> gods — the spectrum of a figure and the live link between table, figure, and
> stats — and is also the canonical statistics dataset (Fisher, 1936), an
> instant signal to the researchers this tool is for. It nods to Prism's
> light-splitting association sideways, as kin rather than knockoff. The code
> rename (package id, Tauri bundle, `iris_engine`) is complete.

*Status: Tiers 0 and 1 complete on Linux (validated installer path, sidecar
lifecycle, orphan prevention); macOS/Windows packaging deferred to the end by
decision. **Tier 2 is substantially complete** — the composable grammar of
graphics shipped through all five phases, the data model was re-grounded on a
**data hierarchy**, and the redesigned **guided test picker** statistics are
built; what remains is breadth (paired plots, undo/redo, methods/stats-table
export, the Poisson rate slice) and rigor polish.*

*Foundations in: the import wizard (CSV/TSV/Excel, locale sniffing, type
confirmation — including a first-class `bool` event-flag type with a 0/1 "looks
boolean" nudge — and wide→long stacking); the AG Grid table; the style panel
(markers, lines, frame, colours, text, mm size; draggable figure labels and
corner-drag resize that export identically); the data-entry wizard; deliberate
exclusion (select + right-click) with a provenance log. One master table feeds
many live-computed **plottables**, each its own figure + stats; the workspace
splits into a maximized-table "Data" mode and an "Analyses" mode (plottable
sidebar + collapsible reduced-table / figure / stats sections). The table is now
**server-owned** — the engine holds it behind a session handle (id + version +
schema + counts) and the browser pulls only the row windows it shows — so
multi-million-cell tables never live in the browser. The wide `cells_by_frame`
dataset is the default sample.*

*The central architectural evolution since this roadmap was first drafted is the
**data-hierarchy redesign** (`docs/superpowers/specs/2026-06-16-data-hierarchy-redesign.md`),
which replaced the destructive `reduce.collapse` step **and** the Phase-5
`repetition_key` / `stat.per_unit` / `pair_by` machinery with one model.
Reduction is now an ordered pipeline of `select` + `filter` only — **aggregation
is no longer a reduce step**. Instead a table-level **spine** of nested
identifier columns (coarsest→finest, e.g. `date → position → cell → frame`)
defines *grain*; each layer binds to a **level** of it (a spine column, or raw),
and picking a level keeps that prefix and aggregates everything finer by the
level's function (default mean), carrying a `row_ids` chain so click-to-exclude
on a coarse mark still drops every underlying raw row. Superplots fall out for
free — a faint raw-dot layer under a bold per-grain layer under a summary, no
`stat:{per_unit}` and no preset. Crucially, **pairing is *derived from the
spine*, not declared**: whether two groups are paired / partially-paired /
unpaired follows from whether a within-unit sub-identity crosses both levels, and
feeds the test picker's structural axis.*

*Plots are a **composable grammar of graphics**, shipped through Phase 5:
**Phase 1 (Layers)** — an ordered editable geom stack on an engine-authoritative
registry (served on `/health`), a layered compiler, and a first-class guard pass
(the 3,000-mark point cap that turned the 82k-point freeze into an actionable
message); spec moved 1.3→2.0, older specs/documents migrate losslessly.
**Phase 2 (Aesthetics)** — `color`/`size`/`shape` as real encodings with shared
scales, an exportable draggable legend, dodged categorical second factors, and
the Okabe–Ito palette (extended with Paul Tol hues to 16 for colourblind-safe
high-cardinality series). **Phase 3 (Data-First Encodings)** — mapped column
*types* drive which primitives are offered (registry-derived,
disabled-with-reason, geom-first selectable), `family` reduced to a derived stats
label; unlocked continuous colour (3b), horizontal orientation (3c), and the
contingency tile/heatmap (3d). **Phase 4 (Facets)** — Facet Row/Col split the
figure into a shared subplot grid (singular legend/colorbar/sup-labels, per-cell
strip titles), describe-only per cell in v1, guarded at 20 cells.
**Phase 5 (Superplots)** — now expressed through the data hierarchy (layers bound
to levels), not a layer `stat`, making the inferential n visible while the test
binds to one honest unit grain.*

*Beyond the original plan, two representations were added: a **time-series
family** (`line` per-unit trajectories + `trend` mean±band over an ordered
numeric x, units from the spine; describe-only in the first cut —
`2026-06-17-time-series-support-design.md`), and a unified **`distribution`
geom** folding the old histogram/density into one geom with selectable renders
(bars/step/line/points/KDE-smooth and a Boltzmann-inverted "potential"
U(x)=−ln P) and binning strategies (numpy strategies, fixed, and a sinh spacing
tighter near zero for signed data). Dot layouts gained a no-overlap **beeswarm**
solver; the stats panel gained inline **info boxes** explaining every reported
quantity.*

***Statistics — the guided test picker — is built*** (it was "redesigned, not yet
built" when this roadmap was written). Inference is opt-in and
describe-by-default; adding a test runs a short guided decision whose family is
fixed by the column types and whose two axes are **structural** (independent vs
paired, prefilled from the spine-derived pairing) and **assumption** (parametric
vs robust — the engine proposes from a Shapiro check, the user confirms). Shipped
cells: the **two-group numeric grid** (Welch / Mann–Whitney / paired-t /
Wilcoxon); **multi-group** (>2 levels → one-way ANOVA + Tukey HSD, or
Kruskal–Wallis + Holm-adjusted pairwise) with the **significance brackets** it
drives (one stacked per reported pair); **correlation** (Pearson/Spearman with an
OLS line + CI band); and the **independent contingency** cell (chi-square ↔
Fisher's exact for 2×2, Cramér's V / odds-ratio). Every test reports an effect
size (+CI where defined), all numbers from scipy/pingouin. A **validation
corpus** (`engine/validation/`) asserts one case per family against independently
recomputed scipy reference values.*

*Remaining for Tier 2: paired *plots* (lines connecting matched units); the
minimal **Poisson rate** slice; **McNemar** (the paired contingency cell);
undo/redo (immer patches over the Jotai store); methods-text / statistics-table
export; sparkline mini-distributions and click-a-header descriptives; mathtext in
labels; configurable significance-star thresholds; a visible exclusion-log UI;
autosave/crash recovery. Documents are **`.iris`** files (a ZIP of a Parquet
table + JSON manifest/schema/analyses/provenance). A browser-blocked batch stays
unverified in this sandbox (no Chromium): the facet-**row** display bug and the
Phase 3 / facet / superplot e2e smokes (see `TODO.md`). Project under git since
13 June 2026. Last updated 17 June 2026.*

## 1. Vision and positioning

Iris brings Python-level plotting and statistical analysis to researchers who
don't code. The measuring stick is not a market: the tool exists to be
genuinely useful to its author and the people they work with — colleagues who
know what an ANOVA is but not how to write one, who need publication-grade
figures, and whose p-values will appear in papers and theses. Every scope
decision is arbitrated by "do we actually need this," not by competitive
breadth. The product's core concept is the reactive triad — one typed data
table linked to a figure and a statistical analysis, where editing any one
updates the others instantly and honestly.

Three properties define the product and arbitrate every decision. Power: all
inferential statistics come from scipy, statsmodels, and pingouin — citable,
battle-tested code, never reimplemented. Beauty: every figure is matplotlib
vector output with total typographic control; the screen preview and the
exported PDF are the same renderer at the same physical size. Simplicity: a
one-click installer for users, and an architecture a small team can maintain
(boring at the edges, opinionated at the core).

The closest prior art, JASP and jamovi, validates the
frontend-plus-embedded-engine architecture and the audience — and their
weakness is the reason Iris is worth building rather than adopting: their
plot output is serviceable, not publication-grade, and their users re-make
figures in Prism or ggplot. Iris's promise is never having to. No formal
competitive teardown is needed for a tool built to its author's own needs;
when designing a specific feature (presets, brackets, export), a quick look
at how they handle it is reference material, not strategy.

## 2. Settled architecture (the load-bearing decisions)

These were weighed, decided, and only reopen if a genuine blocker emerges —
not for the next attractive library.

The platform is a desktop application: a Tauri shell with a React +
TypeScript + Jotai frontend and a bundled CPython sidecar running pandas,
scipy, pingouin, seaborn, and matplotlib, communicating over localhost HTTP.
Matplotlib is the sole renderer; it emits SVG with gid-tagged artists, which
the frontend injects and wires for discrete interactivity (click-to-exclude,
tooltips). The keystone artifact is the declarative analysis spec (now at
**2.0**, semantically versioned with engine-side migration from every older
shape): grammar-of-graphics encodings + ordered geom layers + a `hierarchy`
block + a stats clause, compiling to both the plot and the test so they can
never disagree about the data. Documents are **`.iris`** files — ZIP archives
of a Parquet data table (exact dtype/null round-trip, an order of magnitude
faster to read than CSV) plus human-readable JSON parts (manifest, schema,
analysis specs, provenance log). All compute is local; data never leaves the
machine.

Consciously rejected, with reasons recorded so they need not be relitigated:
custom JS rendering via D3/Plotly/Vega (a multi-year chase to reimplement
what matplotlib provides, and Plotly's publication export and annotation
ceiling are too low); Julia/Makie (superb plotting but immature packaging,
no browser story, ecosystem and hiring risk, and speed advantages our
thesis-sized datasets never need); browser-first via Pyodide (startup weight
and WASM debugging tax paid forever for a zero-install virtue we dropped).
Accepted trade-offs: ~200 ms re-render latency instead of 60 fps continuous
interactions, and a ~100–150 MB installer.

Buy-versus-build policy: reuse mature parts at the edges (Glide Data Grid or
AG Grid Community for the grid, pandas for all import parsing, pingouin for
test orchestration, immer/zundo patterns for undo), and keep custom only the
four components that are the product's identity — the typed-column data
model, the analysis spec and its compiler, the recommendation logic with its
explanations, and the reactive linking UX. Handsontable is excluded for
licensing; mpld3 for staleness. Every dependency is a bet on maintenance and
license stability and gets reviewed as such.

## 3. Where we are

Tier 0 (one-shot browser demo) proved the product loop: the triad's
reactivity, the recommendation flow, the spec design under live mutation.

Tier 1 (walking skeleton) is built and its risky claims are empirically
validated. The engine test suite has since grown to ~270 tests (plus a
per-family validation corpus): stats match scipy ground truth to four-plus
decimals; the SVG contains one addressable element per data row inside
gid-tagged groups (the click-to-exclude contract), preserved even through the
beeswarm re-solve and coarse-grain aggregation; exclusions propagate into n,
summaries, and auto-generated methods text; PDF export measures exactly
89 × 70 mm for the Nature single-column preset with editable text (fonttype
42); `.iris` documents roundtrip; the strict-TypeScript frontend builds clean.
The reactive loop runs end-to-end against the real engine in dev mode.

One early lesson is already banked: pingouin 0.6 silently renamed its result
columns and broke the engine until a compatibility shim was added. This is
precisely why the validation suite exists, and why engine dependency versions
are pinned and recorded in every document's `engine_snapshot`.

## 4. Tier 1 — remaining work (packaging)

Goal: meet the exit criterion — a stranger double-clicks an installer,
imports a CSV, makes a figure, and exports a PDF that opens in Illustrator
with correct fonts and dimensions. The engine and frontend halves are done;
what remains is inherently machine-bound work. Freeze the engine with
PyInstaller into a single sidecar binary per OS; register it under
`bundle.externalBin` in the Tauri config and switch `spawn_engine()` from
system Python to the bundled binary; compile and run the shell on macOS,
Windows, and Linux; verify sidecar lifecycle (clean spawn, port collision
handling, kill on exit); and produce unsigned installers. Code signing and
notarization can wait for Tier 3 when external users appear. Estimated
effort: roughly a week of build-run-fix cycles, dominated by per-OS quirks.

## 5. Tier 2 — the credible tool (≈ weeks 3–8)

Goal: a real grad student produces a real thesis figure with no hand-holding.
Everything in this tier is breadth riding on existing rails — the spec, the
compiler, and the recommendation engine extend; nothing is re-architected.

**Plot matrix.** Scatter with regression line and CI band; box, violin, and
dot plots for group comparisons; bar with error bars; a unified `distribution`
geom (bars/step/line/points/KDE, plus a Boltzmann "potential" render and
sinh binning); a time-series family (per-unit trajectories + mean±band). Each
compiles from the same encodings-plus-layers grammar; the compiler is raw
matplotlib throughout (the annotation/gid control the click-to-exclude contract
needs ruled out seaborn's `objects` layer as the primary path). Paired *plots*
(lines connecting matched units) are the one plot-matrix item still pending —
they ride the spine-derived pairing, not a `pair_by` mapping (see the
data-hierarchy redesign below, which retired `pair_by`).

**Composable grammar of graphics (Phase 1 — Layers, shipped 15 June 2026).**
The plot matrix above is no longer a closed set of presets: a plot is an
ordered stack of geom layers the user composes (add / remove / reorder /
configure), seeded by the former presets as one-click templates. A single
engine-authoritative geom registry (served on `/health`) drives the layer rail,
the layered compiler, and a first-class guard pass; the guard pass's per-geom
point cap (3,000 raw marks) is what fixed the 82,241-point browser freeze —
blocking with an actionable message rather than emitting a 13.8 MB SVG.
Statistics inverted from `plot-type → test` to `encodings → an inferred,
plain-language, overridable stat_model`, defaulting to *describe, don't test*
when the design is ambiguous. The spec moved 1.3→2.0 (encodings + ordered
`{geom, params}` layers + a `facet` block), normalized engine-side so older
specs and documents keep working (the document format has since become `.iris`).

**Composable grammar of graphics (Phase 2 — Aesthetics, shipped 16 June 2026).**
`color` / `size` / `shape` are now real encodings, each mapped to a column and
resolved through a scale the compiler and legend share. Scatter draws per-point
color/size/shape as sub-series (the click-to-exclude point groups partition
across them); a categorical `color` distinct from `x` dodges the group geoms
(box/violin/bar/dot) into one sub-series per level with an exportable, draggable
legend (gid `legend`, nudgeable like the other figure labels). Okabe–Ito is now
the default palette for colourblind safety. The geom registry declares which
channels each geom accepts, so the encoding pickers only offer channels a layer
can draw, and a guard pass warns when a channel is ignored or a categorical
scale is exhausted (>8 colours / >6 markers — the natural lead-in to faceting).
Statistics gains exactly one move: a categorical `color ≠ x` is *surfaced* as a
candidate second factor in plain language, but **no two-way test runs** — the
two-way ANOVA itself remains Tier 3 (below), so Phase 2 describes rather than
mis-tests. No `spec_version` bump — the 2.0 schema already carried these slots.
The Phase 2 plan is in
`docs/superpowers/plans/2026-06-15-composable-grammar-plots-phase2-aesthetics.md`.

**Composable grammar of graphics (Phase 3 — Data-First Encodings, shipped 16
June 2026).** Phases 1–2 inverted *statistics* from plot-type to encodings; Phase 3 finishes
the job for *the figure itself*, and lands before Facets so faceting rides the
cleaner encoding model rather than the reverse. Today a hidden `family`, chosen
with the plot type, still dictates what the x-axis may hold and which primitives
are offered; Phase 3 deletes that choice and lets the **column types drive
everything**. The five channels (x, y, color, size, shape) each accept exactly
the column types that mean something — x: categorical or numeric; y: numeric
(categorical once a geom consumes it); color: categorical now, numeric (a
continuous gradient + colorbar) when built; size: numeric only (discrete size is
dropped by decision); shape: categorical only — and the *combination* of mapped
types lights up the legal primitives, with `family` reduced to a derived label
for the stats engine rather than a user choice. One mechanism carries it: each
geom declares its required `x_type`/`y_type` in the engine registry (joining
`needs`/`aes`/`params`), a channel offers a column type iff some installed geom
consumes it there, and incompatible primitives are shown **disabled-with-reason**
rather than hidden — so adding a geom later flips a capability on with no UI
rework. The vision spans the new render capability the inversion unlocks: a
**continuous color scale** (numeric color → gradient + shared colorbar legend),
**horizontal orientation** (categorical y + numeric x → horizontal
box/bar/violin/dot), and a **heatmap/tile geom with a count stat** (categorical x
× categorical y → a contingency tile, the one encoding that makes
categorical-vs-categorical worth offering and the geom that unlocks
categorical-y). Delivered as independent chunks, all shipped 16 June 2026 —
**3a** the type-driven core (the inversion, the unified encoding card,
type-gated primitives, derived family), **3b** continuous color, **3c**
horizontal orientation, **3d** the tile geom + count stat — each flipping one
`⛔`/`—` in the channel×type matrix to `✅`. No `spec_version` bump (the 2.0
encoding slots already existed; the tile geom is a new enum value plus an
`orient` param). A same-day fix pass closed a crash the tile geom exposed
(`TEST_BY_FAMILY` had no `"contingency"` key) and removed auto-seeding (a
fresh analysis now starts fully blank rather than guessing a template/mapping);
that fix left the e2e suite referencing removed UI and assumptions — tracked in
`TODO.md`. Full design in
`docs/superpowers/specs/2026-06-16-data-first-encodings-design.md`.

**Composable grammar of graphics (Phase 4 — Facets, shipped 16 June 2026).**
Mapping a categorical column to the new `facet_row`/`facet_col` channels (in
the same Encodings card, offered categorical-only — no numeric faceting in v1)
splits the figure into a 2D grid of subplots, one per combination of facet
levels present in the data, instead of pooling everything into one axes; row
and col compose into a single grid rather than two independent strips. Chrome
stays singular — one shared legend/colorbar and `fig.suptitle`/`supxlabel`/
`supylabel` for the whole grid, with plain (non-draggable) per-cell strip
titles — while point-group gids stay unique across cells via a counter offset
threaded through the drawing helpers rather than encoded into the gid string,
so the click-to-exclude wiring in `FigurePane.tsx` needed no changes at all.
**v1 is describe-only when faceted, across all four families** (group
comparison, correlation, descriptive, contingency): no per-facet inferential
test runs and no multiple-comparisons correction is applied — the same
deliberate deferral Phase 2 made for the two-way ANOVA, revisited once a real
need for per-facet testing shows up. A facet-cell-count guard blocks above 20
cells (`registry.facet_cell_cap`), mirroring the existing point-cap guard's
shape. No `spec_version` bump (`facet` was already a typed 2.0 field; only its
TS type and runtime behavior changed from an inert stub). `e2e/facets_test.mjs`
is written following the fix pattern logged in `TODO.md` (explicit CSV import,
explicit mapping, explicit `.add-layer-btn` flow) but — like the rest of
`e2e/` — unverified in this sandbox; no Chromium is installable here. Design in
`docs/superpowers/specs/2026-06-15-composable-grammar-plots-design.md`.

**Composable grammar of graphics (Phase 5 — Superplots, shipped 16 June 2026).**
A single plot now displays the same measurement at several collapse levels at
once — raw replicates (faint), one prominent mark per experimental unit (e.g.
per-subject means), and the group summary — the *superplot* pattern (Lord et al.
2020) that defeats pseudoreplication by making the real n visible. The mechanism
is a **layer-level summary stat** (`stat: {per_unit}` on a `Layer`, the grammar's
`stat_summary` / seaborn `so.Agg`), **not** another `reduce.collapse` step: it is
a visual transform that leaves the data model, n, and provenance untouched,
whereas `reduce.collapse` changes what a row *is* (and is logged as such). The
unit columns are **not** redeclared on the layer — they come from the existing
`stats.repetition_key`, so the visible per-unit marks and the inferential n share
one declaration and can never disagree. A per-unit `dot` draws one click-to-
exclude mark per unit (its `row_ids` span the unit's replicates); a per-unit
`summary`/`bar` reports the mean of unit means with unit-level error. The careful
half is statistical, not visual: the figure may show three levels but the
`stat_model` binds to exactly **one** declared inferential unit, tests on it
(n = units, unchanged from item 10), and *describes* the lower levels — the
Phase 2 *describe-don't-test* discipline extended to nesting depth. A one-click
"Build superplot" lays down the canonical raw + per-unit + summary stack (all
editable). Spec stayed within the 2.0 seams: an optional `stat` on a layer, an
echoed inferential-`unit` on `stat_model`, and `accepts_stat`/`dot` size+alpha in
the registry — absent = today's behaviour, no major bump. Design in
`docs/superpowers/specs/2026-06-16-superplots-design.md`. Depends conceptually on
the `pair_by` nesting concept (Tier 2/3) and is the lead-in to mixed models
(Tier 4).

*Absorbs `TODO.md` item 10 (independent-repetition key).* That feature already
shipped the stats half — setting a rep key collapses technical replicates to one
value per independent unit so n, the test, and the error bars count units — but
on box/violin/dot the inference basis stayed invisible (only a tiny `n` label
changed), the superplot problem by another name. Phase 5 makes that basis visible
via the per-unit overlay and settles the three deferred design questions:
box/violin/dot **keep** the raw marks while a composable per-unit overlay shows
the basis (option B, not auto-collapse); the canonical template carries a summary
so n/error are visible there (not forced globally, preserving composition); and
the semantics are mean of unit means with unit-level error. The rep key's
paired-design gap (units spanning both groups) still resolves later through the
single inferential-`unit` + `pair_by` mechanism.

**Data-hierarchy redesign (shipped 16–17 June 2026 — supersedes `reduce.collapse`,
`repetition_key`, `stat.per_unit`, and `pair_by`).** The three mechanisms above —
a destructive `collapse` reduce step, a `repetition_key` for the inferential
unit, and a planned `pair_by` for matched designs — were unified into one
**data hierarchy** after they proved to be three views of the same thing: *grain*.
A table now carries a **spine** of nested identifier columns (coarsest→finest,
e.g. `date → position → cell → frame`), defined once in the Data tab and shared by
every analysis. Each layer binds to a **level** of that spine (a spine column, or
raw); picking level L keeps every spine column from the root down to L and
aggregates everything finer by the level's function (default mean), carrying a
`row_ids` chain so excluding a coarse mark drops every raw row beneath it. This
replaces `collapse` ("average away frames" is just *pick level `cell`*, with no
complement to declare and no row mutated), makes the superplot a pure
composition of layers at different levels (retiring `stat.per_unit`), and makes
the inferential grain the coarsest level any layer draws at — so the figure and
the test read **one shared materialization**, never a parallel route. Most
consequentially it makes **pairing structural, not declared**: `pair_by` is gone;
whether a comparison is paired / partially-paired / unpaired is *derived from the
spine* (does the same home-level entity cross both compared levels?) and feeds the
test picker's structural axis directly. Reduction is now `select` + `filter` only.
Design in `docs/superpowers/specs/2026-06-16-data-hierarchy-redesign.md`.

**Statistics — the guided test picker.** Inference is *opt-in and
describe-by-default*: every analysis renders its figure and summaries with **no
test** until the user adds one on purpose (the resting state is the `describe_*`
path, consistent with the auto-seed removal in `111243b`). Adding a test runs a
short **guided decision**, not a silent recommendation. The family is fixed by
the mapped column *types* — it is the encoding, never asked — and within a
family the choice splits on at most two questions: a **structural** one
(independent vs paired/matched, prefilled from the **spine-derived pairing** —
the data-hierarchy redesign supersedes the earlier `pair_by` idea: pairing is
detected from the spine, not declared) and an **assumption** one (the only
genuine judgment call). On the assumption question the engine
**proposes an answer with a plain-language, diagnostic-backed reason, and the
user confirms it** — the Shapiro/dispersion check *informs* the question instead
of gating the test silently behind it; `chosen_by` records
`recommendation_accepted` vs `user_override` per question, as today.
"Comprehensive but not overwhelming" is delivered by progressive disclosure: the
guide leads with the two obvious options and tucks rarer ones behind a "more"
reveal. The bivariate families fall on one symmetric grid — every cell is
`(structural) × (assumption)`:

| family (from column types) | indep · parametric | indep · robust | paired · parametric | paired · robust |
| --- | --- | --- | --- | --- |
| numeric × group (2 levels) | Welch's t | Mann–Whitney U | paired t | Wilcoxon signed-rank |
| numeric × numeric (scatter) | Pearson r | Spearman ρ | — (already within-pair) | Kendall τ ("more") |
| categorical × categorical | chi-square | Fisher's exact | McNemar | exact McNemar ("more") |

Variance adds no axis — Welch is used unconditionally (the modern default: no
Levene pretest, so Student's t is intentionally absent); one-sample tests (t /
Wilcoxon vs a constant) are a separate design, not a two-group cell. Every test
reports an **effect size + CI** (Hedges' g; rank-biserial; r/ρ/τ; Cramér's V or
odds ratio for 2×2) — the rigor backbone. Tests come from pingouin (t / rank /
ANOVA / correlation) and scipy (exact tests). The **independent contingency
cells shipped 16 June 2026** (`stats.contingency_test`): Pearson chi-square
(default) ↔ Fisher's exact (2×2, recommended when an expected count < 5), with
Cramér's V / odds-ratio (+CI) effect sizes, opt-in like the other families and
still returning counts so the tile renders unchanged. McNemar (the *paired*
contingency cell) remains unbuilt — it needs the structural pairing declaration
and folds into the paired-tests work.

**Counts as a stochastic outcome — the rate (Poisson) family.** A count column
is type-indistinguishable from a continuous measurement (both `numeric`), so
naïve type-inference would misroute an event count to Welch's t. Counts
therefore get a **deliberate distribution-family declaration on the response**:
the engine detects integer / non-negative candidates and *offers* "model [y] as
event counts," default off. A count outcome is a **rate model** (Poisson, log
link; effect = rate ratio / IRR), not a mean comparison — and the contingency
chi-square is a special case of the same log-linear machinery, so this family
*generalizes* the categorical×categorical one. Its assumption axis is
**dispersion** — Poisson vs negative binomial, recommended from a Pearson-χ²/df
dispersion check (mandatory, because real counts overdisperse and naïve Poisson
is anticonservative) — and an optional **exposure/offset** column turns raw
counts into rates. Two conditions: rate ratio + the exact two-sample Poisson
test (scipy `poisson_means_test`) or a Poisson GLM. This is the GLM /
`family: "model"` lane otherwise parked in Tier 4: a **minimal slice** (1–2
conditions, rate ratio, exact test, dispersion check, via statsmodels) is
feasible here in Tier 2, while the general Poisson/NB regression (≥3 conditions,
offsets, covariates) and the repeated-measures Poisson GLMM stay in Tier 4 (§7).

**Multiple groups — the omnibus → post-hoc layer.** Above two groups a single
test cannot say *which* groups differ, so the design splits into two stages, and
this is where multiple-comparisons correction lives. Stage 1 is an **omnibus**
test (means: one-way ANOVA *F* / Welch / Kruskal–Wallis; counts: a
likelihood-ratio test on the factor in the Poisson/NB GLM). Stage 2 is
**corrected pairwise** comparisons, offered only after the omnibus: for means,
**Tukey HSD** (its built-in family-wise control, the planned default); for GLMs,
pairwise **Wald** tests on the coefficients (each a log rate ratio vs the
reference level) with a generic family-wise correction — **Holm by default
(uniformly more powerful than Bonferroni)**, with Bonferroni and others behind
"more." Tukey is reserved for the means row because it assumes the normal,
equal-variance means a GLM does not provide. The structural "how many groups"
answer gates the whole layer (2 → single test, no correction; ≥3 → omnibus +
corrected pairwise); this is exactly the correction step Phase 4 deferred for
facets and the post-hoc work the multi-group item in §10 names, and the figure's
significance brackets read from the (corrected) pairwise p-values.

**Import wizard.** A preview UI in front of `pandas.read_csv` and
`openpyxl`: delimiter and encoding detection, decimal-comma locales, type
inference with per-column confirmation, missing-value rules, and a wide→long
"stack columns" offer with live preview (this single feature prevents the
most common beginner dead-end) — all done. The same engine-side reshape
powers the data-entry wizard: people think in one-column-per-condition, so
that is what they type or paste, and the engine melts it into the long table
the analyses run on. Done 13 June 2026.

**Table upgrade.** Bake-off resolved 12 June 2026 for AG Grid Community
(MIT): Glide Data Grid's last release was February 2024 with aging peer
dependencies, while AG Grid ships monthly — under our
dependency-as-maintenance-bet policy that decided it; bundle weight doesn't
matter on desktop. The grid is wrapped by our typed-column model in
read-only-edit mode so every change flows through the store (exclusions keep
their provenance log). Done: virtualized editing grid, per-type editors and
validation, missing values, exclusion state. Pending: sparkline
mini-distributions, click-a-header descriptives, undo/redo via immer patches
over the Jotai store.

**Rigor backbone.** The exclusion log gets a visible UI (what, when, optional
reason) and a "data modified since import" indicator — provenance as a
feature, deliberately resistant to silent p-hacking. The validation suite
grows a second axis: every test family asserts equality with R reference
outputs and published worked examples, run in CI on every engine change and
on every dependency bump (the pingouin lesson, institutionalized).

**Styling and export.** Style panel done 13 June 2026 in two rounds:
grouped, plot-aware controls (text + tick rotation; markers; axes & ticks —
direction, length, sides, spacing, minor ticks, log scales, manual limits;
lines & frame with split horizontal/vertical grids; per-plot mark options —
box notches, outlier marker/size, mark width, CI95/SEM/SD error bars, cap
size, histogram bins; annotation toggles; colors; size in mm) all writing
`spec.style.overrides`, so the engine renders screen and export from the
same styled spec. Direct manipulation on the figure: title/axis/annotation
labels drag (transparent hit-rects over the glyphs — learned the hard way
that letter strokes alone are unhittable), and a corner handle drag-resizes
in real mm. Verified headless with Playwright (e2e/). Remaining: mathtext in
labels (µM, R², Greek), Okabe–Ito as the default palette for colorblind
safety, configurable significance-star thresholds, and methods-text /
statistics-table export (formatted for supplementary materials) generated
from the spec and provenance log.

Spec schema changes in this tier follow the seams designed in v1.0: new enum
values for marks and tests, a `transform` clause in `data` for derived
columns if needed, all under semantic versioning with migration code from
day one of any change.

## 6. Tier 3 — the rigor release (≈ weeks 9–14)

Goal: a colleague submits a manuscript figure made in Iris without you
sitting next to them.

Statistical depth: two-way ANOVA with proper sums-of-squares options (via
statsmodels), simple linear regression with diagnostic plots (residuals, QQ),
and assumption-check transparency threaded through every analysis — what was
checked, what it found, what it implies, in plain language. **Phase 4
(*Facets*)** of the composable grammar of graphics — the `facet` block going
live as a describe-only subplot grid — shipped early, in Tier 2 (see above),
rather than waiting for Tier 3. **Phase 5 (*Superplots* — nested collapse
levels on one plot, tested on a single honest inferential unit)** also shipped
early in Tier 2 (see above). Per-facet inferential testing with
multiple-comparisons correction, deliberately deferred by Phase 4, would land
here once a real need for it shows up. n and exclusion annotations become
standard figure furniture.

Product hardening: autosave and crash recovery (continuous local snapshots
beside the `.iris` file), polished empty and error states written to direct
rather than apologize, performance passes on the edit→render loop (warm
figure cache in the worker process, skip re-layout when only data values
moved — naive full re-renders on every keystroke would feel sluggish, so
debounce remains and caching joins it).

Distribution: signed and notarized installers for macOS, Windows, and Linux
(this is also where the deferred macOS/Windows packaging legs land); an
update mechanism; then put it in the hands of the colleagues it's for, with
their confusion treated as the bug tracker. Their feedback gates everything
in Tier 4.

## 7. Tier 4 and beyond — deferred by design

Written down so they don't creep in early, and ordered by expected demand
from the beta rather than by engineering appetite. Mixed models and
repeated-measures ANOVA (the most likely first request from the target
fields; statsmodels first, with the option of an R engine via rpy2 behind the
same protocol — the jamovi pattern — if R's implementations prove necessary);
this is the rigorous analysis that Phase 5 superplots visualize as a lead-in.
Logistic regression and a restricted model-formula grammar in the spec
(`family: "model"`). Multi-panel figure composition (a document-level
`figure` object referencing analyses). Multi-table documents with joins
(resisted until real users demonstrate the need; the one-table constraint is
a feature). A **data-manipulation layer** — column transforms (add, multiply,
or otherwise combine columns with each other) and reduction methods
(collapsing/aggregating columns into a new derived column) — is a candidate
addition once a real need shows up; reduction in particular has to be
approached carefully against the data-hierarchy/spine architecture, since
naively reducing across the nesting risks silently duplicating rows at the
wrong grain, which is part of why this likely wants multi-table support
first (an explicit derived table rather than mutating the one master table
in place). A Pyodide browser demo for zero-install sharing — the spec and
protocol design keep the engine swappable, so this is expensive but not a
rewrite. A fluid exploration mode (D3-rendered, 60 fps brushing) feeding the
same spec, with matplotlib still rendering the publication output. A
natural-language layer that compiles utterances to spec edits. Collaboration
and cloud sync, last, because "your data never leaves your machine" is a
selling point not to spend casually.

## 8. Cross-cutting disciplines

The spec is the contract: semantically versioned (at 2.0, up from the 1.0
walking-skeleton freeze), with migrations shipped with every change and
normalized engine-side so every older shape still loads, and never containing
executable code — documents must be safe to email and renderable by future
engines. Validation is policy,
not heroics: no test family ships without R-reference assertions, and CI runs
the suite against pinned and against latest dependencies so upstream drift is
caught before users see it. Provenance is product: exclusions, edits, test
choices, and engine versions are recorded and surfaced, because for this
audience auditability is a feature reviewers reward. Every tier ends with a
user-visible artifact — infrastructure that hasn't produced a figure isn't
done.

## 9. Principal risks

Packaging friction (PyInstaller × three OSes × signing) is the known
time-sink in Tier 1's remainder; budget real days for it. Dependency drift
has already bitten once and is contained by pinning plus CI. Render latency
could degrade as figures grow richer; the figure cache and selective
re-layout in Tier 3 are the mitigation, and the 200 ms budget is the metric
to hold. Scope creep is the strategic risk — the deferred list and the
"reopen only on genuine blockers" rule exist precisely to keep the small
custom core small. Finally, statistical correctness is reputational
all-or-nothing for a rigor-branded tool: hence the validation suite's
non-negotiable status and the policy of orchestrating scipy/pingouin rather
than ever reimplementing.

## 10. Immediate next actions

Tier 2 opened 12 June 2026 with import (CSV/TSV/Excel wizard), the plot
matrix core (box/violin/bar marks plus scatter+regression and
histogram+density, with correlation and descriptive stat families riding the
same spec rails), and the AG Grid table swap. 13 June 2026 added the style
panel + draggable figure labels, the one-column-per-condition data-entry
wizard with engine-side wide→long stacking (also offered in the import
wizard), and the deliberate exclusion flow (click selects, right-click
excludes; the provenance log is unchanged). 16 June 2026 closed out the
composable-grammar Phase 3 (data-first encodings: type-driven core, continuous
color, horizontal orientation, contingency tile) plus a same-day bug-fix pass,
then **Phase 4 (Facets)**: small multiples via Facet Row/Col, describe-only
per cell, gid-uniqueness and singular figure chrome across the grid, and
**Phase 5 (Superplots)**: the inferential n made visible by stacking layers at
different grains. That completes the composable-grammar track through Phase 5.
17 June 2026 re-grounded the data model on the **data hierarchy** (a table-level
spine + per-layer levels, retiring `reduce.collapse` / `repetition_key` /
`stat.per_unit` / `pair_by`; pairing now derived from the spine), added the
**time-series** family and the unified **distribution** geom, the beeswarm dot
layout, and the stats info-boxes, and shipped the rest of the **guided test
picker**: the two-group structural × assumption grid (Welch / Mann–Whitney /
paired-t / Wilcoxon, structural axis from the spine-derived pairing), the
**multi-group omnibus→post-hoc layer** (one-way ANOVA + Tukey HSD, or
Kruskal–Wallis + Holm-adjusted pairwise) and the **significance brackets** it
drives, correlation (Pearson/Spearman + OLS band), and the independent
contingency cell (chi-square / Fisher's exact). A per-family **validation
corpus** backs them against recomputed scipy references.

Remaining for Tier 2: **McNemar** (the paired contingency cell, needs the
structural pairing wired into the categorical family); the minimal **Poisson
rate** slice; **paired *plots*** (lines connecting matched units, on the
spine-derived pairing); undo/redo (immer patches over the Jotai store);
methods-text / statistics-table export; sparkline mini-distributions and
click-a-header descriptives; mathtext labels; configurable significance-star
thresholds; a visible exclusion-log UI; autosave/crash recovery. A
**browser-blocked batch** stays unverified here (no Chromium): a facet-**row**
display bug and the Phase 3 / Phase 4 / Phase 5 e2e smokes — all tracked in
`TODO.md`, to be run on a machine with a browser before `e2e/` is trusted again.
macOS/Windows packaging waits until the end, alongside Tier 3 signing.
