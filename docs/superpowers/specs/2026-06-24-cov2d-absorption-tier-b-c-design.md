# COV2D absorption — Tier B/C: the §3–§5 correlation & rate prep

*Status: draft, 24 June 2026. The continuation of
`2026-06-23-cov2d-absorption-tier-a-design.md`. Tier A absorbed the §1–§2 shape &
motility SuperPlots with the minimal `derive`/`recode`/`join` + null-`filter`
reduce steps (shipped & tested). This spec turns the **Tier B/C backlog notes**
in the Iris `TODO.md` ("COV2D absorption — data-prep targets") into a concrete,
node-by-node design for the **remaining absorbable figures**: §3 crowding
correlations, §4 heterotypic-fraction correlations, and the §5 T1-transition rate
& landscape. It names a node for every prep op those figures need, picks a
minimal first form for each, and resolves the design forks the Tier A spec
deferred. The genuinely-upstream pieces (Tier D) stay out, unchanged.*

## Why these three families, and why now

Tier A's dividing line holds: **Iris absorbs everything from the pooled tidy
table onward; everything that produces that table from images/graphs stays
upstream.** §3–§5 sit just past Tier A on the absorbable side, but each needs one
or more nodes Tier A deferred. They are ready to design now because:

1. **The blocking structural piece is in design.** §3 and §4 both rest on
   `per_cell_features` — a *per-cell aggregate* of several per-frame tables, then
   a join. Tier A could avoid an editable-grain flatten (its join sat at raw
   grain, before the default chain); §3–§5 cannot. That capability — arbitrary
   collapse grain + chosen test grain, behind guards — is exactly the
   `un-force-nesting` work now specced on Iris `main`
   (`2026-06-24-transformation-explorer-un-force-nesting-design.md`). This spec is
   its first real consumer and should land on top of it.
2. **The stat families already exist.** `correlation` (replicate-level Spearman →
   Fisher-z one-sample t) drives §3/§4 today; the `rate` family (NB count GLM,
   log-exposure offset, LR test) drives §5 today. Both ship engine-first and
   validated. The entire remaining gap is **data-prep**, same as Tier A.
3. **The corpus is concrete and checked in.** Every op below is a line in
   `code/cov2d/figures.py`; every target is an existing `.iris`. The acceptance
   bar is the same as Tier A: reproduce the notebook's quoted numbers to float
   precision on a COV2D-shaped fixture.

## What the notebook does today

Three functions in `code/cov2d/figures.py`, plus the §5 grid builder:

```python
def per_cell_features(series_dir):                       # §3 + §4 basis
    csh = pd.read_csv(.../"cell_shape.csv")
    csh["q"] = csh["cell_shape.perimeter_um"] / np.sqrt(csh["cell_shape.area_um2"])   # derive (numeric) ✓landed
    ne = pd.read_csv(.../"neighbor_enrichment.csv")
    ne["opp"] = (ne.focal_label != ne.neighbor_label).astype(int)                     # derive (boolean)  ✗
    g = ne.groupby(KEY + ["opp"])["...observed"].sum().unstack(fill_value=0)          # aggregate + PIVOT ✗
    g.columns = ["s", "o"]
    pc = pd.concat([                                                                  # N-table JOIN/union ✗(2-table only)
        csh.groupby(KEY)["q"].median().rename("q"),                                   # per-CELL aggregate ✗(un-force-nesting)
        ...["...speed_um_per_s"].median().mul(3600).rename("speed"),                  # derive ×3600 ✓ + aggregate ✗
        ...["...n_neighbors"].median().rename("nbr"),                                 # aggregate ✗
        (g["o"] / (g["s"] + g["o"])).rename("het"),                                   # POST-AGGREGATE derive ✗
        ...["class_label"].map(CLASS_LABELS).rename("cls"),                           # recode ✓landed
    ], axis=1).dropna()                                                              # filter not-null ✓landed
    return pc                                                                         # one row per cell

def t1_labeled(series_dir):                              # §5 basis
    df = pd.read_csv(.../"signed_contact_length_labeled.csv")
    df["tt"] = df.contact_type.map(_ttype)               # parser recode "neg-pos→neg-neg" -> "hetero→homo" ✗
    df["ev"] = df.experiment_id +"|"+ df.position_id +"|"+ df.t1_event_id.astype(str) # string-concat derive ✗
    return df

# §5 landscape: tail-clip at the 99th pct of |L|, then a distribution/potential geom
hi = float(np.percentile(np.abs(df[_L]), 99)); clip = df[df[_L].between(-hi, hi)]     # DATA-DEPENDENT filter ✗

# §5 rate: a 0-filled (field × transition) grid, then a per-cell-deduped count
grid = pos.merge(pd.DataFrame({"tt": _TT_ORDER}), how="cross")                        # GRID-COMPLETION cross-join ✗
grid["count"] = ev_counts.reindex(grid.index).fillna(0)                              # 0-fill + count aggregate ✗
grid["hours"] = _DUR_H                                                                # constant derive ✓
```

