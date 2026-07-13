# Multi-lineage plot routing — plots as node-pinned consumers (spec 2.3)

**Status:** design, awaiting review
**Date:** 2026-07-13
**Builds on:** the reduce DAG (spec 2.2, `2026-07-12-reduce-dag-fanout-fanin-design.md`).
Relaxes that design's single-output-convergence invariant; keeps its honesty invariant verbatim.

## Problem

Spec 2.2 turned `reduce` into a DAG that fans out and back in, but it converges to a
single `output` node that feeds one plot and one stats test. Two things a user
reasonably expects are still unrepresentable:

- routing an arbitrary pipeline node — the raw pre-filter source, a mid-chain step, a
  different lineage tail — into a plot as an overlay layer, and
- spawning a second plot pinned to a different node.

Concretely (the reported case): with `table_1 → filter → table_1·filtered → Plot`,
clicking the `+` on the raw `table_1` and picking "Plot" does nothing useful. Two
compounding reasons in today's code:

- `authoring.ts` terminal dispatch (`geom`/`test`) is a node-agnostic singleton — it
  opens the one active analysis's editor and discards the clicked node's id.
- `buildGraph` roots every geom edge at `dag.output` (`graph.ts`), varying only by
  collapse grain (`layer.level`). No `level` value names the pre-filter node. There is
  simply no representable edge from that node into the figure.

## The invariant we relax, and the one we keep

2.2 leaned on: *the reduce DAG converges to a single output node; one plot, one stats
test bound to a single input.* It called this "the invariant that makes this
tractable," because it kept the honesty guardrail — a test is bound to exactly one
input grain — true for free.

2.3 relaxes the **single-output** half: a DAG may feed several consumers, each pinned to
its own node. It keeps the **honesty** half unchanged: a stats test still names exactly
one input node. A plot may overlay several lineages; a test may not. This is
non-negotiable. A test over an ambiguous mixture of lineages is precisely the dishonest
result Iris exists to prevent.

## Model

A **consumer** — a plot, or a stats test — names an input node in the reduce DAG. Two
structural changes.

### Layers gain a source node

Today `Layer = { geom, level }` (`types.ts:88`). Generalize the source from a grain
string to a (node, grain) pair:

```ts
interface LayerSource { nodeId: string; level: string }   // level "" = the node's raw grain
interface Layer { geom: Geom; source: LayerSource }
```

- `nodeId` names a node in the DAG; `level` selects a collapse grain within that node's
  lineage (the existing superplot mechanism, now scoped to a node rather than to
  `dag.output`).
- Grain-only overlay (today's superplot: raw dots + group means) becomes two layers with
  the **same** `nodeId`, different `level`.
- Lineage overlay (new: raw source under filtered box) becomes two layers with
  **different** `nodeId`.

`level` continues to be driven by the table-level hierarchy spine, applied at the pinned
node. A grain is available to a layer only when the pinned node still carries the spine
columns it needs (capability gating, below).

### The plot has a primary source node

`Plottable` gains `sourceNodeId: string`, its primary node. The primary node defines the
encoding column menu (the x/y/color/… pickers read its schema) and the axis reference. A
layer may pin to any node whose schema resolves the plot's encodings on a compatible
scale; incompatible nodes are offered disabled-with-reason (the existing capability
pattern, `channels.ts:173`, `EncodingsCard.tsx:32`).

## Coordinate compatibility — what may share a plot

A node N is overlay-compatible with plot P (mapped channels E) iff, for every mapped
channel `c` in E, N's output schema has a column named `E[c]` whose type matches the
channel's requirement: x keeps P's x-kind (categorical stays categorical, numeric stays
numeric), y numeric, color/shape categorical, and so on. Units are not machine-checkable,
so we check name + type + kind and trust the user (integrity via guidance, not a wall).
Axis scale (log/linear) is a plot-level style shared by every layer.

This is the general rule behind the informal table we sketched:

| Shaping | Mapped columns | Grain | Overlay-compatible? |
|---|---|---|---|
| filter / sort / dedup / slice | kept | kept | yes — same spec, trivially |
| append/union of same-schema tables | kept | kept | yes |
| add-column (derive/recode), left-join | kept (superset) | kept | yes |
| aggregate / collapse to a coarser grain | kept | changed | yes as a *grain* overlay (superplot); the plot's grain machinery already models this |
| pivot long↔wide | changed | changed | no — cannot share axes |
| aggregate that drops a mapped column | removed | changed | no |

## Same-plot vs new-plot — the routing choice

`+`→Plot on a node N offers, gated by compatibility:

- **Add as a layer to `<plot P>`** — when N is compatible with an existing plot. The
  default for a grain node over its own lineage (superplot) and for a same-schema node.
- **New plot from here** — always available; spawns a plottable with `sourceNodeId = N`
  and encodings derived from N's schema.

The default follows operation semantics: a collapse/grain node defaults to overlay; a
filter/derive that preserves the encoding columns offers both, defaulting to a **new**
plot (before/after usually reads better side by side); an incompatible node offers only a
new plot. The default is a suggestion — where both are possible, the user picks.

## Stats honesty

A stats test is a consumer with one `sourceNodeId`, naming exactly one node. When its
plot is multi-source, the UI states which lineage the test is over: the tested node is
highlighted and the result card names it. A test never straddles nodes. A spec that binds
a test to two nodes is rejected, not coerced. This is the 2.2 guardrail, carried through
unchanged.

## Engine

Cheap, and already in place. `evaluate_dag_traced` (shipped in 2.2, `dag.py`) returns
every node's `(df, schema)` keyed by id. Multi-consumer needs no new evaluation: evaluate
the DAG once, and each consumer reads its pinned node's cached frame, then runs its own
collapse → hierarchy → render exactly as the single-output path does today. The only
change is that the collapse/render entry runs once per distinct pinned `(nodeId, level)`
instead of once for `dag.output`.

## buildGraph

`buildGraph` roots each geom edge at its layer's `source.nodeId` (through that node's
grain, as it does today for `level`) instead of always at `dag.output`. When several
plottables share one DAG (Stage 2), the graph projects the one shared DAG with a figure
terminal per plottable, each edged from its pinned node(s). Dead-node pruning generalizes
from "no path to `output`" to "no path to any consumer."

