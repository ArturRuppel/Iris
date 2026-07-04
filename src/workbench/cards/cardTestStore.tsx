import { createStore } from "jotai";
import {
  tablesAtom, activeTableIdAtom, plottablesAtom, activePlottableIdAtom,
  registryAtom, makeDefaultPlottable,
} from "../../state";
import type { ColumnDef, Schema, Registry } from "../../types";

/* A minimal seeded store for card-body tests: a schema whose columns are the
   spine dims (identifiers) + one numeric measure, a hierarchy over that spine,
   a registry stub, and one active default plottable. Mirrors the helper in
   CollapseRoutingPanel.test.tsx. */
export function seedStore(
  spine: string[] = ["experiment", "cell"],
  extraColumns: ColumnDef[] = [],
) {
  const store = createStore();
  const schema: Schema = { schema_version: "1.0", columns: [
    ...spine.map((d) => ({ name: d, type: "identifier" as const, label: d })),
    ...extraColumns,
    { name: "val", type: "numeric" as const, label: "Value" },
  ] };
  // the three single-table globals now derive off the active analysis's pool
  // table — seed one pool entry and bind the plottable to it.
  store.set(tablesAtom, [{ id: "main", name: "main", schema,
    hierarchy: { spine, fn: {} },
    handle: { id: "h_main", n: 0, version: 0, schema, counts: {} as never } }]);
  store.set(activeTableIdAtom, "main");
  const registry: Registry = { point_cap: 5000, facet_cell_cap: 200, geoms: {} };
  store.set(registryAtom, registry);
  const p = makeDefaultPlottable("main");
  store.set(plottablesAtom, [p]);
  store.set(activePlottableIdAtom, p.id);
  return { store, plottable: p };
}
