/* An ordered [from, to] mapping editor: rows of two text inputs plus add/remove.
   The array (not a dict) is deliberate — transient empty or momentarily-duplicate
   `from` keys must survive editing; the engine coerces it to a dict at the reduce
   boundary (drops empties, later-pair-wins). Shared by StepRecode (value relabels)
   and StepPivot (pivoted-column relabels), which differ only in labels + the step
   field they store into. */
export function FromToRows(
  { entries, onChange, fromLabel, toLabel, addLabel }:
  {
    entries: [string, string][];
    onChange: (next: [string, string][]) => void;
    fromLabel: string;
    toLabel: string;
    addLabel: string;
  },
) {
  const setFrom = (i: number, from: string) =>
    onChange(entries.map((e, j) => (j === i ? [from, e[1]] : e)));
  const setTo = (i: number, to: string) =>
    onChange(entries.map((e, j) => (j === i ? [e[0], to] : e)));
  const add = () => onChange([...entries, ["", ""]]);
  const rm = (i: number) => onChange(entries.filter((_, j) => j !== i));
  return (
    <>
      {entries.map(([from, to], i) => (
        <div key={i} className="filter-row">
          <input aria-label={fromLabel} value={from}
            onChange={(e) => setFrom(i, e.target.value)} />
          <input aria-label={toLabel} value={to}
            onChange={(e) => setTo(i, e.target.value)} />
          <button className="icon" aria-label="remove" title="remove" onClick={() => rm(i)}>✕</button>
        </div>
      ))}
      <button className="step-add-row" onClick={add}>{addLabel}</button>
    </>
  );
}
