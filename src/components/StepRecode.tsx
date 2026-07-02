import type { ColumnDef, RecodeStep } from "../types";

/* ---- Recode: relabel the values of one column via a from→to map ---- */
export function StepRecode(
  { step, columns, onChange }:
  { step: RecodeStep; columns: ColumnDef[]; onChange: (s: RecodeStep) => void },
) {
  // `map` is an ordered [from,to] array (not a dict): two empty rows, or a `from`
  // typed through a value that momentarily equals another row's, must not collapse
  // or merge. The engine coerces it to a dict (drops empties, later-pair-wins).
  const entries = step.map;
  const emit = (next: [string, string][]) => onChange({ ...step, map: next });
  const setFrom = (i: number, from: string) =>
    emit(entries.map((e, j) => (j === i ? [from, e[1]] : e)));
  const setTo = (i: number, to: string) =>
    emit(entries.map((e, j) => (j === i ? [e[0], to] : e)));
  const add = () => emit([...entries, ["", ""]]);
  const rm = (i: number) => emit(entries.filter((_, j) => j !== i));
  return (
    <div className="filter-conds">
      <div className="step-meta">
        <select
          aria-label="recode column"
          value={step.column}
          onChange={(e) => onChange({ ...step, column: e.target.value })}
        >
          {columns.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
        </select>
      </div>
      {entries.map(([from, to], i) => (
        <div key={i} className="filter-row">
          <input aria-label="from" value={from}
            onChange={(e) => setFrom(i, e.target.value)} />
          <input aria-label="to" value={to}
            onChange={(e) => setTo(i, e.target.value)} />
          <button className="icon" aria-label="remove" title="remove" onClick={() => rm(i)}>✕</button>
        </div>
      ))}
      <button className="step-add-row" onClick={add}>+ mapping</button>
    </div>
  );
}
