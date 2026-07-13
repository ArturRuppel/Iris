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

  return (
    <aside className="hierarchy-panel">
      <h3>Data hierarchy</h3>
      <p className="dim hp-hint">
        Mark any column an <b>identifier</b> to nest the data by it (a spine
        level) — a numeric key like time or dose still plots on an axis.
        Everything else is a <b>classifier</b> (a label) or a <b>measure</b>.
        Pick a level later to average away everything finer.
      </p>

      {/* role assignment for every column: identifier on/off, with the natural
          (non-identifier) role named per value type. Identifiers listed first,
          in spine order (coarsest → finest), then classifiers, then measures. */}
      <div className="hp-roles">
        {[...spine, ...cols.filter((c) => !c.identifier).map((c) => c.name)]
          .map((name) => {
            const col = cols.find((c) => c.name === name);
            if (!col) return null;
            const isId = !!col.identifier;
            const naturalRole = col.type === "categorical" ? "classifier" : "measure";
            return (
              <div key={name} className="hp-role-row">
                <span className="hp-col">{labelFor(name)}</span>
                <div className="seg">
                  <button className={isId ? "on" : ""}
                    onClick={() => applyRole(name, true)}>identifier</button>
                  <button className={isId ? "" : "on"}
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

    </aside>
  );
}
