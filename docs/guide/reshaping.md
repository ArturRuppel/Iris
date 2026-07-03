# Reshaping real data

Everything so far assumed a tidy table: one row per observation, the columns you
want to plot already present. Real experiments rarely arrive that way. A motility
assay lands as one row per frame; a class label lives in a separate per-cell
sheet; an event-rate denominator needs the combinations that never occurred
counted as real zeros. Iris does this reshaping inside the spec — the shaping
steps you add on the [Workbench](./shape.md), not notebook code — so the figure
stays reproducible and every step stays inspectable. The boundary is firm: Iris
reshapes a pooled tidy table into a figure; producing that table from images or
traces stays upstream.

Each example below is a full analysis. Open it to take the chain apart step by
step.

## Per-frame rows to a SuperPlot

The cell-size SuperPlot below starts from one row per frame. A `join` broadcasts
a per-cell class label onto every frame of that cell, a `recode` relabels it, and
a nested median chain collapses frame → cell → position → experiment, so the
paired test runs across the three replicates rather than the thousands of frames.

![A cell-size SuperPlot built from per-frame rows: faint frame-level points behind bold per-experiment dots, paired across three replicates](example:cov2d-tier-a/cov2d-tier-a-01)

[Open in Iris](iris-open:cov2d-tier-a)

## Honest rates need a complete grid

An event rate is honest only if its denominator counts the units where the event
could have happened but did not. Here a `filter` clips the displacement tail at
the 99th percentile of its own distribution, `count grid` builds the full
position × transition-type grid within each experiment — a combination with no
events becomes a real **0**, not a missing cell — and a `derive` turns the counts
into a rate.

![A rate landscape across position and transition type, with unobserved combinations shown as real zeros rather than gaps](example:cov2d-rate-landscape/cov2d-rate-landscape-01)

[Open in Iris](iris-open:cov2d-rate-landscape)

## Derive after the collapse

Some quantities exist only once you have aggregated. Replicate enrichment is
`log2(Σobs / Σexp)`, a ratio of sums, computable only after the per-cell counts
collapse to the experiment grain. Iris runs it as a post-collapse step: collapse
first by sum, then derive. A derive after an aggregate loses the raw-grain safety
guarantee, so Iris raises a caution — visible, never blocking. Iris guides; you
decide.

![Per-replicate enrichment as log2 of summed observed over summed expected, one point per experiment after a sum collapse](example:cov2d-enrichment/cov2d-enrichment-01)

[Open in Iris](iris-open:cov2d-enrichment)

## Route the test to the right grain

The nesting spine is a default, not a wall. The SuperPlot below routes its test
to the experiment grain: three points, three replicates. Route it to the cell
grain instead and Iris keeps drawing but fires a pseudoreplication caution,
because thousands of correlated cells are not independent replicates. Re-pairing
across the wrong level trips the pairing caution the same way. The guards turn
protection from a locked door into a loud, specific warning; see
[Nested data](./nesting.md).

![A motility SuperPlot whose test is routed to the experiment grain, the finer cell grain available but flagged when chosen](example:cov2d-motility-superplot/cov2d-motility-superplot-01)

[Open in Iris](iris-open:cov2d-motility-superplot)

## Long measurements to a shape factor

Measurements often arrive long: one row per cell per feature. A `pivot` unstacks
them into wide form — a `perimeter` and an `area` column per cell — and a
`derive` turns the pair into a shape factor, `q = perimeter / sqrt(area)`. Spread
cells carry more perimeter per unit area, so their `q` runs higher.

![Cell shape factor q by group after a pivot from long to wide and a derive, spread cells sitting at higher q](example:cov2d-shape-pivot/cov2d-shape-pivot-01)

[Open in Iris](iris-open:cov2d-shape-pivot)

---

These chains use the same steps as any analysis —
[filter, derive, pivot, count grid, join, and collapse](./shape.md) — only
stacked deeper. With the table tidy, the figure and the test take over:
[Choosing a test](./test/choosing.md) picks the test the shaped grain implies.
