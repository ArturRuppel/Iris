# Brief: write the Quickstart page for the Iris user guide

## Your task

Write **one page of the Iris user guide: the Quickstart.** It walks a brand-new
user through a single analysis from start to finish, so that after ~5 minutes
they know whether Iris can do their kind of work. Output a single Markdown file
(the page body, starting with a `# Quickstart` heading). Nothing else.

Everything you need is in this file. **Do not read other repository files** — some
contain domain detail that must not enter your writing. Reason only from here.

## What Iris is (the gist)

Iris is a cross-platform desktop app for turning a table of data into a figure
and a statistical analysis, aimed at scientists who don't program. It's a
point-and-click interface to the Python libraries scientists already use (scipy,
statsmodels, pingouin for the statistics; matplotlib for the figures). You import
a table, shape it if needed, make a plot, and add a statistical test, all by
clicking. An analysis is saved as one open file (the `.iris`) that holds the data
plus the full specification of the analysis; because it's open, a `.iris` can
also be produced or read by a script. The data, the plot, and the test are
linked: change the input and it propagates through to the figure and the numbers.

## The workflow to walk through

Narrate these steps in order, plainly, as a first analysis. Use a **generic,
domain-neutral example**: a table with a **measured numeric value compared
between two groups** (e.g. a measurement taken under two conditions). Keep the
example abstract; do not attach it to any scientific field. Do not invent
specific numeric results (see constraints).

The app has three views, reached from buttons in the header: **Data**,
**Workbench**, and **Guide**.

1. **Get your table in.** The app opens on a sample dataset. Import your own file
   (CSV, TSV, or Excel) through the import dialog. In the **Data** view each
   column carries a type: *numeric* (a measured quantity), *categorical* (a small
   set of labelled groups), or *identifier* (the name of a unit). Iris infers
   these on import; you check and fix them. For the example: the group column is
   categorical, the measured value is numeric.

2. **Make a plot.** Open the **Workbench**. An analysis is shown as a graph that
   flows left to right: a source table on the left, a figure on the right. The
   figure has two halves, a **Plot** and a **Stats**. On the Plot half, use
   **+ add plot**: Iris offers only the plot types your column types can actually
   satisfy, then you map columns onto the plot's channels (for the example: the
   group on the x axis, the measured value on the y axis; a box plot or a dot
   plot are the natural first choices).

3. **Add a test.** On the Stats half, add a statistical test. Iris **suggests**
   one based on the structure of the data (for two groups, a two-group
   comparison) and shows the reasoning behind the suggestion. You can accept it or
   choose a different test.

4. **Read the result.** The figure shows the plot; the stats show the chosen
   test, the test statistic, the p-value, and an effect size, and can draw the
   result onto the figure (e.g. a significance bracket between the groups).
   Describe *what these outputs are*, not specific values.

5. **Save and export.** Save the analysis as a `.iris` file from the header.
   Export the figure on its own as SVG, PDF, or PNG. Reopening the `.iris` later
   reproduces the same figure and the same numbers from the saved data and
   specification.

Keep it to the happy path. Don't cover data reshaping, multiple tables, nesting,
faceting, or styling in depth; those are other pages. One clean pass through the
five steps.

## Tone and voice (use the introduction as the template)

Match the voice of the guide's introduction, reproduced here. Study it, then
write in the same register:

> # Iris
>
> Iris is an open-source app for turning a table into a figure and a statistical
> analysis. It's a graphical interface to the Python libraries scientists already
> use for this, so the analysis can be done by clicking rather than by writing
> code.
>
> An analysis is saved as a single open file, the `.iris`. It holds your data
> together with the specification of the analysis: the steps that shape the
> table, the plot, and the test. Data, plot and test stay linked. Edit a value in
> the input and the change propagates through the shaping steps to the figure and
> the statistics.
>
> Because the format is open, a `.iris` can also be written or read by a script,
> not only built in the app. That lets two ways of working meet: build an analysis
> by hand in the interface, or generate many of them from a script and open each
> one to adjust the figure by eye. The same file works both ways.
>
> When you add a statistical test, Iris suggests one based on the structure of
> your data and shows how it arrived there; you can take the suggestion or choose
> another.

Rules distilled from that voice, all mandatory:

- **Plain and factual. This is documentation, not marketing.** State what things
  are and what the user does. No pitch language, no superlatives, no "powerful /
  seamless / effortless / trusted."
- **Respect the reader's competence.** They know statistics; they came for a tool,
  not a tutor. Never frame Iris as knowing better than the user. When you mention
  the test suggestion, it *suggests and shows its reasoning, and the user
  decides*; it is never a gate or a correction.
