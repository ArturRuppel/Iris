import { useEffect, useState } from "react";
import { BootState, onBootState } from "./browserEngine";
import irisMark from "/iris-favicon.svg";

function useBootState() {
  const [state, setState] = useState<BootState>({ stage: "Starting", percent: 0 });
  useEffect(() => onBootState(setState), []);
  return state;
}

/* While Python starts, the app is already on screen and usable: requests made
   now wait in the worker until the engine is up. This card sits where the
   figure will appear, says what is happening and why the wait is worth it, and
   goes away when the engine answers. */
export function BootStatus({ opening }: { opening?: string | null }) {
  const { stage, percent, ready } = useBootState();
  if (ready) return null;
  return (
    <div className="boot-status" role="status" aria-live="polite">
      <div className="boot-status-head">
        <span>{opening ? `Opening ${opening}` : "Starting the engine"}</span>
        <span className="boot-status-stage">{stage}…</span>
      </div>
      <div className="boot-bar" role="progressbar" aria-label="Starting Iris"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
        <div className="boot-bar-fill" style={{ width: `${percent}%` }} />
      </div>
      <p>Iris runs entirely in this browser, so your data stays on your computer.
        You can start entering or importing data now; figures and statistics
        follow once the engine is ready.</p>
    </div>
  );
}

export function BrowserBootFailed() {
  const { error } = useBootState();
  return (
    <div className="engine-down">
      <div className="tb-brand engine-down-brand">
        <span className="tb-mark"><img src={irisMark} alt="" width="27" height="27" /></span>
        <span className="tb-word">Iris</span>
      </div>
      <h1>Iris could not start in this browser</h1>
      <p>{error ?? "The engine did not answer."}</p>
      <button className="tb-btn" onClick={() => window.location.reload()}>Reload</button>
    </div>
  );
}
