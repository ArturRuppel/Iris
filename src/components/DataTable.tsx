import { useMemo } from "react";
import { useAtomValue, useSetAtom, useAtom } from "jotai";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule, ModuleRegistry, themeQuartz,
  type CellEditRequestEvent, type ColDef,
} from "ag-grid-community";
import { rowsAtom, schemaAtom, toggleExclusionAtom } from "../state";
import type { Row } from "../types";

ModuleRegistry.registerModules([AllCommunityModule]);

/* match the app shell; the grid is wrapped by our typed-column model and
   stays read-only-edit so every change flows through Jotai (provenance) */
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

const TYPE_BADGE = { numeric: "123", categorical: "abc", identifier: "id" } as const;

export function DataTable() {
  const schema = useAtomValue(schemaAtom);
  const [rows, setRows] = useAtom(rowsAtom);
  const toggle = useSetAtom(toggleExclusionAtom);

  const columnDefs = useMemo<ColDef<Row>[]>(() => {
    if (!schema) return [];
    const defs: ColDef<Row>[] = [{
      field: "excluded",
      headerName: "✕",
      headerTooltip: "excluded from analysis",
      width: 44,
      editable: true,
      cellDataType: "boolean",
      resizable: false,
      suppressHeaderMenuButton: true,
    }];
    for (const c of schema.columns) {
      defs.push({
        field: c.name,
        headerName: `${c.label}`,
        headerTooltip: `${c.type} (${TYPE_BADGE[c.type]})`,
        editable: c.type !== "identifier",
        flex: 1,
        minWidth: 90,
        cellDataType: c.type === "numeric" ? "number" : "text",
        cellClass: c.type === "identifier" ? "mono dim"
          : c.type === "numeric" ? "mono" : undefined,
        ...(c.type === "categorical" && {
          cellEditor: "agSelectCellEditor",
          cellEditorParams: { values: c.levels ?? [] },
        }),
        ...(c.type === "numeric" && {
          valueFormatter: (p: { value: unknown }) =>
            p.value == null ? "NA" : String(p.value),
        }),
      });
    }
    return defs;
  }, [schema]);

  if (!schema) return (
    <div className="analyses-empty">
      <span>Import or enter data to start.</span>
    </div>
  );

  /* readOnlyEdit: the grid never mutates; edits arrive here and go through
     the store, so exclusions keep their provenance log entry */
  const onCellEditRequest = (e: CellEditRequestEvent<Row>) => {
    const field = e.colDef.field!;
    if (field === "excluded") {
      toggle(e.data.id);
      return;
    }
    const col = schema.columns.find((c) => c.name === field);
    let value = e.newValue as Row[string];
    if (col?.type === "numeric")
      value = value == null || value === "" || Number.isNaN(Number(value))
        ? null : Number(value);
    setRows(rows.map((r) => (r.id === e.data.id ? { ...r, [field]: value } : r)));
  };

  const included = rows.filter((r) => !r.excluded).length;
  return (
    <section className="pane table-pane">
      <div className="pane-head">
        <h2>Data</h2>
        <span className="provenance">{included} included · {rows.length - included} excluded</span>
      </div>
      <div className="grid-host">
        <AgGridReact<Row>
          theme={theme}
          rowData={rows}
          columnDefs={columnDefs}
          getRowId={(p) => p.data.id}
          readOnlyEdit
          onCellEditRequest={onCellEditRequest}
          rowClassRules={{ excluded: (p) => !!p.data?.excluded }}
          singleClickEdit
          stopEditingWhenCellsLoseFocus
          suppressCellFocus={false}
          headerHeight={30}
          rowHeight={26}
        />
      </div>
    </section>
  );
}
