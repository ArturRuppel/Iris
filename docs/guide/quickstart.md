# Quickstart

This page walks through one complete analysis: a measured value compared between
two groups. It takes about five minutes, and by the end you will have imported a
table, made a plot, run a test, and saved the result. That is the whole shape of
working in Iris; everything else in this guide is variation on it.

The app has three views, reached from the buttons in the header. You will use two
of them here: Data, where your table lives, and the Workbench, where the analysis
is built.

## 1. Get your table in

Start with the sample dataset, import your own file (CSV, TSV, or Excel), or enter
data by hand. Import reads a file that is already a table; the Enter data wizard
takes one column per group, typed or pasted straight from a spreadsheet. Either
way, the table opens in the Data view.

![The import dialog: each column gets a type, with a live preview of the parsed table before you commit](/guide/quickstart-01-import.png)

The import dialog, reading a two-group file: it names each column, infers its
type, and previews the parsed rows before you commit.

Iris works from a tidy table: one row per observation, one column per variable.
For our example that means one row per unit, with one column naming its group and
one holding the measured value. An imported file should already be shaped this
way, and the Enter data wizard arranges hand-entered values into it for you.

Each column carries a type: numeric for a measured quantity, categorical for a
small set of labelled groups, or identifier for the name of a unit. Iris infers
these on import; check them before moving on. For our example, the group column
should be categorical and the measured value numeric. If a type is wrong, correct
it here, since the types decide what Iris will offer you later.

![The Data view: the group column typed categorical, the measured value typed numeric, colour-coded by type](/guide/quickstart-02-types.png)

The Data view, with the group column categorical and the measured value numeric.
The colour of each column header marks its type.

## 2. Make a plot

Open the Workbench. The analysis is shown as a graph flowing left to right, from
your table to a figure on the right. If your table needs work first, this is also
where you shape it: steps that filter rows, collapse them to a coarser unit, or
join in a second table sit between the table and the figure, and stay linked like
everything else. Our example table is ready as it is, so we go straight to the
figure. It has two halves, the plot and the statistics.

![The Workbench graph: a source table on the left flowing into a figure node on the right, whose two halves are Plot and Stats](/guide/quickstart-03-workbench.png)

The Workbench graph flows left to right: the source table feeds the figure node,
which carries the Plot and Stats halves. Here the plot is still empty, waiting for
**+ add plot**.

On the Plot half, click **+ add plot**. Iris offers only the plot types your
column types can satisfy, so the list is short. Pick one, then map your columns
onto the plot's channels: the group on the x axis, the measured value on the y
axis. A box plot or a dot plot is the natural choice for two groups.

![The add-plot wizard's mapping step: the group column assigned to X, the measured value to Y](/guide/quickstart-04-addplot.png)

Mapping columns onto the plot's channels: the group on X, the measured value on Y.

## 3. Add a test

On the Stats half, add a statistical test. Iris suggests one based on the
structure of your data (here, a numeric value across two groups, so a two-group
comparison) and shows the reasoning behind the suggestion. You can take it or
choose a different test; the decision is yours.

## 4. Read the result

The figure now shows your plot, and the statistics panel shows the chosen test
with its outputs: the test statistic, the p-value, and an effect size. Iris can
also draw the result onto the figure itself, as a bracket between the two groups.
What you see is computed from your actual table, so if you edit a value in the
Data view, the figure and the numbers update with it.

![The statistics panel: the chosen test with its test statistic, p-value, effect size, per-group summary, and a plain-language methods sentence](/guide/quickstart-05-stats.png)

The statistics panel reads out the chosen test: the test statistic, the p-value,
an effect size, a per-group summary, and a methods sentence you can copy.

![Petal length in two iris species — the sample dataset standing in for the generic two-group comparison](example:iris-species-comparison/iris-species-comparison-01)

This is the shipped sample analysis behind the generic steps above: petal length
compared between two iris species, plotted as a box plot with a two-group test.
Open it in the app to explore the same figure and numbers hands-on.

[Open in Iris](iris-open:iris-species-comparison)

## 5. Save and export

Save the analysis as a `.iris` file from the header, and export the figure on its
own if you need it elsewhere. The `.iris` file holds your data together with the
full specification of the analysis. Reopen it later and Iris reproduces the same
figure and the same numbers from what was saved.

That is one full pass. From here, the rest of the guide covers shaping tables,
working with more than one table, and refining figures.
