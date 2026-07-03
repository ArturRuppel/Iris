import { render, screen, fireEvent } from "@testing-library/react";
import { it, expect } from "vitest";
import { Provider, createStore } from "jotai";
import { CollapseRoutingPanel } from "./CollapseRoutingPanel";
import {
  setTestGrainAtom, activePlottableAtom,
  tablesAtom, activeTableIdAtom, plottablesAtom, activePlottableIdAtom,
  makeDefaultPlottable,
} from "../state";
import type { Schema } from "../types";

/* Replicated from state.test.ts: a store with the given spine — a schema whose
   columns include the spine dims as identifiers + a numeric measure, a hierarchy
   of that spine, and one active plottable. */
function makeStoreWithSpine(spine: string[]) {
  const store = createStore();
  const schema: Schema = { schema_version: "1.0", columns: [
    ...spine.map((d) => ({ name: d, type: "identifier" as const, label: d })),
    { name: "val", type: "numeric" as const, label: "Value" },
  ] };
  store.set(tablesAtom, [{ id: "main", name: "main", schema,
    hierarchy: { spine, fn: {} },
    handle: { id: "h_main", n: 0, version: 0, schema, counts: {} as never } }]);
  store.set(activeTableIdAtom, "main");
  const p = makeDefaultPlottable("main");
  store.set(plottablesAtom, [p]);
  store.set(activePlottableIdAtom, p.id);
  return store;
}

it("renders one row per collapse step with a remove button", () => {
  const store = makeStoreWithSpine(["experiment", "cell"]); // default plan = 2 steps
  render(<Provider store={store}><CollapseRoutingPanel /></Provider>);
  expect(screen.getAllByRole("button", { name: /remove level/i })).toHaveLength(2);
});

it("test-grain select is present", () => {
  const store = makeStoreWithSpine(["experiment", "cell"]);
  render(<Provider store={store}><CollapseRoutingPanel /></Provider>);
  expect(screen.getByLabelText(/test reads at/i)).toBeInTheDocument();
});

it("reset clears the override", () => {
  const store = makeStoreWithSpine(["experiment", "cell"]);
  store.set(setTestGrainAtom, "experiment/cell");
  render(<Provider store={store}><CollapseRoutingPanel /></Provider>);
  fireEvent.click(screen.getByRole("button", { name: /reset to default/i }));
  expect(store.get(activePlottableAtom)?.testGrain).toBeUndefined();
});
