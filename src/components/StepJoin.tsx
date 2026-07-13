import type { ColumnDef, JoinStep, Schema } from "../types";
import { orderBy } from "./StepCards";

/* ---- Join: inner-join a referenced pool table on shared keys ----
   `rightTableId` picks the right table from the loaded pool (the missing-input
   state until chosen). Join keys are the left columns also present in the chosen
   right table — others are disabled, since the engine joins on shared names.
   Picking a table prunes the keys to that shared set and, when none survive,
   seeds the shared identifier columns (the natural keys). A rightTableId that
   references a table absent from the pool (a .iris joining a table not loaded
   here) stays visible as its own not-loaded option, keys editable as before.
   `how` is fixed to "inner" by the type, rendered as text. */

export interface JoinPoolEntry { id: string; name: string; schema: Schema }

export function StepJoin(
  { step, columns, pool, onChange }:
  { step: JoinStep; columns: ColumnDef[]; pool: JoinPoolEntry[];
    onChange: (s: JoinStep) => void },
) {
  const right = pool.find((t) => t.id === step.rightTableId) ?? null;
  const shared = right ? new Set(right.schema.columns.map((c) => c.name)) : null;
  const dangling = !right && step.rightTableId !== "";

  const pickTable = (id: string) => {
    const next = pool.find((t) => t.id === id);
    const names = new Set(next?.schema.columns.map((c) => c.name) ?? []);
    const kept = step.on.filter((n) => names.has(n));
    const on = kept.length > 0 ? kept
      : columns.filter((c) => c.identifier && names.has(c.name)).map((c) => c.name);
    onChange({ ...step, rightTableId: id, on });
  };

  const toggle = (name: string) => {
    const has = step.on.includes(name);
    const next = new Set(has ? step.on.filter((n) => n !== name) : [...step.on, name]);
    onChange({ ...step, on: orderBy(columns, next) });
  };

  return (
    <>
      <label className="step-meta">
        right table{" "}
        <select
          aria-label="right table"
          value={step.rightTableId}
          onChange={(e) => pickTable(e.target.value)}
        >
          <option value="">— choose a table —</option>
          {dangling && (
            <option value={step.rightTableId} disabled>
              {step.rightTableId} (not loaded)
            </option>
          )}
          {pool.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <div className="step-meta">join type: inner</div>
      <ul className="cp-cols">
        {columns.map((c) => {
          // no table picked yet → keys are meaningless; picked → only shared
          // names joinable; dangling reference → can't know, leave editable.
          const disabled = shared ? !shared.has(c.name) : !dangling;
          return (
            <li key={c.name}>
              <label title={shared && disabled ? `${c.name} is not in ${right!.name}` : c.name}>
                <input
                  type="checkbox"
                  checked={step.on.includes(c.name)}
                  disabled={disabled}
                  onChange={() => toggle(c.name)}
                />
                <span>{c.label}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {!right && !dangling && (
        <em className="step-meta">choose a right table to pick join keys</em>
      )}
      {(right || dangling) && step.on.length === 0 && (
        <em className="step-meta">pick at least one join key</em>
      )}
    </>
  );
}
