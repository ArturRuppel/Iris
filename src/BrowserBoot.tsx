import { useEffect, useState } from "react";
import { BootState, onBootState } from "./browserEngine";
import irisMark from "/iris-favicon.svg";

function useBootState() {
  const [state, setState] = useState<BootState>({ stage: "Starting", percent: 0 });
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
  const { stage, percent } = useBootState();
  return (
    <div className="engine-down">
      <Brand />
      <h1>{stage}…</h1>
      <progress value={percent} max={100} aria-label="Loading Iris" />
      <p>Iris runs entirely in this browser, so your data stays on your computer.
        Every visit reads the statistics libraries and starts Python, which can
        take a minute on a slow connection.</p>
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
