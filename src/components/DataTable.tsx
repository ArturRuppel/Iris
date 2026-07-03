import { useMemo, type CSSProperties } from "react";
import { useAtomValue, useSetAtom, useAtom } from "jotai";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule, ModuleRegistry, themeQuartz,
  type CellEditRequestEvent, type ColDef, type IDatasource,
} from "ag-grid-community";
import { activeSchemaAtom, activeHandleAtom, bumpActiveHandleAtom, typeColorsAtom } from "../state";
import type { ColumnType } from "../state";
import { engine, type Row } from "../types";

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
  const schema = useAtomValue(activeSchemaAtom);
  const handle = useAtomValue(activeHandleAtom);
  // a cell edit bumps the ACTIVE pool table's handle (activeHandleAtom is a
  // read-only view off the pool, so the version bump writes through the pool).
  const bumpHandle = useSetAtom(bumpActiveHandleAtom);
  const [typeColors, setTypeColors] = useAtom(typeColorsAtom);

  /* Infinite Row Model datasource: the grid pulls row windows from the engine
     instead of holding all N rows. A version bump (an edit, Phase C)
     rebuilds this so the affected block refetches. */
  const datasource = useMemo<IDatasource>(() => ({
    rowCount: handle?.n,
    getRows: async (params) => {
      if (!handle) { params.failCallback(); return; }
      try {
        const { rows, n } = await engine.rowsWindow(
          handle.id, params.startRow, params.endRow);
        params.successCallback(rows, n);     // n = known last row -> exact count
      } catch {
        params.failCallback();
      }
    },
  }), [handle?.id, handle?.version]);

  const columnDefs = useMemo<ColDef<Row>[]>(() => {
    if (!schema) return [];
    const defs: ColDef<Row>[] = [];
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

  /* readOnlyEdit: the grid never mutates locally. An edit is an op against the
     server-owned table; bumping the handle version refetches the affected block
     (and re-runs compute). */
  const onCellEditRequest = async (e: CellEditRequestEvent<Row>) => {
    if (!handle) return;
    const field = e.colDef.field!;
    const col = schema.columns.find((c) => c.name === field);
    let value: unknown = e.newValue;
    if (col?.type === "numeric")
      value = value == null || value === "" || Number.isNaN(Number(value))
        ? null : Number(value);
    else if (col?.type === "bool")
      value = value == null || value === "" ? null
        : value === "true" || value === true;
    const { version, counts } = await engine.editCell(handle.id, e.data.id, field, value);
    bumpHandle({ ...handle, version, counts });
  };

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
        <span className="provenance">{handle?.n ?? 0} rows</span>
      </div>
      <div className="grid-host" style={typeVars}>
        <AgGridReact<Row>
          theme={theme}
          rowModelType="infinite"
          datasource={datasource}
          cacheBlockSize={200}
          maxBlocksInCache={10}
          columnDefs={columnDefs}
          getRowId={(p) => p.data.id}
          /* our family columns carry dots (cell_shape.area_um2); without this
             ag-grid reads `field` as a nested path (row.cell_shape.area_um2)
             and every dotted column renders NA. Treat field as a flat key. */
          suppressFieldDotNotation
          readOnlyEdit
          onCellEditRequest={onCellEditRequest}
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
