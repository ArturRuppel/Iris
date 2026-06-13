import { useAtomValue } from "jotai";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef,
} from "ag-grid-community";
import { analysisAtom } from "../state";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  accentColor: "#0e7490",
  fontFamily: "inherit",
  fontSize: 12,
  headerFontSize: 12,
  headerFontWeight: 500,
  borderColor: "#e2e8f0",
  headerBackgroundColor: "#f8fafc",
  rowVerticalPaddingScale: 0.7,
  wrapperBorder: false,
});

export function ReducedTable() {
  const analysis = useAtomValue(analysisAtom);
  if (!analysis) return null;
  const { schema, rows } = analysis.reduced_table;
  const colDefs: ColDef[] = schema.columns.map((c) => ({
    field: c.name,
    headerName: c.label,
    editable: false,
    sortable: true,
    flex: 1,
    minWidth: 90,
    cellClass: c.type === "numeric" ? "mono" : undefined,
    ...(c.type === "numeric" && {
      valueFormatter: (p: { value: unknown }) => (p.value == null ? "NA" : String(p.value)),
    }),
  }));
  return (
    <div className="grid-host reduced-table">
      <AgGridReact
        theme={theme}
        rowData={rows}
        columnDefs={colDefs}
        headerHeight={30}
        rowHeight={26}
      />
    </div>
  );
}
