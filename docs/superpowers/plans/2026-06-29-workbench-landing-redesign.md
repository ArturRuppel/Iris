# Workbench Landing Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the abstract-DAG landing of the Transformation Workbench with three always-on hero cards (Table · Plot · Stats), where Plot/Stats are greyed until a plot exists, and a guided add-plot wizard that only ever offers valid geoms and columns.

**Architecture:** Front-end-only. The data model (`Plottable`/`Layer`), the live `AnalysisSpec` (`specAtom`), and the Python engine are untouched. We add pure gating helpers in `channels.ts`, a tiny card-state selector module, a stepwise `PlotWizard` shell over existing add/encoding atoms, a self-contained `LayerStrip`, and a `HeroCards` row, then restructure `WorkbenchCanvas`'s overlay into a compact DAG band + hero row. Encoding stays two-tier and figure-level (X/Y/Color/Shape/Size/Facet on `Plottable`; geom+level per `Layer`) exactly as today.

**Tech Stack:** React + TypeScript, Jotai atoms, React Flow (`@xyflow/react`), Vitest + @testing-library/react for unit/component tests, Playwright (Chromium) for e2e. Styling in the single `src/index.css`.

**Spec:** `docs/superpowers/specs/2026-06-29-workbench-landing-redesign-design.md`

---

## Orientation (read before starting)

Key existing APIs this plan builds on — all verified present:

- `src/channels.ts`
  - `offeredColumns(reg, channel, columns, activeGeoms?)` → `{ selectable: ColumnDef[]; disabled: {col,reason}[] }`. The single place column-offer rules live. `ID_AS_CATEGORICAL` already hides identifiers on x/y/size and treats them as categorical on color/shape/facets.
  - `geomAddable(meta, xType, yType)` → boolean; `geomGateReason(meta, xType, yType)` → string|null; `axisTypes(mappings, schema)` → `{xType,yType}`; `colType(schema, name)` → `"categorical"|"numeric"|null`.
  - `GeomMeta` fields used: `label`, `x_type`, `y_type` (strings like `"categorical"`/`"numeric"`/`"none"`), `h_orient?`, `aggregates`, `aes: string[]`.
- `src/state.ts`
  - `specAtom` → `AnalysisSpec | null` (live spec from the active plottable).
  - `effectiveSchemaAtom` → `Schema | null` (post-reduction schema, falls back to master).
  - `isSpecRenderable(spec, schema)` → boolean (Y mapping + ≥1 layer + mapped axes survive schema). **Reuse, do not reimplement.**
  - `activePlottableAtom` (read+write `Plottable|null`), `addLayerAtom(geom)`, `updateLayerAtom({index,layer})`, `moveLayerAtom({index,dir})`, `removeLayerAtom(index)`, `registryAtom`, `hierarchyAtom`.
  - `levelOptions(hierarchy, schema)` from `src/levels.ts`.
- `src/types.ts`
  - `ColumnDef { name; type: "numeric"|"categorical"|"identifier"|"bool"; label; levels?: string[] }`. **Single-value detection signal = `levels` (length ≤ 1) for categoricals.** `TableCounts` is `{ total: number }` — NOT per-column; do not use it for distinct counts.
  - `AnalysisSpec.encodings { x,y,color,size,shape: {column}|null }`, `.layers`.
- `src/components/`
  - `EncodingsCard` (no props) — the figure-level X/Y + optional Color/Size/Shape/Facet editor. Reused verbatim as the wizard's "map data" step body.
  - `FigurePane` (no props), `StatsResults` (no props), `TestPicker` (no props) from `StatsPanel`.
  - `LayerRail` — geom-first editor: `<EncodingsCard/>` + a layer list (`LayerItem`) + an inline `+ add layer` geom menu. Still opened by the DAG figure node's "Edit plot…" context menu, so it must keep working.
  - `LayerCard` from `./LayerCards` (per-layer style body), used by `LayerItem`.
- `src/workbench/`
  - `WorkbenchCanvas.tsx` → `Canvas` inside `ReactFlowProvider`. Overlay `.txw-overlay` contains `.txw-topbar`, `.txw-rfcanvas` (the ReactFlow, absolutely positioned `inset:44px 0 0 0`), `.txw-cards` (floating edge-editor cards), `<Stash>`, `<ResizeHandles>`, `<StashFocus>`.
  - `cardRegistry.tsx` — `CARD` map (kept for DAG-click stash/floating cards; the hero cards are separate).
  - The source table node id is the literal string `"source"` (`SOURCE_ID` in `explorer/graph.ts`).
  - Test seed helper: `src/workbench/cards/cardTestStore.tsx` `seedStore(spine?)` → `{ store, plottable }`.
- Host: `src/App.tsx:534-538` renders `<PlottableSidebar/>` + `<WorkbenchCanvas graph={explorerGraph}/>` inside `.workbench-mode`. `PlottableSidebar` is out of scope.

CSS anchors in `src/index.css`: `.txw-overlay` (line ~806, `position:fixed; inset:0`), `.txw-topbar` (~810, 44px sticky), `.txw-rfcanvas` (~865, `position:absolute; inset:44px 0 0 0`), `.txw-cards` (~1028), `.with-stash { bottom: var(--stash-h) }` (~1035).

---

## File Structure

**New files:**

