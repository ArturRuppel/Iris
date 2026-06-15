# Iris — Product & Engineering Roadmap

> **Name:** The project is named **Iris** (formerly the working title
> "Triad"). Iris is the Greek goddess of the rainbow and the messenger of the
> gods — the spectrum of a figure and the live link between table, figure, and
> stats — and is also the canonical statistics dataset (Fisher, 1936), an
> instant signal to the researchers this tool is for. It nods to Prism's
> light-splitting association sideways, as kin rather than knockoff. The code
> rename (package id, Tauri bundle, `iris_engine`) is complete.

*Status: Tier 0 and Tier 1 complete on Linux (validated installer, sidecar
lifecycle, orphan prevention); macOS/Windows packaging deferred to the end by
decision. Tier 2 underway: import wizard (CSV/TSV/Excel, locale sniffing,
type confirmation, wide→long stacking), plot matrix core (box, violin, bar,
scatter+regression, histogram+density with correlation and descriptive stat
families), the AG Grid table upgrade, the style panel (markers, lines, frame,
colors, text, size; draggable figure labels that export identically), the
data-entry wizard (one column per condition), and deliberate exclusion
(select + right-click) are in. One master table now feeds many live-computed
*plottables* — each a saved reduction (row filter + group/aggregate collapse)
carrying its own figure and stats; the workspace splits into a maximized-table
"Data" mode and an "Analyses" mode (plottable sidebar + collapsible
reduced-table / figure / stats sections). The spec gained an additive `reduce`
clause, now an **ordered pipeline of composable steps** — `select` (column
projection), `filter`, `collapse` — applied engine-side in pandas before the
existing mappings→figure→stats pipeline (spec 1.2→1.3; older specs migrate
losslessly to a two-step filter→collapse pipeline). The Analyses workspace
gained a collapsible **pipeline rail** with prefix-grouped, searchable column
pickers (tames 50+ column datasets), a live `/reduce` preview (capped, with a
per-step row-count funnel), and a content-hash table cache so large master
tables upload once and ride as a token instead of re-sending on every edit. The
wide `cells_by_frame` dataset is the new default sample. Plots are now a
**composable grammar of graphics** (Phase 1, *Layers*): the six fixed plot
types became an ordered, editable stack of geom layers driven by an
engine-authoritative geom registry, with first-class validity guards (a
per-geom point cap that turns the 82k-row browser freeze into an actionable
message) and statistics inferred from the encodings into a visible, overridable
`stat_model` (with a describe-only escape hatch); the spec moved 1.3→2.0 and
older specs/documents migrate losslessly. **Phase 2 (*Aesthetics*:
color/size/shape ← a column, with scales, an exportable legend, dodged second
factors, and the Okabe–Ito palette) shipped 16 June 2026**; a categorical color
distinct from x is surfaced as a candidate second factor but not yet two-way
tested (that is Tier 3). The next grammar cycle is **Phase 3 (*Data-First
Encodings*)**: the column *types* mapped to channels — not a hidden plot-family
chosen with the plot type — drive which primitives are offered, unlocking
continuous color, horizontal orientation, and a count heatmap; it is specced for
follow-up (`docs/superpowers/specs/2026-06-16-data-first-encodings-design.md`).
**Phase 4 (*Facets*)** — small multiples via the `facet` block, already designed
into the schema
(`docs/superpowers/specs/2026-06-15-composable-grammar-plots-design.md`) —
follows it. Project is under git as of 13 June 2026. Last updated 16 June 2026.*

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
tooltips). The keystone artifact is the declarative analysis spec (v1.0,
frozen): grammar-of-graphics mappings plus a stats clause, compiling to both
the plot and the test so they can never disagree about the data. Documents
are `.viz` files — ZIP archives of human-readable parts (manifest, CSV,
schema JSON, analysis specs, provenance log). All compute is local; data
never leaves the machine.

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
validated by an 8-test suite: stats match scipy ground truth to four-plus
decimals; the SVG contains one addressable element per data row inside
gid-tagged groups (the click-to-exclude contract); exclusions propagate into
n, summaries, and auto-generated methods text; PDF export measures exactly
89 × 70 mm for the Nature single-column preset with editable text (fonttype
42); `.viz` documents roundtrip; the strict-TypeScript frontend builds clean.
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
dot plots for group comparisons; bar with error bars; histogram and density;
paired plots (lines connecting subjects, enabled by the spec's `pair_by`
mapping). Each compiles from the same mappings-plus-layers grammar; the
compiler targets seaborn's modern `objects` interface where it fits and raw
matplotlib where annotation control demands it.

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
specs and `.viz` documents keep working.

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

