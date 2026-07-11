import type { ColumnDef, RecodeStep } from "../types";
import { FromToRows } from "./FromToRows";

/* ---- Recode: relabel the values of one column via a from→to map ---- */
export function StepRecode(
  { step, columns, onChange }:
  { step: RecodeStep; columns: ColumnDef[]; onChange: (s: RecodeStep) => void },
) {
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
      <FromToRows
        entries={step.map}
        fromLabel="from" toLabel="to" addLabel="+ mapping"
        onChange={(map) => onChange({ ...step, map })}
      />
    </div>
  );
}
