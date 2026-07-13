import { useAtomValue, useSetAtom } from "jotai";
import {
  activePlottableAtom, activeReduceDagAtom, reducePreviewAtom, schemaAtom, tablesAtom, updateStepAtom,
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

/* a clicked edge may belong to the post-collapse phase, which this card can't
   edit (only a loaded .iris carries one today) — the stub must say so honestly
   rather than claim the step is gone. */
export function edgeIsPostStep(graph: ExplorerGraph, edgeId: string): boolean {
  const edge = graph.edges.find((e) => e.id === edgeId);
  const node = edge && graph.nodes.find((n) => n.id === edge.toId);
  return node?.phase === "post";
}

const stale = (
  <div className="txw-card-stub" data-testid="op-editor-card">
    This step is no longer in the pipeline.
  </div>
);

const postStub = (
  <div className="txw-card-stub" data-testid="op-editor-card">
    Post-aggregate steps aren’t editable here yet.
  </div>
);

/* The op editor: edits the reduce step behind a clicked step-edge. Reads the
   index from the edge, the step from the active analysis, and routes to the
   matching inline editor — persisting edits through updateStepAtom. */
export function OpEditorCard({ target }: CardBodyProps) {
  const graph = useAtomValue(explorerGraphAtom);
  const active = useAtomValue(activePlottableAtom);
  const activeDag = useAtomValue(activeReduceDagAtom);
  const preview = useAtomValue(reducePreviewAtom);
  const schema = useAtomValue(schemaAtom);
  const tables = useAtomValue(tablesAtom);
  const updateStep = useSetAtom(updateStepAtom);

  if (!graph || !active || !activeDag || !schema) return stale;
  if (edgeIsPostStep(graph, target.id)) return postStub;
  const index = edgeIdToStepIndex(graph, target.id);
  if (index == null || index >= activeDag.steps.length) return stale;

  /* input columns at step `index` = the previous step's output schema (from the
     live /reduce trace), or the master schema for the first step. */
  const cols: ColumnDef[] = index === 0
    ? schema.columns
    : (preview?.trace[index - 1]?.schema_out?.columns ?? schema.columns);

  const step = activeDag.steps[index];
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
    case "join": {
      // the right-table candidates: every OTHER pool table (joining the
      // analysis's own main table back onto itself is engine-expressible but
      // not a GUI-authorable shape — offering it would only invite confusion).
      const rightPool = tables
        .filter((t) => t.id !== active.tableId)
        .map((t) => ({ id: t.id, name: t.name, schema: t.schema }));
      editor = (
        <StepJoin step={step as JoinStep} columns={cols} pool={rightPool} onChange={onChange} />
      );
      break;
    }
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