- `src/components/plotWizard.ts` — pure step-machine helpers for the wizard (mode/step transitions). No React.
- `src/components/plotWizard.test.ts` — unit tests for the machine.
- `src/components/PlotWizard.tsx` — the stepwise add-plot/add-layer shell component.
- `src/components/PlotWizard.test.tsx` — component tests.
- `src/components/LayerStrip.tsx` — the always-on layer list (list + move/remove/retype + an `addSlot` for the host's add affordance), extracted from `LayerRail`. Self-contained (reads atoms).
- `src/components/LayerStrip.test.tsx` — component tests.
- `src/workbench/cardGating.ts` — pure `heroCardStates(spec, schema)` selector.
- `src/workbench/cardGating.test.ts` — unit tests.
- `src/workbench/HeroCards.tsx` — the always-on Table·Plot·Stats row.
- `src/workbench/HeroCards.test.tsx` — component tests.
- `e2e/workbench-landing.spec.ts` — Playwright flow (path matches the existing e2e dir; adjust if the repo uses a different folder — see Task 9).

**Modified files:**

- `src/channels.ts` — add `categoryUsable(col)` predicate + apply it in `offeredColumns`; add `geomSatisfiableByColumns(meta, columns, reg)` for gallery gating.
- `src/channels.test.ts` (create if absent) — unit tests for the new predicates.
- `src/components/LayerRail.tsx` — render the extracted `<LayerStrip>` instead of its inline list (keep its inline add-layer geom menu as the `addSlot`).
- `src/workbench/WorkbenchCanvas.tsx` — restructure overlay into DAG band + `<HeroCards graph={graph}/>` row.
- `src/index.css` — DAG-band + hero-row layout, `.txw-hero*`, `.txw-card-disabled`.

---

## Task 1: Single-value-category gating in `channels.ts`

A categorical column with ≤1 distinct level can't group anything (box X, Color, Shape, Facet), so it must be hidden from those channels. The signal is `ColumnDef.levels` (populated when a column becomes a classifier). When `levels` is absent we cannot tell, so we stay permissive (do not hide).

**Files:**
- Modify: `src/channels.ts`
- Test: `src/channels.test.ts` (create if it does not exist)

- [ ] **Step 1: Write the failing test**

Create/append to `src/channels.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { categoryUsable, offeredColumns } from "./channels";
import type { ColumnDef, Registry } from "./types";

const reg: Registry = { point_cap: 5000, facet_cell_cap: 200, geoms: {} };

describe("categoryUsable", () => {
  it("rejects a categorical with one (or zero) levels", () => {
    expect(categoryUsable({ name: "g", type: "categorical", label: "G", levels: ["only"] })).toBe(false);
    expect(categoryUsable({ name: "g", type: "categorical", label: "G", levels: [] })).toBe(false);
  });
  it("accepts a categorical with two or more levels", () => {
    expect(categoryUsable({ name: "g", type: "categorical", label: "G", levels: ["a", "b"] })).toBe(true);
  });
  it("stays permissive when levels are unknown", () => {
    expect(categoryUsable({ name: "g", type: "categorical", label: "G" })).toBe(true);
  });
  it("ignores non-categoricals (numeric is never a single-value category)", () => {
    expect(categoryUsable({ name: "v", type: "numeric", label: "V" })).toBe(true);
  });
});

describe("offeredColumns hides single-value categoricals on grouping channels", () => {
  const cols: ColumnDef[] = [
    { name: "cond", type: "categorical", label: "Condition", levels: ["ctrl", "drug"] },
    { name: "batch", type: "categorical", label: "Batch", levels: ["one"] }, // single value
    { name: "val", type: "numeric", label: "Value" },
  ];
  it("color offers the multi-level category but not the single-value one", () => {
    const { selectable } = offeredColumns(reg, "color", cols);
    const names = selectable.map((c) => c.name);
    expect(names).toContain("cond");
    expect(names).not.toContain("batch");
  });
  it("x offers the multi-level category but not the single-value one", () => {
    const { selectable } = offeredColumns(reg, "x", cols);
    expect(selectable.map((c) => c.name)).not.toContain("batch");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/channels.test.ts`
Expected: FAIL — `categoryUsable is not a function` / `batch` still offered.

- [ ] **Step 3: Implement `categoryUsable` and apply it in `offeredColumns`**

In `src/channels.ts`, add the predicate above the `offeredColumns` export (after the `ID_AS_CATEGORICAL` const):

```ts
/* A categorical column is only usable on a grouping channel if it has ≥2 distinct
   levels — a single-value category groups nothing (a box with one x group, a color
   with one swatch). The signal is `levels` (set when a column becomes a classifier);
   when it is absent we cannot tell the cardinality, so we stay permissive and offer
   the column (the engine/guards still catch a degenerate render). Non-categoricals
   are never single-value categories, so they always pass. */
export function categoryUsable(col: ColumnDef): boolean {
  if (col.type !== "categorical") return true;
  if (!col.levels) return true; // unknown cardinality → permissive
  return col.levels.length >= 2;
}
```

Then, inside `offeredColumns`, drop a column resolved to the categorical type when it is an unusable single-value category. Change the loop body:

```ts
  for (const c of columns) {
    const t: ColType | null =
      c.type === "numeric" || c.type === "bool" ? "numeric"
      : c.type === "categorical" ? "categorical"
      : c.type === "identifier" && ID_AS_CATEGORICAL.has(channel) ? "categorical"
      : null;
    if (!t) continue;
    // a single-value categorical groups nothing — hide it entirely (design §4).
    // identifiers treated as categorical (color/shape/facet) are spine ids and
    // keep their existing high-cardinality handling, so this guard only trims a
    // genuine classifier column with <2 levels.
    if (t === "categorical" && c.type === "categorical" && !categoryUsable(c)) continue;
    const st = renderStatus(reg, channel, t, activeGeoms);
    if (st === "ok") selectable.push(c);
    else if (st) disabled.push({ col: c, reason: st.reason });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/channels.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/channels.ts src/channels.test.ts
git commit -m "feat(channels): hide single-value categoricals from grouping channels"
```

---

## Task 2: Gallery gating — `geomSatisfiableByColumns`

The wizard's Step-1 geom gallery must hide geoms no valid column assignment could satisfy (e.g. a box when the data has no usable categorical column). This is a pure predicate over the schema columns.

**Files:**
- Modify: `src/channels.ts`
- Test: `src/channels.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/channels.test.ts`:

```ts
import { geomSatisfiableByColumns } from "./channels";
import type { GeomMeta } from "./types";

const box: GeomMeta = {
  label: "Box", family: "group_comparison", aggregates: true,
  x_type: "categorical", y_type: "numeric", aes: ["color"],
} as GeomMeta;
const scatter: GeomMeta = {
  label: "Scatter", family: "correlation", aggregates: false,
  x_type: "numeric", y_type: "numeric", aes: ["color", "size"],
} as GeomMeta;

describe("geomSatisfiableByColumns", () => {
  const numericOnly: ColumnDef[] = [
    { name: "x", type: "numeric", label: "X" },
    { name: "y", type: "numeric", label: "Y" },
  ];
  const withCategory: ColumnDef[] = [
    { name: "cond", type: "categorical", label: "Condition", levels: ["a", "b"] },
    { name: "val", type: "numeric", label: "Value" },
  ];
  const singleValueCategory: ColumnDef[] = [
    { name: "batch", type: "categorical", label: "Batch", levels: ["one"] },
    { name: "val", type: "numeric", label: "Value" },
  ];
  it("box needs a usable categorical x and a numeric y", () => {
    expect(geomSatisfiableByColumns(box, withCategory, reg)).toBe(true);
    expect(geomSatisfiableByColumns(box, numericOnly, reg)).toBe(false);
    expect(geomSatisfiableByColumns(box, singleValueCategory, reg)).toBe(false);
  });
  it("scatter needs two numerics, satisfied by numeric-only data", () => {
    expect(geomSatisfiableByColumns(scatter, numericOnly, reg)).toBe(true);
    expect(geomSatisfiableByColumns(scatter, withCategory, reg)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/channels.test.ts`
Expected: FAIL — `geomSatisfiableByColumns is not a function`.

- [ ] **Step 3: Implement the predicate**

Add to `src/channels.ts` near `geomAddable`:

```ts
/* Whether a geom could be drawn at all by SOME assignment of the available
   columns — used to gate the wizard's geom gallery. A geom is satisfiable when
   each of its required axis types ("categorical"/"numeric") has at least one
   column that `offeredColumns` would offer on that axis (which already excludes
   identifiers and, via categoryUsable, single-value categoricals). An axis whose
   requirement is "none" needs nothing. h_orient geoms are also satisfiable in the
   swapped orientation (numeric x, categorical y). Registry-independent of mappings:
   this is the data-availability question, not the current-encoding question. */
export function geomSatisfiableByColumns(
  meta: GeomMeta, columns: ColumnDef[], reg: Registry | null,
): boolean {
  const hasAxis = (axis: "x" | "y", required: string): boolean => {
    if (required === "none") return true;
    if (required !== "categorical" && required !== "numeric") return false;
    return offeredColumns(reg, axis, columns).selectable.some(
      (c) => colType(columns.length ? { schema_version: "x", columns } : null, c.name) === required,
    );
  };
  const vertical = hasAxis("x", meta.x_type) && hasAxis("y", meta.y_type);
  if (!meta.h_orient) return vertical;
  const horizontal = hasAxis("x", "numeric") && hasAxis("y", "categorical");
  return vertical || horizontal;
}
```

Note: `colType` takes a `Schema|null`; we wrap `columns` into a throwaway schema literal so the same type rule is reused (a column's `bool` maps to numeric, etc.). Import nothing new — `colType`, `offeredColumns`, `ColType` already live in this module; `GeomMeta`/`Registry`/`ColumnDef` are already imported from `./types`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/channels.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/channels.ts src/channels.test.ts
git commit -m "feat(channels): add geomSatisfiableByColumns for wizard gallery gating"
```

---

## Task 3: Hero-card state selector — `cardGating.ts`

A pure selector deciding which hero cards are enabled. Table is always on; Plot is enabled iff the live spec is renderable; Stats follows Plot. Isolating this makes the rule testable and gives Stats a place to diverge later.

**Files:**
- Create: `src/workbench/cardGating.ts`
- Test: `src/workbench/cardGating.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { heroCardStates } from "./cardGating";
import type { AnalysisSpec, Schema } from "../types";

const schema: Schema = { schema_version: "1.0", columns: [
  { name: "cond", type: "categorical", label: "Condition", levels: ["a", "b"] },
  { name: "val", type: "numeric", label: "Value" },
] };

const renderable: AnalysisSpec = {
  spec_version: "2.1", id: "p1", title: "t", data: { filter: [] },
  reduce: { steps: [] },
  encodings: { x: { column: "cond" }, y: { column: "val" }, color: null, size: null, shape: null },
  facet: { row: null, col: null, share_x: true, share_y: true },
  layers: [{ geom: "box", level: "" }],
} as unknown as AnalysisSpec;

describe("heroCardStates", () => {
  it("Table is always enabled", () => {
    expect(heroCardStates(null, schema).tableEnabled).toBe(true);
    expect(heroCardStates(renderable, schema).tableEnabled).toBe(true);
  });
  it("Plot and Stats are disabled with no spec", () => {
    const s = heroCardStates(null, schema);
    expect(s.plotEnabled).toBe(false);
    expect(s.statsEnabled).toBe(false);
  });
  it("Plot and Stats enable for a renderable spec", () => {
    const s = heroCardStates(renderable, schema);
    expect(s.plotEnabled).toBe(true);
    expect(s.statsEnabled).toBe(true);
  });
  it("Plot disabled when the spec has no layers", () => {
    const noLayers = { ...renderable, layers: [] } as unknown as AnalysisSpec;
    expect(heroCardStates(noLayers, schema).plotEnabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workbench/cardGating.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { AnalysisSpec, Schema } from "../types";
import { isSpecRenderable } from "../state";

export interface HeroCardStates {
  tableEnabled: boolean;
  plotEnabled: boolean;
  statsEnabled: boolean;
}

/* Which of the three hero cards are live. Table is always enabled (a source table
   always exists). Plot is enabled exactly when the live spec is renderable — a Y
   mapping, ≥1 layer, and mapped axes that survive the schema (isSpecRenderable, the
   same gate the render loop uses). Stats follows Plot: there is nothing to test
   without a rendered figure. Kept pure so the rule is unit-tested and the component
   is a thin reader. */
export function heroCardStates(spec: AnalysisSpec | null, schema: Schema | null): HeroCardStates {
  const plotEnabled = spec ? isSpecRenderable(spec, schema) : false;
  return { tableEnabled: true, plotEnabled, statsEnabled: plotEnabled };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/workbench/cardGating.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workbench/cardGating.ts src/workbench/cardGating.test.ts
git commit -m "feat(workbench): hero-card state selector"
```

---

## Task 4: Wizard step machine — `plotWizard.ts`

A pure machine for the wizard's step sequence. Two modes: `first` (no layers yet: pick geom → map data → done) and `addLayer` (figure encoding inherited: pick geom → pick grain → done). Keeping it pure makes the sequencing testable without React.

**Files:**
- Create: `src/components/plotWizard.ts`
- Test: `src/components/plotWizard.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { firstStep, nextStep, type WizardMode } from "./plotWizard";

describe("plotWizard step machine", () => {
  it("first mode goes type → map → done", () => {
    const m: WizardMode = "first";
    expect(firstStep(m)).toBe("type");
    expect(nextStep(m, "type")).toBe("map");
    expect(nextStep(m, "map")).toBe("done");
  });
  it("addLayer mode goes type → grain → done", () => {
    const m: WizardMode = "addLayer";
    expect(firstStep(m)).toBe("type");
    expect(nextStep(m, "type")).toBe("grain");
    expect(nextStep(m, "grain")).toBe("done");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/plotWizard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/* Pure step sequencing for the add-plot wizard (PlotWizard.tsx). Two modes:
   - "first": the figure has no layers yet, so we pick a geom then map the shared
     figure-level encoding (X/Y required, Color/Shape/Size/Facet optional).
   - "addLayer": the figure already has an encoding, so a new layer only chooses a
     geom and a grain/level; X/Y and the aesthetics are inherited read-only.
   "done" closes the wizard. The component owns whether a step may advance (e.g.
   X & Y both mapped); this module owns only the ORDER. */
export type WizardMode = "first" | "addLayer";
export type WizardStep = "type" | "map" | "grain" | "done";

export function firstStep(_mode: WizardMode): WizardStep {
  return "type";
}

export function nextStep(mode: WizardMode, step: WizardStep): WizardStep {
  if (step === "type") return mode === "first" ? "map" : "grain";
  if (step === "map" || step === "grain") return "done";
  return "done";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/plotWizard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/plotWizard.ts src/components/plotWizard.test.ts
git commit -m "feat(workbench): pure step machine for the plot wizard"
```

---

## Task 5: `LayerStrip` — extract the layer list from `LayerRail`

The Plot hero card needs the layer list (with retype/move/remove) without `LayerRail`'s collapse chrome or `EncodingsCard`. Extract a self-contained `LayerStrip` that reads the active plottable + atoms itself and takes an `addSlot` for whatever add affordance the host wants. Then refactor `LayerRail` to render it (DRY), passing its existing inline geom menu as the slot, so the DAG "Edit plot…" card is unchanged.

**Files:**
- Create: `src/components/LayerStrip.tsx`
- Modify: `src/components/LayerRail.tsx`
- Test: `src/components/LayerStrip.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "jotai";
import { LayerStrip } from "./LayerStrip";
import { seedStore } from "../workbench/cards/cardTestStore";
import { activePlottableAtom, registryAtom } from "../state";
import type { Registry } from "../types";

function mount() {
  const { store, plottable } = seedStore();
  const registry: Registry = { point_cap: 5000, facet_cell_cap: 200, geoms: {
    box: { label: "Box", family: "group_comparison", aggregates: true,
      x_type: "categorical", y_type: "numeric", aes: ["color"] } as never,
  } };
  store.set(registryAtom, registry);
  store.set(activePlottableAtom, { ...plottable, mappings: { x: "experiment", y: "val" },
    layers: [{ id: "ly1", geom: "box", level: "" }] });
  render(<Provider store={store}><LayerStrip addSlot={<button>+ add layer</button>} /></Provider>);
  return store;
}

describe("LayerStrip", () => {
  it("renders one row per layer and the add slot", () => {
    mount();
    expect(screen.getByTitle(/change plot type/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add layer/i })).toBeInTheDocument();
  });
  it("removes a layer via the ✕ control", () => {
    const store = mount();
    fireEvent.click(screen.getByTitle(/remove layer/i));
    expect(store.get(activePlottableAtom)?.layers).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/LayerStrip.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `LayerStrip` (move `LayerItem` into it)**

Create `src/components/LayerStrip.tsx`. Move the existing `LayerItem` component out of `LayerRail.tsx` verbatim and host the list here, reading atoms directly:

```tsx
import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import {
  activePlottableAtom, effectiveSchemaAtom, hierarchyAtom,
  moveLayerAtom, registryAtom, removeLayerAtom, updateLayerAtom,
} from "../state";
import { axisTypes, geomGateReason } from "../channels";
import type { Geom, Layer, Registry } from "../types";
import { levelOptions } from "../levels";
import { LayerCard } from "./LayerCards";
import type { ReactNode } from "react";

/* one geom layer, independently collapsible so a tall stack stays scannable. The
   plot type is a dropdown so a layer can be re-typed in place (box → violin)
   without removing and re-adding it. Geoms incompatible with the current encoding
   appear disabled-with-reason rather than hidden. (Moved verbatim from LayerRail.) */
function LayerItem({ layer, registry, i, last, retypeGeoms, gateReason, levels, onMove, onRemove, onChange }: {
  layer: Layer; registry: Registry; i: number; last: boolean; retypeGeoms: Geom[];
  gateReason: (g: Geom) => string | null;
  levels: { value: string; label: string }[];
  onMove: (dir: -1 | 1) => void; onRemove: () => void;
  onChange: (l: Layer) => void;
}) {
  const [open, setOpen] = useState(true);
  const retype = (geom: Geom) => onChange({ ...layer, geom, level: layer.level });
  return (
    <li className="layer-card">
      <div className="layer-head">
        <button className="card-toggle layer-toggle" title={open ? "Collapse" : "Expand"}
          onClick={() => setOpen((o) => !o)}>
          <span className="chevron">{open ? "▾" : "▸"}</span>
        </button>
        <select className="layer-geom" value={layer.geom} title="Change plot type"
          onChange={(e) => retype(e.target.value as Geom)}>
          {retypeGeoms.map((g) => {
            const reason = g === layer.geom ? null : gateReason(g);
            return (
              <option key={g} value={g} disabled={!!reason}>
                {registry.geoms[g]?.label ?? g}{reason ? ` — ${reason}` : ""}
              </option>
            );
          })}
        </select>
        <span className="layer-actions">
          <button className="icon" title="Move up" disabled={i === 0}
            onClick={() => onMove(-1)}>↑</button>
          <button className="icon" title="Move down" disabled={last}
            onClick={() => onMove(1)}>↓</button>
          <button className="icon" title="Remove layer" onClick={onRemove}>✕</button>
        </span>
      </div>
      {open && <LayerCard layer={layer} registry={registry} levels={levels} onChange={onChange} />}
    </li>
  );
}

/* The always-on layer list: every layer as a retype/move/remove row, plus a
   host-supplied add affordance (`addSlot`). Self-contained — reads the active
   plottable and the layer-CRUD atoms itself — so both LayerRail (DAG editor) and
   the Plot hero card can drop it in. */
export function LayerStrip({ addSlot }: { addSlot?: ReactNode }) {
  const active = useAtomValue(activePlottableAtom);
  const registry = useAtomValue(registryAtom);
  const schema = useAtomValue(effectiveSchemaAtom);
  const hierarchy = useAtomValue(hierarchyAtom);
  const updateLayer = useSetAtom(updateLayerAtom);
  const removeLayer = useSetAtom(removeLayerAtom);
  const moveLayer = useSetAtom(moveLayerAtom);
  if (!active || !registry) return null;

  const { xType, yType } = axisTypes(active.mappings, schema);
  const gateReason = (g: Geom): string | null => {
    const meta = registry.geoms[g];
    return meta ? geomGateReason(meta, xType, yType) : null;
  };
  const allGeoms = Object.keys(registry.geoms) as Geom[];
  const layers = active.layers;

  return (
    <div className="layer-strip" data-testid="layer-strip">
      {layers.length === 0 && <p className="rail-empty">No layers — add a geom.</p>}
      <ol className="layer-list">
        {layers.map((layer, i) => (
          <LayerItem key={layer.id ?? i} layer={layer} registry={registry} i={i}
            last={i === layers.length - 1} retypeGeoms={allGeoms}
            gateReason={gateReason} levels={levelOptions(hierarchy, schema)}
            onMove={(dir) => moveLayer({ index: i, dir })}
            onRemove={() => removeLayer(i)}
            onChange={(l) => updateLayer({ index: i, layer: l })} />
        ))}
      </ol>
      {addSlot && <div className="add-layer">{addSlot}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Refactor `LayerRail` to use `LayerStrip`**

In `src/components/LayerRail.tsx`: delete the local `LayerItem` function and the `<ol className="layer-list">…</ol>` + `{layers.length === 0 && …}` block; import and render `<LayerStrip addSlot={…}/>`, passing the existing inline add-layer menu as the slot. Keep `EncodingsCard`, the collapse chrome, and the `addable`/`noEncoding`/`hiddenCount` logic. The render becomes:

```tsx
import { LayerStrip } from "./LayerStrip";
// …keep: useAtomValue/useSetAtom, useState, the atoms, channels imports for
// axisTypes/geomAddable/geomGateReason, registry, EncodingsCard.
// Remove: moveLayerAtom/removeLayerAtom/updateLayerAtom/levelOptions/LayerCard
// imports if now unused (they move to LayerStrip). Keep addLayerAtom (the menu).

      <EncodingsCard />

      <LayerStrip addSlot={
        adding ? (
          <div className="add-layer-menu">
            {addable.length === 0 && (
              <em className="rail-empty">
                No layer fits the current encoding — change X / Y to enable layers.
              </em>
            )}
            {addable.length > 0 && noEncoding && (
              <em className="rail-hint">Pick a geom — it will narrow what X / Y can map.</em>
            )}
            {addable.map((g) => (
              <button key={g} onClick={() => { addLayer(g); setAdding(false); }}>
                {registry.geoms[g].label}
              </button>
            ))}
            {hiddenCount > 0 && addable.length > 0 && (
              <em className="rail-empty">
                {hiddenCount} more hidden — incompatible with the current encoding
              </em>
            )}
            <button className="cancel" onClick={() => setAdding(false)}>cancel</button>
          </div>
        ) : (
          <button className="add-layer-btn" onClick={() => setAdding(true)}>+ Add layer</button>
        )
      } />
```

Keep `axisTypes`/`geomAddable` in `LayerRail` (they still compute `addable`). Remove now-unused imports flagged by the compiler.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/LayerStrip.test.tsx`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: no errors (fix any unused-import errors in `LayerRail.tsx`).

- [ ] **Step 6: Commit**

```bash
git add src/components/LayerStrip.tsx src/components/LayerStrip.test.tsx src/components/LayerRail.tsx
git commit -m "refactor(workbench): extract LayerStrip from LayerRail"
```

---

## Task 6: `PlotWizard` — the guided add-plot/add-layer shell

The stepwise shell. It sequences existing surfaces: a geom gallery (gated by `geomSatisfiableByColumns`), then either `EncodingsCard` (first mode) or a grain picker (addLayer mode). Picking a geom calls `addLayerAtom`; the encoding step reuses `EncodingsCard` verbatim. `onDone`/`onCancel` are host callbacks (the hero Plot card owns open/close).

**Files:**
- Create: `src/components/PlotWizard.tsx`
- Test: `src/components/PlotWizard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "jotai";
import { PlotWizard } from "./PlotWizard";
import { seedStore } from "../workbench/cards/cardTestStore";
import { activePlottableAtom, registryAtom, effectiveSchemaAtom } from "../state";
import type { Registry, Schema } from "../types";

function seedWithGeoms() {
  const { store, plottable } = seedStore();
  const schema: Schema = { schema_version: "1.0", columns: [
    { name: "cond", type: "categorical", label: "Condition", levels: ["a", "b"] },
    { name: "val", type: "numeric", label: "Value" },
  ] };
  const registry: Registry = { point_cap: 5000, facet_cell_cap: 200, geoms: {
    box: { label: "Box", family: "group_comparison", aggregates: true,
      x_type: "categorical", y_type: "numeric", aes: ["color"] } as never,
    scatter: { label: "Scatter", family: "correlation", aggregates: false,
      x_type: "numeric", y_type: "numeric", aes: ["color"] } as never,
  } };
  store.set(registryAtom, registry);
  store.set(effectiveSchemaAtom as never, schema); // derived atom: seed underlying schema instead — see note
  store.set(activePlottableAtom, { ...plottable, mappings: { x: "", y: "" }, layers: [] });
  return store;
}

describe("PlotWizard (first mode)", () => {
  it("shows only geoms the data can satisfy, then adds the picked layer", () => {
    const store = seedWithGeoms();
    render(<Provider store={store}>
      <PlotWizard mode="first" onDone={() => {}} onCancel={() => {}} />
    </Provider>);
    // box (categorical x available) is offered; scatter (needs two numerics) is not
    expect(screen.getByRole("button", { name: /^Box$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Scatter$/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Box$/ }));
    expect(store.get(activePlottableAtom)?.layers).toHaveLength(1);
    // advances to the map-data step (EncodingsCard renders the X row)
    expect(screen.getByText("X")).toBeInTheDocument();
  });

  it("cancel fires onCancel", () => {
    const store = seedWithGeoms();
    const onCancel = vi.fn();
    render(<Provider store={store}>
      <PlotWizard mode="first" onDone={() => {}} onCancel={onCancel} />
    </Provider>);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
```

> **Note on seeding `effectiveSchemaAtom`:** it is a derived (read-only) atom — you cannot `store.set` it. `seedStore` already seeds `tablesAtom` so `schemaAtom`/`effectiveSchemaAtom` resolve; to override the columns, set the underlying table's schema instead. Replace the `store.set(effectiveSchemaAtom …)` line with a helper that rewrites `tablesAtom`'s active table `schema` to the test `schema` (mirror how `cardTestStore` builds the table). Confirm `effectiveSchemaAtom` returns the seeded columns before asserting. (When in doubt, extend `seedStore` to accept a `columns` override and use that.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/PlotWizard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PlotWizard`**

```tsx
import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import {
  activePlottableAtom, addLayerAtom, effectiveSchemaAtom, hierarchyAtom,
  registryAtom, updateLayerAtom,
} from "../state";
import { geomSatisfiableByColumns } from "../channels";
import type { Geom } from "../types";
import { levelOptions } from "../levels";
import { EncodingsCard } from "./EncodingsCard";
import { firstStep, nextStep, type WizardMode, type WizardStep } from "./plotWizard";

/* The guided add-plot / add-layer shell. It does not own plot state — it sequences
   existing surfaces over the existing atoms:
   - Step "type": a gallery of geoms the available columns could satisfy
     (geomSatisfiableByColumns). Picking one calls addLayerAtom and advances.
   - Step "map" (first mode only): the figure-level encoding editor (EncodingsCard,
     verbatim). X & Y required to finish.
   - Step "grain" (addLayer mode only): the new layer's level; X/Y/aesthetics are
     inherited from the figure and shown read-only.
   onDone/onCancel are owned by the host (the Plot hero card opens/closes it). */
export function PlotWizard({ mode, onDone, onCancel }: {
  mode: WizardMode; onDone: () => void; onCancel: () => void;
}) {
  const registry = useAtomValue(registryAtom);
  const schema = useAtomValue(effectiveSchemaAtom);
  const active = useAtomValue(activePlottableAtom);
  const hierarchy = useAtomValue(hierarchyAtom);
  const addLayer = useSetAtom(addLayerAtom);
  const updateLayer = useSetAtom(updateLayerAtom);
  const [step, setStep] = useState<WizardStep>(() => firstStep(mode));

  if (!registry || !active) return null;
  const columns = schema?.columns ?? [];

  // the geom just added is the last layer (addLayer appends); its index drives the
  // grain step's writes.
  const lastIndex = active.layers.length - 1;

  const pickGeom = (g: Geom) => {
    addLayer(g);
    setStep(nextStep(mode, "type"));
  };

  const xyMapped = !!active.mappings.x && !!active.mappings.y;

  return (
    <div className="plot-wizard" data-testid="plot-wizard">
      {step === "type" && (
        <div className="wiz-step wiz-type">
          <p className="wiz-head">Choose a plot type</p>
          <div className="wiz-gallery">
            {(Object.keys(registry.geoms) as Geom[])
              .filter((g) => {
                const meta = registry.geoms[g];
                return meta ? geomSatisfiableByColumns(meta, columns, registry) : false;
              })
              .map((g) => (
                <button key={g} className="wiz-geom" onClick={() => pickGeom(g)}>
                  {registry.geoms[g].label}
                </button>
              ))}
          </div>
          <button className="cancel" onClick={onCancel}>cancel</button>
        </div>
      )}

      {step === "map" && (
        <div className="wiz-step wiz-map">
          <p className="wiz-head">Map your data</p>
          <EncodingsCard />
          <div className="wiz-actions">
            <button className="cancel" onClick={onCancel}>cancel</button>
            <button className="wiz-done" disabled={!xyMapped} onClick={onDone}>Done</button>
          </div>
        </div>
      )}

      {step === "grain" && (
        <div className="wiz-step wiz-grain">
          <p className="wiz-head">Choose the grain for this layer</p>
          <select value={active.layers[lastIndex]?.level ?? ""}
            onChange={(e) => updateLayer({ index: lastIndex,
              layer: { ...active.layers[lastIndex], level: e.target.value } })}>
            {levelOptions(hierarchy, schema).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p className="wiz-inherited">
            X = {active.mappings.x || "—"}, Y = {active.mappings.y || "—"} (inherited from the figure)
          </p>
          <div className="wiz-actions">
            <button className="cancel" onClick={onCancel}>cancel</button>
            <button className="wiz-done" onClick={onDone}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/PlotWizard.test.tsx`
Expected: PASS. (If the `effectiveSchemaAtom` seeding note bit you, fix the seed first.)

- [ ] **Step 5: Commit**

```bash
git add src/components/PlotWizard.tsx src/components/PlotWizard.test.tsx
git commit -m "feat(workbench): guided PlotWizard add-plot/add-layer shell"
```

---

## Task 7: `HeroCards` — the always-on Table · Plot · Stats row

The new landing row. Table is always live (bound to the `"source"` node). Plot is `FigurePane` + `LayerStrip` when enabled, else a `+ add plot` CTA that opens `PlotWizard` (first mode). The `LayerStrip`'s add slot opens `PlotWizard` (addLayer mode). Stats is `StatsResults` + `TestPicker` when enabled, else a "needs a plot" stub.

**Files:**
- Create: `src/workbench/HeroCards.tsx`
- Test: `src/workbench/HeroCards.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { HeroCards } from "./HeroCards";
import { seedStore } from "./cards/cardTestStore";
import { activePlottableAtom, registryAtom } from "../state";
import type { ExplorerGraph } from "../explorer/graph";
import type { Registry } from "../types";

const graph: ExplorerGraph = {
  nodes: [
    { id: "source", kind: "table", phase: "source", label: "Source", table: { via: "at_step", at_step: -1 } },
    { id: "plot", kind: "figure", phase: "terminal", label: "Figure", table: { via: "none" } },
  ],
  edges: [], spine: [],
} as unknown as ExplorerGraph;

function mount(opts: { withPlot: boolean }) {
  const { store, plottable } = seedStore();
  const registry: Registry = { point_cap: 5000, facet_cell_cap: 200, geoms: {
    box: { label: "Box", family: "group_comparison", aggregates: true,
      x_type: "categorical", y_type: "numeric", aes: ["color"] } as never,
  } };
  store.set(registryAtom, registry);
  store.set(activePlottableAtom, opts.withPlot
    ? { ...plottable, mappings: { x: "experiment", y: "val" }, layers: [{ id: "ly1", geom: "box", level: "" }] }
    : { ...plottable, mappings: { x: "", y: "" }, layers: [] });
  render(<Provider store={store}><HeroCards graph={graph} /></Provider>);
  return store;
}

describe("HeroCards", () => {
  it("Table is always present", () => {
    mount({ withPlot: false });
    expect(screen.getByTestId("table-card")).toBeInTheDocument();
  });
  it("with no plot, Plot shows the add-plot CTA and Stats is disabled", () => {
    mount({ withPlot: false });
    expect(screen.getByRole("button", { name: /add plot/i })).toBeInTheDocument();
    expect(screen.getByTestId("hero-stats")).toHaveClass("txw-card-disabled");
  });
  it("with a plot, the Plot body and the layer strip render", () => {
    mount({ withPlot: true });
    expect(screen.getByTestId("layer-strip")).toBeInTheDocument();
    expect(screen.getByTestId("hero-stats")).not.toHaveClass("txw-card-disabled");
  });
});
```

> The `specAtom`/`isSpecRenderable` path needs the seeded schema to contain `experiment` and `val`. `seedStore()`'s default spine is `["experiment","cell"]` plus `val`, so `{x:"experiment", y:"val"}` survives the schema and `isSpecRenderable` is true. Good. (`FigurePane` renders a waiting state with no `analysisAtom` result — that is fine; assert on `layer-strip`, not SVG.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workbench/HeroCards.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `HeroCards`**

```tsx
import { useAtomValue } from "jotai";
import { useState } from "react";
import { specAtom, effectiveSchemaAtom } from "../state";
import { heroCardStates } from "./cardGating";
import { TableCard } from "./cards/TableCard";
import { FigurePane } from "../components/FigurePane";
import { StatsResults, TestPicker } from "../components/StatsPanel";
import { LayerStrip } from "../components/LayerStrip";
import { PlotWizard } from "../components/PlotWizard";
import type { WizardMode } from "../components/plotWizard";
import type { ExplorerGraph } from "../explorer/graph";

/* One framed hero card. Disabled cards get .txw-card-disabled so the row reads
   "one done, two waiting." */
function HeroCard({ title, disabled, testid, children }: {
  title: string; disabled?: boolean; testid: string; children: React.ReactNode;
}) {
  return (
    <section className={`txw-hero-card${disabled ? " txw-card-disabled" : ""}`} data-testid={testid}>
      <header className="txw-hero-bar">{title}</header>
      <div className="txw-hero-body">{children}</div>
    </section>
  );
}

/* The always-on landing row: source Table, the Plot, and the Stats. Table is
   always live; Plot/Stats gate on the live spec (heroCardStates). The Plot card is
   the home of the guided add-plot/add-layer wizard. */
export function HeroCards({ graph }: { graph: ExplorerGraph }) {
  const spec = useAtomValue(specAtom);
  const schema = useAtomValue(effectiveSchemaAtom);
  const { plotEnabled, statsEnabled } = heroCardStates(spec, schema);
  // the wizard, when open, owns the Plot card body. null = closed.
  const [wizard, setWizard] = useState<WizardMode | null>(null);

  // bind the Table card to the source node (always present).
  const sourceId = graph.nodes.find((n) => n.phase === "source")?.id ?? "source";

  return (
    <div className="txw-hero-row" data-testid="hero-row">
      <HeroCard title="Table" testid="hero-table">
        <TableCard target={{ kind: "node", id: sourceId }} />
      </HeroCard>

      <HeroCard title="Plot" disabled={!plotEnabled && !wizard} testid="hero-plot">
        {wizard ? (
          <PlotWizard mode={wizard}
            onDone={() => setWizard(null)} onCancel={() => setWizard(null)} />
        ) : plotEnabled ? (
          <>
            <FigurePane />
            <LayerStrip addSlot={
              <button className="add-layer-btn" onClick={() => setWizard("addLayer")}>
                + add layer
              </button>
            } />
          </>
        ) : (
          <button className="txw-add-plot" onClick={() => setWizard("first")}>+ add plot</button>
        )}
      </HeroCard>

      <HeroCard title="Stats" disabled={!statsEnabled} testid="hero-stats">
        {statsEnabled ? (
          <>
            <StatsResults />
            <TestPicker />
          </>
        ) : (
          <p className="txw-card-stub">Add a plot to see a test.</p>
        )}
      </HeroCard>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/workbench/HeroCards.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workbench/HeroCards.tsx src/workbench/HeroCards.test.tsx
git commit -m "feat(workbench): always-on Table/Plot/Stats hero cards"
```

---

## Task 8: Restructure the overlay — DAG band + hero row + CSS

Split `Canvas`'s overlay so the DAG is a compact band on top and `HeroCards` fills the bottom. The floating edge-editor cards (`.txw-cards`), the stash, focus mode, undo/redo, tidy, and the grain legend all stay.

**Files:**
- Modify: `src/workbench/WorkbenchCanvas.tsx`
- Modify: `src/index.css`
- Test: `src/workbench/WorkbenchCanvas.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/workbench/WorkbenchCanvas.test.tsx` (it already has `mount()` + `graph`):

```tsx
  it("renders the hero-card row alongside the DAG band", () => {
    mount();
    expect(screen.getByTestId("hero-row")).toBeInTheDocument();
    // the DAG is still present (a node from the graph)
    expect(document.querySelectorAll(".react-flow__node").length).toBeGreaterThan(0);
  });
```

> The existing `graph` in that test file has a `"source"` node, so the Table hero card resolves. If the seeded store there lacks a registry/active plottable, the Plot/Stats cards fall to their disabled states — still rendered, so `hero-row` exists. If `HeroCards` throws without an active plottable, guard it (see Step 3: `HeroCards` already returns the row even when `spec` is null — `TableCard` shows its stub, Plot shows `+ add plot`, Stats shows the stub).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workbench/WorkbenchCanvas.test.tsx`
Expected: FAIL — `hero-row` not found.

- [ ] **Step 3: Wire `HeroCards` into the overlay**

In `src/workbench/WorkbenchCanvas.tsx`:

1. Add the import:
```tsx
import { HeroCards } from "./HeroCards";
```
2. Add a class to the overlay root so CSS can lay out band + row, and insert the hero row after the `.txw-rfcanvas` block and before `.txw-cards`. Change the overlay opening tag's className from `"txw-overlay txw-embedded"` to include a landing flag:
```tsx
    <div className="txw-overlay txw-embedded txw-landing" role="dialog" aria-label="Transformation workbench"
```
3. Immediately after the closing `</div>` of `.txw-rfcanvas` (the block that wraps `<ReactFlow>…</ReactFlow>` and the context menu), add:
```tsx
      <HeroCards graph={graph} />
```
Leave `.txw-cards`, `<Stash>`, `<ResizeHandles>`, `<StashFocus>` exactly as they are.

- [ ] **Step 4: Add the layout CSS**

In `src/index.css`, after the existing `.txw-rfcanvas` rule (~line 865), add the landing layout. The `.txw-landing` overlay becomes a vertical stack below the 44px topbar: a DAG band (~32% of the area, min 160px) and the hero row (the rest). Override `.txw-rfcanvas`'s absolute fill for landing only.

```css
/* ---- landing layout: compact DAG band on top, hero cards below ---- */
.txw-overlay.txw-landing { display: block; }
/* the DAG is a band, not the whole canvas, on the landing overlay */
.txw-landing .txw-rfcanvas {
  inset: 44px 0 auto 0;
  height: clamp(160px, 32%, 360px);
  border-bottom: 1px solid #e2e8f0;
}
/* the always-on hero row fills the area below the band */
.txw-hero-row {
  position: absolute;
  inset: calc(44px + clamp(160px, 32%, 360px)) 0 0 0;
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 10px;
  padding: 10px;
  overflow: hidden;
}
.txw-landing .txw-hero-row.with-stash,
.txw-landing .txw-rfcanvas.with-stash { /* stash docks below as today */ }
.txw-hero-card {
  display: flex; flex-direction: column;
  min-height: 0; min-width: 0;
  border: 1px solid #e2e8f0; border-radius: 8px;
  background: #fff; overflow: hidden;
}
.txw-hero-bar {
  flex: 0 0 auto; padding: 6px 10px;
  font-size: 12px; font-weight: 600; color: #334155;
  border-bottom: 1px solid #eef2f7; background: #f8fafc;
}
.txw-hero-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 10px; }
/* disabled (waiting) cards: greyed + hatched so the row reads one-done-two-waiting */
.txw-card-disabled { opacity: 0.65; }
.txw-card-disabled .txw-hero-body {
  background-image: repeating-linear-gradient(
    45deg, #f1f5f9 0, #f1f5f9 8px, #f8fafc 8px, #f8fafc 16px);
}
.txw-add-plot {
  margin: auto; display: block;
  padding: 10px 18px; font-size: 14px; font-weight: 600;
  color: #fff; background: #3b6ef0; border: none; border-radius: 8px; cursor: pointer;
}
.txw-add-plot:hover { background: #2f5fd8; }
.plot-wizard .wiz-gallery { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
.plot-wizard .wiz-geom {
  padding: 8px 14px; border: 1px solid #c3cee0; border-radius: 6px;
  background: #f8fafc; cursor: pointer;
}
.plot-wizard .wiz-geom:hover { border-color: #3b6ef0; background: #eaf0ff; }
.plot-wizard .wiz-head { font-size: 13px; font-weight: 600; color: #334155; margin: 0 0 4px; }
.plot-wizard .wiz-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.plot-wizard .wiz-inherited { font-size: 11px; color: #64748b; margin: 6px 0 0; }
.layer-strip .add-layer { margin-top: 6px; }
```

Note: the `inset` `calc(44px + clamp(...))` must use the SAME `clamp(...)` as the band height so the row starts exactly where the band ends. If you change the band height, change both.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/workbench/WorkbenchCanvas.test.tsx`
Expected: PASS.
Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 6: Visual check**

Run the dev server (`npm run dev`), open the workbench on a dataset:
- Empty analysis → DAG band on top; Table populated; Plot greyed with `+ add plot`; Stats greyed "Add a plot to see a test."
- `+ add plot` → geom gallery (only data-valid geoms) → pick box → `EncodingsCard` X/Y → Done → plot renders, Stats ungreys.
- `+ add layer` in the Plot card → geom + grain only; X/Y shown inherited.
Adjust band height / paddings if cramped.

- [ ] **Step 7: Commit**

```bash
git add src/workbench/WorkbenchCanvas.tsx src/index.css src/workbench/WorkbenchCanvas.test.tsx
git commit -m "feat(workbench): DAG band + hero-card landing layout"
```

---

## Task 9: End-to-end flow (Playwright)

Drive the whole landing flow in a real browser.

**Files:**
- Create: `e2e/workbench-landing.spec.ts` (match the repo's actual e2e dir — see Step 1)
- Test: the spec itself

- [ ] **Step 1: Locate the e2e harness**

Run: `ls e2e tests playwright.config.* 2>/dev/null; npx playwright test --list 2>/dev/null | head`
Use the existing directory and any app-bootstrap/fixture helpers (data import, navigating to the Workbench tab). Mirror an existing spec's setup (selectors for importing a dataset and clicking the **Workbench** tab — `viewMode === "workbench"`). Prior notes say the committed e2e suite is stale, so expect to refresh selectors.

- [ ] **Step 2: Write the spec**

```ts
import { test, expect } from "@playwright/test";

// Mirror an existing spec's bootstrap (import a demo dataset, open the Workbench
// tab). Replace the helpers below with the repo's real ones.
test("landing: greyed cards → add plot → add layer", async ({ page }) => {
  await page.goto("/");
  // … import a dataset with a usable categorical (e.g. condition) + a numeric …
  await page.getByRole("button", { name: "Workbench" }).click();

  // land: Plot & Stats greyed
  await expect(page.getByTestId("hero-plot")).toHaveClass(/txw-card-disabled/);
  await expect(page.getByTestId("hero-stats")).toHaveClass(/txw-card-disabled/);
  await expect(page.getByTestId("table-card")).toBeVisible();

  // add a plot
  await page.getByRole("button", { name: /add plot/i }).click();
  await page.getByRole("button", { name: /^Box$/ }).click();
  // map X/Y via the encoding rows (selects rendered by EncodingsCard)
  await page.getByRole("combobox").first().selectOption({ label: /condition/i });
  // (select the Y row's combobox; index/label per the rendered order)
  await page.locator(".enc-row", { hasText: "Y" }).getByRole("combobox")
    .selectOption({ label: /value|area/i });
  await page.getByRole("button", { name: /^Done$/ }).click();

  // plot renders, stats ungreys
  await expect(page.getByTestId("hero-plot")).not.toHaveClass(/txw-card-disabled/);
  await expect(page.getByTestId("hero-stats")).not.toHaveClass(/txw-card-disabled/);
  await expect(page.getByTestId("layer-strip")).toBeVisible();

  // add a second layer (geom + grain only)
  await page.getByRole("button", { name: /add layer/i }).click();
  await page.getByRole("button", { name: /points|dots|scatter/i }).first().click();
  await page.getByRole("button", { name: /^Done$/ }).click();
  await expect(page.getByTitle(/change plot type/i)).toHaveCount(2);
});
```

- [ ] **Step 3: Run the e2e spec**

Run: `npx playwright test e2e/workbench-landing.spec.ts`
Expected: PASS (Chromium is available per project notes). Fix selectors against the real DOM as needed.

- [ ] **Step 4: Commit**

```bash
git add e2e/workbench-landing.spec.ts
git commit -m "test(e2e): workbench landing add-plot/add-layer flow"
```

---

## Task 10: Full suite + cleanup

**Files:** none new.

- [ ] **Step 1: Run the whole unit/component suite**

Run: `npx vitest run`
Expected: all green. In particular confirm no existing `LayerRail`/`cardRegistry` test regressed after the `LayerStrip` extraction.

- [ ] **Step 2: Typecheck + lint + build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: clean.

- [ ] **Step 3: Remove the brainstorm mockups + stop the visual companion**

```bash
bash scripts/stop-server.sh 2>/dev/null || true
git rm -r --cached .superpowers/brainstorm/3392606-1782683364/content 2>/dev/null || true
rm -rf .superpowers/brainstorm/3392606-1782683364/content
```
(Only if those mockups are not needed as design artifacts; otherwise leave them.)

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore(workbench): finalize landing redesign; drop brainstorm mockups"
```

---

## Self-Review

**Spec coverage:**
- §1 Landing layout (DAG band + hero row) → Task 8.
- §2 Card states (Table always; Plot iff `isSpecRenderable`; Stats follows) → Task 3 (selector) + Task 7 (rendering).
- §3 Add-plot wizard (first: type→map→done; add-layer: geom+grain) → Task 4 (machine) + Task 6 (component); re-entry wired in Task 7.
- §4 Validity gating (hide identifiers + ≤1-level categoricals; gallery hides unsatisfiable geoms) → Task 1 + Task 2.
- §5 Stats card relocation (`StatsResults` + `TestPicker` into the Stats hero card) → Task 7.
- §6 No engine change → honored throughout (no engine/spec/Plottable/Layer edits anywhere in the plan).

**Placeholder scan:** No "TBD"/"add error handling"/"similar to" — every code step carries full code. The two soft spots are flagged explicitly with how to resolve them: the `effectiveSchemaAtom` seeding note (Task 6) and the e2e selector refresh (Task 9), both inherent to the test harness, not gaps in the design.

**Type/name consistency:** `heroCardStates` → `{tableEnabled, plotEnabled, statsEnabled}` used identically in Tasks 3 and 7. `WizardMode`/`WizardStep` and `firstStep`/`nextStep` consistent across Tasks 4, 6, 7. `categoryUsable`/`geomSatisfiableByColumns` signatures consistent across Tasks 1, 2, 6. `LayerStrip` prop `addSlot` consistent across Tasks 5, 7. Test ids (`hero-row`, `hero-table`, `hero-plot`, `hero-stats`, `layer-strip`, `plot-wizard`, `table-card`) consistent across Tasks 5–9. The `"source"` node id is resolved via `phase === "source"` with a `"source"` literal fallback (Task 7), matching `explorer/graph.ts`.

**Known risk:** Task 8's CSS uses a `clamp()` repeated in two places (band height and hero-row top inset) — they must stay equal; the plan calls this out. If the duplicated `calc()` proves fragile, switch `.txw-landing` to a CSS grid (`grid-template-rows: 44px clamp(...) 1fr`) and drop the absolute insets — a clean follow-up, not required for correctness.
