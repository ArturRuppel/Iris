import { atom } from "jotai";
import { viewModeAtom } from "../state";
import { TUTORIAL_STEPS } from "./steps";

/* Session-only tutorial state — never serialized into a .iris. The overlay
   (TutorialOverlay) reads these; App.handleStartTutorial seeds the table first,
   then fires startTutorialAtom. Landing on a step forces the step's `view` when it
   declares one, so an observational step opens in the right place, while the
   workbench-open step (no `view`) leaves navigation to the user. */

export const tutorialActiveAtom = atom(false);
export const tutorialStepAtom = atom(0);

export const startTutorialAtom = atom(null, (_get, set) => {
  set(tutorialStepAtom, 0);
  set(tutorialActiveAtom, true);
  const v = TUTORIAL_STEPS[0]?.view;
  if (v) set(viewModeAtom, v);
});

export const exitTutorialAtom = atom(null, (_get, set) => {
  set(tutorialActiveAtom, false);
});

export const advanceTutorialAtom = atom(null, (get, set) => {
  const i = get(tutorialStepAtom);
  if (i >= TUTORIAL_STEPS.length - 1) {   // last step → Finish leaves them in place
    set(tutorialActiveAtom, false);
    return;
  }
  const next = i + 1;
  set(tutorialStepAtom, next);
  const v = TUTORIAL_STEPS[next]?.view;
  if (v) set(viewModeAtom, v);
});

export const backTutorialAtom = atom(null, (get, set) => {
  const i = get(tutorialStepAtom);
  if (i <= 0) return;
  const prev = i - 1;
  set(tutorialStepAtom, prev);
  const v = TUTORIAL_STEPS[prev]?.view;
  if (v) set(viewModeAtom, v);
});
