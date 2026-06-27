import { useAtomValue, useSetAtom } from "jotai";
import { tablesAtom, activeTableIdAtom } from "../state";

/* The Data tab's pool selector: a labeled list of the input tables, with the
   active one marked. Clicking a row makes that table active. The Data-tab
   editors (HierarchyPanel, DataTable) read whichever table is active. */
export function TableList() {
  const tables = useAtomValue(tablesAtom);
  const activeId = useAtomValue(activeTableIdAtom);
  const setActiveId = useSetAtom(activeTableIdAtom);
  if (tables.length === 0) return null;
  return (
    <nav className="table-list" aria-label="Input tables">
      <div className="table-list-head">Tables</div>
      {tables.map((t) => {
        const isActive = t.id === activeId;
        return (
          <button key={t.id} type="button"
            className={isActive ? "table-list-item is-active" : "table-list-item"}
            aria-current={isActive}
            title={t.name}
            onClick={() => setActiveId(t.id)}>
            {t.name}
          </button>
        );
      })}
    </nav>
  );
}