## Canvas / arrangement

New plots may be placed beside or stacked (figure arrangement, largely a view concern and
the lightest part). "On top" = a stacked figure sharing the x-domain; "on the side" = an
independent figure.

## Staging — the cheap parts first

The near-term win needs no architecture inversion, because the nodes a raw-vs-filtered
overlay wants are already in the plot's own DAG.

- **Stage 0 — the render bug (prerequisite; a debugging track, not new design).**
  Same-lineage different-grain multi-layer plots (raw dots + group means) are authorable
  today (`addLayerAtom`, the "+ add layer" strip) and reportedly do not render
  (`2026-07-12-reduce-dag-fanout-fanin-design.md:171`). Fix first: layers must render
  before we add layer sources, and this alone may deliver the superplot half of the
  reported screenshot. Confirm what it covers before scoping the rest.
- **Stage 1 — a layer pins to a node (multi-lineage overlay, one plot).** Add `nodeId` to
  `LayerSource`; root the geom edge at the pinned node; compatibility-gate the layer
  source picker; make `+`→Plot on a compatible node offer "add as layer." Delivers the
  raw-vs-filtered overlay. Lands on the current per-plottable DAG with **no** reduce
  hoist, because both nodes already live in the plot's DAG.
- **Stage 2 — a second plot pinned to a node (multi-plottable, shared DAG).** Promote
  `reduce` from `Plottable.reduce` to a table-scoped shared pipeline; plottables carry
  `sourceNodeId` and reference nodes in it. `buildGraph` projects one shared DAG with a
  terminal per plot. This is the structural inversion, and it is where the `state.ts`
  god-module split (deferred in the 2026-06-28 audit) most likely has to land.
- **Stage 3 — arrangement (side / on top).** Multi-figure layout.

## Out of scope

- DAG-ifying the post-collapse chain (stays linear, per 2.2).
- Many-to-many join (still rejected).
- A test spanning multiple lineages (forbidden by design, not merely deferred).
- Per-layer independent axis scales (scale stays plot-level).

## Testing

- **Compatibility predicate:** unit matrix over schema × encodings — filter compatible;
  derive/left-join compatible; pivot incompatible; aggregate-drops-y incompatible.
- **Stage 1:** a layer pinned to the source node emits a geom edge from that node; an
  incompatible node is not offerable; raw+filtered overlay renders two layers.
- **Stage 2:** two plottables sharing one DAG project one graph with two terminals; a node
  on a path to either consumer is live, otherwise pruned and flagged; a fan-out/two-plot
  spec round-trips through `.iris`.
- **Stats honesty:** a multi-source plot's test names one node; the result card reports the
  tested lineage; a spec binding a test to two nodes is rejected.
