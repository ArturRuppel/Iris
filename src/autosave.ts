/* Autosave / crash recovery — the client half (design:
   docs/superpowers/specs/2026-07-02-autosave-crash-recovery-design.md).

   The engine owns the on-disk snapshot slot; this module owns WHEN to
   snapshot. Dirtiness is computed from the SOURCE state (plottables + pool
   metadata), not from the built save specs: those jitter without any user
   edit as the recommended test and derived family settle asynchronously
   (renders / reduce previews landing), and keying on them would leave a
   bogus snapshot — and a bogus launch-time restore offer — after a plain
   load-and-quit. */
import type { Plottable } from "./state";
import type { WorkspaceTable } from "./tables";
import type { ReduceStep } from "./types";

/* session-only fields that must not count as unsaved work: a step's React
   list key is regenerated every load. */
const stripStep = (s: ReduceStep) => {
  const { _key, ...rest } = s as ReduceStep & { _key?: string };
  void _key;
  return rest;
};

/** The semantic identity of everything a snapshot would persist. Equal keys
 *  mean "nothing worth snapshotting changed"; the autosave loop compares this
 *  against the baseline captured at load / explicit save. */
export function snapshotStateKey(
  plottables: Plottable[], tables: WorkspaceTable[]): string {
  return JSON.stringify({
    plottables: plottables.map((p) => ({
      ...p,
      reduce: {
        steps: p.reduce.steps.map(stripStep),
        post: p.reduce.post?.map(stripStep) ?? null,
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
