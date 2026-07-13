import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  // The coach card's own height, measured live, so we can dock it clear of the
  // spotlight with a real gap instead of guessing from a fixed offset.
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [cardH, setCardH] = useState(0);
  // The spotlight tracks its target 1:1 every frame (no lag), and only *glides*
  // during the brief window right after it jumps to a new target — see below.
  const [gliding, setGliding] = useState(false);

  /* Track the spotlight target's box. A per-frame measure (rAF) keeps the cutout
     glued to its target through view switches, wizard open/close, scroll and card
     drags — cheap because the overlay only exists during the tutorial. We only
     re-render when the box actually moved, so a static target costs nothing. */
  const rectRef = useRef<DOMRect | null>(null);
  const lastElRef = useRef<Element | null>(null);
  const rafRef = useRef<number | null>(null);
  const glideTimerRef = useRef<number | null>(null);
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

      // Glide only when hopping between two present targets (a step change or a
      // mid-step control swap). Snapping in/out of nothing avoids animating from a
      // stale position; tracking a *moving* same target stays lag-free (no glide).
      if (el && lastElRef.current && el !== lastElRef.current) {
        setGliding(true);
        if (glideTimerRef.current != null) window.clearTimeout(glideTimerRef.current);
        glideTimerRef.current = window.setTimeout(() => setGliding(false), 340);
      }
      lastElRef.current = el;

      const next = el ? el.getBoundingClientRect() : null;
      const prev = rectRef.current;
      const moved = !prev || !next
        ? prev !== next
        : prev.top !== next.top || prev.left !== next.left
          || prev.width !== next.width || prev.height !== next.height;
      if (moved) { rectRef.current = next; setRect(next); }

      rafRef.current = requestAnimationFrame(measure);
    };
    measure();
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      if (glideTimerRef.current != null) window.clearTimeout(glideTimerRef.current);
    };
  }, [active, step?.anchor]);

  // Is the current step's goal satisfied right now? Computed once per render and
  // reused by both the auto-advance logic and the Next button's gating.
  const met = !step?.goal || step.goal(ctx);

  /* Auto-advance a step that opts in, the moment its goal flips from unmet to met.
     enteredMetRef remembers whether the goal already held on entry, so arriving via
     Back on an already-satisfied step waits for a real Next instead of bouncing on.
     The deps are deliberately just [index, met, …]: this decision must react only to
     a real goal flip or a step change, never to the overlay's own cosmetic re-renders
     (spotlight tracking, card measuring), which would otherwise re-run it every frame
     and could fire on a transient during a view-switch recompile. */
  const enteredMetRef = useRef(false);
  const prevIndexRef = useRef(-1);
  useEffect(() => {
    if (!active || !step) return;
    if (prevIndexRef.current !== index) {
      prevIndexRef.current = index;
      enteredMetRef.current = met;   // baseline for this step; never advance on entry
      return;
    }
    if (step.autoAdvance && met && !enteredMetRef.current) advance();
  }, [active, index, met, step, advance]);

  // Keep the measured card height in sync with its content (varies per step, and
  // when a hint appears). Runs after layout, updates only on a real change.
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight ?? 0;
    if (h && h !== cardH) setCardH(h);
  });

  if (!active || !step) return null;

  const goalMet = met;
  const isLast = index === TUTORIAL_STEPS.length - 1;
  // Dock the card clear of the spotlight with a real gap, keyed off the target's
  // actual edges and the card's own height (not a fixed offset). Prefer below the
  // target, fall back to above, and if neither half fits use the roomier one.
  const cardTop = (() => {
    const GAP = 16, EDGE = 12;
    const vh = window.innerHeight;
    if (!rect) return vh - cardH - 24; // no target: dock bottom
    const below = vh - rect.bottom, above = rect.top;
    const fitsBelow = below >= cardH + GAP;
    const dockAbove = !fitsBelow && above > below;
    return dockAbove
      ? Math.max(EDGE, rect.top - GAP - cardH)
      : Math.min(rect.bottom + GAP, vh - cardH - EDGE);
  })();

  return (
    <div className="tutorial-root">
      {rect ? (
        <div
          className={`tutorial-spotlight${gliding ? " gliding" : ""}`}
          style={{
            top: rect.top - 6, left: rect.left - 6,
            width: rect.width + 12, height: rect.height + 12,
          }}
        />
      ) : (
        <div className="tutorial-spotlight tutorial-spotlight--none" />
      )}

      <div className="tutorial-card" ref={cardRef} style={{ top: cardTop }}
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
