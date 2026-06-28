import type { AnalysisSpec, Schema } from "../types";
import { isSpecRenderable } from "../state";

export interface HeroCardStates {
  tableEnabled: boolean;
  plotEnabled: boolean;
  statsEnabled: boolean;
}

/* Which of the three hero cards are live. Table is always enabled (a source table
   always exists). Plot is enabled exactly when the live spec is renderable — a Y
   mapping, ≥1 layer, and mapped axes that survive the schema (isSpecRenderable, the
   same gate the render loop uses). Stats follows Plot: there is nothing to test
   without a rendered figure. Kept pure so the rule is unit-tested and the component
   is a thin reader. */
export function heroCardStates(spec: AnalysisSpec | null, schema: Schema | null): HeroCardStates {
  const plotEnabled = spec ? isSpecRenderable(spec, schema) : false;
  return { tableEnabled: true, plotEnabled, statsEnabled: plotEnabled };
}
