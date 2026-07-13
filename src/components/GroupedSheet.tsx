import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  activeSchemaAtom, activeHandleAtom, bumpActiveHandleAtom, factorOrderAtom,
} from "../state";
import { engine, type Row } from "../types";
import {
  pivotability, longToWide, applyFactorOrder, MAX_GROUPED_COLS,
  type GroupedSheet as Sheet,
} from "../grouped";
import { DataViewToggle } from "./DataViewToggle";

/* The grouped-sheet lens (read-only, Slice 1): the active tidy table projected
   into the wide, merged-header layout — repeating condition columns under merged
   group bands, replicates down the rows. It materializes the whole table
   (rowsWindow 0..n) because the grouped view is inherently whole-table; that's
   fine at this audience's scale and gated (pivotability + row/col caps) above it.
   No write-back yet: value editing arrives in Slice 2. */
export function GroupedSheet() {
  const schema = useAtomValue(activeSchemaAtom);
  const handle = useAtomValue(activeHandleAtom);
  const bumpHandle = useSetAtom(bumpActiveHandleAtom);
  const orders = useAtomValue(factorOrderAtom);
  const setOrders = useSetAtom(factorOrderAtom);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const avail = pivotability(schema, handle?.n ?? 0);
  const tableId = handle?.id ?? null;

  /* the factor nesting for this table, outer → inner: the saved order reconciled
     against the live factors (self-heals across role changes). Pure view state —
     re-nesting never touches the data. */
  const orderedFactors = avail.ok
    ? applyFactorOrder(avail.spec.factors, (tableId && orders[tableId]) || [])
    : [];
  const orderKey = orderedFactors.map((f) => f.name).join(">");

  /* swap two adjacent factors and persist the full reconciled order for this
     table, so the nesting is stable across edits/refetches. */
  const moveFactor = (i: number, j: number) => {
    if (!tableId || j < 0 || j >= orderedFactors.length) return;
    const names = orderedFactors.map((f) => f.name);
    [names[i], names[j]] = [names[j], names[i]];
    setOrders({ ...orders, [tableId]: names });
  };

  /* a value edit is an op against the canonical tidy table: set the value column
     of the tidy row this cell came from, bump the handle version, and let the
     effect above refetch + re-pivot. Same write path as the tidy grid — no
     client-only table state (invariant 5). */
  const commitEdit = async (rowId: string, value: number | null) => {
    if (!handle || !avail.ok) return;
    const { version, counts } = await engine.editCell(
      handle.id, rowId, avail.spec.value.name, value);
    bumpHandle({ ...handle, version, counts });
  };

  /* materialize the whole table; refetch when the table or its version changes */
  useEffect(() => {
    if (!handle || !avail.ok) { setRows(null); return; }
    let stale = false;
    setFetchError(null);
    engine.rowsWindow(handle.id, 0, handle.n)
      .then((res) => { if (!stale) setRows(res.rows); })
      .catch((e) => { if (!stale) setFetchError(e instanceof Error ? e.message : String(e)); });
    return () => { stale = true; };
    // avail.ok is derived from schema+handle.n, covered by the deps below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle?.id, handle?.version, handle?.n, avail.ok]);

  const sheet = useMemo<Sheet | null>(
    () => (rows && avail.ok
      ? longToWide(rows, { value: avail.spec.value, factors: orderedFactors })
      : null),
    // orderKey captures a re-nest; rows / avail.ok the data / availability
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, avail.ok, orderKey],
  );

  const body = (() => {
    if (!schema || !handle) return <Empty>Import or enter data to start.</Empty>;
    if (!avail.ok) return <Empty>{avail.reason}</Empty>;
    if (fetchError) return <Empty>Couldn’t load the table: {fetchError}</Empty>;
    if (!sheet) return <Empty>Loading…</Empty>;
    if (sheet.nCols > MAX_GROUPED_COLS)
      return <Empty>
        This table pivots to {sheet.nCols.toLocaleString()} columns — too many to show
        as a grouped sheet (limit {MAX_GROUPED_COLS.toLocaleString()}). Use the tidy table.
      </Empty>;
    return <Grid sheet={sheet} onCommit={commitEdit} />;
  })();

  return (
    <section className="pane table-pane">
      <div className="pane-head">
        <h2>Data</h2>
        <DataViewToggle />
        <span className="provenance">
          {avail.ok && sheet ? `${sheet.nRows} × ${sheet.nCols}` : `${handle?.n ?? 0} rows`}
        </span>
      </div>
      {avail.ok && orderedFactors.length >= 2 && (
        <div className="gs-controls">
          <span className="gs-controls-label">Grouping · outer → inner</span>
          {orderedFactors.map((f, i) => (
            <span key={f.name} className="gs-factor">
              <button className="gs-fmove" disabled={i === 0}
                title="Move outward (coarser)" onClick={() => moveFactor(i, i - 1)}>◄</button>
              <span className="gs-factor-name">{f.label}</span>
              <button className="gs-fmove" disabled={i === orderedFactors.length - 1}
                title="Move inward (finer)" onClick={() => moveFactor(i, i + 1)}>►</button>
            </span>
          ))}
        </div>
      )}
      <div className="gs-host">{body}</div>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="gs-empty"><span>{children}</span></div>;
}

const fmt = (v: string | number | boolean | null): string =>
  v == null ? "" : typeof v === "boolean" ? (v ? "true" : "false") : String(v);

/* the merged-header grid; shares the entry grid's visual language (.de-grid) so
   entry and lens look like one surface. Value cells backed by a tidy row are
   click-to-edit; blank padding cells (ragged tails, no row behind them) stay
   read-only — creating a row is a structural edit (Slice 4), not this slice. */
function Grid({ sheet, onCommit }: {
  sheet: Sheet;
  onCommit: (rowId: string, value: number | null) => void;
}) {
  const { bands, columnLabels, factorLabels, values, rowIds, nRows, nCols } = sheet;
  const [edit, setEdit] = useState<{ r: number; c: number } | null>(null);
  const [draft, setDraft] = useState("");
  // Enter and the follow-on blur both fire for one commit; this guards the double.
  const done = useRef(false);

  const startEdit = (r: number, c: number) => {
    done.current = false;
    setDraft(fmt(values[r][c]));
    setEdit({ r, c });
  };
  const commit = () => {
    if (!edit || done.current) return;
    done.current = true;
    const { r, c } = edit;
    const id = rowIds[r][c];
    const raw = draft.trim();
    // match the tidy grid's numeric coercion: blank or unparseable clears to NA
    const value = raw === "" || Number.isNaN(Number(raw)) ? null : Number(raw);
    if (id != null && value !== values[r][c]) onCommit(id, value);
    setEdit(null);
  };
  const cancel = () => { done.current = true; setEdit(null); };

  return (
    <div className="gs-scroll">
      <table className="de-grid gs-grid">
        <thead>
          {bands.map((band, level) => (
            <tr key={`b${level}`} className="de-band">
              <th className="de-corner" />
              {band.map((c, i) => (
                <th key={i} colSpan={c.span} className="de-groupcell gs-static"
                  title={factorLabels[level]}>
                  <div className="de-grouphead"><span>{c.label}</span></div>
                </th>
              ))}
            </tr>
          ))}
          <tr className="de-heads">
            <th className="de-corner">#</th>
            {columnLabels.map((label, c) => (
              <th key={c} className="de-colcell gs-static"
                title={factorLabels[factorLabels.length - 1]}>
                <div className="de-colhead"><span>{label}</span></div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: nRows }, (_, r) => (
            <tr key={r}>
              <td className="de-rowhead">{r + 1}</td>
              {Array.from({ length: nCols }, (_, c) => {
                const editable = rowIds[r][c] != null;
                const editing = !!edit && edit.r === r && edit.c === c;
                return (
                  <td key={c}
                    className={`gs-cell${editable ? "" : " gs-blank"}${editing ? " gs-editing" : ""}`}
                    onClick={editable && !editing ? () => startEdit(r, c) : undefined}>
                    {editing
                      ? <input className="gs-input" autoFocus value={draft}
                          spellCheck={false} inputMode="decimal"
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={commit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); commit(); }
                            else if (e.key === "Escape") { e.preventDefault(); cancel(); }
                          }} />
                      : fmt(values[r][c])}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
