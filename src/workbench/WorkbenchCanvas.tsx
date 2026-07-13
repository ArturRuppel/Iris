import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, Panel, Position,
  useNodesState, useEdgesState, useReactFlow,
  type Node, type Edge as RFEdge, type NodeTypes, type EdgeTypes, type FitViewOptions,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useSetAtom, useAtomValue } from "jotai";
import type { ExplorerGraph } from "../explorer/graph";
import { layoutGraph } from "./layout";
import { ArrayShapeRFNode, nodeShapeProps, type RFNodeData } from "./ArrayShapeRFNode";
import { nodeDeltas, levelInitial } from "./nodeDelta";
import { WorkbenchEdge } from "./WorkbenchEdge";
import {
  openCardAtom, collapseAllCardsAtom, cardsAtom, nodePositionsAtom,
  pushStashAtom, stashAtom, workbenchLayoutAtom, focusedStashIdAtom,
} from "./state";
import { targetToCardKind, type Target } from "./cardRegistry";
import { FloatingCard } from "./FloatingCard";
import { Stash, StashFocus } from "./Stash";
import { ResizeHandles, useWorkbenchResize } from "./WorkbenchResize";
import { clampStashH, TOPBAR } from "./paneTiling";
import { NodeContextMenu, type NodeMenu } from "./NodeContextMenu";
import { removeStepAtom, connectInputAtom, undoSpecAtom, redoSpecAtom, analysisTableAtom, activePlottableAtom, activeReduceDagAtom } from "../state";

// the custom node/edge components intentionally accept a narrower prop shape than
// React Flow's NodeProps/EdgeProps (they read only `data`); cast for registration.
const nodeTypes = { arrayShape: ArrayShapeRFNode } as unknown as NodeTypes;
const edgeTypes = { workbench: WorkbenchEdge } as unknown as EdgeTypes;

/* fit the DAG into its pane with a little breathing room; maxZoom 1 keeps nodes
   at their natural size at most, so a roomy pane never balloons them. The top gets
   extra room so the chain always clears the GRAIN legend that floats over the
   canvas's top-left (see the top-left Panel) instead of tucking behind it. Shared
   by the initial fit and the resize re-fit so both frame the graph identically. */
const FIT_OPTS: FitViewOptions = { padding: { top: "72px", right: "24px", bottom: "24px", left: "24px" },
  maxZoom: 1, duration: 0 };

/* the onNodeDragStop reducer: records a node's post-drag position into the
   override map, immutably. Kept pure so it's unit-testable (RF drag events don't
   fire under jsdom, so the handler delegates here and we test this directly). */
export function applyNudge(
  prev: Record<string, { x: number; y: number }>,
  id: string, x: number, y: number,
): Record<string, { x: number; y: number }> {
  return { ...prev, [id]: { x, y } };
}

/* Map a React Flow connection (graph node ids + a target handle) to a
   connectInputAtom arg. `dagIdOf` translates a graph node id (`source`,
   `step:<i>`) to its DAG node id; a synthetic/unwireable endpoint resolves to
   null and the connection is dropped. The target handle names the input slot:
   "in-1" is a join's right (slot 1), anything else the primary input (slot 0).
   Pure + exported: React Flow connect events do not fire under jsdom, so the
   handler delegates here and we unit-test this directly. */
export function onConnectDelegate(
  conn: { source: string | null; target: string | null; targetHandle?: string | null },
  dagIdOf: (graphId: string) => string | null,
): { targetId: string; sourceId: string; slot: number } | null {
  if (!conn.source || !conn.target) return null;
  const targetId = dagIdOf(conn.target);
  const sourceId = dagIdOf(conn.source);
  if (!targetId || !sourceId) return null;
  const slot = conn.targetHandle === "in-1" ? 1 : 0;
  return { targetId, sourceId, slot };
}

