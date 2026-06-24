import { createPortal } from "react-dom";
import { useAtom, useAtomValue } from "jotai";
import { workspaceOpenAtom } from "../state";
import { explorerGraphAtom } from "../explorer/graphAtom";
import { WorkspaceView } from "./WorkspaceView";

export function TransformWorkspace() {
  const [open, setOpen] = useAtom(workspaceOpenAtom);
  const graph = useAtomValue(explorerGraphAtom);
  if (!open || !graph) return null;
  return createPortal(
    <WorkspaceView graph={graph} onClose={() => setOpen(false)} />,
    document.body,
  );
}
