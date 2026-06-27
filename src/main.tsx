import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// DEV-only E2E seam (see src/testSeam.ts); gated so prod builds tree-shake it out.
if (import.meta.env.DEV) import("./testSeam").then((m) => m.installTestSeam());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
