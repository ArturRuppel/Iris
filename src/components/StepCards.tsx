import { ColumnPicker } from "./ColumnPicker";
import type {
  ColumnDef, FilterOp, SelectStep, FilterStep,
} from "../types";

const OPS: FilterOp[] = ["==", "!=", "<", "<=", ">", ">=", "in", "not-in"];

const orderBy = (cols: ColumnDef[], chosen: Set<string>) =>
  cols.map((c) => c.name).filter((n) => chosen.has(n));

/* ---- Select: keep only specific columns (projection) ---- */
export function StepSelect(
  { step, columns, onChange }:
  { step: SelectStep; columns: ColumnDef[]; onChange: (s: SelectStep) => void },
) {
  const toggle = (name: string) => {
    const has = step.columns.includes(name);
    onChange({ ...step,
      columns: has ? step.columns.filter((c) => c !== name) : [...step.columns, name] });
  };
  const toggleGroup = (names: string[], on: boolean) => {
    const set = new Set(step.columns);
    names.forEach((n) => (on ? set.add(n) : set.delete(n)));
    onChange({ ...step, columns: orderBy(columns, set) });
  };
  return (
    <>
      <div className="step-meta">
        {step.columns.length} of {columns.length} columns kept
        {step.columns.length === 0 && <em> — pick columns to keep</em>}
      </div>
      <ColumnPicker columns={columns} selected={step.columns}
        onToggle={toggle} onToggleGroup={toggleGroup} />
    </>
  );
}

/* ---- Filter: drop rows failing the AND-ed conditions ---- */
export function StepFilter(
  { step, columns, onChange }:
  { step: FilterStep; columns: ColumnDef[]; onChange: (s: FilterStep) => void },
) {
  const conds = step.conditions;
  const set = (i: number, patch: Partial<FilterStep["conditions"][number]>) =>
    onChange({ ...step, conditions: conds.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  /* in/not-in take a list, the scalar ops take a single value. Coerce the value
     when the op crosses that boundary so the engine never sees a scalar where it
     wants a list (which 422s) just because the user changed the operator first. */
  const changeOp = (i: number, op: FilterOp) => {
    const cur = conds[i];
    const wasList = cur.op === "in" || cur.op === "not-in";
    const isList = op === "in" || op === "not-in";
    let value = cur.value;
    if (isList && !wasList)
      value = String(cur.value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (!isList && wasList)
      value = Array.isArray(cur.value) ? (cur.value[0] ?? "") : cur.value;
    set(i, { op, value });
  };
  const add = () => onChange({ ...step,
    conditions: [...conds, { column: columns[0]?.name ?? "", op: "==", value: "" }] });
  const rm = (i: number) =>
    onChange({ ...step, conditions: conds.filter((_, j) => j !== i) });
  return (
    <div className="filter-conds">
      {conds.map((f, i) => (
        <div key={i} className="filter-row">
          <select value={f.column} onChange={(e) => set(i, { column: e.target.value })}>
            {columns.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
          </select>
          <select value={f.op} onChange={(e) => changeOp(i, e.target.value as FilterOp)}>
            {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <input
            value={Array.isArray(f.value) ? f.value.join(",") : String(f.value)}
            placeholder={f.op === "in" || f.op === "not-in" ? "a, b, c" : "value"}
            onChange={(e) => set(i, {
              value: f.op === "in" || f.op === "not-in"
                ? e.target.value.split(",").map((s) => s.trim())
                : e.target.value })}
          />
          <button className="icon" title="remove" onClick={() => rm(i)}>✕</button>
        </div>
      ))}
      <button className="step-add-row" onClick={add}>+ condition</button>
      {conds.length === 0 && <em className="step-meta">no conditions — all rows pass</em>}
    </div>
  );
}
