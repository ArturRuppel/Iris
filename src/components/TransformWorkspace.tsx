import { useAtom, useAtomValue } from "jotai";
import { createPortal } from "react-dom";
import { workspaceOpenAtom } from "../state";
import { explorerGraphAtom } from "../explorer/graphAtom";
import { WorkbenchCanvas } from "../workbench/WorkbenchCanvas";

export function TransformWorkspace() {
  const [open, setOpen] = useAtom(workspaceOpenAtom);
  const graph = useAtomValue(explorerGraphAtom);
  if (!open || !graph) return null;
  return createPortal(
    <WorkbenchCanvas graph={graph} onClose={() => setOpen(false)} />,
    document.body,
  );
}
