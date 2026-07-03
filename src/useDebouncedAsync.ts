import { useEffect, useRef } from "react";

/* The outcome of one debounced run: a discriminated union so the callbacks can't
   read `value` on a failure or `error` on a success. */
export type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface DebouncedAsyncOptions<T> {
  /* Gate: when false, no run is scheduled (an idle / not-yet-ready state the
     caller settles itself). */
  when: boolean;
  /* Re-dispatch key: a new run is scheduled whenever any dep changes (same array
     semantics as a useEffect dep list — the caller owns its correctness). */
  deps: unknown[];
  /* Debounce delay in ms (default 200). */
  delay?: number;
  /* Fired synchronously at (re)dispatch, before the debounce — e.g. flip a status
     to "running" so a pending change never reads as a freeze. */
  start?: () => void;
  /* The async work. Captured at DISPATCH: whatever it closes over is the
     dispatch-time value, so a result always belongs to the render that scheduled
     it — never "whatever is current when the request returns." */
  run: () => Promise<T>;
  /* ALWAYS runs when the request settles, even if a newer dispatch has since
     superseded this one. Use for id-routed store writes: they land in the entry
     they were computed for, so a late result is still correct. */
  commit?: (outcome: Outcome<T>) => void;
  /* Runs ONLY if this dispatch has not been superseded. Use for GLOBAL status /
     error that must describe the latest work, not a stale one. */
  status?: (outcome: Outcome<T>) => void;
}

/* One debounced-async primitive for the "edit → wait → call the engine → route
   the result" effects. It bakes the subtle rule those effects each re-implemented
   into the callback contract: `commit` always runs (id-routed writes are safe
   late), `status` only if still fresh (global status must not be clobbered by a
   superseded run). The freshness flag lives in the effect cleanup, and the
   callbacks are snapshotted in the effect body so id-capture-at-dispatch can't be
   lost to a later render. */
export function useDebouncedAsync<T>(opts: DebouncedAsyncOptions<T>): void {
  const timer = useRef<number>();
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const { when, deps, delay = 200 } = opts;

  useEffect(() => {
    if (!when) return;
    // Snapshot THIS render's callbacks now (dispatch time). A later render that
    // doesn't move deps updates optsRef but must not change what this pending
    // dispatch does — so we never read optsRef.current inside the timer.
    const { start, run, commit, status } = optsRef.current;
    window.clearTimeout(timer.current);
    start?.();
    let stale = false;
    timer.current = window.setTimeout(async () => {
      let outcome: Outcome<T>;
      try {
        outcome = { ok: true, value: await run() };
      } catch (e) {
        outcome = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      commit?.(outcome);
      if (!stale) status?.(outcome);
    }, delay);
    return () => { stale = true; window.clearTimeout(timer.current); };
    // deps are forwarded verbatim; `when` gates dispatch. exhaustive-deps can't
    // see through the forwarded array, so dep correctness is the caller's job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [when, ...deps]);
}
