/* Pure step sequencing for the add-plot wizard (PlotWizard.tsx). Two modes:
   - "first": the figure has no layers yet, so we pick a geom then map the shared
     figure-level encoding (X/Y required, Color/Shape/Size/Facet optional).
   - "addLayer": the figure already has an encoding, so a new layer only chooses a
     geom and a grain/level; X/Y and the aesthetics are inherited read-only.
   "done" closes the wizard. The component owns whether a step may advance (e.g.
   X & Y both mapped); this module owns only the ORDER. */
export type WizardMode = "first" | "addLayer";
export type WizardStep = "type" | "map" | "grain" | "done";

export function firstStep(_mode: WizardMode): WizardStep {
  return "type";
}

export function nextStep(mode: WizardMode, step: WizardStep): WizardStep {
  if (step === "type") return mode === "first" ? "map" : "grain";
  return "done";
}
