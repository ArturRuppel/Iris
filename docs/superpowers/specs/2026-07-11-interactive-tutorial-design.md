# Interactive tutorial — design

*2026-07-11*

## Goal

Replace the prose-and-screenshots **Quickstart** page with an **interactive
tutorial**: a guided walkthrough that drives the *real* app — real table, real
Workbench, real engine — while a floating coach card narrates and the current
control is spotlit. The user learns Iris's one core loop (table → plot → test →
read) by *doing* it once, not by reading about it.

Scope of this pass: **one** tutorial (the quickstart golden path) on a reusable
engine. Not a framework of twelve. The engine is the durable asset; more
tutorials are demand-driven later.

## Why interactive (the one-paragraph case)

Iris's whole value is the reactive triad — change the table, the plot and the
test move together and can't disagree. A screenshot freezes exactly the property
that is the point. And because the tutorial advances on *real application state*
(see predicates below), it cannot demonstrate a state the app can't actually
produce — the same honesty discipline Iris applies to statistics. A screenshot
can lie after a refactor; a state-driven tutorial fails its e2e test instead.

## Architecture

New directory `src/tutorial/`. Everything session-only; nothing serialized into
`.iris`.

### State (`src/tutorial/state.ts`)

```ts
export const tutorialActiveAtom = atom(false);      // overlay mounted?
export const tutorialStepAtom   = atom(0);          // index into STEPS
// write-atoms: startTutorialAtom (seed + activate + step 0),
//              advanceTutorialAtom, backTutorialAtom, exitTutorialAtom
```

### Step model (`src/tutorial/types.ts`)

```ts
export interface TutorialStep {
  id: string;
  title: string;
  body: ReactNode;                 // the coach-card prose
  view?: ViewMode;                 // force viewMode on entry ("data" | "workbench")
  anchor?: string;                 // data-tour value to spotlight (optional)
  goal?: (ctx: TutorialCtx) => boolean;   // gate: Next disabled until true
  hint?: string;                   // shown while goal unmet
}
```

`TutorialCtx` is a plain snapshot the overlay assembles from atoms each render:
`{ viewMode, plottable, spec, schema, analysis }`. Every `goal` is a **pure
function of ctx** — no per-step subscription juggling.

### Advancement — gated Next, never auto-advance

Action steps set a `goal`; the coach card's **Next** is *disabled until the goal
predicate is satisfied by real app state*. So you cannot skip past "map Y to the
value column" without actually mapping it — learning is enforced by the same
predicate the app runs on. Observational steps (no `goal`) have Next always
enabled. **Back** always enabled (except step 0); **Exit** always available.
We do not auto-jump on goal-met (it would skip past unread prose); we reveal a
"✓ — Next" instead.

### The overlay (`src/tutorial/TutorialOverlay.tsx`)

Mounts as the last child of `<div className="app">` in `App.tsx`, renders only
when `tutorialActiveAtom`. `position: fixed`. Two parts:

1. **Spotlight**: `document.querySelector([data-tour="<anchor>"])` →
   `getBoundingClientRect()` → a dimmed full-screen layer with a cutout over that
   rect (four-sided box-shadow trick). Recomputed on step change, window resize,
   and a `requestAnimationFrame` settle tick. Missing anchor → no spotlight, card
   centered (graceful, never blocks).
2. **Coach card**: title, body, progress ("Step 2 of 5"), Back / Next / Exit,
   and the hint when the goal is unmet. Positioned near the anchor, clamped to
   viewport.

On entry each step sets `viewMode` if `view` is given.

### `data-tour` convention

New attribute, distinct from the existing `data-testid` (which identifies
workbench *cards* for tests and can be renamed for test reasons). `data-tour`
marks a **tutorial spotlight target** and is a deliberate, greppable contract.
Targets for this tutorial:

| anchor            | element                                   | file |
|-------------------|-------------------------------------------|------|
| `mode-data`       | header "Data" button                      | App.tsx |
| `mode-workbench`  | header "Workbench" button                 | App.tsx |
| `data-types`      | the Data view (column type chips)         | App.tsx `.data-mode` wrap |
| `add-plot`        | `+ add plot` CTA                          | PlotCard.tsx |
| `add-test`        | the add-test control on the Stats card    | StatsCard.tsx |

