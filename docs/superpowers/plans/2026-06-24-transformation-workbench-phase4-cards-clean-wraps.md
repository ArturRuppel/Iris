# Transformation Workbench — Phase 4: Card Bodies (clean wraps)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace five of the eight stub card bodies with real ones that wrap existing, global-atom-bound panels (`FigurePane`, `StatsPanel`, `CollapseRoutingPanel`, `EncodingsCard`+`LayerRail`) plus one small new editor (`AnnotateCard` for `style.show_significance`). The remaining three stubs (`table`, `op-editor`, `test-editor`) stay stubs — they need component extraction / new editors / a StatsPanel split and are deferred to a focused Phase 4b.

**Architecture:** Each card body lives in `src/workbench/cards/<Name>.tsx` and is a thin wrapper: it renders the existing panel (which already binds to the active analysis via global Jotai atoms) inside a labeled container. The `target` prop is unused by these five — they all operate on the single active analysis, not a per-target slice (that's exactly why they're the "clean" subset). `AnnotateCard` is the only one with its own logic: a checkbox reading/writing `activePlottableAtom.style.show_significance`, with the active test name for context. The final task swaps the five entries in `cardRegistry.tsx`'s `CARD_BODIES` map from stubs to these components. A shared test helper seeds a minimal store.

**Tech Stack:** TypeScript, React 18.3, Jotai, Vitest 4 + @testing-library/react (jsdom). No engine, no `.iris`, no `src/types.ts` changes. `show_significance` already exists on `StyleOverrides` — no new spec field. All card state remains the active analysis's existing spec fields; nothing new is serialized.

---

## Context for the implementer

You are extending **Iris** (a stats/plotting tool). The "Workbench" shows a pipeline DAG; clicking a node/edge opens an ephemeral floating **card**. Phase 3 built the card *infrastructure*:

- `src/workbench/cardRegistry.tsx` exports `type CardKind` (8 kinds), `interface Target { kind: "node"|"edge"; id: string }`, `interface CardBodyProps { target: Target }`, and `CARD_BODIES: Record<CardKind, (p: CardBodyProps) => JSX.Element>` — currently all **stub** bodies. This phase replaces 5 of the 8.
- `src/workbench/FloatingCard.tsx` renders a card body inside a `.txw-card-body` shell. (Not relevant to this phase except that your bodies render inside it eventually; you test the bodies directly.)

**The five panels you wrap (all already exist, all bind to global atoms — NO props):**

| Card kind | Panel | File | Renders |
|---|---|---|---|
| `plot` | `FigurePane` | `src/components/FigurePane.tsx` | `<section className="pane figure-pane">` (always; placeholder when no figure) |
| `stats` | `StatsPanel` | `src/components/StatsPanel.tsx` | `<section className="pane stats-pane">`; when `analysisAtom` is null shows text **"Waiting for first analysis…"** |
| `collapse-editor` | `CollapseRoutingPanel` | `src/components/CollapseRoutingPanel.tsx` | rows + a **"test reads at"** labelled select |
| `geom-editor` | `EncodingsCard` + `LayerRail` | `src/components/EncodingsCard.tsx`, `LayerRail.tsx` | encoding pickers + layer rail |
| `annotate-editor` | **new** `AnnotateCard` | (you create it) | a `show_significance` checkbox |

**Key atoms (from `src/state.ts`), all already exported:**
- `activePlottableAtom` — read/write atom for the active `Plottable`. `Plottable.style: StyleOverrides`; `StyleOverrides.show_significance?: boolean`.
- `analysisAtom` — **derived read-only**: `get(analysisByIdAtom)[activeId] ?? null`. Its result type has `.stats.result.test` (a test id string). You CANNOT `store.set` it directly; seed it in tests via `setAnalysisByIdAtom` (writer: `{ id, res }`).
- `schemaAtom`, `hierarchyAtom`, `plottablesAtom`, `activePlottableIdAtom`, `registryAtom`, `makeDefaultPlottable(schema)` — for test seeding.

**Test-seeding idiom** (copied from `src/components/CollapseRoutingPanel.test.tsx`): build a `createStore()`, set `schemaAtom`/`hierarchyAtom`/`plottablesAtom`/`activePlottableIdAtom` (and `registryAtom` for geom), wrap the component in `<Provider store={store}>`. This phase introduces a shared helper for that (Task 1).

