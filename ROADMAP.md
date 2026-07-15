# Iris roadmap

Open items only. Shipped work leaves this file: the git history and
`docs/superpowers/specs/` hold the per-item write-ups. This is the single list,
consolidating what used to live in `TODO.md` and the open tail of a full-repo
code review.

## Where it is rough

The honest read on what a new user is most likely to break, roughly in order of
how likely it is to bite:

- **Data editing** just got a large enhancement (Excel-like selection, keyboard
  navigation, copy/paste, cut, column and discontiguous selection across both
  spreadsheet grids). It is new, it still has wrinkles, and it is barely tested.
- **The workbench**, and the complex computation it now allows (multi-table
  documents, joins, pivots across grain), is also quite new. It likely has
  wrinkles and has not seen much real use.
- **Large parts of the documentation are stale** and need a rewrite.
- **The Guide tab UI needs an overhaul.**
- **Documentation and validation are a rough first draft.** Both need
  substantially more coverage than they have.

Underneath all of these: Iris has not yet been used for a published analysis.
Handing it to the researchers it is for is the next milestone, and the one most
likely to reorder everything below.

## Statistics

- **McNemar**, the paired contingency cell. Rides the spine-derived pairing.
  `contingency_test` defers it explicitly (`stats.py:1209`).
- **Poisson rate: finish the family.** Per-group rate with CI, the exposure
  offset, and the Poisson-vs-negative-binomial dispersion check are shipped
  (`stats.py:755-881`). Still missing: the rate-ratio effect size between two
  groups (`result.effect` is always `_no_effect()`, `stats.py:863`) and the exact
  two-sample Poisson test. Only the asymptotic GLM likelihood-ratio test exists.
- **`alpha` is a parameter in name only.** `stats.py:520,526,892,1013,1258`
  hardcode `1.96` / `0.975` while `:984` honors `1 - alpha`. Harmless today
  because the frontend pins `alpha: 0.05` with no UI to change it, and a trap the
  day it does not.

## Plots and figure

- **Paired plots**: lines connecting matched units, on the spine-derived pairing.
  The paired *test* is shipped; no geom draws the connecting lines.
- **Sparkline mini-distributions** and click-a-header descriptives in the table.
- **Configurable significance-star thresholds.** `_p_stars` hardcodes
  `0.001/0.01/0.05` (`stats.py:37`), and `StatsPanel.tsx:13` duplicates the same
  cutoffs.
- **Exclusion annotations.** The n/N sample-size labels are shipped
  (`compiler.py:238-272`); an annotation for what a filter dropped is not.
- **The stats panel promises numbers it does not show.** `statsGlossary`
  describes the 95% CI of the mean and the IQR; `StatsPanel` renders only n, mean
  and SD. The engine already computes and ships `ci95_half`, and nothing in the
  frontend reads it (`types.ts:540` is its only mention). Either render it and
  drop the IQR sentence, or align the prose. This is the smallest live gap
  between what Iris says and what it does, so it should not sit here long.

## Workbench

- **Authoring post-collapse (`reduce.post`) steps from the UI.** The engine phase
  is complete and round-trips through a `.iris`; the UI shows an honest stub
  ("post-aggregate steps aren't editable here yet",
  `workbench/cards/OpEditorCard.tsx:46`) and the `+` menu offers nothing for the
  post phase by design (`authoring.ts:56`). The real feature needs its own
  brainstorm and spec before code.
- **Backend SVG render of the transformation graph**, so the lineage diagram can
  be exported for a methods figure the way the plot already is via `POST /export`.
  The graph is drawn client-side only (React Flow). The fork to settle first: the
  engine already receives everything `buildGraph` consumes, so it can re-derive
  the graph server-side, which keeps "the engine owns truth" but risks drift from
  the TypeScript derivation unless shared or pinned by a fixture test. It also
  needs its own layout pass. Own brainstorm and spec before code.
