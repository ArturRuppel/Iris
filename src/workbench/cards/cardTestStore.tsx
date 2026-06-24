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