export function toRF(
  graph: ExplorerGraph,
  overrides: Record<string, { x: number; y: number }>,
  sourceName: string,
): { nodes: Node[]; edges: RFEdge[] } {
  const L = layoutGraph(graph);
  const deltas = nodeDeltas(graph);
  return {
    nodes: L.nodes.map((n) => ({
      id: n.id, type: "arrayShape",
      position: overrides[n.id] ?? { x: n.x, y: n.y },
      // wire from the right edge into the left edge: RF derives edge endpoints
      // from these node fields, not from the <Handle> dot placement.
      sourcePosition: Position.Right, targetPosition: Position.Left,
      data: nodeShapeProps(n.node, deltas.get(n.id), sourceName) as unknown as Record<string, unknown>,
    })),
    edges: L.edges.map((e) => ({
      id: e.id, source: e.source, target: e.target, type: "workbench",
      // forward edges leave the right edge and enter the left edge. The figure's
      // Plot and Stats sections are separate sinks: a geom wire feeds the Plot, the
      // test wire the Stats, so they target the section-specific handles (see
      // ArrayShapeRFNode) instead of stacking on one point as a single line.
      sourceHandle: "out",
      targetHandle: e.kind === "geom" ? (e.panel ? `in-plot-${e.panel}` : "in-plot")
        : e.kind === "test" ? "in-test" : "in",
      data: { kind: e.kind, label: e.label, guards: e.guards },
    })),
  };
}

/* the persistent grain legend: decodes the per-node segment glyphs (E, P, …) to
   their full level names, in nesting order, so the shedding bars are readable. */
function GrainLegend({ spine }: { spine: string[] }) {
  if (spine.length === 0) return null;
  return (
    <div className="txw-grain-legend">
      <span className="txw-gl-k">Grain</span>
      <span className="txw-gl-lvls">
        {spine.map((name, i) => (
          <span key={name} className="txw-gl-lvl">
            {i > 0 && <span className="txw-gl-chev" aria-hidden>›</span>}
            <span className="txw-gl-seg" aria-hidden>{levelInitial(name)}</span>
            {name}
          </span>
        ))}
      </span>
      <span className="txw-gl-note">each step pools one level →</span>
    </div>
  );
}

