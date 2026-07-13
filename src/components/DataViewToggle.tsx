import { useAtom, useAtomValue } from "jotai";
import { dataViewAtom, activeSchemaAtom, activeHandleAtom, activeHierarchyAtom } from "../state";
import { pivotability } from "../grouped";

/* The Data-tab representation switch: tidy Table ↔ wide Grouped sheet. Lives in
   both panes' headers so it's always reachable. The Grouped option is offered
   only when the table is genuinely pivotable and small enough (integrity via
   guidance): otherwise it's disabled with the reason in its tooltip. */
export function DataViewToggle() {
  const [view, setView] = useAtom(dataViewAtom);
  const schema = useAtomValue(activeSchemaAtom);
  const handle = useAtomValue(activeHandleAtom);
  const hierarchy = useAtomValue(activeHierarchyAtom);

  const avail = pivotability(schema, hierarchy);
  // no table yet: the grouped pane is the entry surface, so it's the only place
  // to be — Grouped is forced-on and Table has nothing to show (Slice 5).
  const noTable = !handle;

  return (
    <div className="seg dv-toggle" role="tablist">
      <button role="tab" aria-selected={!noTable && view === "table"}
        className={!noTable && view === "table" ? "on" : ""}
        disabled={noTable}
        title={noTable ? "Import or enter data first" : "Show the tidy table"}
        onClick={() => !noTable && setView("table")}>Table</button>
      <button role="tab" aria-selected={noTable || view === "grouped"}
        className={noTable || view === "grouped" ? "on" : ""}
        /* offer it as a target only when pivotable; if it's already the view,
           stay enabled (a no-op click) rather than reading disabled-yet-selected —
           GroupedSheet then shows the reason it can't render. With no table it's
           the entry canvas, always reachable. */
        disabled={!noTable && view !== "grouped" && !avail.ok}
        title={noTable ? "Enter data as a grouped sheet"
          : avail.ok ? "Show the wide grouped sheet" : avail.reason}
        onClick={() => (noTable || avail.ok) && setView("grouped")}>Grouped sheet</button>
    </div>
  );
}
