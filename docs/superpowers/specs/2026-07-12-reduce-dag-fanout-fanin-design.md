# Fan-out / fan-in data shaping — the reduce DAG (spec 2.2)

**Status:** design, awaiting review
**Date:** 2026-07-12
**Supersedes on merge:** the linear `reduce.steps[]` model and the join's inline
`right` sub-pipeline (COV2D §4).

## Problem

The transformation workbench renders a DAG but authors a **line**. `AnalysisSpec`
carries one `reduce: { steps[], post[] }` — a strictly ordered chain folded by the
engine (`reduce.py:apply_reduction`). The only fan-in anywhere is the `join` step,
special-cased to carry its second input inline. There is no canvas gesture to
branch a table into two paths (fan-out) or to merge two nodes by anything other
than that one hardcoded join (general fan-in). `buildGraph` threads a single `prev`
cursor; the canvas has no `onConnect`; node deletion "auto-heals" precisely because
it assumes linearity (`WorkbenchCanvas.tsx:172`).

We want authorable fan-out and fan-in for data-shaping actions: send one table down
two different reductions, merge two tables, and have the workbench both author and
render it.

## The invariant that makes this tractable

The reduce DAG **converges to a single output node.** That node feeds the existing
collapse → hierarchy → plot/stats path unchanged. Consequences:

- The user's stated guardrails — *one plot, one stats test bound to a single input*
  — are already enforced downstream (layers read grains of one collapse plan; stats
  reads one grain). The feature does not touch them; they stay true for free.
- Everything downstream of the reduce output (`hierarchy.py`, `render.py`, the stats
  path, layers, the plot/stats cards) is **unchanged**. This feature is entirely
  upstream: it changes how the reduce result is *produced*, not what is done with it.
- Branches must reconverge (via join) or be the output. A branch that reaches no
  consumer of the output is dead — the graph prunes it with a visible note, never
  silently.

**Explicitly deferred (not v1):** two un-joined lineages overlaid as separate layers
on one plot (genuinely different reduce paths → different plot layers without a key
join). That is the heavier multi-lineage case — multiple collapse plans, layers
gaining a lineage ref, stats picking one of several. The "aggregate + individual on
one plot" need is different (same lineage, different grains) and is already
authorable; its failure to render is a **separate bug**, tracked below, not this
work.

## Spec 2.2 — the reduce DAG

`reduce` stops being an ordered `steps[]` and becomes a node set with explicit input
refs. Every reduce node carries an `id`; every non-source node names the node id(s)
it consumes. The linear pipeline is the degenerate case where each step's input is
its predecessor.

```ts
interface ReduceDag {
  // root inputs: each names a pool table by id. Was the single top-level `table_id`.
  sources: { id: string; table_id: string }[];
  // transform nodes. `inputs` lists upstream node ids (a source id or another
  // step id). One input for filter/drop/derive/recode/pivot/grid_complete; two
  // for join (left, right). A node whose input set names the same id as another
  // node is a fan-out; a node naming two ids is a fan-in.
  steps: (ReduceStep & { id: string; inputs: string[] })[];
  // the single node whose frame feeds collapse → plot/stats. Any node not on a
  // path to `output` is dead (pruned + flagged).
  output: string;
  // post-collapse steps stay a LINEAR chain on the collapsed output grain — no
  // input refs, folded in order as today (a future sub-project may DAG-ify these;
  // out of scope here).
  post?: ReduceStep[];
}
```

`spec_version` bumps `"2.1" → "2.2"`. `table_id` (single root) is removed in favor
of `sources[]`. `JoinStep` loses `rightTableId` and its inline right sub-pipeline;
its right lineage becomes ordinary DAG nodes feeding `inputs[1]`.

### Join dissolves into the DAG (COV2D §4 impact)

