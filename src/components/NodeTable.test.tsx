import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import {
  schemaAtom, hierarchyAtom, plottablesAtom, activePlottableIdAtom,
  reducePreviewByIdAtom, makeDefaultPlottable,
} from "../state";
import type { Schema, Table } from "../types";
import type { ExplorerNode } from "../explorer/graph";
import { NodeTable } from "./NodeTable";

function seed() {
  const store = createStore();
  const schema: Schema = { schema_version: "1.0", columns: [
    { name: "cell", type: "identifier", label: "cell" },
    { name: "val", type: "numeric", label: "Value" },
  ] };
  store.set(schemaAtom, schema);
  store.set(hierarchyAtom, { spine: ["cell"], fn: {} });
  const p = makeDefaultPlottable(schema);
  store.set(plottablesAtom, [p]);
  store.set(activePlottableIdAtom, p.id);
  return { store, schema, plottable: p };
}

describe("NodeTable", () => {
  it("shows a loading state for a fetchable node with no table handle (no engine under jsdom)", () => {
    const { store } = seed();
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
});
