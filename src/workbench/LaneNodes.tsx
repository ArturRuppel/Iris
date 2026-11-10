import { useState } from "react";
import { createPortal } from "react-dom";
import { Handle, Position } from "@xyflow/react";
import { useAtomValue, useSetAtom } from "jotai";
import { ArrayShapeNode } from "../components/ArrayShapeNode";
import type { RFNodeData } from "./ArrayShapeRFNode";
import { NodeContextMenu, type NodeMenu } from "./NodeContextMenu";
import type { Lane } from "./lanes";
import {
  activePlottableIdAtom, addPlottableAtom, deletePlottableAtom, duplicatePlottableAtom,
  onePlotOnlyAtom, plottablesAtom, renamePlottableAtom, setTagAtom,
} from "../state";

/* The lanes experiment's three extra node types. None is draggable; the canvas
   pans from them like from the empty pane. */

/* the lane header: what a row of the Analyses list was. Click selects the
   analysis, double-click renames it, ⋯ (or right-click) duplicates / deletes,
   and the panel letter is typed in place. */
export function LaneHeadNode({ data }: { data: { lane: Lane } }) {
  const { lane } = data;
  const setActive = useSetAtom(activePlottableIdAtom);
  const rename = useSetAtom(renamePlottableAtom);
  const dup = useSetAtom(duplicatePlottableAtom);
  const del = useSetAtom(deletePlottableAtom);
  const setTag = useSetAtom(setTagAtom);
  const onePlotOnly = useAtomValue(onePlotOnlyAtom);
  const count = useAtomValue(plottablesAtom).length;
  const [draft, setDraft] = useState<string | null>(null);
  const [menu, setMenu] = useState<NodeMenu | null>(null);
  const commit = () => {
    const name = draft?.trim();
    if (name) rename({ id: lane.id, name });
    setDraft(null);
  };
  const openMenu = (x: number, y: number) => setMenu({ x, y, items: [
    { label: "Rename", onClick: () => setDraft(lane.name) },
    ...(onePlotOnly ? [] : [{ label: "Duplicate", onClick: () => dup(lane.id) }]),
    ...(count > 1 ? [{ label: "Delete analysis", danger: true, onClick: () => del(lane.id) }] : []),
  ] });
  return (
    <div className={`txw-lanehead nopan${lane.active ? " active" : ""}`} data-lane={lane.id}
      onClick={() => setActive(lane.id)}
      onDoubleClick={() => setDraft(lane.name)}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openMenu(e.clientX, e.clientY); }}>
      <div className="txw-lanehead-text">
        {draft != null ? (
          <input autoFocus className="nodrag" value={draft}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.target.select()} onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") setDraft(null); }} />
        ) : <span className="txw-lanehead-name" title={lane.name}>{lane.name}</span>}
        {lane.marks && <span className="txw-lanehead-meta">{lane.marks}</span>}
      </div>
      <input className="txw-lanehead-tag nodrag" value={lane.tag} maxLength={4} placeholder="+"
        title="Panel letter: type one (A, B, …) to make this analysis a panel of the Figure"
        aria-label={`Panel tag of ${lane.name}`}
        onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
        onChange={(e) => setTag({ id: lane.id, tag: e.target.value })} />
      <button className="txw-lanehead-more nodrag" aria-label={`Actions for ${lane.name}`}
        onClick={(e) => { e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect(); openMenu(r.left, r.bottom + 4); }}>⋯</button>
      {menu && createPortal(<NodeContextMenu menu={menu} onClose={() => setMenu(null)} />, document.body)}
    </div>
  );
}

/* a node of an inactive lane: the same picture, nothing to edit. The click that
   selects its analysis is the canvas's onNodeClick. */
export function GhostNode({ data }: { data: RFNodeData & { laneId: string } }) {
  const { missing: _m, options: _o, inEdge: _e, stepIndex: _s, acceptsRightInput: _a,
    laneId: _l, ...shape } = data;
  const hidden = { opacity: 0, pointerEvents: "none" as const };
  return (
    <div className="txw-rfnode txw-ghost">
      <Handle id="in" type="target" position={Position.Left} style={hidden} isConnectable={false} />
      {shape.variant === "figure" && (shape.sections ?? []).map((sec, i, all) => {
        const id = sec.kind === "stats" ? "in-test" : (sec.panel ? `in-plot-${sec.panel}` : "in-plot");
        return <Handle key={id} id={id} type="target" position={Position.Left} isConnectable={false}
          style={{ ...hidden, top: `${((i + 0.5) / all.length) * 100}%` }} />;
      })}
      <ArrayShapeNode {...shape} />
      <Handle id="out" type="source" position={Position.Right} style={hidden} isConnectable={false} />
    </div>
  );
}

export function LaneAddNode() {
  const add = useSetAtom(addPlottableAtom);
  const onePlotOnly = useAtomValue(onePlotOnlyAtom);
  return (
    <button className="txw-laneadd nodrag nopan" disabled={onePlotOnly}
      title={onePlotOnly ? "A lab-book figure holds one plot" : undefined}
      onClick={() => add()}>+ Analysis</button>
  );
}
