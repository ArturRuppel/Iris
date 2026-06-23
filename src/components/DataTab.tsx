import { useEffect, useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef,
} from "ag-grid-community";
import {
  activePlottableAtom, hierarchyAtom, reducePreviewAtom,
  selectedNodeIdAtom, tableHandleAtom,
} from "../state";
import { explorerGraphAtom } from "../explorer/graphAtom";
import type { ExplorerNode } from "../explorer/graph";
import { engine, type Table } from "../types";

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

/* Render a (schema, rows, n_total) triple as the AG grid — the body lifted from
   ReducedTable so the data tab looks identical regardless of which node it shows. */
function Grid({ table, total }: { table: Table; total: number }) {
  const shown = table.rows.length;
  const colDefs: ColDef[] = table.schema.columns.map((c) => ({
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
        {" · "}{table.schema.columns.length} column
        {table.schema.columns.length === 1 ? "" : "s"}
      </div>
      <div className="grid-host reduced-table">
        <AgGridReact
          theme={theme}
          rowData={table.rows}
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

export function DataTab() {
  const active = useAtomValue(activePlottableAtom);
  const hierarchy = useAtomValue(hierarchyAtom);
  const handle = useAtomValue(tableHandleAtom);
  const preview = useAtomValue(reducePreviewAtom);
  const selectedId = useAtomValue(selectedNodeIdAtom);

  /* the same graph TransformExplorer renders, so node ids line up exactly. */
  const graph = useAtomValue(explorerGraphAtom);

  /* the selected node, falling back to the plot node (the final reduced table)
     when nothing is selected or the id is stale. */
  const node: ExplorerNode | null = useMemo(() => {
    if (!graph) return null;
    return graph.nodes.find((n) => n.id === selectedId)
      ?? graph.nodes.find((n) => n.kind === "plot")
      ?? null;
  }, [graph, selectedId]);

  /* fetched intermediate table for source/step/collapse nodes. The terminal
     plot/stats nodes use the live reducePreviewAtom instead (no fetch). */
  const [table, setTable] = useState<Table | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /* Clear the fetched table the instant the selected node changes — during
     render, before paint — so the previous node's rows never flash for a frame
     under the new node's label (the async fetch effect runs only after paint). */
  const fetchableId = node && node.table.via !== "none" ? node.id : null;
  const [shownFor, setShownFor] = useState<string | null>(fetchableId);
  if (fetchableId !== shownFor) {
    setShownFor(fetchableId);
    setTable(null);
  }

  const fetchKey = node && node.table.via !== "none"
    ? JSON.stringify([active?.id, node.table, active?.reduce.steps, hierarchy])
    : null;

  useEffect(() => {
    if (!handle || !active || !node || node.table.via === "none") {
      setTable(null); setLoading(false); setErr(null); return;
    }
    let cancelled = false;
    const steps = active.reduce.steps;
    setTable(null); setLoading(true); setErr(null);
    void (async () => {
      try {
        const tbl = node.table;
        const res = tbl.via === "at_step"
          ? await engine.reduce({ token: handle.id }, steps, hierarchy, undefined, tbl.at_step)
          : tbl.via === "level"
            ? await engine.reduce({ token: handle.id }, steps, hierarchy, tbl.level)
            : null;
        if (!res) return;
        if (cancelled) return;
        setTable(res.preview); setTotal(res.n_total);
      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // fetchKey captures node.table + steps + hierarchy; handle/active id gate it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle?.id, handle?.version, fetchKey]);

  if (!active || !node) return <div className="reduced-empty">Building preview…</div>;

  // plot/stats (or a no-table node) → the live final reduced table.
  if (node.table.via === "none") {
    if (!preview) return <div className="reduced-empty">Building preview…</div>;
    return <Grid table={preview.preview} total={preview.n_total} />;
  }
  if (err) return <div className="reduced-empty">Could not load this node: {err}</div>;
  if (loading || !table) return <div className="reduced-empty">Loading {node.label}…</div>;
  return <Grid table={table} total={total} />;
}
