import { useAtom, useAtomValue } from "jotai";
import { activePlottableAtom, effectiveSchemaAtom } from "../state";
import { familyForMappings } from "../channels";

/* item 10 — independent-repetition key. Pick the column(s) that identify an
   independent unit (e.g. subject, litter, run); the engine then averages the
   technical replicates within each unit before computing n and the test, while
   the figure keeps showing the raw points. Only meaningful for a group
   comparison (where n drives the test), so it's hidden otherwise. How replicates
   are combined into a unit value is the Collapse pipeline step's concern. */
export function RepetitionKey() {
  const [active, setActive] = useAtom(activePlottableAtom);
  const schema = useAtomValue(effectiveSchemaAtom);
  if (!active || !schema) return null;
  if (familyForMappings(active.mappings, schema) !== "group_comparison") return null;

  const { x, y } = active.mappings;
  /* a unit is named by an identifier or category, never the measurement; the
     grouping axis itself is excluded (it defines groups, not units within). */
  const eligible = schema.columns.filter(
    (c) => (c.type === "identifier" || c.type === "categorical")
      && c.name !== x && c.name !== y);
  if (eligible.length === 0) return null;

  const selected = new Set(active.repetitionKey);
  const toggle = (name: string) =>
    setActive({ ...active, repetitionKey:
      selected.has(name) ? active.repetitionKey.filter((k) => k !== name)
        : [...active.repetitionKey, name] });

  return (
    <div className="rep-key">
      <div className="rep-key-head">
        <strong>n by</strong>
        <span className="dim" title="The columns that identify an independent repetition. Technical replicates within each unit are averaged before n and the test; the figure still shows the raw points.">independent repetition</span>
      </div>
      <div className="rep-key-opts">
        {eligible.map((c) => (
          <label key={c.name}>
            <input type="checkbox" checked={selected.has(c.name)}
              onChange={() => toggle(c.name)} />
            {c.label}
          </label>
        ))}
      </div>
      {selected.size > 0 && (
        <span className="dim rep-key-note">
          n = unique {[...selected].join(" × ")} per group; replicates averaged
        </span>
      )}
    </div>
  );
}