The e2e spec walks every step, which naturally asserts each referenced anchor
resolves at its step. A unit test also asserts every `STEPS[i].anchor` is
non-empty-or-absent and unique-per-step.

### Seeding

Reuse the `loadDocumentAtom` path (identical to `handleOpenExample`): fetch a
bundled `.iris`, `engine.loadDocument`, `loadDocument({ tables, analyses: [] })`.
Passing `analyses: []` makes `applyLoadedDoc` seed one blank plottable on the
loaded table — a genuinely raw start the user builds from.

## The quickstart tutorial (5 steps)

Mirrors the golden path the prose currently teaches.

1. **Get your table in** — `view: "data"`, seed already loaded. Body: "Iris works
   from a tidy table — one row per observation. This one has a group column and a
   measured value. Each column has a *type* (colour-coded): the group is
   categorical, the value numeric — the types decide what Iris offers you next."
   `anchor: data-types`. Observational (Next always on).
2. **Open the Workbench** — Body: "Your analysis is a graph flowing left→right,
   from the table to a figure. Open the Workbench." `anchor: mode-workbench`.
   `goal: viewMode === "workbench"`.
3. **Make a plot** — Body: "On the Plot half, add a plot and map the group to the
   X axis and the value to Y." `anchor: add-plot`.
   `goal: colType(schema, mappings.x)==="categorical" && colType(schema, mappings.y)==="numeric" && layers.length>0`.
   hint: "Map a categorical column to X and a numeric column to Y."
4. **Add a test** — Body: "On the Stats half, add a test. Iris suggests one from
   the shape of your data — two groups of a numeric value — and shows its
   reasoning. Take it or override it." `anchor: add-test`.
   `goal: spec.stats.test is a real (non-descriptive) test`.
5. **Read the result** — Body: "The figure shows your plot; the stats panel shows
   the statistic, p-value and effect size — all computed from your real table.
   Edit a value in Data and they update. That's the whole loop. Save it as a
   `.iris` any time." Observational; **Finish** leaves the user in the Workbench
   with the analysis they built.

## Guide integration

- `docs/guide/quickstart.md` shrinks to a short orienting intro + a launch link
  using a new token `iris-tutorial:quickstart` (mirrors the existing
  `iris-open:` token). The heavy step-by-step prose + five screenshots retire —
  the tutorial *is* the walkthrough now.
- `Guide.tsx` `a`-renderer: handle `iris-tutorial:<id>` → a button calling a new
  `onStartTutorial(id)` prop.
- `App.tsx` passes `onStartTutorial={handleStartTutorial}` (seeds + activates).
- `NAV` keeps the `quickstart` slug (label unchanged).

## Testing

- **Unit** (`src/tutorial/*.test.ts[x]`): each step's `goal` against synthetic
  ctx (unmet → met); overlay renders the active step, Next disabled while goal
  unmet, enabled when met; anchors well-formed.
- **e2e** (`e2e/tutorial_test.mjs`, house style): launch → Guide → Quickstart →
  Start → walk all five steps performing the real actions (click Workbench, add
  plot + map, add test), asserting Next gates correctly and the final stats card
  shows a p-value. Needs engine 8765 + vite 5173.

## Decisions to confirm

1. **Seed dataset.** `mann-whitney.iris` (synthetic, natively two-group, *zero*
   new assets) vs. a small pre-filtered **iris two-species** seed asset (more
   charming, needs a ~15-line table-only exporter because the shipped iris table
   is all three species). *Rec: iris, for first-run charm — fall back to
   mann-whitney if the exporter turns fiddly.*
2. **Quickstart nav behaviour.** Clicking "Quickstart" (a) launches the tutorial
   immediately, or (b) shows a 2-line landing page with a **Start tutorial**
   button. *Rec: (b) — opt-in, doesn't hijack, keeps a sentence of orientation.*

## Out of scope

Multiple tutorials; branching; progress persistence across sessions; a
`toc.json`-driven nav; converting other guide pages. All deferred until one
tutorial exists and real users show where the friction is.
