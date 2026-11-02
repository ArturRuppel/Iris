/* The main-thread half of the browser runtime: a `fetch` lookalike that sends
   engine requests to Python in a Web Worker and hands back a real `Response`, so
   the callers in types.ts cannot tell which deployment they are in.

   The site must also open straight from a file share. On file:// Chromium blocks
   fetch and workers loaded from files, but classic <script> tags still run, so the
   Python runtime and libraries ship as base64 inside classic scripts. This thread
   loads them and passes each one to an in-memory worker.
   Design: docs/superpowers/specs/2026-11-02-browser-runtime-design.md */
import EngineWorker from "./engine.worker?worker&inline";

/* `percent` runs from 0 to 100 across reading the files and then starting Python. */
export type BootState = { stage: string; percent: number; error?: string };
type PayloadFile = { name: string; script: string; bytes: number };
type Manifest = { packages: string[]; wheels: string[]; engine: string; files: PayloadFile[] };

const READ_SHARE = 60;
let state: BootState = { stage: "Starting", percent: 0 };
const listeners = new Set<(s: BootState) => void>();
const pending = new Map<number, { resolve: (r: Response) => void; reject: (e: Error) => void }>();
let worker: Worker | null = null;
let nextId = 1;

function setState(next: BootState) {
  state = { ...next, error: state.error ?? next.error }; // the first failure stays on screen
  listeners.forEach((listener) => listener(state));
}

export function onBootState(listener: (s: BootState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => { listeners.delete(listener); };
}

function failAll(message: string) {
  setState({ ...state, error: message });
  pending.forEach(({ reject }) => reject(new Error(message)));
  pending.clear();
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = src;
    tag.onload = () => { tag.remove(); resolve(); };
    tag.onerror = () => { tag.remove(); reject(new Error(`Could not read ${src}`)); };
    document.head.appendChild(tag);
  });
}

async function sendPayload(w: Worker) {
  const root = new URL("./pyodide/", document.baseURI).href;
  const scope = window as unknown as {
    __irisManifest?: (m: Manifest) => void;
    __irisPayload?: (name: string, base64: string) => void;
  };
  const manifest = await new Promise<Manifest>((resolve, reject) => {
    scope.__irisManifest = resolve;
    loadScript(`${root}manifest.js`).catch(reject);
  });
  /* the string goes to the worker for decoding, so that a large wheel does not
     stall this thread, and the script tag is dropped so the text can be freed */
  scope.__irisPayload = (name, base64) => w.postMessage({ type: "file", name, base64 });
  const total = manifest.files.reduce((sum, f) => sum + f.bytes, 0);
  let read = 0;
  for (const file of manifest.files) {
    setState({ stage: "Reading the statistics libraries", percent: (read / total) * READ_SHARE });
    await loadScript(root + file.script);
    read += file.bytes;
  }
  w.postMessage({ type: "boot", packages: manifest.packages, wheels: manifest.wheels, engine: manifest.engine });
}

function startWorker(): Worker {
  const w = new EngineWorker();
  w.onmessage = ({ data }) => {
    if (data.type === "progress") {
      setState({ stage: data.stage, percent: READ_SHARE + (100 - READ_SHARE) * data.fraction });
    } else if (data.type === "failed") failAll(data.message);
    else if (data.type === "response") {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      if (data.error) {
        /* before the app is up this is the only account of why it never will be */
        if (!state.error) setState({ ...state, error: data.error });
        request.reject(new Error(data.error));
      } else request.resolve(new Response(data.body, { status: data.status, headers: data.headers }));
    }
  };
  w.onerror = (event) => failAll(event.message || "The engine worker could not start.");
  sendPayload(w).catch((err) => failAll(String(err?.message ?? err)));
  return w;
}

export const browserFetch: typeof fetch = async (input, init) => {
  worker ??= startWorker();
  const body = init?.body == null ? new Uint8Array()
    : new TextEncoder().encode(String(init.body));
  const id = nextId++;
  return new Promise<Response>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({
      type: "request", id, url: String(input), method: init?.method ?? "GET",
      headers: init?.headers ?? {}, body,
    }, [body.buffer]);
  });
};