`✓landed` = a Tier A step; `✗` = a node this spec must add; `✗(un-force-nesting)` =
supplied by the collapse-plan dependency.

## The nodes to add

Grouped by what they unblock. Each gives the **minimal form** §3–§5 needs and what
stays deferred, and resolves a design fork where one exists.

### B1 · N-way spine-aligned join (union)  — *Tier B*

`per_cell_features` is a 4–5-way `pd.concat` of per-cell series sharing `KEY`.
Tier A's `join` is a 2-table inner broadcast; generalize to **N right tables,
inner, same-grain**, merged on shared identifiers — the explorer spec's
"spine-aligned table union" (#3). Each right table rides inline `{schema, rows}`
exactly as Tier A's does, so the linear `reduce.steps` model is preserved.
**Defer:** outer/many-to-many/non-spine/general relational joins (unchanged from
Tier A).

### B2 · `derive` extensions: boolean & string  — *Tier B*

The landed `derive` AST is numeric-arithmetic + a numpy whitelist. §3–§5 need two
more shapes, both row-wise and raw-grain:
- **comparison → boolean/int**: `opp = (focal_label != neighbor_label)`. Add `==`
  `!=` `<` `<=` `>` `>=` to the AST, yielding a 0/1 int column.
- **string concatenation**: `ev = experiment_id + "|" + position_id + "|" + t1_event_id`.
  Add `str`-typed `+` and a `str(col)` cast for the id.

**Decision (proposed):** keep these inside the existing `derive` node — the AST
already exists and the additions are small, explicit whitelist entries, so an
unsupported construct still fails loudly. Do **not** introduce a second
expression node. **Defer:** conditionals (`where`/`if`), regex, arbitrary calls.

### B3 · parser `recode` (split-and-map)  — *Tier B*

`_ttype` maps `"neg-pos→neg-neg"` → `"hetero→homo"` by splitting on `→`/`-` and
relabelling each side homo/hetero. Tier A's `recode` is a flat level→level
lookup; this needs a **derived categorical from a small rule**, not a 1:1 table.

**Decision (proposed):** express it as a two-step `derive`(string) →
`recode`(lookup) rather than a new "function recode" node: split the contact-type
string into `lose`/`gain` sides with B2 string ops, recode each side to
`homo`/`hetero` with the flat Tier A `recode`, then concat. This keeps the node
vocabulary minimal and the mapping inspectable in the graph. **Alternative
(rejected):** a `recode` that takes a Python/parser callable — violates "the spec
contains no executable code; a `.iris` must be safe to email."

### C1 · `aggregate` to an arbitrary grain  — *Tier C, via `un-force-nesting`*

The per-cell medians (`q`, `speed`, `nbr`) and the §5 per-(field,tt) **count** are
group aggregates to a grain that is **not** the test grain — the thing Tier A
explicitly avoided. This is the `un-force-nesting` `CollapsePlan`: a node whose
grain is an arbitrary spine *subset*, emitting one table per prefix, with the
per-level `fn` (median, **and a new `count`/`size` fn for §5**).

**Decision (proposed):** do **not** add a standalone `aggregate` reduce step;
reuse the collapse-plan machinery. The pre-join per-cell table is "the
`(experiment, position, cell)` node of the plan"; the join then consumes that
node. This requires the join to be able to take a *plan node* as a side, i.e. the
reduce pipeline and the collapse plan stop being strictly sequential — **the one
real architectural change in this spec** (see Architecture). Add `count` as a
level `fn` so a grain can be a tally rather than a summary.

### C2 · `pivot` / unstack (long → wide)  — *Tier C*

`groupby(KEY+["opp"]).sum().unstack()` turns the long `opp∈{0,1}` rows into `s`,
`o` columns. Minimal form: **unstack one categorical key into one column per
level**, value = an aggregate (sum), fill = 0. **Defer:** multi-key pivots,
margins, non-aggregating reshape.

### C3 · post-aggregate `derive`  — *Tier C (guarded)*

`het = o/(s+o)` and §3's `log2(Σobs/Σexp)` are `derive`s that run **after** an
aggregate/pivot, where Tier A's free grain-safety guarantee no longer holds.

**Decision (proposed):** same `derive` node kind, *allowed at a post-aggregate
position* in the pipeline. The safety that was structural in Tier A becomes a
**guard**: when a `derive` reads a column produced by an aggregate, the
`un-force-nesting` pseudoreplication/flattening guards apply to anything tested
downstream. No new node — but the guard wiring is mandatory, not optional.

### C4 · grid-completion (cross-join + 0-fill)  — *Tier C*

§5's rate denominator needs the full `(field × transition)` grid; an absent cell
is a **real zero**, not missing. Minimal form: **cross-join the observed levels of
named identifier(s) with a fixed category list, left-join the aggregate, fill
absent = 0.** This is non-optional for honest rate denominators. **Defer:**
inferring the category universe from elsewhere; partial grids.

### C5 · data-dependent `filter` bound  — *Tier C*

§5's landscape tail-clips at the 99th percentile of `|L|`. Tier A's `filter` takes
static literals only.

**Decision (proposed):** an **expression-valued filter** —
`abs(value) <= quantile(abs(value), 0.99)` — where the bound is a reduction over
the filter's input. To keep the contract "a `.iris` is reproducible and safe to
email," **record the realized numeric bound in provenance** at render time
(consistent with "provenance is product"); the *expression* is what persists in
the spec, the *value* is logged. **Alternative (rejected):** freeze the literal at
authoring time — loses the data-coupling and silently goes stale if the table is
re-imported.

## Architecture & data flow

- **The one structural change** is C1: the join must accept a collapse-plan node
  (a per-cell aggregate) as a side, so "reduce then flatten" is no longer strictly
  linear for these figures. This is the same non-linearity `un-force-nesting`
  introduces (branching collapse); this spec rides it rather than inventing a
  parallel mechanism. Everything else (B1/B2/B3/C2/C4/C5) is a new or extended
  **reduce step** that folds over a single frame, exactly like Tier A.
- **No `spec_version` bump expected.** As in Tier A, new step kinds grow the
  `ReduceStep`/`EdgeKind` unions; the embedded-right-table pattern carries the
  union join's N sides. C1 is the exception to watch — if a plan node must be
  referenced from a reduce step, that reference shape may need a versioned field;
  decide in the engine plan.
- **Stat families unchanged.** `correlation` and `rate` already exist; §3–§5 wire
  exposure/offset, the grid denominator, and the chosen test grain — no new
  inference.

## Equivalence test — the acceptance bar (per Tier A)

Done when the absorbed graph reproduces the notebook **exactly** on checked-in
COV2D-shaped fixtures:

- **§3 crowding:** the per-cell joined table, the replicate-level Spearman `r`
  and Fisher-z one-sample-t `p` match `replicate_spearman` to float precision.
- **§4 het:** `opp`, the `s`/`o` pivot, and `het = o/(s+o)` match `per_cell_features`
  per cell; the stratified within-type Spearman matches.
- **§5 rate:** the 0-filled `(field × transition)` grid matches `write_t1_rate_iris`'s
  `grid` row-for-row (including the real zeros); the per-type NB rate ratios ± CI
  and the global LR `p` match.
- **§5 landscape:** the 99th-pct tail-clip selects the same rows; the distribution
  /potential barrier matches; the realized clip bound is recorded in provenance.
- **Round-trip:** each `.iris` (N-way join, pivot, grid, expression-filter) saves
  and reloads losslessly and re-renders identically.

## Scope

**In (Tier B/C):** the §3 crowding, §4 het, and §5 rate/landscape figures
end-to-end inside the graph; the minimal forms of B1 (N-way union), B2 (boolean/
string derive), B3 (split-and-map recode), C2 (pivot), C4 (grid-completion), C5
(expression filter); the post-aggregate derive C3 behind the `un-force-nesting`
guards; `count` as a level `fn`; the COV2D-shaped fixtures + equivalence tests.

**Out (Tier D — upstream by nature, unchanged):** the neighbour-enrichment
**permutation null** (1000× label shuffle — a bespoke Monte-Carlo test; only its
`log2(Σobs/Σexp)` *metric* is the C3 example, the null stays upstream),
`nls_classification` (TIFF→Otsu), `neighborhood` adjacency extraction, `msd_alpha`
(windowed MSD regression), and `coordination` (velocity-correlation functions).
Editable-grain flatten **authoring UI** is owned by `un-force-nesting`; this spec
consumes the capability, not the UI.

## Dependencies & risks

- **Depends on `un-force-nesting`** (the arbitrary-grain aggregate C1 + its
  guards). B1/B2/B3/C2/C4/C5 can be built and unit-tested against the landed
  engine independently; the §3/§4 *end-to-end* targets cannot land until the
  collapse plan does. Suggested order: ship the independent reduce nodes first
  (they also benefit other reports), then the §3 crowding target the moment
  `un-force-nesting` lands, then §4 het (adds C2+C3), then §5 (adds C4+C5+rate
  wiring).
- **Risk — post-aggregate pseudoreplication (C3).** A `derive` over an aggregate,
  tested at the wrong grain, is exactly the inflation the guards exist for. The
  guard is a hard requirement here, not a nicety.
- **Risk — the data-dependent filter vs "the spec is data" (C5).** A bound
  recomputed at render time means two engines could clip differently if the data
  changed. Mitigation: persist the *expression*, log the *realized value*, and
  surface it — never freeze a silent literal.
- **Risk — grid-completion correctness (C4).** Absent-as-zero is right for a rate
  denominator and wrong almost everywhere else; the node must make the
  zero-fill explicit and scoped to the rate path, not a general default.
