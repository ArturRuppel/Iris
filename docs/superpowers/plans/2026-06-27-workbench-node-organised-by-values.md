# Workbench node "Organised by" / "Values" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a Workbench table node legible to non-coders by replacing the opaque `AXES`/`VALUES` chip rows with a nested **"Organised by"** outline on the canvas node, and a role-banded, shaded spreadsheet in the expanded Table card.

**Architecture:** Presentation-only. The canvas node (`ArrayShapeNode`) and the expanded card's grid (`NodeTable`) both already receive everything they need from `node.count.{axes,values}` (`AxisDesc`/`ValueDesc`). Task 1 reworks the node's render + CSS. Tasks 2–3 add an opt-in `groupRoles` mode to `NodeTable` (column groups + index shading + legend), wired on only by the Workbench `TableCard` so the Data tab grid is untouched. No engine, `.iris`, or data-contract change.

**Tech Stack:** React + TypeScript, Jotai, AG Grid Community, Vitest + Testing Library, plain CSS in `src/index.css`.

**Spec:** `docs/superpowers/specs/2026-06-27-workbench-node-organised-by-values-design.md`

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/components/ArrayShapeNode.tsx` | Canvas node presentation | Replace chip rows with Organised-by outline + Values list; add `varies` pill, type labels |
| `src/components/ArrayShapeNode.test.tsx` | Node render tests | Rewrite assertions for the new markup |
| `src/index.css` | Node + grid styles | Swap old `.txw-row/.txw-ax/.txw-caret` rules for outline classes; add role-band + index-shade + legend rules |
| `src/components/NodeTable.tsx` | Reduced-table grid (shared) | Export pure `buildColumnDefs`; add opt-in `groupRoles` prop → column groups, index shading, legend |
| `src/components/NodeTable.test.tsx` | Grid tests | Add `buildColumnDefs` unit tests + `groupRoles` render tests |
| `src/workbench/cards/TableCard.tsx` | Workbench table card body | Pass `groupRoles` to `NodeTable` |

---

## Task 1: Canvas node — nested "Organised by" / "Values" outline

**Files:**
- Modify: `src/components/ArrayShapeNode.tsx`
- Modify: `src/index.css` (node CSS block, ~lines 699–719)
- Test: `src/components/ArrayShapeNode.test.tsx`

- [ ] **Step 1: Rewrite the failing tests**

Replace the body of `src/components/ArrayShapeNode.test.tsx` (keep the imports/fixtures at the top, lines 1–14) with these `describe` tests:

```tsx
describe("ArrayShapeNode", () => {
  it("lists index dims under 'Organised by' with counts; ragged shows 'varies' not ~", () => {
    render(<ArrayShapeNode title="filtered" variant="table" axes={axes} values={values} />);
    expect(screen.getByText("Organised by")).toBeInTheDocument();

    const exp = screen.getByText("experiment");
    expect(exp).toHaveClass("txw-dim");
    expect(exp).not.toHaveClass("ragged");
    expect(exp.closest(".txw-lvl")).toHaveTextContent("3");

    const frame = screen.getByText("frame");
    expect(frame).toHaveClass("ragged");
    expect(frame.closest(".txw-lvl")).toHaveTextContent("varies");
    expect(screen.queryByText("~")).toBeNull();
  });

  it("shows a nesting connector on every axis after the first", () => {
    const { container } = render(
      <ArrayShapeNode title="x" variant="table" axes={axes} values={[]} />);
    const lvls = container.querySelectorAll(".txw-tree .txw-lvl");
    expect(lvls[0]).not.toHaveClass("nested");
    expect(lvls[1]).toHaveClass("nested");
    expect(lvls[1].querySelector(".txw-twig")).not.toBeNull();
  });

  it("lists values under 'Values' with a plain-English type label and the @grain tag", () => {
    render(<ArrayShapeNode title="x" variant="table" axes={axes} values={values} />);
    expect(screen.getByText("Values")).toBeInTheDocument();

    const speed = screen.getByText("speed");
    expect(speed.closest(".txw-val")).toHaveClass("num");
    expect(speed.closest(".txw-vrow")).toHaveTextContent("number");

    const cls = screen.getByText("class").closest(".txw-val")!;
    expect(cls).toHaveClass("catg");
    expect(cls).toHaveTextContent("@cell");
    expect(screen.getByText("class").closest(".txw-vrow")).toHaveTextContent("category");
  });

  it("renders removed axes struck-through (collapse), and join keys highlighted", () => {
    render(<ArrayShapeNode title="per cell" variant="grain"
      axes={axes.slice(0, 2)} values={[]} removed={["frame"]} onKeys={["experiment"]} />);
    expect(screen.getByText("frame")).toHaveClass("gone");
    expect(screen.getByText("experiment")).toHaveClass("keyhi");
  });

  it("applies the variant class and falls back to rows×cols when no descriptor", () => {
    const { container } = render(
      <ArrayShapeNode title="source" variant="source" axes={[]} values={[]} rows={1240} cols={5} />);
    expect(container.querySelector(".txw-node")).toHaveClass("source");
    expect(screen.getByText("1240×5")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/ArrayShapeNode.test.tsx`
Expected: FAIL — e.g. `Unable to find an element with the text: Organised by`.

- [ ] **Step 3: Implement the new render + type labels**

In `src/components/ArrayShapeNode.tsx`, add a type-label map next to the existing `VAL_CLASS` (after line 19):

```tsx
const TYPE_LABEL: Record<string, string> = {
  numeric: "number", categorical: "category", bool: "yes-no",
};
```

Then replace the entire `return (...)` block of `ArrayShapeNode` (the JSX from `<div className={`txw-node ${variant}`}>` through its closing `</div>`) with:

```tsx
  return (
    <div className={`txw-node ${variant}`}>
      <div className="txw-ntitle">
        <span className="txw-nicon" aria-hidden><NodeIcon variant={variant} /></span>
        <span className="txw-ntitle-text">{title}</span>
      </div>

      {(axes.length > 0 || removed.length > 0) && (
        <div className="txw-sec">
          <div className="txw-sk">Organised by</div>
          <ul className="txw-tree">
            {axes.map((a, i) => (
              <li key={a.name} className={`txw-lvl${i > 0 ? " nested" : ""}`}>
                {i > 0 && <span className="txw-twig" aria-hidden>└</span>}
                <span className={`txw-dim${a.ragged ? " ragged" : ""}${onKeys.includes(a.name) ? " keyhi" : ""}`}>
                  {a.name}
                </span>
                <span
                  className={`txw-pill${a.ragged ? " varies" : ""}`}
                  title={a.ragged ? "count varies by parent (ragged)" : undefined}
                >
                  {a.ragged ? "varies" : a.n_levels}
                </span>
              </li>
            ))}
            {removed.map((name) => (
              <li key={name} className="txw-lvl removed">
                <span className="txw-dim gone">{name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {values.length > 0 && (
        <div className="txw-sec">
          <div className="txw-sk">Values</div>
          <ul className="txw-vlist">
            {values.map((v) => (
              <li key={v.name} className="txw-vrow">
                <span className={`txw-val ${VAL_CLASS[v.type] ?? "num"}`}>
                  {v.name}
                  {v.grain && <span className="txw-grain">@{v.grain}</span>}
                </span>
                <span className="txw-vtype">{TYPE_LABEL[v.type] ?? v.type}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!hasDescriptor && rows != null && cols != null && (
        <div className="txw-count">{rows}×{cols}</div>
      )}
    </div>
  );
```

(Leave the `hasDescriptor` line, the props signature, `NodeIcon`, and `VAL_CLASS` as they are.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/ArrayShapeNode.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Swap the node CSS**

In `src/index.css`, replace this block (the `.txw-row` … `.txw-ax.keyhi .txw-n` rules):

```css
.txw-row { display:flex; align-items:flex-start; gap:6px; margin:3px 0; }
.txw-rk { font:600 9px/1.4; text-transform:uppercase; letter-spacing:.05em;
  color:var(--faint); flex:none; padding-top:2px; }
.txw-chips { display:flex; align-items:center; gap:4px 5px; flex-wrap:wrap; min-width:0; }
.txw-axwrap { display:inline-flex; align-items:center; gap:5px; }
.txw-ax { display:inline-flex; align-items:center; gap:3px; background:#e0f2fe;
  border:1px solid #7dd3fc; color:#0369a1; border-radius:4px; padding:1px 6px; font-size:11px; }
.txw-ax .txw-n { font:600 9px/1 ui-monospace,monospace; color:#0284c7;
  background:#fff; border-radius:2px; padding:1px 3px; }
.txw-ax.ragged { border-style:dashed; }
.txw-ax.gone { opacity:.3; text-decoration:line-through; }
.txw-ax.keyhi { background:#fef3c7; border-color:#fcd34d; color:#b45309; }
.txw-ax.keyhi .txw-n { color:#b45309; }
```

with the outline rules:

```css
/* node body: two labelled sections — "Organised by" (index dims, nested) and
   "Values" (measured columns). Replaces the old axes/values chip rows. */
.txw-sec { margin:4px 0; }
.txw-sk { font:600 9px/1.4; text-transform:uppercase; letter-spacing:.05em;
  color:var(--faint); margin-bottom:3px; }
.txw-tree, .txw-vlist { list-style:none; margin:0; padding:0; }
.txw-lvl { display:flex; align-items:center; gap:5px; padding:1.5px 0; min-width:0; }
.txw-lvl.nested { padding-left:7px; }
.txw-twig { flex:none; color:#cbd5e1; font:11px/1 ui-monospace,monospace; }
.txw-dim { font-size:11px; color:#334155; overflow:hidden; text-overflow:ellipsis;
  white-space:nowrap; }
.txw-dim.ragged { font-style:italic; }
.txw-dim.gone { opacity:.4; text-decoration:line-through; }
.txw-dim.keyhi { color:#b45309; font-weight:600; }
.txw-pill { margin-left:auto; flex:none; font:600 9px/1 ui-monospace,monospace;
  color:#6d28d9; background:#f3e8ff; border-radius:9px; padding:1px 7px; }
.txw-pill.varies { color:#b45309; background:#fef3c7; }
.txw-vrow { display:flex; align-items:center; gap:6px; padding:1.5px 0; min-width:0; }
.txw-vtype { margin-left:auto; flex:none; font-size:9px; color:var(--faint); }
```

Then delete the now-unused caret rule:

```css
.txw-caret { color:#cbd5e1; font-size:11px; }
```

(Keep `.txw-val`, `.txw-val.num/.catg/.bool`, `.txw-val .txw-grain`, and `.txw-count` exactly as they are.)

- [ ] **Step 6: Verify the whole suite + types are clean**

Run: `npx vitest run src/components/ArrayShapeNode.test.tsx && npx tsc --noEmit`
Expected: tests PASS, tsc exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/ArrayShapeNode.tsx src/components/ArrayShapeNode.test.tsx src/index.css
git commit -m "feat(workbench): canvas node shows 'Organised by' outline + 'Values' list

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MqRMCubLHeVwS2CZsBbnD6"
```

---

## Task 2: Pure `buildColumnDefs` helper (index/value column grouping)

**Files:**
- Modify: `src/components/NodeTable.tsx`
- Test: `src/components/NodeTable.test.tsx`

- [ ] **Step 1: Write the failing unit tests**

At the top of `src/components/NodeTable.test.tsx`, add to the existing import from `./NodeTable` so it reads:

```tsx
import { NodeTable, buildColumnDefs } from "./NodeTable";
```

and add this import near the other type imports:

```tsx
import type { ColDef, ColGroupDef } from "ag-grid-community";
import type { ColumnDef } from "../types";
```

Then add a new `describe` block at the end of the file:

```tsx
describe("buildColumnDefs", () => {
  const cols: ColumnDef[] = [
    { name: "experiment", label: "experiment", type: "identifier" },
    { name: "position", label: "position", type: "identifier" },
    { name: "t1_event_id", label: "t1_event_id", type: "numeric" },
    { name: "contact_type", label: "contact_type", type: "categorical" },
  ];

  it("returns flat colDefs when groupRoles is off", () => {
    const defs = buildColumnDefs(cols);
    expect(defs).toHaveLength(4);
    expect(defs.every((d) => "field" in d)).toBe(true);
  });

  it("groups index vs value columns under role bands and shades index cells", () => {
    const defs = buildColumnDefs(cols, { groupRoles: true, axisNames: ["experiment", "position"] });
    expect(defs).toHaveLength(2);
    const [organised, values] = defs as ColGroupDef[];
    expect(organised.headerName).toBe("Organised by");
    expect(organised.children.map((c) => (c as ColDef).field)).toEqual(["experiment", "position"]);
    expect(String((organised.children[0] as ColDef).cellClass)).toContain("idxcol");
    expect(values.headerName).toBe("Values");
    expect(values.children.map((c) => (c as ColDef).field)).toEqual(["t1_event_id", "contact_type"]);
  });

  it("falls back to flat colDefs when there are no axis names or no value columns", () => {
    expect(buildColumnDefs(cols, { groupRoles: true, axisNames: [] })).toHaveLength(4);
    expect(buildColumnDefs(cols, { groupRoles: true, axisNames: cols.map((c) => c.name) })).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/NodeTable.test.tsx -t buildColumnDefs`
Expected: FAIL — `buildColumnDefs is not a function` / not exported.

- [ ] **Step 3: Implement the helper**

In `src/components/NodeTable.tsx`, update the ag-grid type import (line 4–6) to also pull `ColGroupDef`:

```tsx
import {
  AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ColGroupDef,
} from "ag-grid-community";
```

and add `ColumnDef` to the types import (line 12):

```tsx
import { engine, type Table, type ColumnDef } from "../types";
```

Then add this exported function just above the `Grid` component (before line 30 `function Grid`):

```tsx
/* Build AG Grid column defs for a reduced table. With `groupRoles` and a non-empty
   `axisNames`, columns split into two header groups — "Organised by" (the index
   dims, shaded) and "Values" (everything else) — so the index/payload roles read
   at a glance. Falls back to a flat list when off, or when the split is degenerate
   (no index or no value columns). Pure + exported for unit tests. */
export function buildColumnDefs(
  columns: ColumnDef[],
  opts?: { groupRoles?: boolean; axisNames?: string[] },
): (ColDef | ColGroupDef)[] {
  const base = (c: ColumnDef): ColDef => ({
    field: c.name,
    headerName: c.label,
    editable: false,
    sortable: true,
    flex: 1,
    minWidth: 90,
    cellClass: c.type === "numeric" ? "mono" : undefined,
    ...(c.type === "numeric" && {
      valueFormatter: (p: { value: unknown }) => (p.value == null ? "NA" : String(p.value)),
    }),
  });

  const axisNames = opts?.axisNames ?? [];
  const idx = new Set(axisNames);
  const indexCols = columns.filter((c) => idx.has(c.name));
  const valueCols = columns.filter((c) => !idx.has(c.name));

  if (!opts?.groupRoles || indexCols.length === 0 || valueCols.length === 0) {
    return columns.map(base);
  }

  const shade = (c: ColumnDef): ColDef => {
    const d = base(c);
    d.cellClass = c.type === "numeric" ? ["mono", "idxcol"] : "idxcol";
    d.headerClass = "idxcol-head";
    return d;
  };

  return [
    { headerName: "Organised by", headerClass: "role-band idx", children: indexCols.map(shade) },
    { headerName: "Values", headerClass: "role-band val", children: valueCols.map(base) },
  ];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/NodeTable.test.tsx -t buildColumnDefs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/NodeTable.tsx src/components/NodeTable.test.tsx
git commit -m "feat(workbench): buildColumnDefs groups index vs value columns

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MqRMCubLHeVwS2CZsBbnD6"
```

---

## Task 3: Wire `groupRoles` through the grid + card (bands, shading, legend)

**Files:**
- Modify: `src/components/NodeTable.tsx`
- Modify: `src/workbench/cards/TableCard.tsx`
- Modify: `src/index.css`
- Test: `src/components/NodeTable.test.tsx`

- [ ] **Step 1: Write the failing render tests**

Add this `describe` block to the end of `src/components/NodeTable.test.tsx`:

```tsx
describe("NodeTable role bands (groupRoles)", () => {
  function seedPreview() {
    const { store, schema, plottable } = seed();
    const table: Table = { schema, rows: [{ id: "r0", cell: "c1", val: 42 }] };
    store.set(reducePreviewByIdAtom, {
      [plottable.id]: { preview: table, n_total: 1, trace: [], summary: [] },
    });
    const node: ExplorerNode = {
      id: "plot", kind: "plot", label: "Plot", table: { via: "none" },
      count: { rows: 1, cols: 2,
        axes: [{ name: "cell", n_levels: 1, ragged: false }],
        values: [{ name: "val", type: "numeric", grain: null }] },
    };
    return { store, node };
  }

  it("renders role bands + legend when groupRoles is on", () => {
    const { store, node } = seedPreview();
    render(<Provider store={store}><NodeTable node={node} groupRoles /></Provider>);
    expect(screen.getByText("Organised by")).toBeInTheDocument();
    expect(screen.getByText(/what was measured/i)).toBeInTheDocument();
  });

  it("renders no role bands by default (Data tab grid is unchanged)", () => {
    const { store, node } = seedPreview();
    render(<Provider store={store}><NodeTable node={node} /></Provider>);
    expect(screen.queryByText("Organised by")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/NodeTable.test.tsx -t "role bands"`
Expected: FAIL — `groupRoles` prop doesn't exist / "Organised by" not found.

- [ ] **Step 3: Thread `groupRoles` through `Grid` and `NodeTable`**

In `src/components/NodeTable.tsx`, change the `Grid` signature and body. Replace the current `Grid` function (lines ~30–67) with:

```tsx
function Grid(
  { table, total, groupRoles, axisNames }:
  { table: Table; total: number; groupRoles?: boolean; axisNames?: string[] },
) {
  const shown = table.rows.length;
  const colDefs = buildColumnDefs(table.schema.columns, { groupRoles, axisNames });
  const grouped = colDefs.some((d) => "children" in d);
  return (
    <div className="reduced-wrap">
      <div className="reduced-note">
        {shown < total
          ? `showing ${shown.toLocaleString()} of ${total.toLocaleString()} rows`
          : `${total.toLocaleString()} row${total === 1 ? "" : "s"}`}
        {" · "}{table.schema.columns.length} column
        {table.schema.columns.length === 1 ? "" : "s"}
      </div>
      <div className="grid-host reduced-table">
        <AgGridReact
          theme={theme}
          rowData={table.rows}
          columnDefs={colDefs}
          /* family columns carry dots (cell_shape.area_um2); without this
             ag-grid reads `field` as a nested path and renders NA. */
          suppressFieldDotNotation
          headerHeight={30}
          rowHeight={26}
        />
      </div>
      {grouped && (
        <div className="reduced-legend">
          <span className="lg idx">Organised by — what defines each row</span>
          <span className="lg val">Values — what was measured</span>
        </div>
      )}
    </div>
  );
}
```

Then update `NodeTable` to accept and forward the prop. Change its signature (line ~72):

```tsx
export function NodeTable({ node, groupRoles }: { node: ExplorerNode; groupRoles?: boolean }) {
```

and add this line just after that signature (above the existing `const active = ...`):

```tsx
  const axisNames = (node.count?.axes ?? []).map((a) => a.name);
```

Finally update the three `<Grid .../>` call sites at the bottom of `NodeTable` to forward the props:

```tsx
  // plot/stats (or a no-table node) → the live final reduced table.
  if (node.table.via === "none") {
    if (!preview) return <div className="reduced-empty">Building preview…</div>;
    return <Grid table={preview.preview} total={preview.n_total} groupRoles={groupRoles} axisNames={axisNames} />;
  }
  if (err) return <div className="reduced-empty">Could not load this node: {err}</div>;
  if (loading || !table) return <div className="reduced-empty">Loading {node.label}…</div>;
  return <Grid table={table} total={total} groupRoles={groupRoles} axisNames={axisNames} />;
```

- [ ] **Step 4: Turn it on in the Workbench card**

In `src/workbench/cards/TableCard.tsx`, change the render line from `<NodeTable node={node} />` to:

```tsx
      <NodeTable node={node} groupRoles />
```

- [ ] **Step 5: Run to verify the tests pass**

Run: `npx vitest run src/components/NodeTable.test.tsx`
Expected: PASS (all `NodeTable`, `buildColumnDefs`, and `role bands` tests).

- [ ] **Step 6: Add the grid CSS (bands, index shading, legend)**

In `src/index.css`, add these rules right after the `.reduced-note` rule (line ~438):

```css
/* Workbench table card: role-banded reduced grid (opt-in via groupRoles). */
.reduced-table .ag-header-group-cell.role-band.idx { background:#f5f3ff; color:#6d28d9; }
.reduced-table .ag-header-group-cell.role-band.val { background:#f0fdf4; color:#15803d; }
.reduced-table .ag-header-cell.idxcol-head { background:#f5f3ff; }
.reduced-table .idxcol { background:#faf8ff; }
.reduced-legend { display:flex; gap:16px; flex-wrap:wrap; font-size:11px;
  color:var(--faint); padding:6px 8px; }
.reduced-legend .lg::before { content:""; display:inline-block; width:10px; height:10px;
  border-radius:2px; margin-right:5px; vertical-align:-1px; }
.reduced-legend .lg.idx::before { background:#ede9fe; }
.reduced-legend .lg.val::before { background:#dcfce7; }
```

- [ ] **Step 7: Verify the full suite + types**

Run: `npx vitest run src/components/NodeTable.test.tsx src/workbench/cards/TableCard.test.tsx && npx tsc --noEmit`
Expected: tests PASS, tsc exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/components/NodeTable.tsx src/workbench/cards/TableCard.tsx src/index.css
git commit -m "feat(workbench): expanded Table card bands + shades index vs value columns

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MqRMCubLHeVwS2CZsBbnD6"
```

---

## Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the entire unit suite**

Run: `npm test`
Expected: all suites PASS (no regressions in `ArrayShapeRFNode`, `WorkbenchCanvas`, etc.).

- [ ] **Step 2: Typecheck the build**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Visual smoke check in the running app**

With `./dev.sh` running, open http://localhost:5173, open the Workbench, and confirm on a multi-axis source node:
- the node shows an "Organised by" outline with nested `└` connectors and a `varies` pill for a ragged axis (no `~`);
- a "Values" list with `number`/`category` labels;
- clicking the node opens the Table card with "Organised by" / "Values" header bands, shaded index columns, and the bottom legend;
- the **Data tab** grid is unchanged (no bands/shading).

- [ ] **Step 4: Final commit (only if Step 3 surfaced a tweak)**

```bash
git add -A
git commit -m "fix(workbench): polish node/card legibility after smoke check

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MqRMCubLHeVwS2CZsBbnD6"
```

---

## Self-review notes

- **Spec coverage:** Organised-by outline + nesting + `varies` pill + preserved removed/keyhi (Task 1); opt-in `groupRoles`, column groups, index shading, legend, Data-tab-untouched (Tasks 2–3); tests for both surfaces (Tasks 1–3); no engine/`.iris` change (none of the tasks touch them). All spec sections map to a task.
- **Type consistency:** `buildColumnDefs(columns, { groupRoles, axisNames })` signature is identical across Task 2 (definition + tests) and Task 3 (call in `Grid`); `NodeTable({ node, groupRoles })` is consistent across Task 3 wiring, tests, and the `TableCard` call site; CSS classes (`txw-dim/ragged/gone/keyhi/pill/varies`, `idxcol`, `idxcol-head`, `role-band idx|val`, `reduced-legend .lg idx|val`) match between the TSX that emits them and the CSS that styles them.
- **No placeholders:** every code/CSS step contains the literal content to apply.
