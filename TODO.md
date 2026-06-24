# TODO

Open items only. Shipped work is removed from this file once it lands — see git
history and `docs/superpowers/specs/` for the per-item write-ups. Already shipped:
the composable grammar of graphics, the data-hierarchy model, the guided test
picker, the validation corpus, style-rationalization + loadable style sheets, the
n/N annotation, pan/zoom, real `.iris` save/load (File System Access), the
one-sample `location` and count `rate` families + their plot types, the rank-floor
recommendation guard, the transformation explorer (dataflow graph + un-forced
nesting / editable collapse routing + never-blocking guards), the `.iris` file
format redesign (engine identity in the manifest, stored stats = decisions only,
spec 2.1), and the COV2D absorption work below through Tier C + Part-2 §3/§5.

## COV2D absorption

The COV2D report's pandas prep (`code/cov2d/figures.py`, `tables.py`) was the
corpus for the transformation explorer. Tiers A–C and Part-2 §3/§5 have landed on
`main`: the nested-median SuperPlots; the `derive`/`recode`/`join`/`pivot`/
`grid_complete`/expression-`filter` reduce vocabulary; arbitrary-grain collapse +
the pseudoreplication / pairing-flip / identity-merge / post-aggregate-derive
guards; the post-collapse `reduce.post` phase; and §3 enrichment verified on real
data.

**Open — Part 2 §4 / §4A (the only remaining absorption gap); in progress on a
separate thread.** The §4A crowding figure's statistical decision gate is resolved
(the replicate-level Spearman → Fisher-z → one-sample t needs no `correlation`-
family extension); the remaining work is plumbing the N-way join + `opp` pivot +
`het` derive at per-cell grain through to the stat path. Being executed elsewhere
— no in-repo plan file.

**Follow-on (deferred with §4): `pivot` showcase example + guide chapter entry.**
The capability showcase
(`docs/superpowers/specs/2026-06-24-cov2d-capability-showcase-design.md`) covers
the new reduce vocabulary except `pivot`, whose natural home is the §4 `opp`
long-to-wide reshape. Once §4 lands, add a `pivot` showcase case + a "Reshaping
real data" chapter entry, rather than author a competing example now.

**Tier D — out by nature; do NOT absorb.** Upstream of the tidy table, or outside
the SuperPlot+test model; absorbing them would break "spec is data, not code" /
"never reimplement statistics":
- `nls_classification.py` — TIFF → per-track intensity → Otsu (image processing).
- `neighborhood.py` — contact-graph adjacency + 1000× label-shuffle null over
  `.h5` (pre-tidy feature extraction + bespoke Monte-Carlo test).
- `msd_alpha`/`alpha_per_cell` — per-track log-log MSD slope over a fixed lag
  window (a windowed-regression feature, not a group aggregate).
- `coordination.py` — velocity correlation *functions* `C_v(r)`/`S(r)` + a shuffle
  null → a line plot; already outside Iris's per-replicate families.

The dividing line: **Iris absorbs everything from the pooled tidy table onward
(reshape → figure → stat); everything that produces that table from images/graphs
stays upstream.** COV2D's `tables.py` is the boundary; `figures.py` is almost all
absorbable reshaping.

**Status (2026-06-24): §4 absorbed — part 2 complete.** The §4A correlation gate is
closed on branch `cov2d-correlation-collapse`. Two engine additions, both with unit
tests (engine suite 482 green): (1) the **correlation family now runs through
`collapse` + `reduce.post`** (`render.py`; the point-cap guard is collapse-aware so
the post-collapse per-cell scatter isn't blocked by the raw per-frame count); (2)
**`join` accepts a right side carrying its own `reduce` + `collapse` sub-pipeline**
(`reduce.py`; `project_schema` projects it) — so features at different grains (each a
per-cell median over its OWN frame support; the het SUM-pivot) join at a shared
grain without being forced onto a common intersected support first. The data repo's
`reports/COV2D/verify_s4.py` rebuilds all four §4 correlation `.iris` from ONE
self-contained per-cell assembly and reproduces the committed r/p (crowding_q
−0.174/0.049, crowding_speed −0.122/0.008, het_q −0.088/0.396, het_speed
−0.024/0.631). `per_cell_features` is now fully expressible as Iris steps.

## Open follow-ups

### App-side test-picker controls for the `location` & `rate` families
Both families ship engine-first: a `.iris` authored in JSON selects them today,
but the GUI GuidedTestPicker has no control to choose the one-sample design +
reference value (`location`), or the design + exposure/model (`rate`). Add those
controls so the families are reachable without hand-editing the spec. Deferred
per the N/Q design specs; the engine + render paths are done and tested.

### Identifier default vs time-on-X (product note — flag only, no change made)
A column named `frame`/`time`/`timepoint` defaults to `type: identifier` and so
isn't axis-mappable without a manual retype — friction for the core time-lapse
use case (time on X is the whole point of the time-series geom family). Decision
2026-06-22: left as is, recorded here. If revisited, let `time`-like tokens stay
numeric/axis-mappable by default (or offer a one-click "use as axis" nudge like
the 0/1→bool one) without losing their nesting-level role.

### Transformation explorer — inline editing on edges
The explorer ships as a dataflow graph: nodes = data (`table`/`plot`/`stats`),
edges = transformations (`filter`/`drop`/`collapse`/`geom`/`test`). Next
sub-project: click an edge to edit that transformation in place (filter
conditions, dropped columns, collapse level), and surface the `derive` / `recode`
/ `join` reduce kinds as editable edges. Plugs into the existing
`src/explorer/graph.ts` nodes+edges frame. Needs its own brainstorm → spec → plan
before code.

### Transformation explorer — backend SVG render of the graph
A standalone export that renders the data-transformation graph itself as SVG —
the lineage diagram (Source → filter/drop → collapse chain → geom/test →
plot/stats), not the plot. The seam already exists on the figure side: the *plot*
is engine-rendered (matplotlib → SVG) and exported via `POST /export`
(svg/pdf/png) → `compiler.figure_to_bytes`; the *graph* today is only drawn
client-side (`src/components/TransformExplorer.tsx`) from `buildGraph(...)` in
`src/explorer/graph.ts` (typed `ExplorerGraph` = nodes + edges). This feature
gives the graph the same backend export path the figure has, so a methods/lineage
figure can be saved or embedded in a paper.

Design fork to settle in the spec: the engine already receives the exact inputs
`buildGraph` consumes (reduce steps, hierarchy/spine, layers, stats), so it can
**re-derive** the graph server-side — keeping "spec is data, engine owns truth"
and mirroring `/export` — rather than having the client POST a pre-built
`ExplorerGraph`. Re-derivation risks node/edge drift from the TS `buildGraph`
unless the derivation is shared or pinned by a fixture test against the TS
output; it also needs its own layout pass (the TS view is a left→right chain with
branch edges below — SVG needs its own coordinates). Side-feature — own
brainstorm → spec → plan before code.
