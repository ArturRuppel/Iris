import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  activeSchemaAtom, activeHandleAtom, bumpActiveHandleAtom, applyTableEditAtom,
  factorOrderAtom,
} from "../state";
import { engine, type Row } from "../types";
import {
  pivotability, longToWide, applyFactorOrder, MAX_GROUPED_COLS,
  type GroupedSheet as Sheet,
} from "../grouped";
import { DataViewToggle } from "./DataViewToggle";
import { DataEntry } from "./DataEntry";

/* The grouped-sheet lens: the active tidy table projected into the wide,
   merged-header layout — repeating condition columns under merged group bands,
   replicates down the rows. It materializes the whole table (rowsWindow 0..n)
   because the grouped view is inherently whole-table; that's fine at this
   audience's scale and gated (pivotability + row/col caps) above it.

   Every edit is an op on the canonical tidy table (invariant 5, one write path):
   a value cell → edit_cell (Slice 2); a header rename → relabel_category; a
   column/band delete → delete_rows (Slice 4). The two structural ops can lose
   data — a rename that collides with a sibling *merges* two levels, a delete
   *drops rows* — so both are surfaced (a pre-warning or a stated row count),
   never performed silently (invariant 3). */
export function GroupedSheet() {
  const schema = useAtomValue(activeSchemaAtom);
  const handle = useAtomValue(activeHandleAtom);
  const bumpHandle = useSetAtom(bumpActiveHandleAtom);
  const applyEdit = useSetAtom(applyTableEditAtom);
  const orders = useAtomValue(factorOrderAtom);
  const setOrders = useSetAtom(factorOrderAtom);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // a structural edit awaiting confirmation (it would lose data), and the last
  // outcome message — the honesty surface for delete_rows / relabel_category /
  // drop_column. add_level is pure addition (no confirm, just a notice).
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // an add-a-level input open in the factor strip (keyed by factor name), with
  // the Enter/blur double-commit guard the header rename uses.
  const [adding, setAdding] = useState<string | null>(null);
  const [addDraft, setAddDraft] = useState("");
  const addDone = useRef(false);

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
     effect below refetch + re-pivot. Same write path as the tidy grid. */
  const commitEdit = async (rowId: string, value: number | null) => {
    if (!handle || !avail.ok) return;
    const { version, counts } = await engine.editCell(
      handle.id, rowId, avail.spec.value.name, value);
    bumpHandle({ ...handle, version, counts });
  };

  /* --- structural edits (Slice 4). Each resolves the header the user acted on to
     a tidy op, surfaces its loss, and routes the version/schema/count change
     through applyTableEditAtom so the effect refetches + re-pivots. --- */

  const doRelabel = async (column: string, from: string, to: string) => {
    if (!handle) return;
    const res = await engine.relabelCategory(handle.id, column, from, to);
    applyEdit({ version: res.version, counts: res.counts, schema: res.schema });
    setNotice(res.merged
      ? `Merged “${from}” into “${to}” — ${res.n} rows now share that level.`
      : `Renamed “${from}” to “${to}” (${res.n} rows).`);
  };

  const doDelete = async (ids: string[], label: string) => {
    if (!handle) return;
    const res = await engine.deleteRows(handle.id, ids);
    applyEdit({ version: res.version, counts: res.counts });
    setNotice(`Deleted ${res.removed} ${res.removed === 1 ? "row" : "rows"} in “${label}”.`);
  };

  /* add a new level to a factor (a new grouped column, blank down its rows). Pure
     addition — no confirm; a client-side pre-check keeps a duplicate level from
     round-tripping to a 422, stating it instead. The engine lays the blanks out
     across every combination of the other factors. */
  const doAddLevel = async (factor: string, level: string) => {
    if (!handle || !avail.ok) return;
    const idx = orderedFactors.findIndex((x) => x.name === factor);
    const f = orderedFactors[idx];
    const exists = idx < 0 ? false
      : idx < (sheet?.bands.length ?? 0)
        ? (sheet?.bands[idx].some((c) => c.label === level) ?? false)
        : (sheet?.columnLabels.includes(level) ?? false);
    if (exists) { setNotice(`“${level}” already exists in ${f?.label ?? factor}.`); return; }
    const res = await engine.addLevel(handle.id, factor, level);
    applyEdit({ version: res.version, counts: res.counts, schema: res.schema });
    setNotice(`Added “${level}” to ${f?.label ?? factor} — ${res.added} blank ${res.added === 1 ? "row" : "rows"}.`);
  };

  /* drop a whole factor column. Lossy (its labels vanish; rows that differed only
     by it become undifferentiated replicates), so it's confirmed first. */
  const doDrop = async (column: string, label: string) => {
    if (!handle) return;
    const res = await engine.dropColumn(handle.id, column);
    applyEdit({ version: res.version, counts: res.counts, schema: res.schema });
    setNotice(`Removed the ${label} grouping.`);
  };

  /* a header rename at factor `level` (0 = outer band … last = leaf columns).
     Renaming to a name a sibling already carries *merges* the two levels — that's
     lossy, so we warn and confirm first; a fresh name is applied immediately. */
  const requestRelabel = (level: number, from: string, to: string) => {
    setNotice(null);
    const t = to.trim();
    if (!avail.ok || t === "" || t === from) return;
    const column = orderedFactors[level]?.name;
    if (!column || !sheet) return;
    const siblings = level < sheet.bands.length
      ? new Set(sheet.bands[level].map((c) => c.label))
      : new Set(sheet.columnLabels);
    if (siblings.has(t)) setPending({ kind: "relabel", column, from, to: t });
    else void doRelabel(column, from, t);
  };

  /* deleting a grouped column (or band) drops every tidy row under it — always
     lossy, so always confirmed with the exact count. Grid supplies the ids. */
  const requestDelete = (ids: string[], label: string) => {
    setNotice(null);
    if (ids.length > 0) setPending({ kind: "delete", ids, label });
  };

  /* dropping a factor is always lossy, so always confirmed. */
  const requestDrop = (column: string, label: string) => {
    setNotice(null); setAdding(null);
    setPending({ kind: "drop", column, label });
  };

  const confirmPending = () => {
    const p = pending; setPending(null);
    if (!p) return;
    if (p.kind === "delete") void doDelete(p.ids, p.label);
    else if (p.kind === "drop") void doDrop(p.column, p.label);
    else void doRelabel(p.column, p.from, p.to);
  };

  /* the add-a-level input in the factor strip: open, commit (guarded against the
     Enter+blur double), cancel. */
  const startAdd = (factor: string) => {
    setNotice(null); setPending(null);
    addDone.current = false; setAddDraft(""); setAdding(factor);
  };
  const commitAdd = () => {
    if (adding == null || addDone.current) return;
    addDone.current = true;
    const factor = adding, level = addDraft.trim();
    setAdding(null);
    if (level !== "") void doAddLevel(factor, level);
  };
  const cancelAdd = () => { addDone.current = true; setAdding(null); };

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

  // a version/id change means the pivot the pending edit was framed against is
  // gone; drop the stale confirmation (and any open add-input) so we never act
  // on a moved target.
  useEffect(() => { setPending(null); setAdding(null); }, [handle?.id, handle?.version]);

  const sheet = useMemo<Sheet | null>(
    () => (rows && avail.ok
      ? longToWide(rows, { value: avail.spec.value, factors: orderedFactors })
      : null),
    // orderKey captures a re-nest; rows / avail.ok the data / availability
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, avail.ok, orderKey],
  );

  const body = (() => {
    // no table yet: the grouped pane IS the entry surface (Slice 5). Typing here
    // and hitting Create mints the session; the moment a handle exists this
    // unmounts and the live lens below takes over.
    if (!schema || !handle) return <DataEntry />;
    if (!avail.ok) return <Empty>{avail.reason}</Empty>;
    if (fetchError) return <Empty>Couldn’t load the table: {fetchError}</Empty>;
    if (!sheet) return <Empty>Loading…</Empty>;
    if (sheet.nCols > MAX_GROUPED_COLS)
      return <Empty>
        This table pivots to {sheet.nCols.toLocaleString()} columns — too many to show
        as a grouped sheet (limit {MAX_GROUPED_COLS.toLocaleString()}). Use the tidy table.
      </Empty>;
    return (
      <Grid sheet={sheet} onCommit={commitEdit}
        onRelabel={requestRelabel} onDelete={requestDelete} />
    );
  })();

  return (
    <section className="pane table-pane">
      <div className="pane-head">
        <h2>Data</h2>
        <DataViewToggle />
        <span className="provenance">
          {!handle ? "new table"
            : avail.ok && sheet ? `${sheet.nRows} × ${sheet.nCols}`
            : `${handle.n} rows`}
        </span>
      </div>
      {avail.ok && orderedFactors.length >= 1 && (
        <div className="gs-controls">
          <span className="gs-controls-label">
            {orderedFactors.length >= 2 ? "Factors · outer → inner" : "Factor"}
          </span>
          {orderedFactors.map((f, i) => (
            <span key={f.name} className="gs-factor">
              <button className="gs-fmove" disabled={orderedFactors.length < 2 || i === 0}
                title="Move outward (coarser)" onClick={() => moveFactor(i, i - 1)}>◄</button>
              {adding === f.name
                ? <input className="gs-input gs-factor-add" autoFocus value={addDraft}
                    placeholder={`new ${f.label}`} spellCheck={false}
                    onChange={(e) => setAddDraft(e.target.value)}
                    onBlur={commitAdd}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); commitAdd(); }
                      else if (e.key === "Escape") { e.preventDefault(); cancelAdd(); }
                    }} />
                : <span className="gs-factor-name">{f.label}</span>}
              <button className="gs-fmove" disabled={orderedFactors.length < 2 || i === orderedFactors.length - 1}
                title="Move inward (finer)" onClick={() => moveFactor(i, i + 1)}>►</button>
              <button className="gs-faction gs-fadd" title={`Add a ${f.label} level`}
                onClick={() => startAdd(f.name)}>＋</button>
              <button className="gs-faction gs-fdrop" title={`Remove the ${f.label} grouping`}
                disabled={orderedFactors.length < 2} onClick={() => requestDrop(f.name, f.label)}>✕</button>
            </span>
          ))}
        </div>
      )}
      {pending && (
        <div className="gs-confirm" role="alertdialog">
          <span className="gs-confirm-msg">
            {pending.kind === "delete"
              ? `Delete ${pending.ids.length} ${pending.ids.length === 1 ? "row" : "rows"} under “${pending.label}”? This drops the data.`
              : pending.kind === "drop"
              ? `Remove the “${pending.label}” grouping? Its rows keep their values but lose that distinction. This can't be undone.`
              : `“${pending.to}” already exists — renaming “${pending.from}” merges the two levels. This can't be undone.`}
          </span>
          <button className="gs-confirm-go" onClick={confirmPending}>
            {pending.kind === "delete" ? "Delete" : pending.kind === "drop" ? "Remove" : "Merge"}
          </button>
          <button className="gs-confirm-cancel" onClick={() => setPending(null)}>Cancel</button>
        </div>
      )}
      {notice && !pending && (
        <div className="gs-notice" role="status">
          <span>{notice}</span>
          <button className="gs-notice-x" title="Dismiss" onClick={() => setNotice(null)}>✕</button>
        </div>
      )}
      <div className="gs-host">{body}</div>
    </section>
  );
}

