import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { TutorialOverlay } from "./TutorialOverlay";
import { tutorialActiveAtom, tutorialStepAtom } from "./state";
import { TUTORIAL_STEPS } from "./steps";
import { viewModeAtom } from "../state";

const WB = TUTORIAL_STEPS.findIndex((s) => s.id === "workbench");

function mount(init: { active?: boolean; step?: number; view?: "data" | "workbench" }) {
  const store = createStore();
  store.set(tutorialActiveAtom, init.active ?? true);
  if (init.step != null) store.set(tutorialStepAtom, init.step);
  if (init.view) store.set(viewModeAtom, init.view);
  render(<Provider store={store}><TutorialOverlay /></Provider>);
  return store;
}

describe("TutorialOverlay", () => {
  it("renders nothing when the tutorial is inactive", () => {
    mount({ active: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the active step's title and progress", () => {
    mount({ step: 0, view: "data" });
    expect(screen.getByText(TUTORIAL_STEPS[0].title)).toBeInTheDocument();
    expect(screen.getByText(`Step 1 of ${TUTORIAL_STEPS.length}`)).toBeInTheDocument();
  });

  it("gates Next on the step goal — disabled until the real state satisfies it", () => {
    mount({ step: WB, view: "data" });          // goal: viewMode === "workbench"
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("enables Next once the goal is met", () => {
    mount({ step: WB, view: "workbench" });
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    expect(screen.getByText(/done/)).toBeInTheDocument();
  });

  it("auto-advances the workbench step when the view flips to workbench", () => {
    const store = mount({ step: WB, view: "data" });     // goal unmet on entry
    expect(store.get(tutorialStepAtom)).toBe(WB);
    act(() => store.set(viewModeAtom, "workbench"));      // the real click's effect
    expect(store.get(tutorialStepAtom)).toBe(WB + 1);     // stepped on, no Next click
  });

  it("does not auto-advance when the workbench step is entered already met (Back)", () => {
    const store = mount({ step: WB, view: "workbench" });
    expect(store.get(tutorialStepAtom)).toBe(WB);         // stays put, waits for Next
  });

  it("leaves Next enabled on an observational step (no goal)", () => {
    mount({ step: 0, view: "data" });
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("labels the last step's action Finish", () => {
    mount({ step: TUTORIAL_STEPS.length - 1, view: "workbench" });
    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
  });

  it("Back is disabled on the first step", () => {
    mount({ step: 0, view: "data" });
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  });

  it("exiting tears the overlay down", () => {
    const store = mount({ step: 0, view: "data" });
    fireEvent.click(screen.getByTitle("Exit the tutorial"));
    expect(store.get(tutorialActiveAtom)).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
