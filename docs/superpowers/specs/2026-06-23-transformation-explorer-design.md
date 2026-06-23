# Transformation explorer — visualizing data shaping as a graph

*Status: draft, 23 June 2026. Establishes the data-prep direction for Iris:
multi-table-capable, graph-shaped data shaping with the nesting hierarchy as a
**removable default** rather than an enforced constraint. The MVP is the explorer
UI over the steps Iris already runs (filter · drop · flatten); new transformation
power (derive · recode · join · multi-table) plugs into the same frame later.
Likely a `spec_version` bump once the pipeline is modelled as a graph.*

## The problem

Today Iris's data shaping is real but **invisible and scattered**, and its power
stops exactly where researchers need it most.

1. **Shaping is split across three places.** The spine/hierarchy lives in "data"
   mode (`HierarchyPanel`), the reduce steps live in the `LayerRail`
   (`PipelineSection`), and the materialized result shows in `ReducedTable` with a
   level dropdown. There is no single view of "how the data was analyzed."
2. **Power stops at the one-table, strictly-nested model**, so the interesting
   prep escapes into Excel/pandas — where it becomes *unauditable*. The COV2D
   report's `cov2d/figures.py` and `cov2d/tables.py` do joins, derived columns
   (`q = perimeter/√area`), recodes, and grid-completion in pandas *before*
   Iris ever sees the table. The provenance Iris prides itself on has a hole the
   size of the entire prep pipeline.
3. **The strict line fights the data's real shape.** A SuperPlot (per-cell points
   *and* per-experiment means) is a flatten **fan-out**; a join is two inputs
   **converging**; a crossed design is a branch that does not nest. The current
   spine + per-layer level-selection is a workaround that flattens a graph into a
   line.

## The principle

**Iris guides and educates; the user is ultimately responsible.** More power to
the user, more responsibility on the user. We move integrity from a *wall* (the
model forbids the mistake) to *guardrails* (the model proposes the correct default
and loudly explains the consequence of leaving it). This is a deliberate evolution
of the earlier "opinionated core prevents mistakes" stance.

Why this is *more* honest, not less: the wall never actually prevented the
mistake — it pushed prep into Excel/pandas where the mistake became invisible
(literally the COV2D situation). Bringing the power inside Iris with a legible,
auditable graph and a loud guard beats a wall users climb over.

The price, stated plainly: this preserves the rigor brand **only if the default
proposer is genuinely good and the guards are loud and clear.** Both become
load-bearing investments, not nice-to-haves.

## The model: a transformation graph

The pipeline becomes a **directed acyclic graph** of typed nodes:

