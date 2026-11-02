/* The worker half of the browser runtime: boots Pyodide from files on this site,
   then answers engine requests one at a time. Requests that arrive during boot
   wait for it, so the app's first health check resolves when Iris is ready. */

type Manifest = { packages: string[]; wheels: string[]; engine: string };

const AUTOSAVE_DIR = "/autosave";
const TOTAL_STAGES = 4;
let py: any = null;
let bridge: any = null;
let ready: Promise<void> | null = null;

const progress = (stage: string, done: number) =>
  self.postMessage({ type: "progress", state: { stage, done, total: TOTAL_STAGES } });

const syncAutosave = (populate: boolean) => new Promise<void>((resolve, reject) => {
  py.FS.syncfs(populate, (err: unknown) => (err ? reject(err) : resolve()));
});

async function boot(base: string) {
  const root = `${base}pyodide/`;
  progress("Starting Python", 0);
  const { loadPyodide } = await import(/* @vite-ignore */ `${root}pyodide.mjs`);
  py = await loadPyodide({ indexURL: root, stdout: () => {} });

  progress("Downloading the statistics libraries", 1);
  const response = await fetch(`${root}iris-web.json`);
  if (!response.ok) throw new Error(`iris-web.json: ${response.status}`);
  const manifest: Manifest = await response.json();
  await py.loadPackage(manifest.packages, { messageCallback: () => {} });
  await py.loadPackage(manifest.wheels.map((w) => `${root}${w}`), { messageCallback: () => {} });

  progress("Unpacking the Iris engine", 2);
  const zip = await fetch(`${root}${manifest.engine}`);
  if (!zip.ok) throw new Error(`${manifest.engine}: ${zip.status}`);
  py.unpackArchive(await zip.arrayBuffer(), "zip", { extractDir: "/engine" });

  py.FS.mkdirTree(AUTOSAVE_DIR);
  py.FS.mount(py.FS.filesystems.IDBFS, {}, AUTOSAVE_DIR);
  await syncAutosave(true);

  progress("Loading Iris", 3);
  await py.runPythonAsync(`
import os, sys
os.environ["IRIS_AUTOSAVE_DIR"] = "${AUTOSAVE_DIR}"
sys.path.insert(0, "/engine")
from iris_engine import browser, main
browser.install()
`);
  bridge = py.pyimport("iris_engine.browser");
  progress("Ready", TOTAL_STAGES);
}

async function answer(id: number, method: string, url: string, headers: unknown, body: Uint8Array) {
  try {
    await ready;
    const path = new URL(url, "http://browser").pathname + new URL(url, "http://browser").search;
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
  if (data.type === "init") {
    ready = boot(data.base);
    ready.catch((err) => self.postMessage({ type: "failed", message: String(err?.message ?? err) }));
  } else if (data.type === "request") {
    queue = queue.then(() => answer(data.id, data.method, data.url, data.headers, data.body));
  }
};
