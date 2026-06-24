import type { ColumnDef, DeriveStep } from "../types";

/* ---- Derive: add a computed column from a free-text expression ---- */
export function StepDerive(
  { step, columns: _columns, onChange }:
  { step: DeriveStep; columns: ColumnDef[]; onChange: (s: DeriveStep) => void },
) {
  return (
    <>
      <div className="filter-row">
        <input
          aria-label="New column"
          placeholder="new column"
          value={step.column}
          onChange={(e) => onChange({ ...step, column: e.target.value })}
        />
        <input
          aria-label="Expression"
          placeholder="expression"
          value={step.expr}
          onChange={(e) => onChange({ ...step, expr: e.target.value })}
        />
      </div>
      <div className="step-meta">
        new column “{step.column || "…"}” = {step.expr || "…"}
      </div>
    </>
  );
}
