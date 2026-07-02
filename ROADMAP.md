# Iris — Roadmap

This is a forward-looking plan: where Iris is headed and what is deliberately
deferred. For what Iris *is* and how to run it, see [README.md](README.md); for
what has already shipped, see the git history and `docs/superpowers/specs/`.

## Where we are

**Tier 2 — the credible tool — is mostly complete.** The product loop works
end-to-end on Linux: import one or more tables, reshape them into a tidy frame on
the transformation workbench, compose a figure from a composable grammar of geom
layers, add a guided statistical test, restyle in millimetres, export a
publication-grade PDF, and save a `.iris` document. The four load-bearing systems
are built and tested:

- the **composable grammar of graphics** (ordered geom layers; color/size/shape
  encodings; facets; superplots; box/violin/bar/dot, scatter+regression, a
  unified distribution geom, contingency tiles, and a time-series family);
- the **data-hierarchy** model (a table-level spine of nested identifier levels;
  each layer binds to a grain; pairing is *derived from the spine*, not
  declared);
- the **guided test picker** (describe-by-default, opt-in tests chosen on a
  structural × assumption grid; two-group, multi-group omnibus→post-hoc,
  correlation, and independent contingency families, each effect-size-backed and
  validated against scipy); and
- the **transformation workbench** (each analysis as an interactive left→right
  dataflow graph of clickable nodes and edges; a reshaping vocabulary of
  join / pivot / grid_complete / derive / recode / filter / drop steps plus
  spine-driven collapse and a post-collapse phase; and multi-table documents —
  a pool of named input tables joined coarse→fine).

What remains in Tier 2 is breadth, polish, optimization, and — the real gate —
putting it in front of the researchers it's for.

## Guiding principles (how scope decisions get made)

- **Need, not breadth.** Every feature is arbitrated by "do we actually need
  this," judged against the author's and collaborators' real work — not against
  a competitor's feature list.
- **Never reimplement statistics.** All inference comes from scipy /
  statsmodels / pingouin. No test family ships without reference-value assertions
  in `engine/validation/`.
- **The spec is the contract.** Semantically versioned, with engine-side
  migration from every older shape, and never containing executable code — a
  `.iris` must be safe to email and renderable by future engines.
- **Provenance is product.** Edits, filters, test choices, and engine versions
  are recorded and surfaced; auditability is a feature this audience rewards.
- **Settled architecture stays settled.** Tauri + React/Jotai + a bundled
  CPython sidecar over localhost HTTP, with matplotlib as the sole renderer, was
  weighed and decided. It reopens only on a genuine blocker, not for the next
  attractive library. (D3/Plotly/Vega, Julia/Makie, and Pyodide-first were all
  considered and rejected — reasons are in the git history.)

## Tier 2 — remaining work

**Statistics breadth**
- **McNemar** — the paired contingency cell; rides the spine-derived pairing now
  that pairing is inferential-level-aware.
- **Poisson rate (minimal slice)** — a deliberate count/rate family so an event
  count isn't misrouted to a mean comparison: rate ratio + the exact two-sample
  Poisson test, with a dispersion check (Poisson vs negative binomial) and an
  optional exposure offset. The general GLM lane stays in Tier 4.

**Plots**
- **Paired plots** — lines connecting matched units, on the spine-derived
  pairing (not a declared `pair_by`).

