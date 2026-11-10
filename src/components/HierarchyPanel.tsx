import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import {
  activeHierarchyAtom, moveSpineAtom, activeSchemaAtom, setColumnRoleAtom, setLevelFnAtom,
  activeHandleAtom,
} from "../state";
import { engine, LEVEL_FNS, type HierarchyInfo, type LevelFn } from "../types";
import { labelForCol } from "../levels";

/* The data hierarchy, defined on the DATA (not per analysis). Any column can be
   an *identifier* (a nesting level on the spine) — the role is orthogonal to the
   value type, so a numeric key like time or dose is an identifier that still
   plots on an axis. A non-identifier column is a *classifier* (a categorical
   qualifier) or a *measure* (numeric). Identifiers form the ordered spine
   (coarsest → finest); classifiers attach at their *home level* — the coarsest
   grain where they stay single-valued. Identifiers ideally jointly key the raw
   table, but a coarse spine over replicate rows (a SuperPlot) is legitimate: the
   engine allows it and just notes, inline below, that there is replication below
   the finest level. */
export function HierarchyPanel() {
  const schema = useAtomValue(activeSchemaAtom);
  const hierarchy = useAtomValue(activeHierarchyAtom);
  const handle = useAtomValue(activeHandleAtom);
  const setRole = useSetAtom(setColumnRoleAtom);
  const moveSpine = useSetAtom(moveSpineAtom);
  const setLevelFn = useSetAtom(setLevelFnAtom);
  const [info, setInfo] = useState<HierarchyInfo | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [roleWarning, setRoleWarning] = useState<string | null>(null);
  const timer = useRef<number>();

  const cols = schema?.columns ?? [];
  // classifiers = categorical qualifiers (non-identifier); they drive the home-
  // level preview fetch below.
  const classifiers = cols.filter((c) => c.type === "categorical" && !c.identifier);
  const spine = hierarchy.spine;

  // toggle a column's identifier role. The change always applies (non-unique
  // identifiers are allowed); when they don't jointly key the table the engine
  // returns a note about replication below the finest level, surfaced inline. A
  // genuine failure (e.g. the column vanished) still throws and shows as an error.
  async function applyRole(name: string, identifier: boolean) {
    setRoleError(null);
    setRoleWarning(null);
    try {
      setRoleWarning((await setRole({ name, identifier })) ?? null);
    } catch (e) {
      setRoleError(e instanceof Error ? e.message : String(e));
    }
  }

  /* fetch home levels + grain cardinalities whenever the spine or the set of
     classifiers changes (debounced). Resolves the table by its session id. */
  const key = JSON.stringify([spine, classifiers.map((c) => c.name)]);
  useEffect(() => {
    if (!handle) return;
    window.clearTimeout(timer.current);
    // the debounce timer cancels a not-yet-fired fetch, but not one already
    // awaiting; a stale flag drops a superseded response so an out-of-order
    // resolve can't overwrite fresher info.
    let stale = false;
    timer.current = window.setTimeout(async () => {
      try {
        const res = await engine.hierarchy({ token: handle.id }, spine, classifiers.map((c) => c.name));
        if (!stale) setInfo(res);
      } catch { /* preview only; ignore transient errors */ }
    }, 200);
    return () => { stale = true; window.clearTimeout(timer.current); };
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

  // every column once: the nesting levels first (coarsest → finest), then the
  // rest in table order. A column on the spine counts as an identifier even if
  // its schema flag is missing (a file written by an older build or by a script).
  const onSpine = new Set(spine);
  const roleOrder = [
    ...spine.filter((n) => cols.some((c) => c.name === n)),
    ...cols.filter((c) => !onSpine.has(c.name)).map((c) => c.name),
  ];

  return (
    <aside className="hierarchy-panel">
      <h3>Data hierarchy</h3>

      {/* the nesting leads: it is the one picture of how the rows are organised,
          and what the roles below exist to produce */}
      {spine.length > 0 ? (
        <div className="hp-viz">
          <div className="hp-viz-head">Nesting, coarse → fine</div>
          <ol className="hp-tree">
            {spine.map((s, i) => (
              <li key={s} className="hp-node">
                <span className="hp-rail" aria-hidden>
                  <span className="hp-dot" />
                </span>
                <span className="hp-node-body">
                  <span className="hp-level">
                    <span className="hp-level-name" title={labelFor(s)}>{labelFor(s)}</span>
                    {nGroups(s) != null && (
                      <span className="hp-count"
                        title={`${nGroups(s)!.toLocaleString()} distinct at this level`}>
                        {nGroups(s)!.toLocaleString()}</span>
                    )}
                    <select className="hp-fn" value={hierarchy.fn[s] ?? "mean"}
                      title={`How finer rows collapse into a ${labelFor(s)}`}
                      aria-label={`How finer rows collapse into a ${labelFor(s)}`}
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
          <p className="dim hp-hint">
            The number is how many there are at that level. A plot or a test that
            works at a level combines the finer rows with the function beside it.
          </p>
        </div>
      ) : cols.length > 0 && (
        <p className="hp-empty">
          No nesting yet: every row counts as one independent observation. If
          rows belong to experiments, animals or cells, mark those columns as
          identifiers below.
        </p>
      )}

      {/* role assignment for every column: identifier on/off, with the natural
          (non-identifier) role named per value type */}
      <div className="hp-viz-head hp-roles-head">Column roles</div>
      <dl className="hp-legend">
        <dt>identifier</dt><dd>which unit a row belongs to: experiment, animal, cell, time point</dd>
        <dt>classifier</dt><dd>a label that describes a unit: condition, genotype</dd>
        <dt>measure</dt><dd>a number you measured</dd>
      </dl>
      <div className="hp-roles">
        {roleOrder.map((name) => {
          const col = cols.find((c) => c.name === name);
          if (!col) return null;
          const isId = !!col.identifier || onSpine.has(name);
          const naturalRole = col.type === "categorical" ? "classifier" : "measure";
          return (
            <div key={name} className="hp-role-row">
              <span className="hp-col" title={labelFor(name)}>{labelFor(name)}</span>
              <div className="seg">
                <button className={isId ? "on" : ""} aria-pressed={isId}
                  onClick={() => applyRole(name, true)}>identifier</button>
                <button className={isId ? "" : "on"} aria-pressed={!isId}
                  onClick={() => applyRole(name, false)}>{naturalRole}</button>
              </div>
            </div>
          );
        })}
        {cols.length === 0 && (
          <p className="rail-empty">No columns to organize.</p>
        )}
      </div>
      {roleError && <p className="hp-role-error error-bar">{roleError}</p>}
      {roleWarning && <p className="hp-role-warning error-bar warn-bar">{roleWarning}</p>}
    </aside>
  );
}
