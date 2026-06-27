# Workbench node legibility: "Organised by" / "Values"

**Date:** 2026-06-27
**Status:** Approved, ready for planning

## Problem

A Workbench DAG table node currently labels its structure with two rows, `AXES`
and `VALUES`, each a strip of chips. For the target user — a researcher who does
not code — the word "axes" is opaque and collides with the unrelated notion of
*plot* axes (x/y). The chip strip also fails to convey two things that matter:

1. that the index columns are **nested** (e.g. `position_id` sits inside
   `experiment_id`), and
2. that there are **two roles** of column — the ones that *define a row* versus
   the ones that were *measured*.

The cryptic `~` badge (ragged axis) compounds the problem.

## Goal

Make a node's structure legible at a glance on the canvas, and fully readable
when opened, using one plain-English vocabulary in both places:

- **Organised by** — the index/dimension columns (replaces "axes").
- **Values** — the payload/measured columns (unchanged word).

## Two views, one vocabulary

The Workbench already has the right two surfaces (no new components or routes):

- **Summary (canvas node):** `src/components/ArrayShapeNode.tsx`, fed by
  `nodeShapeProps` in `src/workbench/ArrayShapeRFNode.tsx`. → gets a **nested
  outline**.
- **Expanded (floating card):** clicking a node opens a `FloatingCard` whose body
  is `src/workbench/cards/TableCard.tsx`, which renders the real reduced table via
  `src/components/NodeTable.tsx`. → gets a **role-banded, shaded spreadsheet**.

Both read their data from `node.count.{axes,values}` (`AxisDesc`, `ValueDesc` in
`src/types.ts`), which already carry everything needed. **No engine change.**

## Design

### 1. Summary node — nested outline (`ArrayShapeNode.tsx`)

Replace the two `txw-row` chip rows (`axes`, `values`) with:

- A **"Organised by"** section. Render the index columns as an indented
  hierarchy in axis order: the first axis flush-left; each subsequent axis
  prefixed with a `└` connector to show it is nested inside the previous one.
  Each axis shows a right-aligned **count pill**:
  - a fixed axis → its `n_levels` (e.g. `3`);
  - a ragged axis (`ragged: true`) → the word **`varies`** (not `~`), with a
    `title` tooltip "count varies by parent (ragged)". The varies pill uses a
    distinct (amber) tint from the numeric pill.
- A divider, then a **"Values"** section: each value column as a type-coloured
  chip (numeric = green, categorical = purple, bool = its existing class) with a
  plain-English type label aligned right (`number` / `category` / `yes-no`).
- The `@grain` suffix on a value chip is preserved (existing `txw-grain`).

**Preserved behaviours (must not regress):**
- `removed` axis names still render struck-through (today's `txw-ax gone`),
  shown within / after the Organised-by outline.
- `onKeys` join-key axes still get the amber key highlight (`keyhi`).
- The fixed node width from the recent DAG redesign is unchanged; the outline
  must fit it. Raw column names are kept verbatim — **no auto-prettifying**
  (stripping `_id` etc. is too lossy/ambiguous to guess).
- The `rows×cols` fallback (when no descriptor has loaded) is unchanged.

`nodeShapeProps` already passes `axes`, `values`, `removed`, `onKeys` — the
change is presentational, inside `ArrayShapeNode`. Section labels live in the
component (not the engine).

### 2. Expanded card — shaded role-banded spreadsheet (`NodeTable.tsx`)

Add an **opt-in** `groupRoles?: boolean` prop to `NodeTable` (default `false`,
so the Data tab's grid is untouched). `TableCard` passes `groupRoles`.

When `groupRoles` is on, and the node has `count.axes`/`count.values`:

- Build AG Grid **column groups**: a parent header **"Organised by"** spanning
  the index columns (those whose name is in `count.axes`) and **"Values"**
  spanning the rest. Columns keep their existing order.
- **Shade the index columns** — header and cells — with a light lavender
  (`idxcol` cell class + header class), so the eye separates "what defines a
  row" from "what was measured". Numeric value cells keep the existing `mono`
  class.
- Add a one-line **legend** under the grid: "Organised by — what defines each
  row · Values — what was measured", with the two swatch colours.

The data itself is already fetched by `NodeTable`; this is presentation only.
Column-to-role mapping is derived from `node.count.axes` names (fall back to the
ungrouped grid if the descriptor is absent — e.g. terminal `via:"none"` nodes).

## Components touched

| File | Change |
|---|---|
| `src/components/ArrayShapeNode.tsx` | Outline rendering for Organised by / Values; `varies` pill |
| `src/index.css` | New `.txw-*` classes for outline rows, pills, value type labels, index shading + legend |
| `src/workbench/cards/TableCard.tsx` | Pass `groupRoles` to `NodeTable` |
| `src/components/NodeTable.tsx` | `groupRoles` prop → AG Grid column groups, index shading, legend |

No changes to: `nodeShapeProps` data contract, `ArrayShapeRFNode` wiring,
authoring/`+` flow, collapse/grain model, the engine, the `.iris` format.

## Testing

- `src/components/ArrayShapeNode.test.tsx`: renders the Organised-by outline
  with nested connectors; ragged axis shows `varies` (not `~`); values show
  type labels; `removed` struck-through and `onKeys` highlight still present.
- `src/workbench/ArrayShapeRFNode.test.tsx`: `nodeShapeProps` mapping unchanged
  (axes/values/removed/onKeys still passed through) — update only if assertions
  reference removed markup.
- `src/components/NodeTable.test.tsx` (or new): with `groupRoles`, the grid
  renders the two parent header groups and applies the index shading class;
  with `groupRoles` false (Data tab), output is unchanged.
- e2e: no new flow; existing Workbench e2e should still pass.

## Non-goals

- Renaming "Values", prettifying column names, or changing type vocabulary
  beyond the plain-English labels above.
- Rolling the role-banding into the Data tab grid (kept opt-in; can be a later
  decision).
- Any change to the coordinate-grid (direction D) or other rejected mockups.
