import { useAtomValue, useSetAtom } from "jotai";
import {
  activePlottableAtom, effectivePlanAtom, effectiveTestGrainAtom,
  hierarchyAtom, schemaAtom,
  setCollapsePlanAtom, setTestGrainAtom, resetCollapseAtom,
} from "../state";
import { shapeCountsAtom } from "../explorer/graphAtom";
import { grainKey, planGrains } from "../collapse";
import { LEVEL_FNS, type LevelFn } from "../types";

export function CollapseRoutingPanel() {
  const p = useAtomValue(activePlottableAtom);
  const schema = useAtomValue(schemaAtom);
  const { spine } = useAtomValue(hierarchyAtom);
  const plan = useAtomValue(effectivePlanAtom);
  const testGrain = useAtomValue(effectiveTestGrainAtom);
  const counts = useAtomValue(shapeCountsAtom);
  const setPlan = useSetAtom(setCollapsePlanAtom);
  const setTestGrain = useSetAtom(setTestGrainAtom);
  const reset = useSetAtom(resetCollapseAtom);
  if (!p || spine.length === 0) return null;

  const label = (n: string) => schema?.columns.find((c) => c.name === n)?.label ?? n;
  const grainLabel = (k: string) => k === "" ? "Raw (every row)"
    : k.split("/").map(label).join(" × ");
  const keptDims = new Set(plan.flatMap((s) => s.keep));
  const addable = spine.filter((d) => !keptDims.has(d));

  const setFn = (i: number, fn: LevelFn) =>
    setPlan(plan.map((s, j) => (j === i ? { ...s, fn } : s)));
  const remove = (i: number) => setPlan(plan.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= plan.length) return;
    const next = [...plan]; [next[i], next[j]] = [next[j], next[i]]; setPlan(next);
  };
  const add = (dim: string) =>
    setPlan([...plan, { keep: spine.slice(0, spine.indexOf(dim) + 1), fn: "mean" }]);

  return (
    <aside className="collapse-routing">
      <h3>Collapse routing</h3>
      <ol className="cr-steps">
        {plan.map((step, i) => {
          const key = grainKey(step.keep);
          return (
            <li key={`${key}:${i}`} className="cr-step">
              <span className="cr-grain">{grainLabel(key)}</span>
              <select aria-label={`aggregate into ${grainLabel(key)}`} value={step.fn}
                onChange={(e) => setFn(i, e.target.value as LevelFn)}>
                {LEVEL_FNS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <button className="icon" title="Earlier" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
              <button className="icon" title="Later" onClick={() => move(i, 1)} disabled={i === plan.length - 1}>↓</button>
              <button className="icon" aria-label={`remove level ${grainLabel(key)}`} onClick={() => remove(i)}>×</button>
            </li>
          );
        })}
      </ol>
      {addable.length > 0 && (
        <div className="cr-add">
          <span>+ add level</span>
          {addable.map((d) => <button key={d} onClick={() => add(d)}>{label(d)}</button>)}
        </div>
      )}
      <label className="cr-testgrain">
        <span>Test reads at</span>
        <select aria-label="test reads at" value={testGrain}
          onChange={(e) => setTestGrain(e.target.value)}>
          {planGrains(plan).map((k) => {
            const n = counts?.[k === "" ? "source" : `grain:${k}`]?.rows;
            return <option key={k} value={k}>{grainLabel(k)}{n != null ? ` (n = ${n})` : ""}</option>;
          })}
        </select>
      </label>
      <button className="cr-reset" onClick={() => reset()}>Reset to default</button>
    </aside>
  );
}
