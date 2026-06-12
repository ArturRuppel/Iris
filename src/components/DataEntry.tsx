import { useState } from "react";
import { useSetAtom } from "jotai";
import { loadTableAtom } from "../state";
import { engine, fileToBase64 } from "../types";

interface Cond { name: string; text: string }

const FRESH: Cond[] = [
  { name: "Control", text: "" },
  { name: "Treatment", text: "" },
];

/** "Enter data…" wizard: one column per condition (the layout people have in
 *  their heads and their Excel sheets), values typed or pasted one per line.
 *  The engine stacks it into the long table the analyses run on — parsing,
 *  decimal commas, and type inference all reuse the import pipeline. */
export function DataEntry() {
  const loadTable = useSetAtom(loadTableAtom);
  const [open, setOpen] = useState(false);
  const [conds, setConds] = useState<Cond[]>(FRESH);
  const [varName, setVarName] = useState("Condition");
  const [valueName, setValueName] = useState("Value");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => { setOpen(false); setError(null); setBusy(false); };
  const update = (i: number, patch: Partial<Cond>) =>
    setConds(conds.map((c, k) => (k === i ? { ...c, ...patch } : c)));

  const nValues = conds.map((c) => c.text.split("\n").filter((l) => l.trim()).length);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      /* wide CSV: header = condition names, ragged columns padded empty */
      const cols = conds.map((c) => c.text.split("\n")
        .map((l) => l.trim().replace(/[;"]/g, "")).filter(Boolean));
      const depth = Math.max(...cols.map((c) => c.length));
      const lines = [conds.map((c) => c.name.replace(/[;\n"]/g, " ").trim() || "Condition").join(";")];
      for (let r = 0; r < depth; r++)
        lines.push(cols.map((c) => c[r] ?? "").join(";"));
      const b64 = fileToBase64(new TextEncoder().encode(lines.join("\n")).buffer as ArrayBuffer);

      /* first preview learns the sanitized column names, second applies the
         wide→long reshape, commit loads the long table */
      const wide = await engine.importPreview("entered.csv", b64, { delimiter: ";" });
      const opts = {
        delimiter: ";",
        reshape: {
          value_columns: wide.columns.map((c) => c.name),
          var_name: varName.trim() || "Condition",
          value_name: valueName.trim() || "Value",
        },
      };
      const long = await engine.importPreview("entered.csv", b64, opts);
      const table = await engine.importCommit("entered.csv", b64, opts,
        long.columns.map((c) => ({ name: c.name, label: c.label, type: c.type })));
      loadTable(table);
      setConds(FRESH);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <>
      <button onClick={() => setOpen(true)}>Enter data…</button>
      {open && (
        <div className="modal-overlay" onClick={close}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Enter data</h2>
              <span className="provenance">one column per condition</span>
            </div>

            <div className="wizard-options">
              <label>Condition variable
                <input type="text" value={varName}
                  onChange={(e) => setVarName(e.target.value)} />
              </label>
              <label>Value variable
                <input type="text" value={valueName}
                  onChange={(e) => setValueName(e.target.value)} />
              </label>
            </div>

            <div className="entry-columns">
              {conds.map((c, i) => (
                <div className="entry-col" key={i}>
                  <div className="entry-col-head">
                    <input type="text" value={c.name}
                      onChange={(e) => update(i, { name: e.target.value })} />
                    <button className="link" title="remove condition"
                      disabled={conds.length <= 2}
                      onClick={() => setConds(conds.filter((_, k) => k !== i))}>
                      ✕
                    </button>
                  </div>
                  <textarea rows={10} value={c.text} spellCheck={false}
                    placeholder={"one value per line\n(paste a column\nfrom Excel)"}
                    onChange={(e) => update(i, { text: e.target.value })} />
                  <span className="dim">{nValues[i]} value{nValues[i] === 1 ? "" : "s"}</span>
                </div>
              ))}
              <button className="entry-add"
                onClick={() => setConds([...conds,
                  { name: `Condition ${conds.length + 1}`, text: "" }])}>
                + condition
              </button>
            </div>

            {error && <p className="warn">{error}</p>}
            <div className="modal-foot">
              <button onClick={close}>Cancel</button>
              <button className="primary"
                disabled={busy || nValues.filter((n) => n > 0).length < 2}
                onClick={() => void create()}>
                {busy ? "Working…" : `Create table (${nValues.reduce((a, b) => a + b, 0)} values)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
