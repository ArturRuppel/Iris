import { useMemo, type CSSProperties } from "react";
import { useAtomValue, useSetAtom, useAtom } from "jotai";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule, ModuleRegistry, themeQuartz,
  type CellEditRequestEvent, type ColDef,
} from "ag-grid-community";
import { rowsAtom, schemaAtom, toggleExclusionAtom, typeColorsAtom } from "../state";
import type { ColumnType } from "../state";
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

const TYPE_BADGE = { numeric: "123", categorical: "abc", identifier: "id", bool: "T/F" } as const;
const TYPE_LABEL: Record<ColumnType, string> = {
  numeric: "numeric", categorical: "categorical", identifier: "identifier", bool: "bool",
};

export function DataTable() {
  const schema = useAtomValue(schemaAtom);
  const [rows, setRows] = useAtom(rowsAtom);
  const toggle = useSetAtom(toggleExclusionAtom);
  const [typeColors, setTypeColors] = useAtom(typeColorsAtom);

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
        headerClass: `type-${c.type}`,
        editable: c.type !== "identifier",
        flex: 1,
        minWidth: 90,
        cellDataType: c.type === "numeric" ? "number" : "text",
        cellClass: c.type === "identifier" ? "mono dim"
          : c.type === "numeric" || c.type === "bool" ? "mono" : undefined,
        ...(c.type === "categorical" && {
          cellEditor: "agSelectCellEditor",
          cellEditorParams: { values: c.levels ?? [] },
        }),
        ...(c.type === "bool" && {
          cellEditor: "agSelectCellEditor",
          cellEditorParams: { values: ["true", "false"] },
          valueFormatter: (p: { value: unknown }) =>
            p.value == null ? "NA" : p.value ? "true" : "false",
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
    else if (col?.type === "bool")
      value = value == null || value === "" ? null
        : value === "true" || value === true;
    setRows(rows.map((r) => (r.id === e.data.id ? { ...r, [field]: value } : r)));
  };

  const included = rows.filter((r) => !r.excluded).length;
  /* expose the configurable type colours to the grid headers as CSS vars */
  const typeVars = {
    "--type-numeric": typeColors.numeric,
    "--type-categorical": typeColors.categorical,
    "--type-identifier": typeColors.identifier,
    "--type-bool": typeColors.bool,
  } as CSSProperties;
  return (
    <section className="pane table-pane">
      <div className="pane-head">
        <h2>Data</h2>
        <div className="type-legend" title="Data-type colours — click a swatch to recolour">
          {(Object.keys(typeColors) as ColumnType[]).map((t) => (
            <label key={t} className="type-chip" style={{ "--chip": typeColors[t] } as CSSProperties}>
              <input
                type="color"
                value={typeColors[t]}
                onChange={(e) => setTypeColors({ ...typeColors, [t]: e.target.value })}
              />
              <span className="type-dot" />
              {TYPE_LABEL[t]}
            </label>
          ))}
        </div>
        <span className="provenance">{included} included · {rows.length - included} excluded</span>
      </div>
      <div className="grid-host" style={typeVars}>
        <AgGridReact<Row>
          theme={theme}
          rowData={rows}
          columnDefs={columnDefs}
          getRowId={(p) => p.data.id}
          /* our family columns carry dots (cell_shape.area_um2); without this
             ag-grid reads `field` as a nested path (row.cell_shape.area_um2)
             and every dotted column renders NA. Treat field as a flat key. */
          suppressFieldDotNotation
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
