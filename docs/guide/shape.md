# Shape it

The Workbench shows an analysis as a chain that flows left to right: your table
on the left, the figure on the right, and between them the steps that shape the
data. Each box in the chain is the table as it stands at that point; each arrow
between boxes is a step. If your table is already the shape you want, the chain
is short, table then figure, and you can skip this page. The steps exist for
when it is not.

## Working with steps

To add a step, click the **+** on the right edge of a box. A menu offers the
shaping steps: **Filter rows**, **Drop columns**, **Derive column**,
**Recode column**, **Join table**, **Pivot column**, and **Count grid**. The
new step lands directly after the box you clicked, so you can insert one in
the middle of a chain, not only at the end.

Click a step to open its editor and change its settings. To remove a step,
right-click its box and choose **Delete**, or select it and press the Delete
key. Each box shows how many rows and columns its table has, so you can see at
a glance what a step did; click a box to open the table itself in a card below
the canvas and check the rows.

When you change a step, everything after it recomputes, through to the figure
and the statistics. **Undo** and **Redo** in the top bar step back and forward
through your edits.

## Filter rows

Keeps the rows that pass your conditions and removes the rest. A condition is
a column, a comparison, and a value: `value > 0`, or
`condition in control, treated`. The comparisons are `==`, `!=`, `<`, `<=`,
`>`, `>=`, and `in` / `not-in`, which take a comma-separated list of values.
**+ condition** adds another condition; a row must pass all of them to stay.

## Drop columns

Removes columns. Tick the ones to drop; the rest pass through untouched. Use
it to clear out columns that came along in the import but play no part in the
analysis.

## Derive column

Adds a column computed from the others, row by row. Name the new column and
write the expression: `after / before` for a ratio, `log10(value)` for a log
scale. Expressions can use column names, numbers, the arithmetic operators
`+ - * / **`, and the functions `log`, `log2`, `log10`, `sqrt`, `exp`, and
`abs`. A comparison such as `value > 10` gives 1 where it holds and 0 where it
does not. If you give the name of an existing column, that column is
overwritten.

## Recode column

Renames the values inside a categorical column. Pick the column, then add
pairs of old name and new name: turn `ctrl` into `control`, or give two
spellings of the same group a single name so they become one group. Values you
do not list pass through unchanged.

## Pivot column

Spreads a categorical column out into several columns, one per group. This is
the reverse of **Stack columns** in the import dialog, and since Iris works
from long tables you will rarely need it. Reach for it when a calculation
needs two conditions side by side in one row. A table like this:

| subject | condition | value |
| ------- | --------- | ----- |
| s1      | control   | 4.1   |
| s1      | treated   | 5.0   |
| s2      | control   | 3.8   |
| s2      | treated   | 5.4   |

pivoted with `subject` as the index, `condition` as the column to spread, and
`value` as the values, becomes:

| subject | control | treated |
| ------- | ------- | ------- |
| s1      | 4.1     | 5.0     |
| s2      | 3.8     | 5.4     |

and a **Derive column** of `treated / control` then gives one ratio per
subject. If several rows land in the same cell their values are summed;
combinations with no rows get the fill value you set. You can rename the new
columns in the step.

## Count grid

Counts rows per group, including the groups where the count is zero. Ordinary
counting loses the zeros: a unit with no rows of some kind simply has no row
to count, so it vanishes instead of appearing as 0. Count grid builds the full
grid first, every unit crossed with every group you list, then counts into it,
writing 0 (or another fill value) where nothing was observed.

You choose the columns that identify a unit (**complete within**), the column
whose groups form the grid and the full list of its levels, and a name for the
new count column. Optionally, count distinct values of another column instead
of raw rows.

## Join table

Brings in columns from a second table. First get the other table in:
**Import data…** adds to your open tables rather than replacing, and the
Tables list in the Data view shows everything loaded. In the step, choose the
right table and tick the key columns, the columns that identify matching rows;
only columns present in both tables can be keys.

Iris keeps the rows whose key appears in both tables and appends the second
table's columns to them. The second table must have exactly one row per key:
it acts as a lookup, such as a table of per-subject details joined onto a
table of measurements.

## Collapse

The other steps reshape columns and rows; Collapse changes resolution. It
averages fine rows into a coarser unit, following the hierarchy you described
in the [Data view](./data-in.md#describe-the-hierarchy). Pick the level that
should count as one observation and Iris combines everything finer, one level
at a time, using each level's chosen function (mean by default).

One level at a time matters. Choosing median at every level gives a median of
medians, so each subject counts once whether it contributed three readings or
three hundred. The Collapse card also sets **Test reads at**: the level the
statistics are computed from, with the number of observations that level
gives shown next to each option.

With the table in shape, the figure takes over: a plot on its Plot half, a
test on its Stats half. The [Quickstart](./quickstart.md) walks through that
pass; the plot pages cover each plot type in detail.
