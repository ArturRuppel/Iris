/* Build-time half of the browser runtime's boot: install the engine's packages
   into Pyodide running in Node, compile every module to bytecode, strip what a
   running engine never reads, and pack each package's files as one image
   (src/fsImage.ts) that the worker writes straight into its filesystem.

   Doing this here, once, is what keeps the browser from unzipping ~30 wheels and
   compiling ~3000 modules from source on every visit. The .pyc files come from
   the very interpreter the site ships, so their magic number always matches.
   Design: docs/superpowers/specs/2026-11-02-browser-runtime-design.md */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { loadPyodide } from "pyodide";
import { packImage, populate, readImage } from "../src/fsImage.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "/lib/python3.14/site-packages";
const quiet = { messageCallback: () => {} };
/* bump when the image's content rules change, so cached images are rebuilt */
const IMAGE_FORMAT = 2;
/* Bytecode without column positions (they only place the ^^^ under a traceback
   line), which keeps the .pyc files near the size of their sources. */
const ENV = { PYTHONNODEBUGRANGES: "1" };

/* Never read by a running engine: tests, type stubs, C sources and headers,
   matplotlib's sample data, and the sources of modules that have bytecode. */
const STRIP_DIR = /\/(tests|test|__pycache__|sample_data|include)\//;
const STRIP_FILE = /\.(pyi|pxd|pyx|pxi|c|cc|cpp|h|hpp|f|f90)$|\/py\.typed$/;

function walkFS(FS, dir, out = []) {
  for (const name of FS.readdir(dir)) {
    if (name === "." || name === "..") continue;
    const path = `${dir}/${name}`;
    const { mode } = FS.lstat(path);
    if (FS.isDir(mode)) walkFS(FS, path, out);
    else if (FS.isFile(mode)) out.push(path);
  }
  return out;
}

const COMPILE = (dirs) => `
import compileall, py_compile
for d in ${JSON.stringify(dirs)}:
    compileall.compile_dir(d, quiet=2, legacy=True, workers=1,
                           invalidation_mode=py_compile.PycInvalidationMode.UNCHECKED_HASH)
`;

/* Which file of the image each installed path belongs to, by its top-level name
   in site-packages (a package dir, its dist-info, or a single module). */
function owners(py, names) {
  const own = new Map();
  for (const name of names) {
    const info = py.runPython(`
import importlib.metadata as m
d = m.distribution(${JSON.stringify(name)})
[str(f).split("/")[0] for f in (d.files or [])]`).toJs();
    for (const top of new Set(info)) if (top !== ".." && !own.has(top)) own.set(top, name);
  }
  return own;
}

/* The packages, installed, compiled and stripped: { name: gzipped image }.
   Cached on disk, keyed on everything that determines the result. */
export async function packageImages({ packages, wheels, cacheDir, lock }) {
  const key = createHash("sha256").update(JSON.stringify({
    IMAGE_FORMAT, wheels, packages: packages.map((p) => [p, lock.packages[p].sha256]),
    source: readFileSync(fileURLToPath(import.meta.url), "utf8"),
  })).digest("hex").slice(0, 16);
  const dir = join(cacheDir, `image-${key}`);
  const index = join(dir, "index.json");
  if (existsSync(index)) {
    const names = JSON.parse(readFileSync(index, "utf8"));
    return Object.fromEntries(names.map((n) => [n, readFileSync(join(dir, `${n}.gz`))]));
  }
  const py = await loadPyodide({ packageCacheDir: cacheDir, env: ENV, stdout: () => {}, stderr: () => {} });
  const FS = py.FS;
  const before = new Set(walkFS(FS, SITE));
  await py.loadPackage(packages, quiet);
  for (const w of wheels) await py.loadPackage(join(cacheDir, w), quiet);
  py.runPython(COMPILE([SITE]));

  const names = [...packages, ...wheels.map((w) => w.split("-")[0].toLowerCase().replaceAll("_", "-"))];
  const own = owners(py, names);
  const groups = new Map(names.map((n) => [n, []]));
  const all = walkFS(FS, SITE).filter((p) => !before.has(p));
  const paths = new Set(all);
  for (const path of all.sort()) {
    const rel = path.slice(SITE.length + 1);
    if (STRIP_DIR.test(`/${rel}`) || STRIP_FILE.test(path)) continue;
    if (path.endsWith(".py") && paths.has(`${path}c`)) continue;   // the bytecode replaces it
    const top = rel.split("/")[0];
    const name = own.get(top) ?? own.get(top.replace(/\.pyc$/, ".py"));
    if (!name) throw new Error(`no package owns ${path}`);
    groups.get(name).push({ path, data: FS.readFile(path) });
  }
  for (const old of readdirSync(cacheDir)) {       // one image set at a time
    if (old.startsWith("image-")) rmSync(join(cacheDir, old), { recursive: true, force: true });
  }
  mkdirSync(dir, { recursive: true });
  const out = {};
  for (const [name, files] of groups) {
    out[name] = gzipSync(packImage(files), { level: 9 });
    writeFileSync(join(dir, `${name}.gz`), out[name]);
  }
  writeFileSync(index, JSON.stringify(names));
  return out;
}

