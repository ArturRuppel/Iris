import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebouncedAsync } from "./useDebouncedAsync";

/* A promise whose settlement the test controls — lets us hold a run "in flight"
   across a supersession, then resolve it after the newer dispatch exists. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("useDebouncedAsync", () => {
  it("fires start synchronously, then commit + status on success after the debounce", async () => {
    const start = vi.fn(), commit = vi.fn(), status = vi.fn();
    renderHook(() => useDebouncedAsync({
      when: true, deps: [1], delay: 200,
      start, run: async () => "v1", commit, status,
    }));
    expect(start).toHaveBeenCalledTimes(1);   // synchronous, at dispatch
    expect(commit).not.toHaveBeenCalled();    // still inside the debounce window
    expect(status).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(commit).toHaveBeenCalledWith({ ok: true, value: "v1" });
    expect(status).toHaveBeenCalledWith({ ok: true, value: "v1" });
  });

  it("maps a thrown run to an { ok: false, error } outcome", async () => {
    const commit = vi.fn(), status = vi.fn();
    renderHook(() => useDebouncedAsync({
      when: true, deps: [1], delay: 200,
      run: async () => { throw new Error("boom"); }, commit, status,
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(commit).toHaveBeenCalledWith({ ok: false, error: "boom" });
    expect(status).toHaveBeenCalledWith({ ok: false, error: "boom" });
  });

  it("does not dispatch while `when` is false", async () => {
    const start = vi.fn(), commit = vi.fn();
    renderHook(() => useDebouncedAsync({
      when: false, deps: [1], delay: 200, start, run: async () => "v", commit,
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(start).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("debounces: rapid dep changes coalesce to a single run", async () => {
    const run = vi.fn(async () => "x");
    const { rerender } = renderHook(
      (p: Parameters<typeof useDebouncedAsync>[0]) => useDebouncedAsync(p),
      { initialProps: { when: true, deps: [1], delay: 200, run } },
    );
    rerender({ when: true, deps: [2], delay: 200, run });
    rerender({ when: true, deps: [3], delay: 200, run });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(run).toHaveBeenCalledTimes(1);   // only the last dispatch's timer survived
  });

  it("a superseded in-flight run still commits, but does not update status", async () => {
    const d1 = deferred<string>();
    const commit1 = vi.fn(), status1 = vi.fn();
    const { rerender } = renderHook(
      (p: Parameters<typeof useDebouncedAsync>[0]) => useDebouncedAsync(p),
      { initialProps: {
        when: true, deps: [1], delay: 200,
        run: () => d1.promise, commit: commit1, status: status1,
      } },
    );
    // fire dispatch-1's timer: run-1 is now awaiting (in flight, unresolved)
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(commit1).not.toHaveBeenCalled();

    // supersede with dispatch-2 (deps changed) before run-1 settles
    const d2 = deferred<string>();
    const commit2 = vi.fn(), status2 = vi.fn();
    rerender({
      when: true, deps: [2], delay: 200,
      run: () => d2.promise, commit: commit2, status: status2,
    });

    // now let the stale run-1 resolve
    await act(async () => { d1.resolve("v1"); await d1.promise; });
    expect(commit1).toHaveBeenCalledWith({ ok: true, value: "v1" });   // id-routed write still lands
    expect(status1).not.toHaveBeenCalled();                            // stale → global status untouched

    // dispatch-2 completes normally and owns the status
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await act(async () => { d2.resolve("v2"); await d2.promise; });
    expect(commit2).toHaveBeenCalledWith({ ok: true, value: "v2" });
    expect(status2).toHaveBeenCalledWith({ ok: true, value: "v2" });
  });

  it("uses the callbacks captured at dispatch, not a later same-deps re-render's", async () => {
    const commitA = vi.fn();
    const { rerender } = renderHook(
      (p: Parameters<typeof useDebouncedAsync>[0]) => useDebouncedAsync(p),
      { initialProps: {
        when: true, deps: [1], delay: 200, run: async () => "vA", commit: commitA,
      } },
    );
    // same deps → no re-dispatch; the pending timer must keep its dispatch-time closure
    const commitB = vi.fn();
    rerender({ when: true, deps: [1], delay: 200, run: async () => "vB", commit: commitB });

    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(commitA).toHaveBeenCalledWith({ ok: true, value: "vA" });   // dispatch-time run + callback
    expect(commitB).not.toHaveBeenCalled();
  });
});
