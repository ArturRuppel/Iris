import type { ColumnDef, PivotStep } from "../types";
import { FromToRows } from "./FromToRows";
import { orderBy } from "./StepCards";

/* ---- Pivot: long→wide. `index` rows stay as keys, `column`'s values become
   new headers, `values` is aggregated (sum), empties fill with `fill`. ---- */
export function StepPivot(
  { step, columns, onChange }:
  { step: PivotStep; columns: ColumnDef[]; onChange: (s: PivotStep) => void },
) {
  const toggleIndex = (name: string) => {
    const next = new Set(step.index);
    next.has(name) ? next.delete(name) : next.add(name);
    onChange({ ...step, index: orderBy(columns, next) });
  };
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
      <FromToRows
        entries={step.names}
        fromLabel="rename from" toLabel="rename to" addLabel="+ relabel"
        onChange={(names) => onChange({ ...step, names })}
      />
    </div>
  );
}