**Hard constraints:**
- Do NOT edit the engine, `src/types.ts`, or anything serialized to `.iris`. No new spec field (`show_significance` already exists).
- Do NOT modify the wrapped panels (`FigurePane`, `StatsPanel`, etc.) — wrap them as-is.
- The three deferred stubs (`table`, `op-editor`, `test-editor`) stay exactly as they are. Do not touch them.
- 2-space indent; match the comment voice of `src/explorer/graph.ts` / `src/state.ts`.
- Card bodies bind to the active analysis, so they take no params (a `() => JSX.Element` is assignable to `(p: CardBodyProps) => JSX.Element` — fewer params is fine). Do NOT thread `target` into them.

Baseline before you start: full suite **193 passed**. Run `npm test -- --run`; type-check `npx tsc --noEmit`.

Each commit message gets these trailers (after a blank line):
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VoR6UvzPXR5gYDeVpAVyiM
```

---

## File Structure

- **Create** `src/workbench/cards/cardTestStore.tsx` — shared test helper `seedStore(spine?)`.
- **Create** `src/workbench/cards/AnnotateCard.tsx` (+ test) — the one new editor.
- **Create** `src/workbench/cards/PlotCard.tsx` (+ test) — wraps `FigurePane`.
- **Create** `src/workbench/cards/StatsCard.tsx` (+ test) — wraps `StatsPanel`.
- **Create** `src/workbench/cards/CollapseCard.tsx` (+ test) — wraps `CollapseRoutingPanel`.
- **Create** `src/workbench/cards/GeomCard.tsx` (+ test) — wraps `EncodingsCard` + `LayerRail`.
- **Modify** `src/workbench/cardRegistry.tsx` — swap 5 stub entries for the real components (Task 6).

Each card wraps its panel in `<div className="txw-card-<kind>" data-testid="<kind>-card">…</div>` so tests have a stable hook and the body has a layout anchor.

---

## Task 1: Shared test store + AnnotateCard

`AnnotateCard` is the only card with its own logic, so it goes first and introduces the shared test helper.

**Files:**
- Create: `src/workbench/cards/cardTestStore.tsx`
- Create: `src/workbench/cards/AnnotateCard.tsx`
- Test: `src/workbench/cards/AnnotateCard.test.tsx`

- [ ] **Step 1: Create the shared test helper**

Create `src/workbench/cards/cardTestStore.tsx`:

```tsx
import { createStore } from "jotai";
import {
  schemaAtom, hierarchyAtom, plottablesAtom, activePlottableIdAtom,
  registryAtom, makeDefaultPlottable,
} from "../../state";
import type { Schema, Registry } from "../../types";

/* A minimal seeded store for card-body tests: a schema whose columns are the
   spine dims (identifiers) + one numeric measure, a hierarchy over that spine,
   a registry stub, and one active default plottable. Mirrors the helper in
   CollapseRoutingPanel.test.tsx. */
export function seedStore(spine: string[] = ["experiment", "cell"]) {
  const store = createStore();
  const schema: Schema = { schema_version: "1.0", columns: [
    ...spine.map((d) => ({ name: d, type: "identifier" as const, label: d })),
    { name: "val", type: "numeric" as const, label: "Value" },
  ] };
  store.set(schemaAtom, schema);
  store.set(hierarchyAtom, { spine, fn: {} });
  const registry: Registry = { point_cap: 5000, facet_cell_cap: 200, geoms: {} };
  store.set(registryAtom, registry);
  const p = makeDefaultPlottable(schema);
  store.set(plottablesAtom, [p]);
  store.set(activePlottableIdAtom, p.id);
  return { store, plottable: p };
}
```

- [ ] **Step 2: Write the failing AnnotateCard test**

Create `src/workbench/cards/AnnotateCard.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "jotai";
import { AnnotateCard } from "./AnnotateCard";
import { seedStore } from "./cardTestStore";
import { activePlottableAtom, setAnalysisByIdAtom } from "../../state";
import type { AnalyzeResponse } from "../../types";

