import { useAtomValue, useSetAtom } from "jotai";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef,
} from "ag-grid-community";
import {
  activePlottableAtom, effectiveSchemaAtom, hierarchyAtom, reducePreviewAtom,
  setPreviewLevelAtom,
} from "../state";
import { levelOptions } from "../levels";

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
  const preview = useAtomValue(reducePreviewAtom);
  const active = useAtomValue(activePlottableAtom);
  const schemaFull = useAtomValue(effectiveSchemaAtom);
  const hierarchy = useAtomValue(hierarchyAtom);
  const setPreviewLevel = useSetAtom(setPreviewLevelAtom);
  const levels = active ? levelOptions(hierarchy, schemaFull) : [];
  if (!preview) return <div className="reduced-empty">Building preview…</div>;
  const { schema, rows } = preview.preview;
  const shown = rows.length;
  const total = preview.n_total;
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
    <div className="reduced-wrap">
      <div className="reduced-note">
        {shown < total
          ? `showing ${shown.toLocaleString()} of ${total.toLocaleString()} rows`
          : `${total.toLocaleString()} row${total === 1 ? "" : "s"}`}
        {" · "}{schema.columns.length} column{schema.columns.length === 1 ? "" : "s"}
        {levels.length > 1 && active && (
          <label className="reduced-level" title="Collapse the table to a hierarchy level (averages away everything finer).">
            {" · "}level{" "}
            <select value={active.previewLevel}
              onChange={(e) => setPreviewLevel(e.target.value)}>
              {levels.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="grid-host reduced-table">
        <AgGridReact
          theme={theme}
          rowData={rows}
          columnDefs={colDefs}
          /* family columns carry dots (cell_shape.area_um2); without this
             ag-grid reads `field` as a nested path and renders NA. */
          suppressFieldDotNotation
          headerHeight={30}
          rowHeight={26}
        />
      </div>
    </div>
  );
}
