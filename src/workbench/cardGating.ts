import type { AnalysisSpec, Schema } from "../types";
import { isSpecRenderable } from "../state";

export interface DataCardStates {
  plotEnabled: boolean;
  statsEnabled: boolean;
}

/* Which of the three canonical data cards are live. The table card is always
   live (a source table always exists), so only Plot and Stats are gated here.
   Plot is enabled exactly when the live spec is renderable — a Y mapping, ≥1
   layer, and mapped axes that survive the schema (isSpecRenderable, the same
   gate the render loop uses). Stats follows Plot: there is nothing to test
   without a rendered figure. Kept pure so the rule is unit-tested and the card
   bodies are thin readers. */
export function dataCardStates(spec: AnalysisSpec | null, schema: Schema | null): DataCardStates {
  const plotEnabled = spec ? isSpecRenderable(spec, schema) : false;
  return { plotEnabled, statsEnabled: plotEnabled };
}