- **Close spec 2.2: one fan-in mechanism, not two.** A join's right side can
  still arrive either as an inline `right` table or as a `right_table_id` pool
  reference (`types.ts:271`). The reduce DAG set out to leave one. Dissolving the
  redundant inline-right path is the close-out item, and two coexisting join
  mechanisms tax every later change until it lands.
- **`mergeGuards` discards the engine's `post_aggregate_derive` guard** while
  `explorer/graph.ts:210` computes a local look-alike. The badges render, so this
  is drift risk rather than a hole.

## Packaging and distribution

- **Cross-platform distribution.** Linux is the only verified platform. macOS and
  Windows builds are not packaged or verified, installers are unsigned, and
  signing and notarization are deferred. An update mechanism goes with them.

## Code-review tail

The low-severity remainder of the 2026-07-01 full-repo review. Each is real and
none is urgent; they are recorded so they are not rediscovered.

- **GuidedTestPicker two-pick race** (§4.2) and **duplicate card ids in
  authoring** (§4.13). Both need the graph and edge context to fix correctly.
- **`loadDocument` bails on an empty `doc.tables`** (§4.7), with a deliberate
  "already cleared" comment. The right empty-workspace semantics is a product
  call, not a bug fix.
- **`WorkbenchCanvas.tsx:126`** recomputes the full React Flow layout via
  `useMemo` on every graph tick and drag-stop, for a value `useNodesState` and
  `useEdgesState` ignore after the first render. Use a lazy initializer.
- **Dead-looking wire contract**: the `/sample` and `/table` endpoints
  (`main.py:567,578`), `GeomDef.needs`, and `/reduce`'s `summary` each have a
  test caller or cross the wire. Removing them is a subsystem decision, not a
  deletion.
- **`@tauri-apps/cli`** is a devDependency no npm script invokes; the README
  documents `cargo tauri dev`. Confirm it is kept for `npx tauri`, or drop it.
- **Dormant by design, do not strip**: the `reduce.post` plumbing (above) and
  `FilterCond.bound`, the expression-valued filter threshold, which the engine
  supports and only a hand-written `.iris` reaches.

## Recorded decisions

- **Identifier default vs time on X** (2026-06-22, left as is). A column named
  `frame` / `time` / `timepoint` defaults to `type: identifier`, so it is not
  axis-mappable without a manual retype: friction for the time-lapse use case
  that the time-series geoms exist to serve. If revisited, let `time`-like tokens
  stay numeric and axis-mappable by default, or offer a one-click "use as axis"
  nudge, without losing their nesting-level role.
- **COV2D absorption is complete.** Iris absorbs everything from the pooled tidy
  table onward (reshape, figure, stat); whatever produces that table from images
  or graphs stays upstream. Deliberately **not** absorbed, because they sit
  upstream of the tidy table or outside the test model: per-track intensity and
  Otsu classification, contact-graph adjacency with a label-shuffle null,
  per-track log-log MSD slopes, and velocity correlation functions.

## Deliberately deferred

Written down so they do not creep in early, ordered by expected demand from real
use rather than by engineering appetite. If something here should not be, an
issue is the place to argue it.

- **Mixed models / repeated-measures ANOVA**: the most likely first request from
  the target fields. statsmodels first, R via rpy2 behind the same protocol only
  if its implementations prove necessary.
- **Logistic regression** and a restricted model-formula grammar.
- **Two-way ANOVA** with sums-of-squares options, and **simple linear regression**
  with diagnostic plots.
- **Per-facet inferential testing** with multiple-comparisons correction: the
  testing that faceting deliberately deferred, landing once a real need shows up.
- **Multi-panel figure composition**: a document-level figure object referencing
  analyses.
- **A Pyodide browser demo** for zero-install sharing. The spec and protocol keep
  the engine swappable, so this is expensive but not a rewrite.
- **A fluid exploration mode** (D3-rendered, 60 fps brushing) feeding the same
  spec, with matplotlib still rendering the publication output.
- **A natural-language layer** compiling utterances to spec edits.
- **Collaboration and cloud sync**, last, because "your data never leaves your
  machine" is not a property to spend casually.
