import type { ColumnDef, GridCompleteStep } from "../types";

/* ---- Grid complete: fill in missing category combinations, optionally counting ---- */
export function StepGridComplete(
  { step, columns, onChange }:
  { step: GridCompleteStep; columns: ColumnDef[]; onChange: (s: GridCompleteStep) => void },
) {
  const toggleBy = (name: string) => {
    const has = step.by.includes(name);
    onChange({ ...step,
      by: has ? step.by.filter((c) => c !== name) : [...step.by, name] });
  };
  return (
    <>
      <div className="filter-row">
        <span>complete within</span>
        {columns.map((c) => (
          <label key={c.name}>
            <input type="checkbox" aria-label="complete within"
              checked={step.by.includes(c.name)}
              onChange={() => toggleBy(c.name)} />
            {c.label}
          </label>
        ))}
      </div>
      <div className="filter-row">
        <span>grid column</span>
        <select aria-label="grid column" value={step.column}
          onChange={(e) => onChange({ ...step, column: e.target.value })}>
          {columns.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
        </select>
      </div>
      <div className="filter-row">
        <span>levels</span>
        <input aria-label="levels"
          value={step.levels.join(", ")}
          placeholder="a, b, c"
          onChange={(e) => onChange({ ...step,
            levels: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
      </div>
      <div className="filter-row">
        <label>
          <input type="checkbox" aria-label="count rows"
            checked={step.count}
            onChange={(e) => onChange({ ...step, count: e.target.checked })} />
          count rows
        </label>
      </div>
      <div className="filter-row">
        <span>count unique</span>
        <select aria-label="count unique" value={step.count_unique ?? ""}
          onChange={(e) => onChange({ ...step,
            count_unique: e.target.value === "" ? null : e.target.value })}>
          <option value="">— none —</option>
          {columns.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
        </select>
      </div>
      <div className="filter-row">
        <span>fill value</span>
        <input type="number" aria-label="fill value"
          value={step.fill}
          onChange={(e) => onChange({ ...step,
            fill: e.target.value === "" ? 0 : Number(e.target.value) })} />
      </div>
      <div className="filter-row">
        <span>count name</span>
        <input aria-label="count name"
          value={step.count_name}
          onChange={(e) => onChange({ ...step, count_name: e.target.value })} />
      </div>
    </>
  );
}
