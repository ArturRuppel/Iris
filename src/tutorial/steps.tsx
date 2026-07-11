import { colType } from "../channels";
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
          Iris works from a tidy table — one row per observation, one column per
          variable. This one holds petal measurements for two iris species.
        </p>
        <p>
          Each column has a <strong>type</strong>, shown by the colour of its
          header: <em>species</em> is categorical (a few labelled groups) and the
          measurements are numeric. The types decide what Iris offers you next, so
          they are worth a glance before you build anything.
        </p>
      </>
    ),
  },
  {
    id: "workbench",
    title: "Open the Workbench",
    anchor: "mode-workbench",
    goal: (c) => c.viewMode === "workbench",
    hint: "Click Workbench in the header to continue.",
    body: (
      <p>
        The <strong>Workbench</strong> is where an analysis is built: a graph that
        flows left to right, from your table to a figure. Open it now.
      </p>
    ),
  },
  {
    id: "plot",
    title: "Make a plot",
    view: "workbench",
    anchor: "add-plot",
    goal: (c) =>
      !!c.plottable &&
      c.plottable.layers.length > 0 &&
      colType(c.schema, c.plottable.mappings.x) === "categorical" &&
      colType(c.schema, c.plottable.mappings.y) === "numeric",
    hint: "Add a plot, then map species onto X and a measurement onto Y.",
    body: (
      <>
        <p>
          The figure has two halves, a plot and its statistics. On the plot half,
          click <strong>+ add plot</strong>.
        </p>
        <p>
          Iris only offers plot types your columns can satisfy. Pick one, then map
          the <em>species</em> onto the X axis and <em>petal length</em> onto Y — a
          box or dot plot is the natural choice for two groups.
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
          You didn't ask for statistics — they're already here. The moment a plot
          exists, Iris reads the shape of your data (a numeric value across two
          groups) and <strong>suggests a test</strong>, showing how it got there.
        </p>
        <p>
          Take the suggestion or override it; the decision is yours. Because the
          plot and the test come from one specification, they can never disagree.
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
          move with it — that's the reactive loop at the heart of Iris.
        </p>
        <p>
          Save the whole analysis as a single <code>.iris</code> file from the
          header whenever you like; reopening it reproduces exactly this figure and
          these numbers. That's one full pass — you're ready to explore.
        </p>
      </>
    ),
  },
];
