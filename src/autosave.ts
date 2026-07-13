/* Autosave / crash recovery — the client half (design:
   docs/superpowers/specs/2026-07-02-autosave-crash-recovery-design.md).

   The engine owns the on-disk snapshot slot; this module owns WHEN to
   snapshot. Dirtiness is computed from the SOURCE state (plottables + pool
   metadata), not from the built save specs: those jitter without any user
   edit as the recommended test and derived family settle asynchronously
   (renders / reduce previews landing), and keying on them would leave a
   bogus snapshot — and a bogus launch-time restore offer — after a plain
   load-and-quit. */
import type { Plottable, SharedPipeline } from "./state";
import type { WorkspaceTable } from "./tables";
import type { ReduceStep, ReduceStepNode } from "./types";

/* session-only fields that must not count as unsaved work: a step's React
   list key is regenerated every load. */
const stripStep = (s: ReduceStep) => {
  const { _key, ...rest } = s as ReduceStep & { _key?: string };
  void _key;
  return rest;
};

/* the steps upstream-reachable from a plottable's `output` — a local mirror of
   state's reachableFrom, duplicated here so autosave keeps NO runtime dependency
   on state.ts (which imports this module — importing back would form a cycle).
   Fingerprinting the reachable branch, not the whole shared pool, means a
   lingering orphaned node (e.g. left in the pool after an add-then-undo, or a
   sibling analysis's disjoint branch) never registers as unsaved work for this
   plottable — the key tracks exactly what this analysis would serialize. */
function reachable(steps: ReduceStepNode[], output: string): ReduceStepNode[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const keep = new Set<string>();
  const stack = [output];
  while (stack.length) {
    const id = stack.pop()!;
    if (keep.has(id) || !byId.has(id)) continue;
    keep.add(id);
    for (const i of byId.get(id)!.inputs) stack.push(i);
  }
  return steps.filter((s) => keep.has(s.id));
}

/** The semantic identity of everything a snapshot would persist. Equal keys
 *  mean "nothing worth snapshotting changed"; the autosave loop compares this
 *  against the baseline captured at load / explicit save. The reduce pipeline is
 *  table-scoped (Stage 2): each plottable's branch is projected out of its
 *  table's shared pool by output-reachability, so the key mirrors the saved bytes. */
export function snapshotStateKey(
  plottables: Plottable[], tables: WorkspaceTable[],
  store: Record<string, SharedPipeline>): string {
  return JSON.stringify({
    plottables: plottables.map((p) => ({
      ...p,
      reduce: {
        steps: reachable(store[p.tableId]?.steps ?? [], p.output).map(stripStep),
        post: p.post?.map(stripStep) ?? null,
      },
    })),
    tables: tables.map((t) => ({
      id: t.id, name: t.name, schema: t.schema, hierarchy: t.hierarchy,
      session: t.handle.id, version: t.handle.version,
    })),
  });
}

/** The data tier's identity: which tables exist and which engine-session
 *  state backs each. Unchanged fingerprint ⇒ the engine skips re-serializing
 *  the (potentially huge) table data and only rewrites the spec sidecar. A
 *  session version bump (cell edit, schema retype) or a pool change (import,
 *  load) moves it; spec/style/hierarchy-order edits do not. */
export function dataFingerprint(tables: WorkspaceTable[]): string {
  return JSON.stringify(tables.map((t) => [t.id, t.handle.id, t.handle.version]));
}
