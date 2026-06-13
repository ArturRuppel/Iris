import { useAtom, useAtomValue } from "jotai";
import { activePlottableAtom, schemaAtom } from "../state";
import type { AggFn, FilterOp } from "../types";

const OPS: FilterOp[] = ["==", "!=", "<", "<=", ">", ">=", "in", "not-in"];
const AGGS: AggFn[] = ["mean", "median", "count", "sum", "sem"];

export function ReducePanel() {
  const schema = useAtomValue(schemaAtom);
  const [p, setP] = useAtom(activePlottableAtom);
  if (!schema || !p) return null;
  const cols = schema.columns;
  const numerics = cols.filter((c) => c.type === "numeric");
  const reduce = p.reduce;
  const setReduce = (r: typeof reduce) => setP({ ...p, reduce: r });
  const addFilter = () => setReduce({ ...reduce,
    filter: [...reduce.filter, { column: cols[0].name, op: "==", value: "" }] });
  const setFilter = (i: number, patch: Partial<typeof reduce.filter[0]>) =>
    setReduce({ ...reduce,
      filter: reduce.filter.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const rmFilter = (i: number) =>
    setReduce({ ...reduce, filter: reduce.filter.filter((_, j) => j !== i) });
  const toggleGroup = (name: string) => {
    const c = reduce.collapse;
    const group_by = c?.group_by ?? [];
    const next = group_by.includes(name)
      ? group_by.filter((g) => g !== name) : [...group_by, name];
    setReduce({ ...reduce,
      collapse: next.length ? { group_by: next, aggregate: c?.aggregate ?? {} } : null });
  };
  const setAgg = (col: string, fn: AggFn) => {
    if (!reduce.collapse) return;
    setReduce({ ...reduce,
      collapse: { ...reduce.collapse,
        aggregate: { ...reduce.collapse.aggregate, [col]: fn } } });
  };
  return (
    <div className="reduce-panel">
      <div className="reduce-filter">
        <strong>Filter rows</strong>
        {reduce.filter.map((f, i) => (
          <div key={i} className="filter-row">
            <select value={f.column} onChange={(e) => setFilter(i, { column: e.target.value })}>
              {cols.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
            </select>
            <select value={f.op} onChange={(e) => setFilter(i, { op: e.target.value as FilterOp })}>
              {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <input value={Array.isArray(f.value) ? f.value.join(",") : String(f.value)}
              onChange={(e) => setFilter(i, {
                value: (f.op === "in" || f.op === "not-in")
                  ? e.target.value.split(",").map((s) => s.trim())
                  : e.target.value })} />
            <button onClick={() => rmFilter(i)}>✕</button>
          </div>
        ))}
        <button onClick={addFilter}>+ condition</button>
      </div>
      <div className="reduce-collapse">
        <strong>Collapse</strong>
        <div className="group-by">
          {cols.map((c) => (
            <label key={c.name}>
              <input type="checkbox"
                checked={reduce.collapse?.group_by.includes(c.name) ?? false}
                onChange={() => toggleGroup(c.name)} /> {c.label}
            </label>
          ))}
        </div>
        {reduce.collapse && (
          <div className="aggregates">
            {numerics.filter((c) => !reduce.collapse!.group_by.includes(c.name)).map((c) => (
              <label key={c.name}>{c.label}
                <select value={reduce.collapse!.aggregate[c.name] ?? "mean"}
                  onChange={(e) => setAgg(c.name, e.target.value as AggFn)}>
                  {AGGS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
