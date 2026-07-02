import type { ColumnDef, PivotStep } from "../types";

/* ---- Pivot: long→wide. `index` rows stay as keys, `column`'s values become
   new headers, `values` is aggregated (sum), empties fill with `fill`. ---- */
export function StepPivot(
  { step, columns, onChange }:
  { step: PivotStep; columns: ColumnDef[]; onChange: (s: PivotStep) => void },
) {
  const toggleIndex = (name: string) => {
    const next = new Set(step.index);
    next.has(name) ? next.delete(name) : next.add(name);
    onChange({ ...step, index: columns.map((c) => c.name).filter((n) => next.has(n)) });
  };
  // `names` is an ordered [from,to] array (not a dict) for the same reason as
  // RecodeStep.map: transient empty/duplicate `from` keys must survive editing.
  const entries = step.names;
  const emitNames = (next: [string, string][]) => onChange({ ...step, names: next });
  const setFrom = (i: number, from: string) =>
    emitNames(entries.map((e, j) => (j === i ? [from, e[1]] : e)));
  const setTo = (i: number, to: string) =>
    emitNames(entries.map((e, j) => (j === i ? [e[0], to] : e)));
  const addName = () => emitNames([...entries, ["", ""]]);
  const rmName = (i: number) => emitNames(entries.filter((_, j) => j !== i));
  return (
    <div className="filter-conds">
      <div className="step-meta">
        index
        {columns.map((c) => (
          <label key={c.name}>
            <input
              type="checkbox"
              aria-label={c.name}
              checked={step.index.includes(c.name)}
              onChange={() => toggleIndex(c.name)}
            />
            {c.label}
          </label>
        ))}
      </div>
      <div className="step-meta">
        column
        <select
          aria-label="pivot column"
          value={step.column}
          onChange={(e) => onChange({ ...step, column: e.target.value })}
        >
          {columns.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
        </select>
      </div>
      <div className="step-meta">
        values
        <select
          aria-label="values column"
          value={step.values}
          onChange={(e) => onChange({ ...step, values: e.target.value })}
        >
          {columns.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
        </select>
        agg <strong>sum</strong>
      </div>
      <div className="step-meta">
        fill
        <input
          type="number"
          aria-label="fill value"
          value={step.fill}
          onChange={(e) =>
            onChange({ ...step, fill: e.target.value === "" ? 0 : Number(e.target.value) })}
        />
      </div>
      <div className="step-meta">relabel pivoted columns</div>
      {entries.map(([from, to], i) => (
        <div key={i} className="filter-row">
          <input aria-label="rename from" value={from}
            onChange={(e) => setFrom(i, e.target.value)} />
          <input aria-label="rename to" value={to}
            onChange={(e) => setTo(i, e.target.value)} />
          <button className="icon" aria-label="remove" title="remove" onClick={() => rmName(i)}>✕</button>
        </div>
      ))}
      <button className="step-add-row" onClick={addName}>+ relabel</button>
    </div>
  );
}
