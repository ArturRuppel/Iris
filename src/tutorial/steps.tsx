import type { TutorialStep } from "./types";

/* The quickstart golden path, as a walk through the real app: raw table → open
   the Workbench → build a plot → read the test Iris suggests → see it's all one
   live loop. The seed (a two-species Fisher-iris table, no analyses) is loaded by
   App.handleStartTutorial before the overlay mounts. */
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "table",
    title: "Start with a table",
    view: "data",
    anchor: "data-types",
    body: (
      <>
        <p>
          Iris works from one tidy table: one row per observation, one column per
          variable. This one holds petal measurements for two iris species,
          versicolor and virginica.
        </p>
        <p>
          Each column has a <strong>type</strong>, shown by the colour of its
          header. <code>species</code> is categorical, a few labelled groups; the
          measurements are numeric. The types decide what Iris offers you next: a
          numeric column can go on a value axis, a categorical one can group, and
          the test suggestion reads the typed table. So give them a glance before
          you build anything.
        </p>
      </>
    ),
  },
  {
    id: "workbench",
    title: "Open the Workbench",
    anchor: "mode-workbench",
    goal: (c) => c.viewMode === "workbench",
    autoAdvance: true,   // opening the Workbench IS the step; don't ask for a second click
    hint: "Click Workbench in the header to continue.",
    body: (
      <p>
        The <strong>Workbench</strong> is where the analysis is built: a graph that
        flows left to right, from your table to a figure. Open it now.
      </p>
    ),
  },
  {
    id: "plot",
    title: "Make a plot",
    view: "workbench",
    // Spotlight the "+ add plot" button; once clicked it is replaced by the
    // wizard, so fall the spotlight through to the wizard rather than collapse.
    anchor: ["plot-wizard", "add-plot"],
    // Any built plot counts: pick whatever type and mapping you like. Constraining
    // it to one shape traps anyone who tries something else.
    goal: (c) => !!c.plottable && c.plottable.layers.length > 0,
    hint: "Add a plot and map your columns to the axes.",
    body: (
      <>
        <p>
          The figure has two halves, a plot and its statistics. On the plot half,
          click <strong>+ add plot</strong>.
        </p>
        <p>
          Iris offers only the plot types your columns can satisfy. Pick whichever
          you like and map your columns to the axes. For two groups a box or a dot
          plot reads well, showing the spread rather than a single number; mapping{" "}
          <code>species</code> against <code>petal length</code> is a natural start.
        </p>
      </>
    ),
  },
  {
    id: "test",
    title: "Iris suggests a test",
    view: "workbench",
    anchor: "stats",
    body: (
      <>
        <p>
          You didn't ask for statistics; they are already here. The moment a plot
          exists, Iris reads the shape of the data (a numeric value across two
          groups), <strong>suggests a test</strong>, and shows how it got there.
        </p>
        <p>
          Take the suggestion or override it: the decision is yours. The plot and
          the test come from one specification, so they can never disagree.
        </p>
      </>
    ),
  },
  {
    id: "result",
    title: "That's the whole loop",
    view: "workbench",
    anchor: "plot",
    body: (
      <>
        <p>
          The statistic, the p-value and the effect size are all computed from your
          real table. Edit a value in the Data view and the figure and the numbers
          move with it: that is the reactive loop at the heart of Iris.
        </p>
        <p>
          Save the whole analysis as a single <code>.iris</code> file from the
          header whenever you like; reopening it reproduces this exact figure and
          these numbers. That is one full pass. You are ready to explore.
        </p>
      </>
    ),
  },
];
