import { useEffect, useState } from "react";
import { BootState, onBootState } from "./browserEngine";
import irisMark from "/iris-favicon.svg";

function useBootState() {
  const [state, setState] = useState<BootState>({ stage: "Starting", done: 0, total: 4 });
  useEffect(() => onBootState(setState), []);
  return state;
}

const Brand = () => (
  <div className="tb-brand engine-down-brand">
    <span className="tb-mark"><img src={irisMark} alt="" width="27" height="27" /></span>
    <span className="tb-word">Iris</span>
  </div>
);

/* The first visit downloads Python and its libraries, so this screen says what is
   happening and why it is worth the wait. */
export function BrowserBoot() {
  const { stage, done, total } = useBootState();
  return (
    <div className="engine-down">
      <Brand />
      <h1>{stage}…</h1>
      <progress value={done} max={total} aria-label="Loading Iris" />
      <p>Iris runs entirely in this browser, so your data stays on your computer.
        The first visit downloads the statistics libraries, and every visit takes
        a few seconds to start Python.</p>
    </div>
  );
}

export function BrowserBootFailed() {
  const { error } = useBootState();
  return (
    <div className="engine-down">
      <Brand />
      <h1>Iris could not start in this browser</h1>
      <p>{error ?? "The engine did not answer."}</p>
      <button className="tb-btn" onClick={() => window.location.reload()}>Reload</button>
    </div>
  );
}
