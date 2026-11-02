/* The worker half of the browser runtime: holds the files the main thread passes
   in, boots Pyodide from them, then answers engine requests one at a time. Requests
   that arrive during boot wait for it, so the app's first health check resolves
   when Iris is ready.

   Pyodide reads its files through the global `fetch`, so that is overridden to
   answer from memory for one reserved address. Its one file that must be imported
   goes through its documented `createPyodideModule` option. */

/* Chromium only allows a classic worker from a blob on file://, and Pyodide refuses
   classic workers because it expects to use import(), which works here too. Its
   only test is whether importScripts succeeds, and it never calls it otherwise. */
(self as any).importScripts = () => { throw new TypeError("importScripts is unavailable"); };

const AUTOSAVE_DIR = "/autosave";
const VIRTUAL = "https://iris-payload.invalid/";
const files = new Map<string, Uint8Array<ArrayBuffer>>();
let py: any = null;
let bridge: any = null;
let bootStarted: () => void;
let bootFailed: (e: unknown) => void;
const ready = new Promise<void>((res, rej) => { bootStarted = res; bootFailed = rej; });

const progress = (stage: string, fraction: number) =>
  self.postMessage({ type: "progress", stage, fraction });

function decode(base64: string): Uint8Array<ArrayBuffer> {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

function need(name: string): Uint8Array<ArrayBuffer> {
  const bytes = files.get(name);
  if (!bytes) throw new Error(`missing from this build: ${name}`);
  return bytes;
}

const realFetch = self.fetch.bind(self);
self.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith(VIRTUAL)) return realFetch(input, init);
  const name = url.slice(VIRTUAL.length);
  const headers = { "Content-Type": name.endsWith(".wasm") ? "application/wasm" : "application/octet-stream" };
  return new Response(need(name), { status: 200, headers });
}) as typeof fetch;

const importFile = (name: string) => import(/* @vite-ignore */ URL.createObjectURL(
  new Blob([need(name)], { type: "text/javascript" })));

const syncAutosave = (populate: boolean) => new Promise<void>((resolve, reject) => {
  py.FS.syncfs(populate, (err: unknown) => (err ? reject(err) : resolve()));
});

async function boot(packages: string[], wheels: string[], engine: string) {
  progress("Starting Python", 0);
  const { loadPyodide } = await importFile("pyodide.mjs");
  const createPyodideModule = (await importFile("pyodide.asm.mjs")).default;
  py = await loadPyodide({
    indexURL: VIRTUAL, packageBaseUrl: VIRTUAL, createPyodideModule,
    lockFileContents: new TextDecoder().decode(need("pyodide-lock.json")),
    stdout: () => {},
  });

  progress("Unpacking the statistics libraries", 0.25);
  await py.loadPackage(packages, { messageCallback: () => {} });
  await py.loadPackage(wheels.map((w) => `${VIRTUAL}${w}`), { messageCallback: () => {} });

  progress("Unpacking the Iris engine", 0.6);
  py.unpackArchive(need(engine), "zip", { extractDir: "/engine" });
  files.clear();

  py.FS.mkdirTree(AUTOSAVE_DIR);
  py.FS.mount(py.FS.filesystems.IDBFS, {}, AUTOSAVE_DIR);
  await syncAutosave(true);

  progress("Loading Iris", 0.7);
  await py.runPythonAsync(`
import os, sys
os.environ["IRIS_AUTOSAVE_DIR"] = "${AUTOSAVE_DIR}"
sys.path.insert(0, "/engine")
from iris_engine import browser, main
browser.install()
`);
  bridge = py.pyimport("iris_engine.browser");
  progress("Ready", 1);
}

async function answer(id: number, method: string, url: string, headers: unknown, body: Uint8Array) {
  try {
    await ready;
    const parsed = new URL(url, "http://browser");
    const path = parsed.pathname + parsed.search;
    const out = bridge.dispatch(method, path, JSON.stringify(headers), py.toPy(body));
    const [status, headersJson, bytes] = out.toJs();
    out.destroy();
    /* flushed only after a successful write, so that a failed snapshot cannot
       replace a good one in browser storage */
    if (method === "POST" && path.startsWith("/autosave/") && status < 400) await syncAutosave(false);
    self.postMessage({ type: "response", id, status, headers: JSON.parse(headersJson), body: bytes },
      { transfer: [bytes.buffer] });
  } catch (err) {
    self.postMessage({ type: "response", id, error: String((err as Error)?.message ?? err) });
  }
}

/* Requests run strictly in order, because the engine is single-threaded and an
   overlap could interleave a syncfs with the next write. */
let queue: Promise<void> = Promise.resolve();

self.onmessage = ({ data }: MessageEvent) => {
  if (data.type === "file") files.set(data.name, decode(data.base64));
  else if (data.type === "boot") {
    boot(data.packages, data.wheels, data.engine).then(bootStarted, (err) => {
      bootFailed(err);
      self.postMessage({ type: "failed", message: String(err?.message ?? err) });
    });
  } else if (data.type === "request") {
    queue = queue.then(() => answer(data.id, data.method, data.url, data.headers, data.body));
  }
};