- `source` — an input table (one today; several once multi-table lands).
- `filter` — drop rows by condition (today's `FilterStep`).
- `drop` — remove named columns (today's `SelectStep`, **renamed and flipped** to
  remove-list semantics; see below).
- `flatten` — aggregate to a coarser grain (one node per spine level: the
  nested-median collapse, made visible step by step).
- *(reserved, later)* `derive` · `recode` · `join`.

Edges are data flow. Most documents are a single chain — for one source and a
nested design the graph **is a line**, and renders as the legible linear pipeline.
It only branches when the user opts into something genuinely branchy (a SuperPlot
fan-out, a join, a crossed factor), where the added visual complexity is paid for
by capability.

### Nesting is the default, not the law

From the column roles (inferred by the importer, overridable by the user) Iris
**proposes** the canonical nested flatten chain — coarsest→finest, median at each
level. Accept it (the one-click default) and you get today's correct behavior.
Deviate — add a flatten to a second grain, a join, an alternate aggregate — and
nothing stops you. The nesting is a strong suggestion, not a constraint.

### Identifier / classifier / measure: demoted to default-generator

The three column roles survive, because the trichotomy is irreducible under any
group-by:

| role | meaning under a flatten | example |
|------|--------------------------|---------|
| **identifier** | grain key — seeds the default chain's grouping | `experiment, position, cell, frame` |
| **classifier** | categorical attribute carried along; available to split on (color/facet/x) | `class_label`, `condition` |
| **measure** | numeric, gets aggregated by the level's `fn` | `area_um2`, `speed` |

What changes is their *authority*: roles no longer **constrain** the graph, they
**propose** it. Identifiers seed grain keys; classifiers seed carried/split
attributes. They are inferred, overridable, and ignorable. Longer term the roles
can become *emergent* — descriptions of how a column is used in the graph — with
inference only seeding the first proposal.

A classifier that varies within *every* level is already a **crossed factor**
riding through all flattens; this is how the current model encodes nest-vs-cross.
True crossed-factor / non-nested designs are the deferred branch — the one thing
that genuinely relaxes strict nesting (see Deferred).

### Integrity via guards, not enforcement

With the wall gone, pseudoreplication protection moves to the **guard pass**
(`engine/iris_engine/guards.py`). Guards inspect the graph + the stat's grain and
warn when a node is statistically dangerous — e.g. *"this test reads per-cell rows
but your replication unit is experiment; N is inflated — here is the nested fix."*
Warn, explain, offer the default; never forbid. The honest-stats promise is kept
by transparency.

## The explorer UI (MVP)

A linear, color-coded transformation pipeline that visualizes the steps Iris
already runs, with a general **data tab** that replaces `ReducedTable` and shows
the table **at the clicked node**.

### Step types and color code

| kind | color | what it does |
|------|-------|--------------|
| `source` | slate | the input table |
| `filter` | rose | drop rows by condition |
| `drop` | amber | remove named columns |
| `flatten` | violet | aggregate to the next coarser grain (one node per level) |
| `derive` | green | *(later)* new column from a row-wise formula |
| `recode` | teal | *(later)* relabel categorical levels |
| `join` | blue | *(later)* attach another table on a shared key |

### Decisions locked in this pass

- **`select` → `drop`.** Today's `SelectStep` is a *keep-list* (`columns` that
  survive), which is backwards for a non-coder and silently loses new columns.
  Replace with remove-list semantics: name what to remove, everything else passes
  through. Keep the step (don't delete it) — an explicit, recorded "we dropped
  these columns" is part of *how the data was analyzed*, so it belongs in the
  auditable graph.
- **One flatten node per grain level.** `frame→cell`, `cell→field`,
  `field→experiment` render as three violet nodes, so the nested-median collapse
  is visible step by step and each node gives the data tab a real intermediate
  table to display. Cost: a longer line on deep spines (acceptable).
- **Data tab replaces `ReducedTable`.** Clicking any node drives an AG-Grid view
  of that node's schema + a capped row window. The level dropdown in today's
  `ReducedTable` is subsumed by clicking flatten nodes. Clicking a node also
  surfaces that step's existing editor inline, so the explorer unifies the three
  places shaping currently lives.

### Scope

**In (MVP):** the linear default graph over `filter · drop · flatten`; node→table
data tab; `select`→`drop` rename; inline editors on node click; the data structure
modelled as a graph from day one (even though the MVP renders/edits only the
canonical default path).

**Out (deferred, plugs into the same frame):** `derive` / `recode` / `join`
nodes; drag-and-drop authoring of new steps; multi-table sources; editable-grain
flatten (authoring a group-by directly); crossed-factor / non-nested designs;
the guard *warnings* themselves may land incrementally after the visualization.

## Architecture & data flow

- **Engine — node→table surface.** The data tab needs the table *at any node*.
  The engine already computes per-step reduce traces (`reduce.py`) and per-level
  materialization (`hierarchy.py`); the gap is returning the actual **rows** at an
  intermediate point, not just counts. Add one surface: given an analysis + a node
  id, return that node's schema + a capped row window. (FastAPI endpoint for the
  GUI; library-callable for headless use.)
- **Pipeline as graph in the spec.** Represent the shaping as a typed node graph
  in the analysis spec so "default, not enforced" is structural. For the MVP the
  graph is the canonical chain derived from `reduce.steps` + `hierarchy.spine`;
  the renderer walks it as a line. Designing the data structure as a graph now
  avoids repainting when branching/joins arrive.
- **Frontend.** New `TransformExplorer` component renders the colored node line
  from the spec; a `DataTab` component (general successor to `ReducedTable`)
  reads the engine node→table surface for the selected node. Existing editors
  (`StepCards`, the `HierarchyPanel` level/aggregate controls) are surfaced inline
  on node selection rather than in a separate mode. State: the selected node id is
  new UI state; `reducePreviewAtom` generalizes to "table at node."

## Testing

- **Engine:** assert the node→table surface returns the right grain/rows at each
  node (raw, post-filter, post-drop, each flatten level) against a COV2D-shaped
  fixture. Assert the canonical default graph derived from roles matches today's
  `materialize_levels` output exactly (no behavior change for the default path).
- **Frontend:** the explorer renders the correct colored nodes from a spec, and
  node selection drives the data tab; runs under strict TypeScript + Vite build.

## Deferred / future power (ordered by expected demand)

1. **`derive` (row-wise, raw grain)** — `q = a/b`, `log`, unit conversion, concat
   keys. Grain-safe because evaluated before any flatten. The cheapest first
   power-up; COV2D's `per_cell_features` is the test corpus.
2. **`recode`** — relabel categorical levels (Iris's `ColumnDef.labels` already
   carries the mapping; the gap is an affordance to set it).
3. **`join` / multi-table** — spine-aligned table union first (N tables sharing
   the spine, merged by shared identifiers — what COV2D's `_join_class` and
   `per_cell_features` do); general relational joins last.
4. **Editable-grain flatten & branching graph** — SuperPlot fan-out and arbitrary
   group-by, behind guards.
5. **Crossed-factor / non-nested designs** — the case that truly relaxes strict
   nesting; its own design when demand shows up.
6. **Drag-and-drop authoring** — a transformation palette dropped onto the graph.

## Risks

- **Scope creep into authoring** before the visualization MVP ships — the in/out
  scope above is the discipline.
- **Default + guard quality is the brand.** Removing the wall is only safe if the
  proposed default is excellent and the guard warnings are loud, specific, and
  actionable. Under-investing here trades away the rigor reputation.
- **Graph data model churn** — designing the node graph now, even while rendering
  only the default line, is the hedge against a costly remodel later.
