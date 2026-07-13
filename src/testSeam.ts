import { getDefaultStore } from "jotai";
import {
  plottablesAtom, activePlottableIdAtom, tablesAtom, activeTableIdAtom, makeStep,
  reduceStoreAtom, activeReduceDagAtom, dagView, poolFor,
} from "./state";

/* DEV-only window seam for E2E: lets a Playwright test author a join (Plan A has
   no drag-to-join UI yet) by mutating the active plottable's reduce steps through
   the real jotai store. Never installed in a production build (gated in main.tsx).
   Stage 2: the reduce pipeline is table-scoped (reduceStoreAtom); a test reads the
   active analysis's reduce via activeReduceDagAtom, or any plottable's branch via
   dagView(poolFor(store.get(reduceStoreAtom), p.tableId), p). */
export function installTestSeam() {
  (window as unknown as { __iris: unknown }).__iris = {
    store: getDefaultStore(),
    atoms: {
      plottablesAtom, activePlottableIdAtom, tablesAtom, activeTableIdAtom,
      reduceStoreAtom, activeReduceDagAtom,
    },
    fns: { dagView, poolFor },
    makeStep,
  };
}
