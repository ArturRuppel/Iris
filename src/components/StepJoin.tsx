import type { ColumnDef, JoinStep } from "../types";

/* ---- Join: inner-join the (read-only) embedded right table on shared keys ----
   Only `on` (the join-key columns) is editable here. `right` carries a whole
   embedded table — too heavy to edit inside this card, so it's shown as a
   read-only summary. `how` is fixed to "inner" by the type, rendered as text. */
export function StepJoin(
  { step, columns, onChange }:
  { step: JoinStep; columns: ColumnDef[]; onChange: (s: JoinStep) => void },
) {
  const toggle = (name: string) => {
    const has = step.on.includes(name);
    const next = new Set(has ? step.on.filter((n) => n !== name) : [...step.on, name]);
    onChange({ ...step, on: columns.map((c) => c.name).filter((n) => next.has(n)) });
  };
  return (
    <>
      <div className="step-meta">
        right table · {step.right.rows.length} rows ·
        {" "}{step.right.schema.columns.length} columns
      </div>
      <div className="step-meta">join type: inner</div>
      <ul className="cp-cols">
        {columns.map((c) => (
          <li key={c.name}>
            <label title={c.name}>
              <input
                type="checkbox"
                checked={step.on.includes(c.name)}
                onChange={() => toggle(c.name)}
              />
              <span>{c.label}</span>
            </label>
          </li>
        ))}
      </ul>
      {step.on.length === 0 && <em className="step-meta">pick at least one join key</em>}
    </>
  );
}