Today a join's right side is an inline `right: { schema, rows, reduce, collapse,
test_grain }` block, reduced/collapsed independently then merged (`reduce.py:280`,
`project_schema` at `reduce.py:498`). Under the DAG, that right lineage is just more
nodes: a `source` for the right table, its own reduce steps as nodes, and the join
consumes the tail as `inputs[1]`. This **removes the special case** — one evaluation
mechanism, not two — but reworks the §4 join-carries-sub-pipeline path and requires
regenerating the four §4 correlation `.iris` fixtures (via the data repo's
`verify_s4.py`). Recommended, because two coexisting fan-in mechanisms is exactly the
incoherence to avoid. Flagged for the reviewer: this is the largest single piece of
churn in the change.

## Engine — topological evaluation

`apply_reduction` / `iter_reduction` / `reduce_with_trace` change from a fold to a
**topological evaluation** over the DAG:

- Topologically order nodes from `sources`. Evaluate each node once, caching its
  `(df, schema)` keyed by node id. A step reads its inputs from the cache — one
  frame for the unary steps, two for join (replacing the inline `right` block).
- `project_schema` gains the same topological form for schema-only projection
  (family inference, preview).
- The per-node trace/preview (`iter_reduction` yields per-step frames today) becomes
  per-node: the workbench's `/shape_counts` already wants a frame per node, so this
  aligns with the existing per-node card `via` contract.
- Cycle guard: a malformed spec with a cycle is rejected with a clear error, never
  evaluated.
- The request shape changes: today one table's rows arrive top-level and the join's
  right rows arrive inline. Now each `sources[]` entry's rows must be resolvable by
  `table_id` from the loaded pool (the pool already exists — this is the "multiple
  tables as inputs" plumbing).

Downstream (`hierarchy.materialize_plan/levels`, `render.py`, stats) reads the single
`output` node's frame exactly as it reads the linear tail today — no change.

## buildGraph — adjacency-driven

`buildGraph` stops threading a single `prev` and reads adjacency from the spec:
sources become source nodes, each step becomes a node with edges from its `inputs`,
the join emits two converging edges (as it already does) but now for a real
second-lineage node rather than a synthetic `source:i`. The collapse chain, per-grain
geom edges, and post chain are still synthesized from the `output` node downstream —
unchanged. Layout (`layoutGraph`, a real DAG longest-path ranker) and the React Flow
canvas already render arbitrary fan-in/out; no renderer change.

## Canvas — connect / branch / merge gestures

- **Connect:** enable React Flow `onConnect` with an output handle on every node and
  an input handle on every step. Dragging output→input authors an edge = sets the
  target step's `inputs`. Dragging onto a join's open second handle fills its right
  input (subsumes the drag-a-table-onto-the-open-circle gesture that was TODO polish).
- **Branch (fan-out):** the on-canvas `+` still creates a step; a created step's
  input defaults to the node its `+` was launched from. Launching `+` from a node
  that already has a consumer creates a *second* consumer — that is the fan-out. No
  new menu; the existing `+` gains a second outgoing edge instead of splicing.
- **Merge (fan-in):** author a join (or drag a second edge into a node that accepts
  two inputs). The join editor card's right-table picker (already shipped) stays; the
  drag gesture is the second path in.
- **Deletion rewiring:** the linear "auto-heal" is gone. Deleting a node with one
  input and one consumer reconnects consumer→input (the common case, behaves like
  today). Deleting a node whose consumers would be orphaned drops them to the
  "missing input" open-circle state (the existing `missing` node affordance), never
  a silent cascade. This is the trickiest UX atom and gets its own tests.

## Migration & fixtures

No users, no legacy path (per project policy): the reader/writer switch to 2.2
outright; there is no 2.1 compatibility shim. In-repo `.iris` fixtures (the COV2D §4
correlation files and any test fixtures) are regenerated, not migrated —
`verify_s4.py` in the data repo rebuilds the §4 files and must reproduce the committed
r/p (crowding_q −0.174/0.049, crowding_speed −0.122/0.008, het_q −0.088/0.396,
het_speed −0.024/0.631) as the acceptance check that the join dissolution is correct.

## Out of scope (deferred, named so they are not silently dropped)

- Multi-lineage plot overlay (two un-joined reduce paths → two plot layers).
- DAG-ifying the `post` (post-collapse) chain — stays linear here.
- Many-to-many join (still rejected, as today).
- New table-op vocabulary (append/union/concat) — "keep table ops minimal."

## Testing

- **Engine:** topological evaluator — linear (degenerate) equals the old fold on
  existing fixtures; diamond (fan-out then join-back) evaluates each branch on its own
  support; cycle rejected; dead-branch pruned. Join-dissolution parity: §4 r/p
  reproduced. `project_schema` topological parity with the data path.
- **buildGraph:** adjacency graph for fan-out and diamond shapes; dead-branch flagged;
  degenerate linear spec yields today's graph (fixture-pinned).
- **Canvas:** `onConnect` sets `inputs`; `+` from a consumed node creates a second
  consumer; deletion rewiring (single-consumer reconnect vs. orphan-to-missing).
- **Round-trip:** a fan-out/diamond spec saves and reloads through `.iris` 2.2 with
  `output`, `sources`, and per-node `inputs` preserved (regression against the class
  of silent-drop bugs the post-phase round-trip already hit).

## Separate track — the plot multi-layer render bug

Multi-layer plots (raw individual + aggregate, same lineage, different grains) are
authorable today (`addLayerAtom`, the "+ add layer" strip) and *should* render as two
`geom` edges into the figure. Reported not rendering. This is a defect, not part of
this design — a `systematic-debugging` hunt on its own. Noted here so it is not
conflated with the fan-out/fan-in feature.