type Pending =
  | { kind: "delete"; ids: string[]; label: string }
  | { kind: "relabel"; column: string; from: string; to: string }
  | { kind: "drop"; column: string; label: string };

function Empty({ children }: { children: ReactNode }) {
  return <div className="gs-empty"><span>{children}</span></div>;
}

const fmt = (v: string | number | boolean | null): string =>
  v == null ? "" : typeof v === "boolean" ? (v ? "true" : "false") : String(v);

/* the merged-header grid; shares the entry grid's visual language (.de-grid) so
   entry and lens look like one surface. Value cells backed by a tidy row are
   click-to-edit; blank padding cells (ragged tails) stay read-only. Header cells
   carry the structural gestures: double-click a group/leaf label to rename it,
   or hover for a × that deletes that whole column/band. */
function Grid({ sheet, onCommit, onRelabel, onDelete }: {
  sheet: Sheet;
  onCommit: (rowId: string, value: number | null) => void;
  onRelabel: (level: number, from: string, to: string) => void;
  onDelete: (ids: string[], label: string) => void;
}) {
  const { bands, columnLabels, factorLabels, values, rowIds, nRows, nCols } = sheet;
  const [edit, setEdit] = useState<{ r: number; c: number } | null>(null);
  const [draft, setDraft] = useState("");
  // a header rename in progress, keyed to disambiguate a band cell from a leaf.
  const [head, setHead] = useState<{ key: string; level: number; from: string } | null>(null);
  const [headDraft, setHeadDraft] = useState("");
  // Enter and the follow-on blur both fire for one commit; these guard the double.
  const done = useRef(false);
  const headDone = useRef(false);
  const hasFactors = factorLabels.length > 0;
  const leafLevel = bands.length;   // leaf headers name the innermost factor

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

  const startHead = (key: string, level: number, from: string) => {
    headDone.current = false;
    setHeadDraft(from);
    setHead({ key, level, from });
  };
  const commitHead = () => {
    if (!head || headDone.current) return;
    headDone.current = true;
    onRelabel(head.level, head.from, headDraft);
    setHead(null);
  };
  const cancelHead = () => { headDone.current = true; setHead(null); };

  // every non-blank tidy row id under leaf columns [start, start+span)
  const idsUnder = (start: number, span: number): string[] => {
    const ids: string[] = [];
    for (let r = 0; r < nRows; r++)
      for (let c = start; c < start + span; c++) {
        const id = rowIds[r][c];
        if (id != null) ids.push(id);
      }
    return ids;
  };

  const headInput = (
    <input className="gs-input gs-head-input" autoFocus value={headDraft}
      spellCheck={false} onChange={(e) => setHeadDraft(e.target.value)}
      onBlur={commitHead}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commitHead(); }
        else if (e.key === "Escape") { e.preventDefault(); cancelHead(); }
      }} />
  );

  return (
    <div className="gs-scroll">
      <table className="de-grid gs-grid">
        <thead>
          {bands.map((band, level) => {
            let offset = 0;
            return (
              <tr key={`b${level}`} className="de-band">
                <th className="de-corner" />
                {band.map((c, i) => {
                  const start = offset; offset += c.span;
                  const key = `b${level}:${i}`;
                  const editing = head?.key === key;
                  return (
                    <th key={i} colSpan={c.span} className="de-groupcell gs-head"
                      title={factorLabels[level]}
                      onDoubleClick={() => startHead(key, level, c.label)}>
                      <div className="de-grouphead">
                        {editing ? headInput : <span>{c.label}</span>}
                        {!editing && (
                          <button className="gs-head-x" title={`Delete “${c.label}”`}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => { e.stopPropagation(); onDelete(idsUnder(start, c.span), c.label); }}>✕</button>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            );
          })}
          <tr className="de-heads">
            <th className="de-corner">#</th>
            {columnLabels.map((label, c) => {
              const key = `L:${c}`;
              const editing = head?.key === key;
              return (
                <th key={c} className="de-colcell gs-head"
                  title={factorLabels[factorLabels.length - 1]}
                  onDoubleClick={hasFactors ? () => startHead(key, leafLevel, label) : undefined}>
                  <div className="de-colhead">
                    {editing ? headInput : <span>{label}</span>}
                    {hasFactors && !editing && (
                      <button className="gs-head-x" title={`Delete “${label}”`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => { e.stopPropagation(); onDelete(idsUnder(c, 1), label); }}>✕</button>
                    )}
                  </div>
                </th>
              );
            })}
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
