# How the pieces fit

Iris is built from one small grammar, and every feature is an instance of it.
Learn the grammar once and the rest of the app reads as variations on it: three
kinds of data, three kinds of transformation between them, and one rule for how
they compose. The [Workbench](../shape.md) draws any analysis directly as this
grammar — data as boxes, transformations as the arrows between them — so the
picture here and the picture on your screen are the same.

## Three kinds of data

Everything Iris holds is one of three kinds:

- **table**: a tidy data frame, one row per observation and one column per
  variable. You see it in the Data view and in every table box on the Workbench.
- **plot**: a figure, marks positioned on axes. It is the Plot half of the
  figure node.
- **stats**: a statistical result — a test, an effect size, and the numbers
  behind them. It is the Stats half of the figure node.

An analysis is one table flowing through transformations until it becomes a plot
and a stats result. The plot and the stats read the *same* shaped table, so Iris
draws them as two halves of a single **figure node** rather than two separate
places. That shared input is the structural reason a figure and its statistics
can never disagree about the data.

## Three kinds of transformation

Every step has a typed input and a typed output, and each is one of three kinds,
named by what it connects:

- **shape** (table → table): the row and column edits — filter, drop, derive,
  recode, pivot, count grid, join — and collapse, which aggregates up to a
  coarser unit.
- **draw** (table → plot): a mark, such as box, dot, or scatter.
- **test** (table → stats): a statistical test, or describe-only.

Shaping steps chain in order, each feeding the next. Drawing and testing are
terminal: they read the shaped table and produce the figure and the numbers.
[Shape it](../shape.md) works through the shaping vocabulary; the
[plot pages](../plots.md) and [Choosing a test](../test/choosing.md) cover the
two terminals.

## Column types

A table's columns each carry a type, and the type decides what a column may do.

| type | what it holds | role |
|---|---|---|
| **numeric** | a measured quantity on a scale: a length, an intensity, a count | value axes; the thing a test compares |
| **categorical** | a small set of labelled groups: treatment, species, phenotype | the grouping axis, colour, and facets |
| **identifier** | the name of a unit: subject, cell, dish | defines the [nesting](../nesting.md); never an axis or a test factor |

A fourth type, **bool**, is handled as numeric 0/1 and needs no attention.
[Get your data in](../data-in.md#column-types) covers setting these on import.

## What each mark needs

A mark can be drawn only when the columns on its channels have the right types.
This is the registry Iris reads to offer you the valid marks and no others.

| mark | x | y | extra channels | family |
|---|---|---|---|---|
| **dot** | categorical | numeric | colour, size, shape | comparison |
| **summary** (mean ± error) | categorical | numeric | colour | comparison |
| **box** | categorical | numeric | colour | comparison |
| **violin** | categorical | numeric | colour | comparison |
| **bar** | categorical | numeric | colour | comparison |
| **pointrange** (estimate ± CI) | categorical | numeric | colour | comparison / rate |
| **scatter** | numeric | numeric | colour, size, shape | correlation |
| **regression** | numeric | numeric | colour | correlation |
| **line** | numeric | numeric | colour | time course |
| **trend** (mean ± band) | numeric | numeric | colour | time course |
| **distribution** | — | numeric | colour | descriptive |
| **tile** (heatmap) | categorical | categorical | — | contingency |

Two rules sit behind the table. **Size** and **shape** are offered only on the
per-point marks, dot and scatter: an aggregate mark has no individual points to
size or reshape. And colour is a grouping (categorical) channel on the aggregate
marks but may be a continuous (numeric) channel on the per-point ones.

## How they compose

The pieces compose in one direction, never backward:

> the **column types** on x and y decide which **marks** are valid; the chosen
> mark's **family** decides the **stats family**; the stats family gates the
> **tests** on offer.

So you never pick a test and then hunt for a compatible plot. You shape and
encode the data, Iris narrows the marks to the ones the types allow, and the
mark you draw selects the family of tests. Which test within that family is the
subject of [Choosing a test](../test/choosing.md); what counts as one row of the
shaped table is the subject of [Nested data](../nesting.md).
