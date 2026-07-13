import { useAtomValue } from "jotai";
import { dataViewAtom, activeHandleAtom } from "../state";
import { DataTable } from "./DataTable";
import { GroupedSheet } from "./GroupedSheet";

/* The Data tab's right pane: the tidy table, or the grouped-sheet lens over it.
   Both are self-contained panes carrying the shared DataViewToggle in their head,
   so the switch is always reachable. With no table loaded there is nothing to
   tabulate, so we land on the grouped pane — which, empty, is the entry surface
   (Slice 5): entry and lens are one continuous surface. */
export function DataView() {
  const view = useAtomValue(dataViewAtom);
  const handle = useAtomValue(activeHandleAtom);
  return !handle || view === "grouped" ? <GroupedSheet /> : <DataTable />;
}
