import { useEffect } from "react";
import type { ExplorerGraph } from "../explorer/graph";
import { buildWorkspaceModel, type SpineEntry, type WsEdge } from "../explorer/workspace";
import { ArrayShapeNode } from "./ArrayShapeNode";

const LEGEND: { cls: string; label: string }[] = [
  { cls: "axis", label: "axis" }, { cls: "key", label: "join key" },
  { cls: "num", label: "numeric" }, { cls: "catg", label: "categorical" },
  { cls: "grain", label: "grain" },
];

function OpEdge({ edge }: { edge: WsEdge }) {
  return (
    <div className="txw-edge">
      <span className={`txw-arr ${edge.kind}`}>↓</span>
      {edge.op && <span className={`txw-op ${edge.kind}`}>{edge.op}</span>}
    </div>
  );
}

function SpineRow({ entry }: { entry: SpineEntry }) {
  const { node, rightInput, onKeys, removed } = entry;
  const main = (
    <ArrayShapeNode title={node.title} variant={node.variant} axes={node.axes}
      values={node.values} removed={removed} onKeys={onKeys}
      rows={node.rows} cols={node.cols} />
  );
  if (!rightInput) return main;
  return (
    <div className="txw-joinwrap">
      {main}
      <div className="txw-into">←</div>
      <div className="txw-rightin">
        <div className="txw-inlbl">right input ↓</div>
        <ArrayShapeNode title={rightInput.title} variant="source"
          axes={rightInput.axes} values={rightInput.values} onKeys={onKeys}
          rows={rightInput.rows} cols={rightInput.cols} />
      </div>
    </div>
  );
}

export function WorkspaceView({ graph, onClose }: { graph: ExplorerGraph; onClose: () => void }) {
  const model = buildWorkspaceModel(graph);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="txw-overlay" role="dialog" aria-label="Transformation workspace">
      <div className="txw-topbar">
        <h1 className="txw-title">⛁ Transformation workspace</h1>
        <div className="txw-legend">
          {LEGEND.map((l) => (
            <span key={l.cls}><b className={`txw-sw ${l.cls}`} />{l.label}</span>
          ))}
        </div>
        <button className="txw-close" onClick={onClose} aria-label="Close workspace">✕</button>
      </div>
      <div className="txw-canvas">
        <div className="txw-spine">
          {model.spine.map((entry) => (
            <div key={entry.node.id} className="txw-spine-item">
              {entry.inEdge && <OpEdge edge={entry.inEdge} />}
              <SpineRow entry={entry} />
            </div>
          ))}
          {model.fork.length > 0 && (
            <>
              <div className="txw-edge"><span className="txw-arr">↓</span></div>
              <div className="txw-fork">
                {model.fork.map((f) => (
                  <div key={f.terminal.id} className="txw-forkcol">
                    <div className={`txw-forklabel ${f.terminal.kind}`}>
                      {f.terminal.kind === "plot" ? "geom" : "test"}
                    </div>
                    <div className="txw-term">
                      <div className="txw-tt">{f.terminal.title}</div>
                      {f.edges.map((e) => (
                        <div key={e.id} className="txw-ts">{e.op} <span className="txw-multiin">← {e.fromTitle}</span></div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
