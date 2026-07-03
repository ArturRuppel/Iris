# Get your data in

Iris works from one tidy table: one row per observation, one column per
variable. Everything downstream, the plots it offers and the tests it suggests,
is decided by that table and the types of its columns.

There are two ways to get a table in: import a file, or enter values by hand.
Either way the table opens in the Data view, where you check the column types
and, if you measured each thing more than once, describe how the rows group.

## Import a file

Click **Import data…** in the header. Iris reads CSV, TSV, plain text, and Excel
files (`.xlsx`, `.xlsm`, `.xls`). A dialog opens titled with the file name and a
count of its rows and columns, a preview of the first rows, and a few options.
Which options appear depends on the file:

- **Delimiter** (delimited text): comma, semicolon, tab, or pipe. Iris guesses
  it from the file; change it if the preview comes out wrong.
- **Decimal**: point (`1.5`) or comma (`1,5`), for data written in either
  convention. Iris infers this too.
- **Sheet** (Excel with more than one sheet): choose which sheet to read.
- **first row is column names**: on by default. Turn it off and Iris names the
  columns for you.

Accented letters and other special characters come through as they are; there
is nothing to set. An empty cell, or one containing `NA`, `N/A`, `null`,
`none`, or similar, is read as a missing value and shown as `NA` in the
preview.

When the preview looks right, click **Import**.

### Stack columns

Spreadsheets often grow one column per condition. A file like this:

| control | treated |
| ------- | ------- |
| 4.1     | 5.0     |
| 3.8     | 5.4     |
| 4.4     | 5.2     |

holds one measurement taken under two conditions, but the condition is written
in the column names rather than in the table itself. Iris needs it the other
way around: one column saying which condition each value came from, one column
holding the values.

Open **Stack columns** in the dialog, tick `control` and `treated`, and Iris
folds them into that shape:

| condition | value |
| --------- | ----- |
| control   | 4.1   |
| control   | 3.8   |
| control   | 4.4   |
| treated   | 5.0   |
| treated   | 5.4   |
| treated   | 5.2   |

An **Undo** link reverses it if you picked the wrong columns.

![The import dialog for a wide file with **Stack columns** expanded: tick the condition columns and Iris folds them into one condition column and one value column.](/guide/data-in-01-import.png)

## Enter data by hand

If your numbers live in a few short lists rather than a file, click
**Enter data…**. You get one column per condition, starting with two. Name the
two columns Iris will produce (a condition column and a value column), then type
or paste values one per line into each condition, adding more with
**+ condition**. Click **Create table** and Iris stacks the columns into the
same tidy long table an import produces.

![The **Enter data…** wizard: one column per condition, values one per line, **+ condition** to add another, **Create table** to build the long table.](/guide/data-in-02-enter.png)

## Column types

Every column carries a type. Iris guesses it from the contents on import and
shows it in the Data view. There are four:

- **numeric** (`123`): a measured quantity.
- **categorical** (`abc`): a small set of labelled groups.
- **identifier** (`id`): the name of a unit, such as a subject, a replicate, or
  a well. It labels which thing a row belongs to rather than measuring anything,
  so its cells are read-only.
- **bool** (`T/F`): a true or false event. On a plot it reads as the fraction of
  values that are true.

![The Data view. Each column header is coloured by its type, and the legend names the four types.](/guide/data-in-03-types.png)

Check the types before you move on, because they decide what Iris offers you
later: a column typed numeric can go on a value axis; a categorical column can
group; the test suggestion reads the structure of the typed table. If a guess is
wrong, fix it in the import dialog, where you can set any column to any of the
four types. A numeric column of only zeros and ones gets a one-click nudge to
become a bool.

One thing to know: the numeric and bool choices are settled at import. After the
table is in, you can still change a column between identifier and categorical
(the next section), but turning a column to or from numeric or bool means
importing it again. So it is worth getting these right in the dialog.

## Describe the hierarchy

Often a table holds more than one row per thing measured: each subject was
measured three times, or each sample gave many readings. Those rows are not
independent measurements of separate things, and Iris should know it, so that a
summary averages the repeats within each subject first instead of counting
every row as its own subject. If your table has one row per thing, skip this
section.

This is set in the **Data hierarchy** panel of the Data view. Every non-numeric
column gets one of two roles:

- **identifier**: names the thing a row belongs to, such as a subject or a
  sample. Identifiers can sit inside one another: a reading belongs to a
  sample, a sample to a subject.
- **classifier**: extra information about the rows, such as the condition they
  were measured under. It labels the data but does not group it.

![The **Data hierarchy** panel: each category takes a role from the segmented control, and the identifiers form the nesting tree with a per-level collapse function and Coarser/Finer controls.](/guide/data-in-04-hierarchy.png)

Iris reads the table and guesses which columns are identifiers and how they sit
inside one another, from coarsest to finest. Check the guess. You can change
any column's role, and reorder the levels with **Coarser** and **Finer**. For
each level you also choose how its repeats are combined into one value: mean
(the default), median, sum, minimum, or maximum. A classifier belongs to the
level it describes: a label shared by all of a subject's rows is a fact about
the subject.

Later, in an analysis, you choose which level counts as one observation, and
Iris does the averaging below that level for you.

With the table typed and, if needed, its nesting described, open the Workbench to
build a plot and add a test. The [Quickstart](./quickstart.md) walks through that
first pass end to end.