**Composable grammar of graphics (Phase 3 — Data-First Encodings, planned).**
Phases 1–2 inverted *statistics* from plot-type to encodings; Phase 3 finishes
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
categorical-y). Delivered as independent chunks — **3a** the type-driven core
(the inversion, the unified encoding card, type-gated primitives, derived family;
today's renderers only), then **3b** continuous color, **3c** horizontal
orientation, **3d** the tile geom + count stat — each shippable, each flipping
one `⛔`/`—` in the channel×type matrix to `✅`. No `spec_version` bump expected
(the 2.0 encoding slots already exist; the tile geom is a new enum value plus an
`orient` param). Full design in
`docs/superpowers/specs/2026-06-16-data-first-encodings-design.md`. **Phase 4
(*Facets*)** follows; its design is in
`docs/superpowers/specs/2026-06-15-composable-grammar-plots-design.md`.

**Test matrix.** One-sample, two-sample (Welch), and paired t-tests;
Mann–Whitney and Wilcoxon signed-rank; one-way ANOVA with Tukey post-hocs;
Kruskal–Wallis; chi-square; Pearson and Spearman correlations. All via
pingouin, all reporting effect sizes and confidence intervals, all wired into
the recommendation tree: number of groups, paired or independent (derived
from `pair_by`), and assumption checks select the suggested test, with the
reasoning always displayed and always overridable. Overrides are recorded as
`user_override` in the spec, as today.

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
checked, what it found, what it implies, in plain language. Faceting enters
the plot grammar — **Phase 4 (*Facets*)** of the composable grammar of graphics
(the `facet` block, already present in the 2.0 spec, goes live as a subplot
grid; see the composable-grammar design spec). Phases 2 (*Aesthetics*:
color/size/shape encodings) and 3 (*Data-First Encodings*) precede it. n and
exclusion annotations become
standard figure furniture.

Product hardening: autosave and crash recovery (continuous local snapshots
beside the `.viz` file), polished empty and error states written to direct
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
same protocol — the jamovi pattern — if R's implementations prove necessary).
Logistic regression and a restricted model-formula grammar in the spec
(`family: "model"`). Multi-panel figure composition (a document-level
`figure` object referencing analyses). Multi-table documents with joins
(resisted until real users demonstrate the need; the one-table constraint is
a feature). A Pyodide browser demo for zero-install sharing — the spec and
protocol design keep the engine swappable, so this is expensive but not a
rewrite. A fluid exploration mode (D3-rendered, 60 fps brushing) feeding the
same spec, with matplotlib still rendering the publication output. A
natural-language layer that compiles utterances to spec edits. Collaboration
and cloud sync, last, because "your data never leaves your machine" is a
selling point not to spend casually.

## 8. Cross-cutting disciplines

The spec is the contract: frozen at v1.0, semantically versioned, migrations
shipped with every change, and never containing executable code — documents
must be safe to email and renderable by future engines. Validation is policy,
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
excludes; the provenance log is unchanged). Remaining for Tier 2: the
multi-group path — one-way ANOVA with Tukey post-hocs and Kruskal–Wallis,
plus the bracket annotation work it drives; paired plots and tests
(`pair_by`); undo/redo; methods/statistics-table export. (The jamovi/JASP
teardown was dropped with the purpose restatement: there is no positioning
to defend, only features to get right. macOS/Windows packaging waits until
the end, alongside Tier 3 signing.)