- **Short, direct sentences.** Some warmth is fine; density should stay low on a
  first page.
- **No em dashes.** Use a period, comma, or colon instead.
- Use "you" for the reader. British or American spelling is fine, just be
  consistent with the template (which uses "analyse"-style British-ish forms
  loosely; don't stress about it).

## Constraints

- **No domain-specific content.** Keep the running example a generic two-group
  numeric comparison. No scientific field, no real dataset names.
- **Do not fabricate statistics.** Iris's documentation binds every stated number
  to a value the engine actually computes, so never write a specific p-value,
  statistic, or effect size. Describe what the outputs *are* and what they mean,
  not invented values.
- **Embedded example placeholders.** The guide can embed a live example figure and
  an "open in the app" button using two custom link forms. If you want to place
  them, use these exact shapes as placeholders and Artur will wire real ones in:
  a figure is `![](example:CASE/ANALYSIS)`, and an open button is
  `[Open in Iris](iris-open:CASE)`. Use them sparingly, if at all; the prose is
  the deliverable.
- **Length:** roughly 250–450 words. A Quickstart is short by definition.

## Deliverable

The Markdown for the page, beginning with `# Quickstart`. No preamble, no
explanation of your choices, just the page.

---

# Planning context (for later pages and media)

The two pages written so far live in `docs/guide/`: `index.md` (the landing /
"What is Iris") and `quickstart.md`. Below is the plan for the rest of the prose
and for the media that goes into these pages. Any agent writing a page inherits
**all** the tone rules and constraints from the Quickstart brief above (plain,
no sales, respect the reader, the stats picker *suggests and shows its reasoning,
the user decides*, no em dashes, no fabricated statistics, domain-neutral unless
a concrete shipped example is deliberately used).

## Remaining pages to write, in order

The guide is a nested, task-oriented tree (two nav levels, section then page),
ordered along the user's workflow, which is also the tool's dependency chain
(column types gate which plot marks are legal, which gate which test families).

1. **`data-in.md` — Get your data in.** The biggest genuine content hole and the
   next to write. Import (CSV / TSV / Excel), entering data by hand, checking and
   fixing column types (numeric / categorical / identifier), and declaring the
   unit-of-analysis hierarchy (what counts as one observation). No mechanism
   dependency, pure writing.
2. **`shape.md` — Shape it.** The Workbench (an analysis drawn as a left-to-right
   dataflow graph) and the shaping vocabulary as headings on one page: filter,
   drop, derive, recode, pivot, grid-complete, join, and collapse (aggregate to a
   coarser unit). One page, verbs as sections, not a page per verb.
3. **`plots/index.md` + one page per mark.** A gallery-grid overview page, then a
   leaf page per plot type (roughly: box, violin, bar, summary, dot, scatter +
   regression, line, trend, distribution/histogram, tile/heatmap). Each leaf page
   is short: what the mark shows, when to reach for it, and one worked example.
   This is the one place per-page nesting pays off.
4. **`test/choosing.md` — Add a test / Choosing.** The guided picker and the
   decision logic: the parametric-vs-robust axis (from a normality check) and the
   independent-vs-paired axis (read from the data structure), plus the
   small-sample guards. **Tone rule for this page, non-negotiable:** it reads as
   *here is what Iris suggests and exactly why; overriding is normal and is
   recorded as your choice*, never as a gate or a correction. This is the page
   most likely to slip into "the tool knows best" — do not let it.
5. **`test/interpreting.md` — Add a test / Interpreting.** Reading the result:
   what the test statistic, p-value, and effect size mean, and how the result is
   drawn onto the figure.
6. **`troubleshooting.md` — Troubleshooting.** The failure-mode catalogue,
   promoted to top level because users arrive here from error states. What each
   guard/caution means and what to do about it.
7. **`reference/composition.md`** — the type → mark → test-family composition
   rules stated once, plainly.
8. **`reference/glossary.md`** — generated from `src/components/statsGlossary.ts`;
   do not hand-write it (it would fork). This page is produced by a generator, not
   an author.
9. **`reference/citations.md`** — the bibliography for the statistical choices.
10. **`reference/iris-format.md`** — the `.iris` file format in detail. This is
    the home for all the file-format depth that keeps wanting to sit on the
    landing page. The landing links here (currently a dangling forward reference).

## Rich media plan

Three tiers, in decreasing order of how "live" they are and increasing order of
effort. Applies to the Quickstart first, then wherever a page benefits.

- **Tier 1 — live example (ready today, no new plumbing).** For a *result* (a
  finished figure), embed the pre-rendered example figure with the
  `![](example:CASE/ANALYSIS)` token and offer a `[Open in Iris](iris-open:CASE)`
  button that loads the real analysis into the running app. This is the genuine
  "live" primitive. The Quickstart's two-group result maps onto the shipped
  `iris-species-comparison` case (box plot: petal length, versicolor vs
  virginica; analyses `-01` box through `-05` dot).
- **Tier 2 — screenshots of the editing steps (capturable, no plumbing).** The
  process steps (import dialog, the Data view with typed columns, the Workbench
  graph, the `+ add plot` wizard, the Stats/test panel) can't be live windows, so
  they get screenshots. Capture them by driving the running app with Playwright /
  Chromium: `./dev.sh` serves the frontend at `http://localhost:5173`; the
  `e2e/*.mjs` tests are the working template for how this app is driven
  (launch, selectors, the Open-in-Iris flow). Save PNGs under `public/guide/` and
  reference them as `![caption](/guide/NAME.png)` — the Guide renderer passes
  non-`example:` images straight through, and files in `public/` are served at the
  site root, so absolute `/guide/...` paths resolve in dev, in the web build, and
  in the desktop shell with **no renderer change**.
- **Tier 3 — embedded live editing window per step: not supported.** There is no
  in-page interactive app, and building one is out of scope. Do not attempt it;
  use Tier 1 for results and Tier 2 for process steps.

**Media honesty rule:** never hand-draw, mock up, or fabricate a screenshot. If a
step can't be captured, leave a marked placeholder
(`<!-- TODO screenshot: <what> — blocked: <reason> -->`) and report it. A missing
screenshot is fine; a fake one is not.

---

# Task detail: write `data-in.md` — "Get your data in"

This is the next page. Inherit **every** tone rule and constraint from the
Quickstart brief above (plain, no sales, respect the reader, no em dashes, no
fabricated statistics, domain-neutral prose with a generic two-group example; the
shipped iris sample is fine as a concrete illustration but keep the wording
generic). The Quickstart brief is your format and voice example. Output a single
Markdown file body starting with `# Get your data in`. ~400–650 words.

Scope: the three ways data gets in, checking and fixing column types, and
declaring the data hierarchy. Write **only** from the accurate UI facts below; do
not invent UI.

**Getting data in — three ways, all landing in the Data view.**
- **Import a file** (CSV / TSV / Excel) through the "Import data…" dialog. It
  previews the parsed table and exposes: the delimiter, the decimal mark, a
  "first row is column names" toggle, a per-column type dropdown, and a
  collapsible **"Stack columns (one column per condition → long format)"** option
  that folds a wide layout (one column per group) into a tidy long table. It
  shows row/column counts and a live preview before you commit ("Import N rows").
- **Enter data by hand** through the "Enter data…" wizard: one column per group,
  values typed or pasted one per line (paste a column straight from a
  spreadsheet). Iris arranges it into the tidy long shape.
- **Start from the sample dataset** the app opens on.

**Column types.** Every column carries a type, shown colour-coded in the Data
view and editable from a dropdown: **numeric** (a measured quantity; a value
axis), **categorical** (a small set of labelled groups; a grouping axis, colour,
or facet), **identifier** (the name of a unit; it defines the hierarchy, never an
axis), and **bool** (handled as numeric 0/1). Iris infers types on import; the
reader checks and corrects them, because the types decide which plots and tests
are offered later.

**Declaring the data hierarchy.** A panel in the Data view titled "Data
hierarchy", defined on the DATA (not per analysis). Every non-numeric column
takes a role from a segmented control: **identifier** (a nesting level on the
spine) or **classifier** (a label that qualifies the data). The identifiers form
an ordered **spine** from coarsest to finest (for a generic example: experiment →
dish → cell), drawn as a vertical "nesting (coarse → fine)" tree; each level shows
how many groups it holds, a function for how finer rows collapse into it (mean,
median, …), and up/down controls to reorder coarse/fine. Classifiers branch off
at the level where they stay single-valued. Declaring the spine is what later lets
Iris test at the correct unit instead of counting every raw row. Keep the *why*
(pseudoreplication) light here, with a forward pointer to the design/nesting
material; this page is about *how to declare it*, not the full statistical
argument.

Suggested structure: `# Get your data in`, then sections for the three ways in,
column types, and the hierarchy. Leave `example:`/`iris-open:` and screenshot
placement to the media pass (you may mark obvious spots with the placeholder token
forms if it helps).
