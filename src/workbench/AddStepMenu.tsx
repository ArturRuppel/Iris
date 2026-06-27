import type { AuthorAction, AuthorOption } from "./authoring";

/* The phase-keyed add menu opened from a node's `+`: one button per fitting
   option (the reduce kinds + the terminal operations, per `affordances`). Pure —
   it holds no atoms; the handle/canvas routes the picked action via
   `authorDispatch`. The same component is reused on drop-to-empty-canvas. */
export function AddStepMenu(
  { options, onPick }: { options: AuthorOption[]; onPick: (action: AuthorAction) => void },
) {
  return (
    <div className="txw-add-menu" role="menu">
      {options.map((o, i) => (
        <button key={i} role="menuitem" onClick={() => onPick(o.action)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
