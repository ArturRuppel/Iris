import type { Schema, Hierarchy, TableHandle } from "./types";

/* One input table in the workspace pool. Each stands alone: the name analyses
   reference (`id`), a human label, its own schema + hierarchy, and its own engine
   session handle. (Was the global schemaAtom/hierarchyAtom/tableHandleAtom.) */
export interface WorkspaceTable {
  id: string;
  name: string;
  schema: Schema;
  hierarchy: Hierarchy;
  handle: TableHandle;
}

export function byId(pool: WorkspaceTable[], id: string | null): WorkspaceTable | null {
  return id ? pool.find((t) => t.id === id) ?? null : null;
}

/* append a new table or replace the one with the same id, preserving order. */
export function upsertTable(pool: WorkspaceTable[], t: WorkspaceTable): WorkspaceTable[] {
  const i = pool.findIndex((x) => x.id === t.id);
  if (i < 0) return [...pool, t];
  const next = pool.slice();
  next[i] = t;
  return next;
}

/* a unique pool id derived from the imported filename (sans extension), suffixed
   on collision. Falls back to table_N when there is no filename. */
export function seedTableName(pool: WorkspaceTable[], filename: string | undefined): string {
  const base = filename ? filename.replace(/\.[^.]+$/, "") : "";
  const used = new Set(pool.map((t) => t.id));
  if (base && !used.has(base)) return base;
  if (!base) { let n = 1; while (used.has(`table_${n}`)) n++; return `table_${n}`; }
  let n = 2; while (used.has(`${base}_${n}`)) n++; return `${base}_${n}`;
}