/* The Python standard library with bytecode in place of its sources. */
export async function compiledStdlib(py) {
  const stdlib = readFileSync(join(ROOT, "node_modules", "pyodide", "python_stdlib.zip"));
  py.FS.writeFile("/tmp/stdlib.zip", new Uint8Array(stdlib));
  py.runPython(`
import compileall, io, os, py_compile, shutil, zipfile
src = zipfile.ZipFile("/tmp/stdlib.zip")
src.extractall("/tmp/stdlib")
compileall.compile_dir("/tmp/stdlib", quiet=2, legacy=True, ddir="/lib/python314.zip",
                       invalidation_mode=py_compile.PycInvalidationMode.UNCHECKED_HASH)
with zipfile.ZipFile("/tmp/stdlib-compiled.zip", "w", zipfile.ZIP_DEFLATED, compresslevel=9) as out:
    for info in src.infolist():
        name = info.filename
        if name.endswith(".py") and os.path.exists("/tmp/stdlib/" + name + "c"):
            name += "c"
        if name.endswith("/"):
            continue
        z = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        z.compress_type = zipfile.ZIP_DEFLATED
        with open("/tmp/stdlib/" + name, "rb") as f:
            out.writestr(z, f.read())
shutil.rmtree("/tmp/stdlib")
`);
  return py.FS.readFile("/tmp/stdlib-compiled.zip");
}

/* The engine, compiled the same way, plus what a first run would otherwise make:
   matplotlib's font list. Then boots the whole image once, which proves it imports,
   and records which shared libraries the engine's imports load (`boot`) and which
   the statistics add (`stats`), so the worker can load them ahead of the import. */
export async function engineImage({ images, cacheDir, engineFiles }) {
  const py = await loadPyodide({ packageCacheDir: cacheDir, env: ENV, stdout: () => {}, stderr: () => {} });
  const FS = py.FS;
  for (const gz of Object.values(images)) populate(FS, new Uint8Array(gunzipSync(gz)));
  for (const [rel, data] of Object.entries(engineFiles)) {
    FS.mkdirTree(dirname(`/engine/${rel}`));
    FS.writeFile(`/engine/${rel}`, new Uint8Array(data));
  }
  py.runPython(COMPILE(["/engine"]));
  const stdlib = await compiledStdlib(py);

  /* extension modules in the order they were imported; a library one of them
     needs is loaded along with it */
  const extensions = () => py.runPython(`
import sys
[m.__file__ for m in list(sys.modules.values())
 if (getattr(m, "__file__", None) or "").endswith(".so")]`).toJs();
  py.runPython(`
import sys
sys.path.insert(0, "/engine")
from iris_engine import browser, main
browser.install()
import matplotlib.font_manager
assert "scipy" not in sys.modules, "the engine must not import scipy until a test runs"
`);
  const boot = extensions();
  py.runPython("import scipy.stats, statsmodels.api");
  const stats = extensions().filter((p) => !boot.includes(p));

  const files = [];
  for (const path of walkFS(FS, "/engine").sort()) {
    if (path.includes("/__pycache__/") || (path.endsWith(".py") && existsInFS(FS, `${path}c`))) continue;
    files.push({ path, data: FS.readFile(path) });
  }
  for (const path of walkFS(FS, "/home/pyodide/.matplotlib")) files.push({ path, data: FS.readFile(path) });
  return { image: gzipSync(packImage(files), { level: 9 }), stdlib, dynlibs: { boot, stats } };
}

function existsInFS(FS, path) {
  try { FS.lstat(path); return true; } catch { return false; }
}

/* For tools/test-pyodide.mjs and anyone else in Node: a Pyodide with the
   packages already in place, as the browser gets it. */
export async function loadImages(py, images, names) {
  let n = 0;
  for (const gz of Object.values(images)) n += populate(py.FS, new Uint8Array(gunzipSync(gz))).length;
  for (const name of names) py.loadedPackages[name] = "default channel";
  return n;
}

export { readImage, walkFS };
