import { useAtom, useAtomValue } from "jotai";
import { dataViewAtom, activeSchemaAtom, activeHandleAtom } from "../state";
import { pivotability } from "../grouped";

/* The Data-tab representation switch: tidy Table ↔ wide Grouped sheet. Lives in
   both panes' headers so it's always reachable. The Grouped option is offered
   only when the table is genuinely pivotable and small enough (integrity via
   guidance): otherwise it's disabled with the reason in its tooltip. */
export function DataViewToggle() {
  const [view, setView] = useAtom(dataViewAtom);
  const schema = useAtomValue(activeSchemaAtom);
  const handle = useAtomValue(activeHandleAtom);

  const avail = pivotability(schema, handle?.n ?? 0);

  return (
    <div className="seg dv-toggle" role="tablist">
      <button role="tab" aria-selected={view === "table"}
        className={view === "table" ? "on" : ""}
        onClick={() => setView("table")}>Table</button>
      <button role="tab" aria-selected={view === "grouped"}
        className={view === "grouped" ? "on" : ""}
        /* offer it as a target only when pivotable; if it's already the view,
           stay enabled (a no-op click) rather than reading disabled-yet-selected —
           GroupedSheet then shows the reason it can't render. */
        disabled={view !== "grouped" && !avail.ok}
        title={avail.ok ? "Show the wide grouped sheet" : avail.reason}
        onClick={() => avail.ok && setView("grouped")}>Grouped sheet</button>
    </div>
  );
}
