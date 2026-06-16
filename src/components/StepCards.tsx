import { ColumnPicker, groupByPrefix } from "./ColumnPicker";
import type {
  AggFn, ColumnDef, FilterOp, SelectStep, FilterStep, CollapseStep,
} from "../types";

const OPS: FilterOp[] = ["==", "!=", "<", "<=", ">", ">=", "in", "not-in"];
const AGGS: AggFn[] = ["mean", "median", "count", "sum", "sem"];

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
          <select value={f.op} onChange={(e) => set(i, { op: e.target.value as FilterOp })}>
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

/* ---- Collapse: group rows, replace table with one row per group ---- */
export function StepCollapse(
  { step, columns, onChange }:
  { step: CollapseStep; columns: ColumnDef[]; onChange: (s: CollapseStep) => void },
) {
  const toggle = (name: string) => {
    const has = step.group_by.includes(name);
    onChange({ ...step,
      group_by: has ? step.group_by.filter((g) => g !== name) : [...step.group_by, name] });
  };
  const toggleGroup = (names: string[], on: boolean) => {
    const set = new Set(step.group_by);
    names.forEach((n) => (on ? set.add(n) : set.delete(n)));
    onChange({ ...step, group_by: orderBy(columns, set) });
  };
  const setAgg = (col: string, fn: AggFn) =>
    onChange({ ...step, aggregate: { ...step.aggregate, [col]: fn } });

  // bool collapses to numeric 1/0, so it's aggregatable too (mean → fraction true)
  const numerics = columns.filter(
    (c) => (c.type === "numeric" || c.type === "bool") && !step.group_by.includes(c.name));
  return (
    <>
      <div className="step-sub">Group by</div>
      <ColumnPicker columns={columns} selected={step.group_by}
        onToggle={toggle} onToggleGroup={toggleGroup} />
      {step.group_by.length === 0
        ? <em className="step-meta">pick at least one grouping column</em>
        : (
          <>
            <div className="step-sub">Aggregate ({numerics.length})</div>
            <div className="agg-list">
              {groupByPrefix(numerics).map(({ prefix, cols }) => (
                <div key={prefix} className="agg-group">
                  {prefix !== "(other)" && <div className="agg-prefix">{prefix}</div>}
                  {cols.map((c) => (
                    <label key={c.name} className="agg-row" title={c.name}>
                      <span>{c.name.includes(".") ? c.name.slice(c.name.indexOf(".") + 1) : c.name}</span>
                      <select value={step.aggregate[c.name] ?? "mean"}
                        onChange={(e) => setAgg(c.name, e.target.value as AggFn)}>
                        {AGGS.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
    </>
  );
}
