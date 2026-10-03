import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { servedMode } from "./types";
import "./harmonia/harmonia.css";
import "./index.css";

// DEV-only E2E seam (see src/testSeam.ts); gated so prod builds tree-shake it out.
if (import.meta.env.DEV) import("./testSeam").then((m) => m.installTestSeam());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>,
);

/* Served mode only (public/sw.js): a shell-only, server-first worker, so a
   home-screen open with the laptop out of reach shows Iris saying so instead of
   Safari's error page. Never under the Tauri shell or Vite dev — the desktop
   app bundles this same dist/, and a worker there has nothing to fall back
   from. Fails soft: no support, or plain http off loopback (not a secure
   context), just means no offline shell. */
if (servedMode && "serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
