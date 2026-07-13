import { useAtomValue } from "jotai";
import { dataViewAtom } from "../state";
import { DataTable } from "./DataTable";
import { GroupedSheet } from "./GroupedSheet";

/* The Data tab's right pane: the tidy table, or the grouped-sheet lens over it.
   Both are self-contained panes carrying the shared DataViewToggle in their head,
   so the switch is always reachable. */
export function DataView() {
  const view = useAtomValue(dataViewAtom);
  return view === "grouped" ? <GroupedSheet /> : <DataTable />;
}
