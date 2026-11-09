import { useEffect, useState } from "react";
import type { ColumnDef, DeriveStep } from "../types";
import { exprToDisplay, exprToNames } from "../exprLabels";

/* ---- Derive: add a computed column from a free-text expression ----
   The expression is shown and typed with column LABELS (as the table shows
   them; a label with spaces or units goes in backticks) and stored with column
   names (what the engine parses). The input keeps the typed text as a draft so
   the cursor never jumps; the draft is re-derived only when the stored
   expression changes from outside. */
export function StepDerive(
  { step, columns, onChange }:
  { step: DeriveStep; columns: ColumnDef[]; onChange: (s: DeriveStep) => void },
) {
  const [draft, setDraft] = useState(() => exprToDisplay(step.expr, columns));
  useEffect(() => {
    if (exprToNames(draft, columns) !== step.expr) setDraft(exprToDisplay(step.expr, columns));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.expr, columns]);
  const shown = exprToDisplay(step.expr, columns);
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
          className="expr"
          aria-label="Expression"
          placeholder="expression, e.g. `area (µm²)` / 100"
          title="Columns go by the label the table shows; put a label with spaces or units in backticks."
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            onChange({ ...step, expr: exprToNames(e.target.value, columns) });
          }}
        />
      </div>
      <div className="step-meta">
        new column “{step.column || "…"}” = {shown || "…"}
      </div>
    </>
  );
}
