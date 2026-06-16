import { useRef, useState } from "react";
import { useSetAtom } from "jotai";
import { loadTableAtom } from "../state";
import { engine, fileToBase64, tableFromColumnar } from "../types";
import type { ColumnDef, ImportOptions, ImportPreview } from "../types";

const RESHAPE_DEFAULTS = { var_name: "Condition", value_name: "Value" };

const TYPE_LABELS: Record<ColumnDef["type"], string> = {
  numeric: "numeric (123)",
  categorical: "categorical (abc)",
  identifier: "identifier (id)",
};

/** "Import data…" button plus the preview/confirm dialog. Parsing happens in
 *  the engine (pandas); this component only edits the options and column
 *  types, re-previewing on every change so what you see is what loads. */
export function ImportWizard() {
  const loadTable = useSetAtom(loadTableAtom);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; token: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [opts, setOpts] = useState<ImportOptions>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stackSel, setStackSel] = useState<string[]>([]);

  const close = () => {
    setFile(null); setPreview(null); setOpts({}); setError(null);
    setStackSel([]);
    if (fileRef.current) fileRef.current.value = "";
  };

  /* guards against a slow earlier request landing after a newer one */
  const seq = useRef(0);

  /* Headers-first: paint the columns (+ a provisional type guess) from a quick
     sample, then fill in the full-data stats and preview rows once the whole
     file is parsed — so the user can start typing/mapping immediately. A type
     change doesn't re-parse, so `reparse=false` skips the provisional flash and
     just refreshes the full preview. */
  const runPreview = async (name: string, token: string, o: ImportOptions,
                            reparse = true) => {
    const my = ++seq.current;
    const src = { filename: name, file_token: token };
    setBusy(true); setError(null);
    try {
      if (reparse) {
        const heads = await engine.importHeaders(src, o);
        if (my !== seq.current) return;
        setPreview(heads);
      }
      const full = await engine.importPreview(src, o);
      if (my !== seq.current) return;
      setPreview(full);
    } catch (e) {
      if (my === seq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (my === seq.current) setBusy(false);
    }
  };

  const onPick = async (f: File) => {
    setBusy(true); setError(null); setPreview(null);
    try {
      /* upload the bytes once; every re-preview below rides as a small token */
      const { token } = await engine.importUpload(
        f.name, fileToBase64(await f.arrayBuffer()));
      setFile({ name: f.name, token });
      setOpts({});
      await runPreview(f.name, token, {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const updateOptions = (partial: ImportOptions, reparse = true) => {
    if (!file) return;
    const merged = { ...opts, ...partial };
    setOpts(merged);
    void runPreview(file.name, file.token, merged, reparse);
  };

  const setColType = (name: string, type: ColumnDef["type"]) =>
    updateOptions({ types: { ...opts.types, [name]: type } }, false);

  /* wide → long: column names change, so per-column type overrides reset */
  const applyStack = () =>
    updateOptions({
      types: undefined,
      reshape: {
        ...RESHAPE_DEFAULTS,  /* level order = column order in the file */
        value_columns: (preview?.columns ?? [])
          .filter((c) => stackSel.includes(c.name)).map((c) => c.name),
      },
    });
  const undoStack = () => {
    setStackSel([]);
    updateOptions({ types: undefined, reshape: null });
  };
  const toggleStack = (name: string) =>
    setStackSel(stackSel.includes(name)
      ? stackSel.filter((n) => n !== name) : [...stackSel, name]);

  const doImport = async () => {
    if (!file || !preview) return;
    setBusy(true); setError(null);
    try {
      const ct = await engine.importCommit(
        { filename: file.name, file_token: file.token }, opts,
        preview.columns.map((c) => ({ name: c.name, label: c.label, type: c.type })));
      loadTable({ ...tableFromColumnar(ct), token: ct.token });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const o = preview?.options;
  return (
    <>
      <button onClick={() => fileRef.current?.click()}>Import data…</button>
      <input ref={fileRef} type="file" hidden
        accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls"
        onChange={(e) => e.target.files?.[0] && void onPick(e.target.files[0])} />
      {file && (preview || error) && (
        <div className="modal-overlay" onClick={close}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Import {file.name}</h2>
              {preview && <span className="provenance">
                {preview.n_rows == null ? "counting rows…" : `${preview.n_rows} rows`}
                {" · "}{preview.columns.length} columns
              </span>}
            </div>

            {o && (
              <div className="wizard-options">
                {o.kind === "csv" && (
                  <>
                    <label>Delimiter
                      <select value={o.delimiter ?? ","}
                        onChange={(e) => updateOptions({ delimiter: e.target.value })}>
                        <option value=",">comma</option>
                        <option value=";">semicolon</option>
                        <option value={"\t"}>tab</option>
                        <option value="|">pipe</option>
                      </select>
                    </label>
                    <label>Decimal
                      <select value={o.decimal}
                        onChange={(e) => updateOptions({ decimal: e.target.value })}>
                        <option value=".">point (1.5)</option>
                        <option value=",">comma (1,5)</option>
                      </select>
                    </label>
                  </>
                )}
                {o.kind === "excel" && o.sheets && o.sheets.length > 1 && (
                  <label>Sheet
                    <select value={o.sheet ?? ""}
                      onChange={(e) => updateOptions({ sheet: e.target.value })}>
                      {o.sheets.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </label>
                )}
                <label>
                  <input type="checkbox" checked={o.header}
                    onChange={(e) => updateOptions({ header: e.target.checked })} />
                  first row is column names
                </label>
              </div>
            )}

            {preview && (
              <>
                <h3>Columns {preview.provisional && (
                  <span className="dim">· computing stats…</span>
                )}</h3>
                <div className="wizard-columns">
                  {preview.columns.map((c) => (
                    <div className="wizard-col" key={c.name}>
                      <strong>{c.label}</strong>
                      <select value={c.type}
                        onChange={(e) => setColType(c.name, e.target.value as ColumnDef["type"])}>
                        {(Object.keys(TYPE_LABELS) as ColumnDef["type"][]).map((t) => (
                          <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                        ))}
                      </select>
                      <span className="dim">
                        {c.n_distinct == null
                          ? "…"
                          : `${c.n_distinct} distinct${c.n_missing ? ` · ${c.n_missing} missing` : ""}`}
                      </span>
                      {(c.n_unparsed ?? 0) > 0 && (
                        <span className="warn">
                          {c.n_unparsed} value(s) not numeric → missing
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {!o?.reshape && preview.columns.length >= 2 && (
                  <details className="stack-section">
                    <summary>Stack columns (one column per condition → long format)</summary>
                    <div className="wizard-options">
                      {preview.columns.map((c) => (
                        <label key={c.name}>
                          <input type="checkbox" checked={stackSel.includes(c.name)}
                            onChange={() => toggleStack(c.name)} />
                          {c.label}
                        </label>
                      ))}
                      <button disabled={stackSel.length < 2}
                        onClick={applyStack}>
                        Stack {stackSel.length} columns
                      </button>
                    </div>
                  </details>
                )}
                {o?.reshape && (
                  <p className="reason">
                    {o.reshape.value_columns.length} columns stacked into{" "}
                    <strong>{o.reshape.var_name}</strong> / <strong>{o.reshape.value_name}</strong>.{" "}
                    <button className="link" onClick={undoStack}>Undo</button>
                  </p>
                )}

                <h3>Preview</h3>
                {preview.provisional ? (
                  <p className="reason">Loading preview…</p>
                ) : (
                  <div className="table-scroll wizard-preview">
                    <table>
                      <thead>
                        <tr>{preview.columns.map((c) => <th key={c.name}>{c.label}</th>)}</tr>
                      </thead>
                      <tbody>
                        {preview.rows.slice(0, 8).map((r) => (
                          <tr key={r.id}>
                            {preview.columns.map((c) => (
                              <td key={c.name}
                                className={(c.type === "numeric" ? "mono " : "")
                                  + (r[c.name] == null ? "missing-cell" : "")}>
                                {r[c.name] == null ? "NA" : String(r[c.name])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {error && <p className="warn">{error}</p>}
            <div className="modal-foot">
              <button onClick={close}>Cancel</button>
              <button className="primary"
                disabled={busy || !preview || preview.provisional}
                onClick={() => void doImport()}>
                {busy ? "Working…" : `Import ${preview?.n_rows ?? ""} rows`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
