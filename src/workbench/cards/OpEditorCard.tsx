import { useAtomValue, useSetAtom } from "jotai";
import {
  activePlottableAtom, reducePreviewAtom, schemaAtom, updateStepAtom,
} from "../../state";
import { explorerGraphAtom } from "../../explorer/graphAtom";
import type { ExplorerGraph } from "../../explorer/graph";
import type {
  ColumnDef, ReduceStep,
  DropStep, FilterStep, DeriveStep, RecodeStep,
  JoinStep, PivotStep, GridCompleteStep,
} from "../../types";
import { StepDrop, StepFilter } from "../../components/StepCards";
import { StepDerive } from "../../components/StepDerive";
import { StepRecode } from "../../components/StepRecode";
import { StepJoin } from "../../components/StepJoin";
import { StepPivot } from "../../components/StepPivot";
import { StepGridComplete } from "../../components/StepGridComplete";
import type { CardBodyProps } from "../cardRegistry";

/* The clicked reduce-step edge feeds a reduce-phase node carrying its step index
   (see explorer/graph.ts). Resolve that index from the edge's target node; null
   if the edge isn't a step edge (or isn't in the graph) — a stale selection after
   a structural change. */
export function edgeIdToStepIndex(graph: ExplorerGraph, edgeId: string): number | null {
  const edge = graph.edges.find((e) => e.id === edgeId);
  if (!edge) return null;
  const node = graph.nodes.find((n) => n.id === edge.toId);
  return node?.phase === "reduce" ? node.stepIndex ?? null : null;
}

const stale = (
  <div className="txw-card-stub" data-testid="op-editor-card">
    This step is no longer in the pipeline.
  </div>
);

/* The op editor: edits the reduce step behind a clicked step-edge. Reads the
   index from the edge, the step from the active analysis, and routes to the
   matching inline editor — persisting edits through updateStepAtom. */
export function OpEditorCard({ target }: CardBodyProps) {
  const graph = useAtomValue(explorerGraphAtom);
  const active = useAtomValue(activePlottableAtom);
  const preview = useAtomValue(reducePreviewAtom);
  const schema = useAtomValue(schemaAtom);
  const updateStep = useSetAtom(updateStepAtom);

  if (!graph || !active || !schema) return stale;
  const index = edgeIdToStepIndex(graph, target.id);
  if (index == null || index >= active.reduce.steps.length) return stale;

  /* input columns at step `index` = the previous step's output schema (from the
     live /reduce trace), or the master schema for the first step. */
  const cols: ColumnDef[] = index === 0
    ? schema.columns
    : (preview?.trace[index - 1]?.schema_out?.columns ?? schema.columns);

  const step = active.reduce.steps[index];
  const onChange = (s: ReduceStep) => updateStep({ index, step: s });

  let editor: JSX.Element;
  switch (step.kind) {
    case "drop":
      editor = <StepDrop step={step as DropStep} columns={cols} onChange={onChange} />;
      break;
    case "filter":
      editor = <StepFilter step={step as FilterStep} columns={cols} onChange={onChange} />;
      break;
    case "derive":
      editor = <StepDerive step={step as DeriveStep} columns={cols} onChange={onChange} />;
      break;
    case "recode":
      editor = <StepRecode step={step as RecodeStep} columns={cols} onChange={onChange} />;
      break;
    case "join":
      editor = <StepJoin step={step as JoinStep} columns={cols} onChange={onChange} />;
      break;
    case "pivot":
      editor = <StepPivot step={step as PivotStep} columns={cols} onChange={onChange} />;
      break;
    case "grid_complete":
      editor = <StepGridComplete step={step as GridCompleteStep} columns={cols} onChange={onChange} />;
      break;
    default: {
      const _exhaustive: never = step;
      return _exhaustive;
    }
  }

  return (
    <div className="txw-card-op" data-testid="op-editor-card">
      {editor}
    </div>
  );
}
