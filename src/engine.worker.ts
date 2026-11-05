/* The worker half of the browser runtime: takes the files the main thread passes
   in, boots Pyodide from them, then answers engine requests one at a time.
   Requests that arrive during boot wait for it, so the app's first health check
   resolves when Iris is ready.

   Each package is a filesystem image built by tools/web-image.mjs (installed,
   compiled to bytecode, gzipped), decompressed as it arrives and written into
   the filesystem in one pass: nothing is unzipped or compiled from source here.

   Pyodide reads its files through the global `fetch`, so that is overridden to
   answer from memory for one reserved address. Its one file that must be imported
   goes through its documented `createPyodideModule` option. */
import { gunzipSync } from "fflate";
import { populate } from "./fsImage";

/* Chromium only allows a classic worker from a blob on file://, and Pyodide refuses
   classic workers because it expects to use import(), which works here too. Its
   only test is whether importScripts succeeds, and it never calls it otherwise. */
(self as any).importScripts = () => { throw new TypeError("importScripts is unavailable"); };

type Manifest = {
  core: string[]; images: string[]; late: string[]; packages: string[];
  dynlibs: { boot: string[]; stats: string[] };
};

const AUTOSAVE_DIR = "/autosave";
const VIRTUAL = "https://iris-payload.invalid/";
const files = new Map<string, Uint8Array<ArrayBuffer>>();
const images = new Map<string, Promise<Uint8Array>>();
const arrived = new Map<string, () => void>();
let imageNames = new Set<string>();
let py: any = null;
let bridge: any = null;
let bootStarted: () => void;
let bootFailed: (e: unknown) => void;
const ready = new Promise<void>((res, rej) => { bootStarted = res; bootFailed = rej; });
ready.catch(() => {});   // reported through "failed"; requests see it when they await

const progress = (stage: string, fraction: number) =>
  self.postMessage({ type: "progress", stage, fraction });

function decode(base64: string): Uint8Array<ArrayBuffer> {
  const native = (Uint8Array as any).fromBase64;   // Chromium 140, Firefox 133, Safari 18.2
  if (native) return native(base64);
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/* the browser's own gzip decoder runs off this thread; fflate where it is missing */
async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "function") return gunzipSync(bytes);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* Emscripten's loader, after each shared library, walks the whole global offset
   table (Object.entries over ~60,000 entries) to find the few symbols still
   unresolved; across a boot's libraries that walk was most of their load time.
   This answers the same question for that one object from a running list of the
   unresolved entries, in the same order, so the loader's behaviour is unchanged. */
function fastUnresolvedScan(GOT: Record<string, { value: unknown }>) {
  const entries = Object.entries;
  let scanned = 0;
  let open: string[] = [];
  Object.entries = function (o: any) {
    if (o !== GOT) return entries(o);
    const keys = Object.keys(GOT);
    for (let i = scanned; i < keys.length; i++) open.push(keys[i]);
    scanned = keys.length;
    open = open.filter((k) => GOT[k].value === -1);
    return open.map((k) => [k, GOT[k]]);
  } as typeof Object.entries;
}

/* resolves once a file has arrived */
function when(name: string): Promise<void> {
  if (files.has(name) || images.has(name)) return Promise.resolve();
  return new Promise((resolve) => arrived.set(name, resolve));
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

async function boot(manifest: Manifest) {
  await Promise.all([...manifest.core, ...manifest.images].map(when));
  progress("Starting Python", 0);
  const { loadPyodide } = await importFile("pyodide.mjs");
  const createPyodideModule = (await importFile("pyodide.asm.mjs")).default;
  py = await loadPyodide({
    indexURL: VIRTUAL, packageBaseUrl: VIRTUAL, createPyodideModule,
    lockFileContents: new TextDecoder().decode(need("pyodide-lock.json")),
    stdout: () => {},
  });
  for (const name of manifest.core) files.delete(name);
  if (py._module?.GOT) fastUnresolvedScan(py._module.GOT);

  /* Each package is one image: written into the filesystem in one pass. Then the
     shared libraries the engine's imports need, in the order the imports load
     them (the path Pyodide's own loadPackage takes: faster than letting each
     import load its library synchronously). */
  for (const [i, name] of manifest.images.entries()) {
    progress("Preparing the statistics libraries", 0.3 + 0.2 * (i / manifest.images.length));
    populate(py.FS, await images.get(name)!);
    images.delete(name);
  }
  for (const name of manifest.packages) py.loadedPackages[name] = "default channel";
  const libs = [...manifest.dynlibs.boot, ...manifest.dynlibs.stats];
  for (const [i, lib] of libs.entries()) {
    if (i % 8 === 0) progress("Preparing the statistics libraries", 0.5 + 0.25 * (i / libs.length));
    await py._api.loadDynlib(lib);
  }
  py.FS.mkdirTree(AUTOSAVE_DIR);
  py.FS.mount(py.FS.filesystems.IDBFS, {}, AUTOSAVE_DIR);
  await syncAutosave(true);

  progress("Loading Iris", 0.75);
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

function fail(err: unknown) {
  bootFailed(err);
  self.postMessage({ type: "failed", message: String((err as Error)?.message ?? err) });
}

self.onmessage = ({ data }: MessageEvent) => {
  if (data.type === "manifest") {
    imageNames = new Set(data.manifest.images);
    boot(data.manifest).then(bootStarted, fail);
  } else if (data.type === "file") {
    const bytes = decode(data.base64);
    if (imageNames.has(data.name)) {
      const image = gunzip(bytes);
      image.catch(fail);
      images.set(data.name, image);
    } else files.set(data.name, bytes);
    arrived.get(data.name)?.();
    arrived.delete(data.name);
  } else if (data.type === "request") {
    queue = queue.then(() => answer(data.id, data.method, data.url, data.headers, data.body));
  }
};