const target = { kind: "edge" as const, id: "a:annotate" };

describe("AnnotateCard", () => {
  it("renders an unchecked significance toggle by default", () => {
    const { store } = seedStore();
    render(<Provider store={store}><AnnotateCard target={target} /></Provider>);
    const box = screen.getByRole("checkbox");
    expect(box).not.toBeChecked();
    expect(store.get(activePlottableAtom)?.style.show_significance).toBeFalsy();
  });

  it("checking the toggle writes show_significance into the active plottable", () => {
    const { store } = seedStore();
    render(<Provider store={store}><AnnotateCard target={target} /></Provider>);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(store.get(activePlottableAtom)?.style.show_significance).toBe(true);
  });

  it("names the active test when one has run", () => {
    const { store, plottable } = seedStore();
    // a partial AnalyzeResponse — only the path AnnotateCard reads matters.
    const res = { stats: { result: { test: "welch_t" } } } as unknown as AnalyzeResponse;
    store.set(setAnalysisByIdAtom, { id: plottable.id, res });
    render(<Provider store={store}><AnnotateCard target={target} /></Provider>);
    expect(screen.getByText(/welch_t/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- --run src/workbench/cards/AnnotateCard.test.tsx`
Expected: FAIL — `./AnnotateCard` module not found.

- [ ] **Step 4: Implement AnnotateCard**

Create `src/workbench/cards/AnnotateCard.tsx`:

```tsx
import { useAtom, useAtomValue } from "jotai";
import { activePlottableAtom, analysisAtom } from "../../state";
import type { CardBodyProps } from "../cardRegistry";

/* The stats->plot "annotate" edge's editor: a single toggle for whether the
   figure draws significance brackets/stars from the test result. Reuses the
   existing style.show_significance flag (Phase 1 already derives the annotate
   graph edge from it) — no new spec field. Decorative annotations (reference
   lines, bands) live in the geom config, not here (design §2.5). */
export function AnnotateCard(_props: CardBodyProps) {
  const [p, setP] = useAtom(activePlottableAtom);
  const analysis = useAtomValue(analysisAtom);
  if (!p) return <p className="hint">No active analysis.</p>;

  const on = !!p.style.show_significance;
  const test = analysis?.stats?.result?.test;

  return (
    <div className="txw-card-annotate" data-testid="annotate-card">
      <label className="describe-toggle">
        <input type="checkbox" checked={on}
          onChange={(e) =>
            setP({ ...p, style: { ...p.style, show_significance: e.target.checked } })} />
        Draw significance brackets on the figure
      </label>
      <p className="hint">
        {test ? `Brackets use the ${test} result.`
              : "Configure a test to annotate the figure."}
      </p>
    </div>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- --run src/workbench/cards/AnnotateCard.test.tsx`
Expected: PASS (3 tests). If the third test fails on the `analysisAtom` path, confirm the read is `analysis?.stats?.result?.test` (matching `src/explorer/graphAtom.ts`'s `statsInputAtom`).

- [ ] **Step 6: Commit**

```bash
git add src/workbench/cards/cardTestStore.tsx src/workbench/cards/AnnotateCard.tsx src/workbench/cards/AnnotateCard.test.tsx
git commit -m "feat(workbench): AnnotateCard — significance toggle + shared card test store"
```
(append the two trailer lines)

---

## Task 2: PlotCard (wraps FigurePane)

**Files:**
- Create: `src/workbench/cards/PlotCard.tsx`
- Test: `src/workbench/cards/PlotCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/workbench/cards/PlotCard.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Provider } from "jotai";
import { PlotCard } from "./PlotCard";
import { seedStore } from "./cardTestStore";

describe("PlotCard", () => {
  it("renders the FigurePane inside the card wrapper", () => {
    const { store } = seedStore();
    const { container } = render(
      <Provider store={store}><PlotCard target={{ kind: "node", id: "plot" }} /></Provider>,
    );
    expect(container.querySelector('[data-testid="plot-card"]')).toBeInTheDocument();
    // FigurePane always renders its <section className="pane figure-pane">.
    expect(container.querySelector(".figure-pane")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --run src/workbench/cards/PlotCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement PlotCard**

Create `src/workbench/cards/PlotCard.tsx`:

```tsx
import { FigurePane } from "../../components/FigurePane";

/* The plot terminal: the rendered figure + its in-figure style controls. No
   encoding here — encoding lives on the geom edge (design §5). FigurePane binds
   to the active analysis's render result, so the card needs no target. */
export function PlotCard() {
  return (
    <div className="txw-card-plot" data-testid="plot-card">
      <FigurePane />
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --run src/workbench/cards/PlotCard.test.tsx`
Expected: PASS. If FigurePane throws on mount with the seeded store, the missing atom it needs must be added to `seedStore` — but FigurePane handles a null `analysisAtom` with its placeholder, so it should mount cleanly.

- [ ] **Step 5: Commit**

```bash
git add src/workbench/cards/PlotCard.tsx src/workbench/cards/PlotCard.test.tsx
git commit -m "feat(workbench): PlotCard wraps FigurePane"
```
(append trailers)

---

## Task 3: StatsCard (wraps StatsPanel)

**Files:**
- Create: `src/workbench/cards/StatsCard.tsx`
- Test: `src/workbench/cards/StatsCard.test.tsx`

Per the scope decision, StatsCard wraps `StatsPanel` whole for now (the result-vs-picker split is deferred to Phase 5 wiring).

- [ ] **Step 1: Write the failing test**

Create `src/workbench/cards/StatsCard.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { StatsCard } from "./StatsCard";
import { seedStore } from "./cardTestStore";

describe("StatsCard", () => {
  it("renders the StatsPanel inside the card wrapper", () => {
    const { store } = seedStore();
    const { container } = render(
      <Provider store={store}><StatsCard target={{ kind: "node", id: "stats" }} /></Provider>,
    );
    expect(container.querySelector('[data-testid="stats-card"]')).toBeInTheDocument();
    // with no analysis yet, StatsPanel shows its waiting placeholder.
    expect(screen.getByText(/waiting for first analysis/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --run src/workbench/cards/StatsCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement StatsCard**

Create `src/workbench/cards/StatsCard.tsx`:

```tsx
import { StatsPanel } from "../../components/StatsPanel";

/* The stats terminal: the test-result readout. StatsPanel binds to the active
   analysis's stats result, so the card needs no target. (StatsPanel currently
   also embeds the test picker; the result-vs-picker split per design §5 is
   deferred to the Phase 5 canvas wiring.) */
export function StatsCard() {
  return (
    <div className="txw-card-stats" data-testid="stats-card">
      <StatsPanel />
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --run src/workbench/cards/StatsCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workbench/cards/StatsCard.tsx src/workbench/cards/StatsCard.test.tsx
git commit -m "feat(workbench): StatsCard wraps StatsPanel"
```
(append trailers)

---

## Task 4: CollapseCard (wraps CollapseRoutingPanel)

**Files:**
- Create: `src/workbench/cards/CollapseCard.tsx`
- Test: `src/workbench/cards/CollapseCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/workbench/cards/CollapseCard.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { CollapseCard } from "./CollapseCard";
import { seedStore } from "./cardTestStore";

describe("CollapseCard", () => {
  it("renders the CollapseRoutingPanel inside the card wrapper", () => {
    const { store } = seedStore(["experiment", "cell"]);
    const { container } = render(
      <Provider store={store}>
        <CollapseCard target={{ kind: "edge", id: "e:source->grain:experiment" }} />
      </Provider>,
    );
    expect(container.querySelector('[data-testid="collapse-card"]')).toBeInTheDocument();
    expect(screen.getByLabelText(/test reads at/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --run src/workbench/cards/CollapseCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement CollapseCard**

Create `src/workbench/cards/CollapseCard.tsx`:

```tsx
import { CollapseRoutingPanel } from "../../components/CollapseRoutingPanel";

/* The collapse edge's editor: the aggregation routing (per-level grain + fn and
   the grain the test reads). The routing is per-analysis (one plan), so every
   collapse edge opens the same panel; CollapseRoutingPanel binds to the active
   analysis, so the card needs no target. */
export function CollapseCard() {
  return (
    <div className="txw-card-collapse" data-testid="collapse-card">
      <CollapseRoutingPanel />
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --run src/workbench/cards/CollapseCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workbench/cards/CollapseCard.tsx src/workbench/cards/CollapseCard.test.tsx
git commit -m "feat(workbench): CollapseCard wraps CollapseRoutingPanel"
```
(append trailers)

---

## Task 5: GeomCard (wraps EncodingsCard + LayerRail)

**Files:**
- Create: `src/workbench/cards/GeomCard.tsx`
- Test: `src/workbench/cards/GeomCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/workbench/cards/GeomCard.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Provider } from "jotai";
import { GeomCard } from "./GeomCard";
import { seedStore } from "./cardTestStore";

describe("GeomCard", () => {
  it("renders the encoding + layer editors inside the card wrapper", () => {
    const { store } = seedStore();
    const { container } = render(
      <Provider store={store}><GeomCard target={{ kind: "edge", id: "g:plain" }} /></Provider>,
    );
    expect(container.querySelector('[data-testid="geom-card"]')).toBeInTheDocument();
    // both child panels mount; the card wrapper holds them.
    expect(container.querySelectorAll('[data-testid="geom-card"] > *').length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --run src/workbench/cards/GeomCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement GeomCard**

Create `src/workbench/cards/GeomCard.tsx`:

```tsx
import { EncodingsCard } from "../../components/EncodingsCard";
import { LayerRail } from "../../components/LayerRail";

/* The geom edge's editor: the encoding (x/y/color) + the geom/layer picker.
   One geom stack per analysis, so every geom edge opens the same editors; both
   bind to the active analysis, so the card needs no target. Decorative
   annotations (reference lines) also live here via the layer config. */
export function GeomCard() {
  return (
    <div className="txw-card-geom" data-testid="geom-card">
      <EncodingsCard />
      <LayerRail />
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --run src/workbench/cards/GeomCard.test.tsx`
Expected: PASS. The `seedStore` helper already seeds `registryAtom` with `{ point_cap, facet_cell_cap, geoms: {} }`, which satisfies both panels (`EncodingsCard` reads `registry?.geoms[...]` null-safely; `LayerRail` only renders per-layer items, and a default plottable's layers index `registry.geoms[g]?.label` null-safely). If either panel still throws, seed the specific atom it reports missing.

- [ ] **Step 5: Commit**

```bash
git add src/workbench/cards/GeomCard.tsx src/workbench/cards/GeomCard.test.tsx
git commit -m "feat(workbench): GeomCard wraps EncodingsCard + LayerRail"
```
(append trailers)

---

## Task 6: Wire the five cards into the registry

**Files:**
- Modify: `src/workbench/cardRegistry.tsx`
- Modify: `src/workbench/cardRegistry.test.tsx` (extend, don't weaken)

Swap the five stub entries in `CARD_BODIES` for the real components. Keep `table`, `op-editor`, `test-editor` as stubs.

- [ ] **Step 1: Update the registry test first (TDD)**

In `src/workbench/cardRegistry.test.tsx`, the existing `CARD_BODIES` block tests "has a body for every kind" and renders the `test-editor` stub. ADD a test asserting the five real bodies are now wired (not the stub). Append inside the `describe("CARD_BODIES", …)` block:

```tsx
  it("wires real (non-stub) bodies for the five Phase-4 card kinds", () => {
    // the stub bodies render a div with data-testid="card-stub"; real wrappers
    // render data-testid="<kind>-card". Assert the five are no longer stubs.
    const realKinds: [CardKind, string][] = [
      ["plot", "plot-card"], ["stats", "stats-card"],
      ["collapse-editor", "collapse-card"], ["geom-editor", "geom-card"],
      ["annotate-editor", "annotate-card"],
    ];
    for (const [kind] of realKinds) {
      // the real components require app atoms; here we only assert identity, not
      // a deep render — the body must NOT be the shared stub factory output.
      expect(CARD_BODIES[kind].name).not.toBe("StubBody");
    }
  });

  it("keeps table / op-editor / test-editor as stubs (deferred to Phase 4b)", () => {
    for (const k of ["table", "op-editor", "test-editor"] as CardKind[]) {
      expect(CARD_BODIES[k].name).toBe("StubBody");
    }
  });
```

(The stub factory in `cardRegistry.tsx` returns a function named `StubBody` — confirm that name exists; if the stub function is anonymous, give it the name `StubBody` so the assertion is stable. Do not change stub behavior otherwise.)

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npm test -- --run src/workbench/cardRegistry.test.tsx`
Expected: FAIL — the five kinds still point at `StubBody`.

- [ ] **Step 3: Wire the real components**

In `src/workbench/cardRegistry.tsx`:

1. Add imports at the top (after the existing imports):
```tsx
import { PlotCard } from "./cards/PlotCard";
import { StatsCard } from "./cards/StatsCard";
import { CollapseCard } from "./cards/CollapseCard";
import { GeomCard } from "./cards/GeomCard";
import { AnnotateCard } from "./cards/AnnotateCard";
```

2. In the `CARD_BODIES` object, replace the five stub values with the real components (leave `table`, `op-editor`, `test-editor` as `stub(...)`):
```tsx
export const CARD_BODIES: Record<CardKind, (p: CardBodyProps) => JSX.Element> = {
  "table": stub("table"),
  "plot": PlotCard,
  "stats": StatsCard,
  "op-editor": stub("op-editor"),
  "collapse-editor": CollapseCard,
  "geom-editor": GeomCard,
  "test-editor": stub("test-editor"),
  "annotate-editor": AnnotateCard,
};
```

3. Ensure the stub factory's returned function is named `StubBody` (so the registry test's `.name` assertions are stable). If it is currently `function StubBody(...)`, leave it.

- [ ] **Step 4: Run the registry test**

Run: `npm test -- --run src/workbench/cardRegistry.test.tsx`
Expected: PASS (existing + the two new tests).

- [ ] **Step 5: Full suite + type-check**

Run: `npm test -- --run`
Expected: PASS — baseline 193 + Phase 4 tests (AnnotateCard 3, Plot 1, Stats 1, Collapse 1, Geom 1, registry +2 ≈ **202 passed**).

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/workbench/cardRegistry.tsx src/workbench/cardRegistry.test.tsx
git commit -m "feat(workbench): wire Plot/Stats/Collapse/Geom/Annotate cards into the registry"
```
(append trailers)

---

## Done criteria

- Five real card bodies under `src/workbench/cards/` wrap their panels; each renders inside a `data-testid="<kind>-card"` wrapper and is unit-tested against a seeded store.
- `AnnotateCard` toggles `style.show_significance` and names the active test — fully behavior-tested.
- `CARD_BODIES` points `plot`/`stats`/`collapse-editor`/`geom-editor`/`annotate-editor` at the real components; `table`/`op-editor`/`test-editor` remain stubs (asserted).
- Full suite green (~202), `tsc --noEmit` clean.
- No engine/`.iris`/`src/types.ts` changes; wrapped panels unmodified; nothing new serialized.

## Deferred to Phase 4b (own plan)

- **TableCard** — extract a reusable `NodeTable` view from `DataTab` (the per-node `engine.reduce` fetch + `fetchKey` memo), then the "Extend from here" menu (add filter/derive/recode/drop/collapse/join, add plot/stats via `addStepAtom`).
- **OpEditorCard** — step-index routing from the edge id (`e:…->step:N`) + editors for the reduce kinds `StepCards` doesn't yet cover (`derive`/`recode`/`join`/`pivot`/`grid_complete`); only `StepDrop`/`StepFilter` exist today.
- **Stats/Test split** — separate `StatsPanel` into a result-only `StatsCard` and a picker-only `TestCard` (the `test-editor` body), honoring "edges configure, terminals display." Done as part of Phase 5 canvas wiring.

## Roadmap (after Phase 4)

- **Phase 4b** — the three deferred cards above.
- **Phase 5** — canvas click → `openCardAtom`; render `cardsAtom` as `FloatingCard`s over the canvas; node drag → `nodePositionsAtom`; tidy clears nudges; collapse-all; rename `viewMode` `"analyses"`→`"workbench"`; delete `WorkspaceView`/`TransformWorkspace`/`workspaceOpenAtom`/tx-strip; call `clearWorkbenchAtom` on analysis switch.
