import type { ReactNode } from "react";
import type { Plottable } from "../state";
import type { AnalysisSpec, AnalyzeResponse, Schema } from "../types";

/* The interactive tutorial drives the REAL app and advances on real application
   state — never on DOM clicks. A step's `goal` is a pure predicate over this
   snapshot, assembled from the same atoms the reactive triad runs on; the coach
   card's Next stays disabled until it holds. So a step teaching "map the value to
   Y" cannot be skipped without actually doing it. See the design doc:
   docs/superpowers/specs/2026-07-11-interactive-tutorial-design.md */

export type TutorialView = "data" | "workbench";

export interface TutorialCtx {
  viewMode: "data" | "workbench" | "guide";
  plottable: Plottable | null;
  spec: AnalysisSpec | null;
  schema: Schema | null;              // effective (post-reduction) schema, for colType
  analysis: AnalyzeResponse | null;
}

export interface TutorialStep {
  id: string;
  title: string;
  body: ReactNode;                    // the coach-card prose
  /* Force this view when the step is entered. Omit for a step whose task IS to
     navigate (the workbench-open step), so the overlay never fights the user. */
  view?: TutorialView;
  /* data-tour value(s) to spotlight (optional). An array names candidates tried
     in order — the first present in the DOM wins — so a step can follow a control
     that gets replaced by another (the "+ add plot" button becoming the wizard)
     without the spotlight collapsing when the first one unmounts. */
  anchor?: string | string[];
  /* Next is gated until this returns true. Omit for observational steps (Next
     always enabled). We never auto-advance on a met goal — that would skip past
     prose the user hasn't read; we enable Next instead. */
  goal?: (ctx: TutorialCtx) => boolean;
  hint?: string;                      // nudge shown while the goal is unmet
}