**Product & UX**
- **Workbench authoring completeness** — the canvas *edits* every step kind and
  *creates* the single-table ones; a join's right table is now wired on the
  canvas (PR #6) and the one-sample `location` and count `rate` test families
  have their GUI test-picker controls. Still open: authoring the post-collapse
  (`reduce.post`) phase.
- **Methods-text / statistics-table export** — formatted for supplementary
  materials, generated from the spec and provenance log.
- **Sparkline mini-distributions** and click-a-header descriptives in the table.
- **Mathtext in labels** — µM, R², Greek.
- **Configurable significance-star thresholds.**
- **Style rationalization & style sheets** — one canonical home per style knob,
  driven by an engine-emitted style registry; then capture a plot's look as a
  reusable sheet and apply it across plots/files
  (`docs/superpowers/specs/2026-06-17-rationalize-plot-style-design.md`,
  `…-style-sheets-design.md`).
- **Autosave / crash recovery** — continuous local snapshots beside the `.iris`.

**Rigor & verification**
- **Real-world testing.** Hand it to the colleagues it's for and treat their
  confusion as the bug tracker.
- **Browser-verification batch.** A set of items is headlessly sound but
  unverified in a real browser (no Chromium in the dev sandbox): a facet-**row**
  display bug, and the Phase 3 / facet / superplot e2e smokes in `e2e/`. Run
  these on a machine with a browser before `e2e/` is trusted again.
- **Pan / zoom / home in the figure pane** *(investigate first)*. The engine
  renders static SVG, so this isn't free — weigh client-side viewBox pan/zoom
  (cheap, but ticks won't reflow) vs re-rendering per gesture vs an interactive
  renderer before committing.

## Tier 3 — the rigor release

Goal: a colleague submits a manuscript figure made in Iris without anyone
sitting next to them.

- **Statistical depth** — two-way ANOVA with sums-of-squares options (via
  statsmodels), simple linear regression with diagnostic plots (residuals, QQ),
  and assumption-check transparency threaded through every analysis (what was
  checked, what it found, what it implies, in plain language).
- **Per-facet inferential testing** with multiple-comparisons correction — the
  testing that faceting deliberately deferred, landing once a real need shows up.
- **n and exclusion annotations** as standard figure furniture.
- **Performance passes** on the edit→render loop — warm figure cache, skip
  re-layout when only data values moved; hold the ~200 ms render budget as the
  richer figures grow.
- **Cross-platform distribution** — signed and notarized installers for macOS,
  Windows, and Linux (the deferred macOS/Windows packaging legs land here),
  plus an update mechanism.

## Tier 4 and beyond — deferred by design

Written down so they don't creep in early, ordered by expected demand from real
use rather than by engineering appetite:

- **Mixed models / repeated-measures ANOVA** — the most likely first request
  from the target fields; statsmodels first, with R via rpy2 behind the same
  protocol if its implementations prove necessary. The rigorous analysis that
  superplots already visualize as a lead-in.
- **Logistic regression** and a restricted model-formula grammar
  (`family: "model"`).
- **Multi-panel figure composition** — a document-level figure object
  referencing analyses.
- **A Pyodide browser demo** for zero-install sharing — the spec/protocol keep
  the engine swappable, so this is expensive but not a rewrite. The hosting
  tiers (static gallery → Pyodide → backend) and the publication/handbook
  strategy this feeds are planned in
  [docs/dissemination-plan.md](docs/dissemination-plan.md).
- **A fluid exploration mode** (D3-rendered, 60 fps brushing) feeding the same
  spec, with matplotlib still rendering the publication output.
- **A natural-language layer** compiling utterances to spec edits.
- **Collaboration and cloud sync** — last, because "your data never leaves your
  machine" is a selling point not to spend casually.

## Principal risks

- **Packaging friction** (PyInstaller × three OSes × signing) is the known
  time-sink; budget real days for it.
- **Dependency drift** has already bitten once (the pingouin column rename);
  contained by pinning plus the validation suite in CI.
- **Render latency** could degrade as figures grow richer; the figure cache and
  selective re-layout are the mitigation, the ~200 ms budget the metric to hold.
- **Scope creep** is the strategic risk — the deferred list and the "reopen only
  on genuine blockers" rule exist to keep the small custom core small.
- **Statistical correctness** is reputational all-or-nothing for a rigor-branded
  tool — hence the validation suite's non-negotiable status.

---

*On the name:* **Iris** is the Greek goddess of the rainbow and messenger of the
gods — the spectrum of a figure and the live link between table, figure, and
stats — and also the canonical statistics dataset (Fisher, 1936), an instant
signal to the researchers this tool is for.
