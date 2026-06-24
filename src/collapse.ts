import type { CollapsePlan, GrainKey, LevelFn } from "./types";

/* The forced chain as a plan: full-spine prefix chain, finest -> coarsest. Step i
   keeps the prefix spine[0..i) for i = len down to 1; fn from the finest kept dim. */
export function defaultPlan(spine: string[], fn: Record<string, LevelFn>): CollapsePlan {
  const steps: CollapsePlan = [];
  for (let i = spine.length; i >= 1; i--) {
    const keep = spine.slice(0, i);
    steps.push({ keep, fn: fn[keep[keep.length - 1]] ?? "mean" });
  }
  return steps;
}

export function grainKey(keep: string[]): GrainKey {
  return keep.join("/");
}

/* Raw grain ("") followed by each step's grain key, in plan order. */
export function planGrains(plan: CollapsePlan): GrainKey[] {
  return ["", ...plan.map((s) => grainKey(s.keep))];
}
