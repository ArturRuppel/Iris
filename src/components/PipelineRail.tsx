import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import {
  activePlottableAtom, addStepAtom, moveStepAtom, removeStepAtom,
  reducePreviewAtom, schemaAtom, updateStepAtom,
} from "../state";
import type {
  ColumnDef, ReduceStep, ReduceStepKind, Schema,
  SelectStep, FilterStep, CollapseStep,
} from "../types";
import { StepCollapse, StepFilter, StepSelect } from "./StepCards";

const KIND_LABEL: Record<ReduceStepKind, string> = {
  select: "Select columns", filter: "Filter rows", collapse: "Collapse",
};
const fmt = (n: number) => n.toLocaleString();

/* one pipeline step, independently collapsible so a long pipeline stays
   scannable — the head (kind + surviving row count + actions) always shows. */
function StepItem({ step, cols, out, i, last, onMove, onRemove, onChange }: {
  step: ReduceStep; cols: ColumnDef[]; out: number | null;
  i: number; last: boolean; onMove: (dir: -1 | 1) => void;
  onRemove: () => void; onChange: (s: ReduceStep) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <li className="step-card">
      <div className="step-head">
        <button className="card-toggle" title={open ? "Collapse" : "Expand"}
          onClick={() => setOpen((o) => !o)}>
          <span className="chevron">{open ? "▾" : "▸"}</span>
          <span className="step-kind">{KIND_LABEL[step.kind]}</span>
        </button>
        <span className="step-rows">{out == null ? "" : `→ ${fmt(out)} rows`}</span>
        <span className="step-actions">
          <button className="icon" title="Move up" disabled={i === 0}
            onClick={() => onMove(-1)}>↑</button>
          <button className="icon" title="Move down" disabled={last}
            onClick={() => onMove(1)}>↓</button>
          <button className="icon" title="Remove step" onClick={onRemove}>✕</button>
        </span>
      </div>
      {open && (
        <div className="step-body">
          {step.kind === "select" && (
            <StepSelect step={step as SelectStep} columns={cols} onChange={onChange} />
          )}
          {step.kind === "filter" && (
            <StepFilter step={step as FilterStep} columns={cols} onChange={onChange} />
          )}
          {step.kind === "collapse" && (
            <StepCollapse step={step as CollapseStep} columns={cols} onChange={onChange} />
          )}
        </div>
      )}
    </li>
  );
}

export function PipelineRail() {
  const schema = useAtomValue(schemaAtom);
  const active = useAtomValue(activePlottableAtom);
  const preview = useAtomValue(reducePreviewAtom);
  const addStep = useSetAtom(addStepAtom);
  const updateStep = useSetAtom(updateStepAtom);
  const removeStep = useSetAtom(removeStepAtom);
  const moveStep = useSetAtom(moveStepAtom);
  const [collapsed, setCollapsed] = useState(false);
  const [adding, setAdding] = useState(false);

  if (!schema || !active) return null;
  const steps = active.reduce.steps;
  const trace = preview?.trace ?? [];

  /* the columns available at step i's INPUT = the previous step's output schema
     (from the live /reduce trace), or the master schema for the first step.
     Falls back to the master schema if the trace isn't available yet. */
  const inputColumnsFor = (i: number): ColumnDef[] => {
    if (i === 0) return schema.columns;
    const prev: Schema | undefined = trace[i - 1]?.schema_out;
    return prev?.columns ?? schema.columns;
  };
  const rowsOut = (i: number): number | null =>
    trace[i] ? trace[i].n_rows_out : null;

  if (collapsed) {
    return (
      <div className="pipeline-rail collapsed">
        <button className="rail-expand" title="Show pipeline"
          onClick={() => setCollapsed(false)}>⋮ Pipeline</button>
      </div>
    );
  }

  return (
    <div className="pipeline-rail">
      <div className="rail-head">
        <strong>Pipeline</strong>
        <button className="icon" title="Hide pipeline"
          onClick={() => setCollapsed(true)}>⟨</button>
      </div>

      {steps.length === 0 && (
        <p className="rail-empty">
          No steps — the full table flows to the figure. Add a step to reduce it.
        </p>
      )}

      <ol className="step-list">
        {steps.map((step, i) => (
          <StepItem key={step._key ?? i} step={step} cols={inputColumnsFor(i)} out={rowsOut(i)}
            i={i} last={i === steps.length - 1}
            onMove={(dir) => moveStep({ index: i, dir })}
            onRemove={() => removeStep(i)}
            onChange={(s: ReduceStep) => updateStep({ index: i, step: s })} />
        ))}
      </ol>

      <div className="add-step">
        {adding ? (
          <div className="add-step-menu">
            {(["select", "filter", "collapse"] as ReduceStepKind[]).map((k) => (
              <button key={k} onClick={() => { addStep(k); setAdding(false); }}>
                {KIND_LABEL[k]}
              </button>
            ))}
            <button className="cancel" onClick={() => setAdding(false)}>cancel</button>
          </div>
        ) : (
          <button className="add-step-btn" onClick={() => setAdding(true)}>+ Add step</button>
        )}
      </div>
    </div>
  );
}