function Canvas({ graph, onClose }: { graph: ExplorerGraph; onClose?: () => void }) {
  const nodePositions = useAtomValue(nodePositionsAtom);
  const setNodePositions = useSetAtom(nodePositionsAtom);
  // the analysis's main table names every box in the reduce chain (see nodeName).
  const sourceName = useAtomValue(analysisTableAtom)?.name ?? "Table";
  // nodePositions here seeds only the FIRST render; later changes flow through
  // the structural effect below.
  const initial = useMemo(() => toRF(graph, nodePositions, sourceName),
    [graph, nodePositions, sourceName]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);

  const openCard = useSetAtom(openCardAtom);
  const pushStash = useSetAtom(pushStashAtom);
  const collapseAll = useSetAtom(collapseAllCardsAtom);
  const cards = useAtomValue(cardsAtom);
  const stash = useAtomValue(stashAtom);
  const hasStash = stash.length > 0;

  // tiling-resize: stashH + column weights, driven by Alt-drag and the sliders.
  const layout = useAtomValue(workbenchLayoutAtom);
  const setLayout = useSetAtom(workbenchLayoutAtom);
  const overlayRef = useRef<HTMLDivElement>(null);
  const stashRef = useRef<HTMLDivElement>(null);
  const resize = useWorkbenchResize(overlayRef, stashRef);

  // Keep the DAG framed in its pane. The pane shrinks when the stash grows to its
  // 2/3 default (and on window resize), but React Flow only fits once at mount —
  // so without this the nodes keep their old, larger zoom and spill out of the
  // band. Observe the pane and re-fit (coalesced to a frame) whenever it resizes.
  const { fitView } = useReactFlow();
  const rfcanvasRef = useRef<HTMLDivElement>(null);
  const hasNodesRef = useRef(false);
  hasNodesRef.current = nodes.length > 0;
  useEffect(() => {
    const el = rfcanvasRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { if (hasNodesRef.current) fitView(FIT_OPTS); });
    });
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [fitView]);

  // Give the cards ~2/3 of the vertical space (they're the focus; the DAG rides
  // above in the remaining third). Applies on every appearance the user hasn't
  // sized by hand — a fresh mount AND an analysis switch, which resets the layout
  // to its 270px default (see clearWorkbenchAtom). Runs before paint, so there's
  // no jump; guarded by the value check so setting it doesn't re-trigger itself.
  useLayoutEffect(() => {
    if (!hasStash || layout.userSized) return;
    const overlay = overlayRef.current;
    if (!overlay) return;
    const contentH = overlay.clientHeight - TOPBAR;
    const target = clampStashH(Math.round((contentH * 2) / 3), contentH);
    if (layout.stashH !== target) setLayout((l) => ({ ...l, stashH: target }));
  }, [hasStash, layout.userSized, layout.stashH, setLayout]);

  // clicking a node pins its data card into the stash (docked, comparable),
  // never a floating popup. A stale id (kind === null) is ignored. A whole-node
  // click on the figure terminal defaults to the plot facet (rather than leaving
  // facet undefined, which resolves implicitly in targetToCardKind).
  const pinNode = useCallback((target: Target) => {
    const node = graph.nodes.find((n) => n.id === target.id);
    const t: Target = node?.kind === "figure" && !target.facet
      ? { ...target, facet: "plot" } : target;
    const kind = targetToCardKind(graph, t);
    if (kind) pushStash({ target: t, cardKind: kind });
  }, [graph, pushStash]);

  // clicking an edge opens its editor as a floating card (a transient, focused
  // editing surface — distinct from the pinned reference cards).
  const openEdge = useCallback((target: Target) => {
    const kind = targetToCardKind(graph, target);
    if (kind) openCard({ target, cardKind: kind });
  }, [graph, openCard]);

  // deletion: a node is a projection of one reduce step, so removing it = drop
  // that step (the linear steps array auto-heals, no edge rewiring). Only reduce
  // steps are deletable — the source (stepIndex -1), grain/collapse and terminal
  // nodes have no single step to drop, so they offer no delete. Reachable two
  // ways: right-click (context menu) and Delete/Backspace on a selected node.
  const removeStep = useSetAtom(removeStepAtom);
  const connectInput = useSetAtom(connectInputAtom);
  const active = useAtomValue(activePlottableAtom);
  // the active plottable's reduce VIEW (its branch of the shared table pool); the
  // `step:<i>` presentation ids below index THIS array, exactly as buildGraph
  // minted them from it.
  const activeDag = useAtomValue(activeReduceDagAtom);
  const [menu, setMenu] = useState<NodeMenu | null>(null);
  // translate a graph node id to its DAG node id for wiring: the primary source
  // is sources[0]; a `step:<i>` node is steps[i] (array index == the id's index,
  // per buildGraph). Synthetic/terminal ids (source:<i>, grain:, figure) are not
  // wireable and resolve to null.
  const dagIdOf = useCallback((graphId: string): string | null => {
    if (!activeDag) return null;
    if (graphId === "source") return activeDag.sources[0]?.id ?? null;
    const m = /^step:(\d+)$/.exec(graphId);
    if (m) return activeDag.steps[Number(m[1])]?.id ?? null;
    return null;
  }, [activeDag]);
  // removeStepAtom takes a DAG node id now (Phase B); array order still matches
  // chain order for Phase B's linear-only authoring (see insertStepAtom), so a
  // pipeline-step-index still resolves to the right node via this lookup —
  // Phase D routes the canvas through real ids directly instead.
  const deletableStep = (n: Node): { id: string; label: string } | null => {
    const d = n.data as unknown as RFNodeData;
    const id = typeof d.stepIndex === "number" && d.stepIndex >= 0
      ? activeDag?.steps[d.stepIndex]?.id : undefined;
    return id ? { id, label: d.eyebrow ?? "step" } : null;
  };
  const onNodeContextMenu = useCallback((e: ReactMouseEvent, n: Node) => {
    e.preventDefault();
    const d = n.data as unknown as RFNodeData;
    if (d.variant === "figure") {
      setMenu({ x: e.clientX, y: e.clientY, items: [
        { label: "Edit plot…", onClick: () =>
          openCard({ target: { kind: "node", id: n.id, facet: "plot" }, cardKind: "geom-editor" }) },
        { label: "Edit test…", onClick: () =>
          openCard({ target: { kind: "node", id: n.id, facet: "stats" }, cardKind: "test-editor" }) },
      ] });
      return;
    }
    const del = deletableStep(n);
    setMenu(del ? { x: e.clientX, y: e.clientY, items: [
      { label: `Delete ${del.label.toLowerCase()}`, danger: true, onClick: () => removeStep(del.id) },
    ] } : null);
  }, [openCard, removeStep, active]);

  // undo/redo the spec (Cmd/Ctrl+Z, +Shift to redo / +Y); spec mutations only —
  // style + node positions are excluded at the source (see state.ts).
  const undo = useSetAtom(undoSpecAtom);
  const redo = useSetAtom(redoSpecAtom);
  const canUndo = useAtomValue(undoSpecAtom);
  const canRedo = useAtomValue(redoSpecAtom);

  const focusedStashId = useAtomValue(focusedStashIdAtom);
  const setFocused = useSetAtom(focusedStashIdAtom);

  // Keyboard: Delete/Backspace removes the selected node's step (React Flow's
  // built-in delete is disabled via deleteKeyCode={null}, as it would splice the
  // derived RF node array, not the spec); Cmd/Ctrl+Z undo. All suppressed while
  // typing in a card, so the browser's native field editing/undo stays intact.
  const nodesRef = useRef<Node[]>([]);
  nodesRef.current = nodes;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc exits focus mode first — works even from a field inside the maximized
      // tile (it's not a text-bearing key), and is swallowed so it doesn't also
      // bubble to a workbench close.
      if (e.key === "Escape" && focusedStashId) {
        e.preventDefault(); e.stopPropagation(); setFocused(null); return;
      }
      const el = document.activeElement;
      const typing = (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
        || (el instanceof HTMLElement && el.isContentEditable);
      if (typing) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        e.preventDefault(); if (e.shiftKey) redo(); else undo(); return;
      }
      if (mod && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); return; }
      if (e.key === "Delete" || e.key === "Backspace") {
        const sel = nodesRef.current.find((n) => n.selected);
        const d = sel && deletableStep(sel);
        if (d) { e.preventDefault(); removeStep(d.id); setMenu(null); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [removeStep, undo, redo, focusedStashId, setFocused, active]);

  // the structural identity of the graph: the SET of node + edge ids. Layout
  // (positions) is recomputed only when this changes — not on every
  // explorerGraphAtom recompute (those fire on each /shape_counts result and
  // would otherwise clobber user-dragged positions).
  const structureKey = useMemo(
    () => graph.nodes.map((n) => n.id).join(",") + "|" + graph.edges.map((e) => e.id).join(","),
    [graph],
  );
  const lastStructure = useRef<string>("");

  useEffect(() => {
    const rf = toRF(graph, nodePositions, sourceName);
    if (structureKey !== lastStructure.current) {
      // structure changed (step/grain/terminal added or removed):
      // full re-layout with fresh positions.
      lastStructure.current = structureKey;
      setNodes(rf.nodes);
      setEdges(rf.edges);
    } else {
      // same structure, data-only change (counts, guard verdicts, labels):
      // update data in place, preserving any positions the user dragged.
      const nd = new Map(rf.nodes.map((n) => [n.id, n.data]));
      const ed = new Map(rf.edges.map((e) => [e.id, e.data]));
      setNodes((cur) => cur.map((n) => ({ ...n, data: nd.get(n.id) ?? n.data })));
      setEdges((cur) => cur.map((e) => ({ ...e, data: ed.get(e.id) ?? e.data })));
    }
    // `nodePositions` is read but intentionally NOT a dep: including it would
    // force a full re-seed on every nudge and fight React Flow's internal drag
    // state. The effect re-seeds only on a structure change, reading the current
    // overrides at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, structureKey, sourceName, setNodes, setEdges]);

  // "tidy" clears persisted nudges then re-layouts from scratch.
  const tidy = useCallback(() => {
    setNodePositions({});
    const rf = toRF(graph, {}, sourceName);
    setNodes(rf.nodes);
    setEdges(rf.edges);
  }, [graph, sourceName, setNodes, setEdges, setNodePositions]);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="txw-overlay txw-embedded txw-landing" role="dialog" aria-label="Transformation workbench"
         ref={overlayRef}
         style={hasStash ? { "--stash-h": `${layout.stashH}px` } as CSSProperties : undefined}
         onPointerDownCapture={resize.onOverlayPointerDownCapture}>
      <div className="txw-topbar">
        <h1 className="txw-title">⛁ Transformation workbench</h1>
        <button className="txw-undo" onClick={() => undo()} disabled={!canUndo}
          title="Undo (⌘Z)" aria-label="Undo">↶ Undo</button>
        <button className="txw-undo" onClick={() => redo()} disabled={!canRedo}
          title="Redo (⇧⌘Z)" aria-label="Redo">↷ Redo</button>
        <button className="txw-tidy" onClick={tidy}>⤢ Tidy</button>
        <button className="txw-collapse-all" onClick={collapseAll}>⊟ Collapse all</button>
        {onClose && (
          <button className="txw-close" onClick={onClose} aria-label="Close workbench">✕</button>
        )}
      </div>
      <div className={`txw-rfcanvas${hasStash ? " with-stash" : ""}`} ref={rfcanvasRef}>
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onNodeClick={(_e, n) => pinNode({ kind: "node", id: n.id })}
          onNodeContextMenu={onNodeContextMenu}
          onConnect={(c) => { const a = onConnectDelegate(c, dagIdOf); if (a) connectInput(a); }}
          onPaneClick={() => setMenu(null)}
          onNodeDragStop={(_e, n) =>
            setNodePositions((prev) => applyNudge(prev, n.id, n.position.x, n.position.y))}
          onEdgeClick={(_e, ed) => openEdge({ kind: "edge", id: ed.id })}
          nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          deleteKeyCode={null}
          fitView fitViewOptions={FIT_OPTS} proOptions={{ hideAttribution: true }}
        >
          <Background gap={22} size={1} color="#d7dee7" />
          <Controls />
          <Panel position="top-left"><GrainLegend spine={graph.spine} /></Panel>
        </ReactFlow>
        {menu && (
          <NodeContextMenu menu={menu} onClose={() => setMenu(null)} />
        )}
      </div>
      <div className={`txw-cards${hasStash ? " with-stash" : ""}`}>
        {cards.map((c) => <FloatingCard key={c.id} card={c} />)}
      </div>
      <Stash graph={graph} cols={layout.cols} ref={stashRef} />
      {hasStash && (
        <ResizeHandles
          cols={layout.cols}
          startV={resize.startV} startCorner={resize.startCorner}
        />
      )}
      <StashFocus graph={graph} />
    </div>
  );
}

export function WorkbenchCanvas({ graph, onClose }: { graph: ExplorerGraph; onClose?: () => void }) {
  return (
    <ReactFlowProvider>
      <Canvas graph={graph} onClose={onClose} />
    </ReactFlowProvider>
  );
}
