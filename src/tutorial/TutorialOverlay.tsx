import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import {
  activePlottableAtom, analysisAtom, effectiveSchemaAtom, plotWizardOpenCountAtom,
  specAtom, viewModeAtom,
} from "../state";
import {
  advanceTutorialAtom, backTutorialAtom, exitTutorialAtom,
  tutorialActiveAtom, tutorialStepAtom,
} from "./state";
import { TUTORIAL_STEPS } from "./steps";
import type { TutorialCtx } from "./types";

/* The tutorial overlay. Mounts at the top of the app, renders only while active.
   It reads the same atoms the reactive triad runs on, evaluates the current step's
   goal against that live state, and gates Next on it. The dim/spotlight layer is
   purely visual — it has pointer-events:none so the real control underneath stays
   clickable (the user genuinely clicks "Workbench", "+ add plot", …). Only the
   coach card captures input. */
export function TutorialOverlay() {
  const active = useAtomValue(tutorialActiveAtom);
  const [index] = useAtom(tutorialStepAtom);
  const advance = useSetAtom(advanceTutorialAtom);
  const back = useSetAtom(backTutorialAtom);
  const exit = useSetAtom(exitTutorialAtom);

  const ctx: TutorialCtx = {
    viewMode: useAtomValue(viewModeAtom),
    plottable: useAtomValue(activePlottableAtom),
    spec: useAtomValue(specAtom),
    schema: useAtomValue(effectiveSchemaAtom),
    analysis: useAtomValue(analysisAtom),
    wizardOpen: useAtomValue(plotWizardOpenCountAtom) > 0,
  };

  const step = TUTORIAL_STEPS[index];
  const [rect, setRect] = useState<DOMRect | null>(null);

  /* Track the spotlight target's box. A light poll (not just resize) keeps the
     cutout aligned through view switches, wizard open/close, and card drags —
     cheap because the overlay only exists during the tutorial. */
  useEffect(() => {
    if (!active) return;
    const measure = () => {
      // Try each candidate anchor in order; the first present in the DOM wins, so
      // the spotlight follows a control that is swapped for another mid-step.
      const names = step?.anchor
        ? (Array.isArray(step.anchor) ? step.anchor : [step.anchor])
        : [];
      let el: Element | null = null;
      for (const name of names) {
        el = document.querySelector(`[data-tour="${name}"]`);
        if (el) break;
      }
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    const id = window.setInterval(measure, 250);
    window.addEventListener("resize", measure);
    return () => { window.clearInterval(id); window.removeEventListener("resize", measure); };
  }, [active, step?.anchor]);

  /* Auto-advance a step that opts in, the moment its goal flips from unmet to met.
     enteredMetRef remembers whether the goal already held on entry, so arriving via
     Back on an already-satisfied step waits for a real Next instead of bouncing on. */
  const enteredMetRef = useRef(false);
  const prevIndexRef = useRef(-1);
  useEffect(() => {
    if (!active || !step) return;
    const met = !step.goal || step.goal(ctx);
    if (prevIndexRef.current !== index) {
      prevIndexRef.current = index;
      enteredMetRef.current = met;
    }
    if (step.autoAdvance && met && !enteredMetRef.current) advance();
  });

  if (!active || !step) return null;

  const goalMet = !step.goal || step.goal(ctx);
  const isLast = index === TUTORIAL_STEPS.length - 1;
  // Keep the card clear of the spotlight: if the target sits in the top half of
  // the viewport, dock the card at the bottom, and vice versa.
  const dockBottom = !rect || rect.top + rect.height / 2 < window.innerHeight / 2;

  return (
    <div className="tutorial-root">
      {rect ? (
        <div
          className="tutorial-spotlight"
          style={{
            top: rect.top - 6, left: rect.left - 6,
            width: rect.width + 12, height: rect.height + 12,
          }}
        />
      ) : (
        <div className="tutorial-spotlight tutorial-spotlight--none" />
      )}

      <div className={`tutorial-card ${dockBottom ? "dock-bottom" : "dock-top"}`}
        role="dialog" aria-label={`Tutorial: ${step.title}`}>
        <div className="tutorial-card-head">
          <span className="tutorial-progress">Step {index + 1} of {TUTORIAL_STEPS.length}</span>
          <button className="tutorial-exit" onClick={exit} title="Exit the tutorial">✕</button>
        </div>
        <h3 className="tutorial-title">{step.title}</h3>
        <div className="tutorial-body">{step.body}</div>
        {step.goal && !goalMet && step.hint && (
          <p className="tutorial-hint">{step.hint}</p>
        )}
        <div className="tutorial-actions">
          <button className="tutorial-back" onClick={back} disabled={index === 0}>Back</button>
          {step.goal && goalMet && <span className="tutorial-done">✓ done</span>}
          <button
            className="tutorial-next primary"
            onClick={advance}
            disabled={!goalMet}
            title={goalMet ? "" : step.hint ?? "Finish this step to continue"}
          >
            {isLast ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
