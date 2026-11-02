/* The main-thread half of the browser runtime: a `fetch` lookalike that sends
   engine requests to Python in a Web Worker and hands back a real `Response`, so
   the callers in types.ts cannot tell which deployment they are in.
   Design: docs/superpowers/specs/2026-11-02-browser-runtime-design.md */

export type BootState = { stage: string; done: number; total: number; error?: string };

let state: BootState = { stage: "Starting", done: 0, total: 4 };
const listeners = new Set<(s: BootState) => void>();
const pending = new Map<number, { resolve: (r: Response) => void; reject: (e: Error) => void }>();
let worker: Worker | null = null;
let nextId = 1;

function setState(next: BootState) {
  state = next;
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

function startWorker(): Worker {
  const w = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
  w.onmessage = ({ data }) => {
    if (data.type === "progress") setState({ ...state, ...data.state });
    else if (data.type === "failed") failAll(data.message);
    else if (data.type === "response") {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      if (data.error) request.reject(new Error(data.error));
      else request.resolve(new Response(data.body, { status: data.status, headers: data.headers }));
    }
  };
  w.onerror = (event) => failAll(event.message || "The engine worker could not start.");
  w.postMessage({ type: "init", base: new URL("./", document.baseURI).href });
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
