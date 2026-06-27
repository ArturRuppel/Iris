import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import {
  tablesAtom, activeTableIdAtom, plottablesAtom, activePlottableIdAtom,
  reducePreviewByIdAtom, bumpActiveHandleAtom, makeDefaultPlottable,
} from "../state";
import type { CollapsePlan, ReducePreview, Schema, Table } from "../types";
import type { ExplorerNode } from "../explorer/graph";
import { engine } from "../types";
import { NodeTable, buildColumnDefs } from "./NodeTable";
import type { ColDef, ColGroupDef } from "ag-grid-community";
import type { ColumnDef } from "../types";

/* the single-table globals now derive off the active analysis's pool table. With
   `handle`, seed one pool entry (so tableHandleAtom resolves) and bind the
   plottable to it; without, leave the pool empty so tableHandleAtom stays null
   (the "no handle / no engine" branch). */
function seed({ handle = true }: { handle?: boolean } = {}) {
  const store = createStore();
  const schema: Schema = { schema_version: "1.0", columns: [
    { name: "cell", type: "identifier", label: "cell" },
    { name: "val", type: "numeric", label: "Value" },
  ] };
  if (handle) {
    store.set(tablesAtom, [{ id: "main", name: "main", schema,
      hierarchy: { spine: ["cell"], fn: {} },
      handle: { id: "tok-1", n: 1, version: 1, schema, counts: {} as never } }]);
    store.set(activeTableIdAtom, "main");
  }
  const p = makeDefaultPlottable(schema, "main");
  store.set(plottablesAtom, [p]);
  store.set(activePlottableIdAtom, p.id);
  return { store, schema, plottable: p };
}

describe("NodeTable", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("shows a loading state for a fetchable node with no table handle (no engine under jsdom)", () => {
    const { store } = seed({ handle: false });
    const node: ExplorerNode = {
      id: "step:0", kind: "table", label: "filtered",
      table: { via: "at_step", at_step: 0 },
    };
    render(
      <Provider store={store}>
        <NodeTable node={node} />
      </Provider>,
    );
    // via:"at_step" with no tableHandleAtom → loading/empty branch, not a crash.
    expect(screen.getByText(/Loading filtered/i)).toBeInTheDocument();
  });

  it("renders the live preview grid for a via:'none' node", () => {
    const { store, schema, plottable } = seed();
    const table: Table = {
      schema,
      rows: [{ id: "r0", cell: "c1", val: 42 }],
    };
    store.set(reducePreviewByIdAtom, {
      [plottable.id]: { preview: table, n_total: 1, trace: [], summary: [] },
    });
    const node: ExplorerNode = {
      id: "plot", kind: "plot", label: "Plot", table: { via: "none" },
    };
    render(
      <Provider store={store}>
        <NodeTable node={node} />
      </Provider>,
    );
    // the seeded value appears in the grid.
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("fetches a collapse-grain node (collapse plan + grain key) instead of spinning forever", async () => {
    const { store, schema, plottable } = seed();
    // an active plottable carrying a collapse plan (the grain's source).
    const collapse: CollapsePlan = [{ keep: ["cell"], fn: "mean" }];
    store.set(plottablesAtom, [{ ...plottable, collapse }]);
    // seed() already bound a pool table with a handle, so the fetch effect runs.

    const result: ReducePreview = {
      preview: { schema, rows: [{ id: "g0", cell: "c1", val: 7 }] },
      n_total: 1, trace: [], summary: [],
    };
    const spy = vi.spyOn(engine, "reduce").mockResolvedValue(result);

    const node: ExplorerNode = {
      id: "grain:cell", kind: "table", label: "per cell",
      table: { via: "grain", grain: "cell" },
    };
    render(
      <Provider store={store}>
        <NodeTable node={node} />
      </Provider>,
    );

    // it must resolve to the grid (NOT stay on "Loading per cell…").
    expect(await screen.findByText("7")).toBeInTheDocument();

    // grain fetches forward the collapse plan + grain key in the trailing
    // arg positions: (tableRef, steps, hierarchy, level, at_step, collapse, grain).
    const args = spy.mock.calls[0];
    expect(args[5]).toEqual(collapse);   // collapse plan
    expect(args[6]).toBe("cell");        // grain key
  });
});

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
    expect((organised.children[0] as ColDef).cellClass).toEqual(["idxcol"]);
    expect((organised.children[0] as ColDef).headerClass).toBe("idxcol-head");
    expect(organised.headerClass).toBe("role-band idx");
    expect(values.headerClass).toBe("role-band val");
    expect(values.headerName).toBe("Values");
    expect(values.children.map((c) => (c as ColDef).field)).toEqual(["t1_event_id", "contact_type"]);
  });

  it("falls back to flat colDefs when there are no axis names or no value columns", () => {
    expect(buildColumnDefs(cols, { groupRoles: true, axisNames: [] })).toHaveLength(4);
    expect(buildColumnDefs(cols, { groupRoles: true, axisNames: cols.map((c) => c.name) })).toHaveLength(4);
  });
});

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
