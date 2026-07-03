import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import {
  activeHierarchyAtom, moveSpineAtom, activeSchemaAtom, setColumnRoleAtom, setLevelFnAtom,
  activeHandleAtom,
} from "../state";
import { engine, LEVEL_FNS, type HierarchyInfo, type LevelFn } from "../types";
import { labelForCol } from "../levels";

/* The data hierarchy, defined on the DATA (not per analysis). Every non-numeric
   column is either an *identifier* (a nesting level on the spine) or a
   *classifier* (a categorical qualifier). Identifiers form the ordered spine
   (coarsest → finest); classifiers attach at their *home level* — the coarsest
   grain where they stay single-valued (class_label at the cell level, condition
   at the date level). The visualization makes that attachment visible. */
export function HierarchyPanel() {
  const schema = useAtomValue(activeSchemaAtom);
  const hierarchy = useAtomValue(activeHierarchyAtom);
  const handle = useAtomValue(activeHandleAtom);
  const setRole = useSetAtom(setColumnRoleAtom);
  const moveSpine = useSetAtom(moveSpineAtom);
  const setLevelFn = useSetAtom(setLevelFnAtom);
  const [info, setInfo] = useState<HierarchyInfo | null>(null);
  const timer = useRef<number>();

  const classifiers = (schema?.columns ?? []).filter((c) => c.type === "categorical");
  const measures = (schema?.columns ?? []).filter(
    (c) => c.type === "numeric" || c.type === "bool");
  const spine = hierarchy.spine;

  /* fetch home levels + grain cardinalities whenever the spine or the set of
     classifiers changes (debounced). Resolves the table by its session id. */
  const key = JSON.stringify([spine, classifiers.map((c) => c.name)]);
  useEffect(() => {
    if (!handle) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        setInfo(await engine.hierarchy({ token: handle.id }, spine, classifiers.map((c) => c.name)));
      } catch { /* preview only; ignore transient errors */ }
    }, 200);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle?.id, handle?.version, key]);

  if (!schema) return null;
  const labelFor = (name: string) => labelForCol(schema, name);
  const nGroups = (lvl: string) =>
    info?.levels.find((l) => l.name === lvl)?.n_groups;
  const homeOf = (name: string) =>
    info?.classifiers.find((c) => c.name === name)?.home ?? null;
  // classifiers with an unknown home (or home not in the current spine) float free
  const attachedAt = (lvl: string) =>
    classifiers.filter((c) => homeOf(c.name) === lvl);
  const floating = classifiers.filter((c) => {
    const h = homeOf(c.name);
    return h === null || !spine.includes(h);
  });

  return (
    <aside className="hierarchy-panel">
      <h3>Data hierarchy</h3>
      <p className="dim hp-hint">
        Assign every category a role: an <b>identifier</b> nests the data (a spine
        level), a <b>classifier</b> labels it. Pick a level later to average away
        everything finer.
      </p>

      {/* role assignment for every non-numeric column */}
      <div className="hp-roles">
        {[...spine.map((s) => ({ name: s, type: "identifier" as const })),
          ...classifiers.map((c) => ({ name: c.name, type: "categorical" as const }))]
          .map(({ name, type }) => (
            <div key={name} className="hp-role-row">
              <span className="hp-col">{labelFor(name)}</span>
              <div className="seg">
                <button className={type === "identifier" ? "on" : ""}
                  onClick={() => setRole({ name, role: "identifier" })}>identifier</button>
                <button className={type === "categorical" ? "on" : ""}
                  onClick={() => setRole({ name, role: "classifier" })}>classifier</button>
              </div>
            </div>
          ))}
        {classifiers.length === 0 && spine.length === 0 && (
          <p className="rail-empty">No categorical columns to organize.</p>
        )}
      </div>

      {/* the visualization: spine (vertical) with classifiers branching at home */}
      {spine.length > 0 && (
        <div className="hp-viz">
          <div className="hp-viz-head">nesting (coarse → fine)</div>
          <ol className="hp-tree">
            {spine.map((s, i) => (
              <li key={s} className="hp-node">
                <span className="hp-rail" aria-hidden>
                  <span className="hp-dot" />
                </span>
                <span className="hp-node-body">
                  <span className="hp-level">
                    <span className="hp-level-name">{labelFor(s)}</span>
                    {nGroups(s) != null && (
                      <span className="hp-count">{nGroups(s)!.toLocaleString()}</span>
                    )}
                    <select className="hp-fn" value={hierarchy.fn[s] ?? "mean"}
                      title={`How finer rows collapse into a ${labelFor(s)}`}
                      onChange={(e) => setLevelFn({ level: s, fn: e.target.value as LevelFn })}>
                      {LEVEL_FNS.map((fn) => <option key={fn} value={fn}>{fn}</option>)}
                    </select>
                    <span className="hp-move">
                      <button className="icon" title="Coarser" disabled={i === 0}
                        onClick={() => moveSpine({ index: i, dir: -1 })}>↑</button>
                      <button className="icon" title="Finer" disabled={i === spine.length - 1}
                        onClick={() => moveSpine({ index: i, dir: 1 })}>↓</button>
                    </span>
                  </span>
                  {attachedAt(s).length > 0 && (
                    <span className="hp-branches">
                      {attachedAt(s).map((c) => (
                        <span key={c.name} className="hp-branch" title={`${c.label} is constant within a ${labelFor(s)}`}>
                          {c.label}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
          {floating.length > 0 && (
            <div className="hp-floating">
              unattached: {floating.map((c) => c.label).join(", ")}
              <span className="dim"> (varies within every level — add the column it nests under to the spine)</span>
            </div>
          )}
        </div>
      )}

      {measures.length > 0 && (
        <p className="dim hp-measures">{measures.length} numeric measure
          {measures.length === 1 ? "" : "s"}</p>
      )}
    </aside>
  );
}
