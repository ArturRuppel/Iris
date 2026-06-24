# TODO

Open items only. Shipped work — the composable grammar of graphics, the
data-hierarchy model, the guided test picker, the validation corpus,
style-rationalization + loadable style sheets, the n/N annotation, pan/zoom,
real `.iris` save/load (File System Access), the one-sample `location` and
count `rate` families + their plot types, the rank-floor recommendation guard,
and the 2026-06-22 browser-verification batch (incl. the outlined-text SVG/PDF
bug) — was removed from this file once it landed. See git history and
`docs/superpowers/specs/` for the per-item write-ups.

## COV2D absorption — data-prep targets (added 2026-06-23)

The COV2D report's pandas prep (`code/cov2d/figures.py`, `tables.py` in the data
repo) is the corpus for the transformation explorer
(`docs/superpowers/specs/2026-06-23-transformation-explorer-design.md`). Mapping
every prep op against the graph's node types sorts the work into four tiers. The
engine already supports every **stat** family COV2D uses (`location`,
`correlation`, `rate`/NB, `distribution`/`descriptive`) — the entire gap is on
the **data-prep** side, which is exactly what this direction absorbs.

**Tier A — the §1–§2 shape & motility SuperPlots.** The cleanest absorption: the
replicate stat is the *default* nested-median flatten chain
(`frame→cell→field→experiment`) and the paired-t + Hedges g already exists. The
only new prep is the minimal first form of `derive`/`recode`/`join`, all
raw-grain. First concrete target + equivalence test against the notebook's own
numbers. Spec'd 2026-06-23 →
`docs/superpowers/specs/2026-06-23-cov2d-absorption-tier-a-design.md`.

**Tier B — the named deferred nodes, with COV2D as the corpus.** `derive` (#1:
`q = perimeter/√area`, `speed×3600`, key concat, boolean flags), `recode` (#2:
class-label relabel), `join`/spine-aligned union (#3: `_join_class`, the §4
`per_cell_features` 4-table concat). Already the explorer spec's deferred plan;
COV2D confirms the order — `derive` unblocks the most sections, `join` unblocks §4.

**Tier C — gaps the explorer spec doesn't yet name a node for.** Surfaced by
COV2D; design these before they're rediscovered mid-build:
- **post-aggregate `derive`** — `log2(Σobs/Σexp)` (§3), `het = o/(s+o)` (§4): a
  derive that runs *after* a flatten, where the grain-safety guarantee stops
  being free (the spec's `derive` is raw-grain only). This is where guards earn
  their keep.
- **grid-completion / cross-join + 0-fill** — §5's `pos × tt` rate grid; an
  absent (field × transition) is a real zero, not missing. Non-optional for
  honest rate denominators; the spec names "grid-completion" but gives no node.
- **data-dependent `filter` bounds** — §5's tail-clip at the 99th pct of `|L|`;
  current filter takes static literals only (needs a derive feeding the filter,
  or an expression-valued filter).
- **pivot/unstack** (long→wide, §4's `opp`) and **vertical union/append**
  (pooling per-position tables) — reshapes the horizontal-join framing misses.

**Status (2026-06-24): Tiers A–C largely landed.** The §1–§2 SuperPlots (A) and
the Tier B/C reduce vocabulary — `derive` bool/concat, `pivot`, `grid_complete`,
expression-valued `filter` — are on `main`, as is the arbitrary-grain collapse
machinery (C1's basis) and the pseudoreplication / pairing-flip / identity-merge
guards (C3's basis), landed via the un-forced-nesting work. Spec + plan:
[Tier B/C spec](docs/superpowers/specs/2026-06-24-cov2d-absorption-tier-b-c-design.md),
[plan](docs/superpowers/plans/2026-06-24-cov2d-absorption-tier-b-c.md). **Deferred
part 2:** B1/B3 end-to-end composition, the C3 post-aggregate-`derive` guard
wiring, and the §3/§4/§5 figure-assembly equivalence tests against the notebook's
`replicate_spearman` / `write_t1_rate_iris` numbers.

**Tier D — out by nature; do NOT absorb.** Upstream of the tidy table, or outside
the SuperPlot+test model; absorbing them would break "spec is data, not code" /
"never reimplement statistics":
- `nls_classification.py` — TIFF → per-track intensity → Otsu (image processing).
- `neighborhood.py` — contact-graph adjacency + 1000× label-shuffle null over
  `.h5` (pre-tidy feature extraction + bespoke Monte-Carlo test).
- `msd_alpha`/`alpha_per_cell` — per-track log-log MSD slope over a fixed lag
  window (a windowed-regression feature, not a group aggregate).
- `coordination.py` — velocity correlation *functions* `C_v(r)`/`S(r)` + a shuffle
  null → a line plot; already "outside Iris's per-replicate families".

The dividing line: **Iris absorbs everything from the pooled tidy table onward
(reshape → figure → stat); everything that produces that table from images/graphs
stays upstream.** COV2D's `tables.py` is the boundary; `figures.py` is almost all
absorbable reshaping.

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
The explorer shipped 2026-06-23 (branch `transformation-explorer-remodel`, spec
`docs/superpowers/specs/2026-06-23-transformation-explorer-remodel-design.md`) as
a dataflow graph: nodes = data (`table`/`plot`/`stats`), edges = transformations
(`filter`/`drop`/`collapse`/`geom`/`test`). Next sub-project: click an edge to
edit that transformation in place (filter conditions, dropped columns, collapse
level), and introduce the reserved new transformation types `derive` / `recode`
/ `join` as new edge kinds. Plugs into the existing `src/explorer/graph.ts`
nodes+edges frame. Needs its own brainstorm → spec → plan before code.

### Transformation explorer — backend SVG render of the graph (side-feature, added 2026-06-23)
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

### Transformation explorer — un-force the nesting
The bigger conceptual one. Make the canonical collapse chain a *removable
default* rather than an enforced spine: the user can re-route/branch it, with
pseudoreplication protection moved from a wall to loud, specific guard-warnings
("Iris guides and educates; the user is ultimately responsible"). Reshapes how
the spine + identifier/classifier roles drive the graph (roles demote from schema
law to default-generators). See the remodel spec's "Out of scope" section. Own
brainstorm → spec → plan before code.
