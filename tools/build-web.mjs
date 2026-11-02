#!/usr/bin/env node
/* Build the static, zero-install site into dist-web/.
   Everything the page loads at run time is copied in, and each downloaded wheel
   is checked against a SHA-256 before it is used, so a deployed version cannot
   change underneath a user. Design:
   docs/superpowers/specs/2026-11-02-browser-runtime-design.md */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist-web");
const PYO = join(OUT, "pyodide");
const CACHE = join(ROOT, "node_modules", ".cache", "iris-web");
const NPM_PYO = join(ROOT, "node_modules", "pyodide");

/* What the engine imports, resolved through Pyodide's own lock file. */
const ROOTS = ["numpy", "pandas", "scipy", "matplotlib", "statsmodels", "scikit-learn",
  "pyarrow", "patsy", "pydantic", "fastapi", "xarray"];
/* Pure Python packages that Pyodide does not carry, pinned to what the suite ran. */
const PYPI = {
  seaborn: "0.13.2", pingouin: "0.6.1", "pandas-flavor": "0.8.1", openpyxl: "3.1.5",
  "et-xmlfile": "2.0.0", tabulate: "0.10.0",
};

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function fetchVerified(url, name, expected) {
  mkdirSync(CACHE, { recursive: true });
  const cached = join(CACHE, name);
  let buf = existsSync(cached) ? readFileSync(cached) : null;
  if (!buf) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  if (sha256(buf) !== expected) throw new Error(`${name}: SHA-256 mismatch`);
  writeFileSync(cached, buf);
  return buf;
}

function lockClosure(lock) {
  const names = new Set();
  const visit = (name) => {
    const key = name.toLowerCase().replaceAll("_", "-");
    const pkg = lock.packages[key];
    if (!pkg) throw new Error(`not in pyodide-lock.json: ${name}`);
    if (names.has(key)) return;
    names.add(key);
    pkg.depends.forEach(visit);
  };
  ROOTS.forEach(visit);
  return [...names].sort();
}

function engineZip() {
  const dir = join(ROOT, "engine", "iris_engine");
  const files = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      if (statSync(path).isDirectory()) { if (name !== "__pycache__") walk(path); }
      else if (!name.endsWith(".pyc") && name !== "_build_stamp.py") {
        files[relative(join(ROOT, "engine"), path)] = readFileSync(path);
      }
    }
  };
  walk(dir);
  const describe = execFileSync("git", ["-C", ROOT, "describe", "--always", "--dirty", "--abbrev=7"],
    { encoding: "utf8" }).trim();
  const version = readFileSync(join(ROOT, "engine", "pyproject.toml"), "utf8")
    .match(/^version\s*=\s*"([^"]+)"/m)[1];
  const dirty = describe.endsWith("-dirty");
  files["iris_engine/_build_stamp.py"] = Buffer.from(
    `VERSION = ${JSON.stringify(version)}\nCOMMIT = ${JSON.stringify(describe.replace(/-dirty$/, ""))}\nDIRTY = ${dirty ? "True" : "False"}\n`);
  return { zip: zipSync(files, { level: 6 }), describe };
}

execFileSync("npx", ["tsc"], { cwd: ROOT, stdio: "inherit" });
rmSync(OUT, { recursive: true, force: true });
execFileSync("npx", ["vite", "build", "--base", "./", "--outDir", "dist-web"], {
  cwd: ROOT, stdio: "inherit", env: { ...process.env, VITE_IRIS_RUNTIME: "browser" },
});
rmSync(join(OUT, "sw.js"), { force: true }); // the static site has no service worker

mkdirSync(PYO, { recursive: true });
for (const f of ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"]) {
  cpSync(join(NPM_PYO, f), join(PYO, f));
}
const version = JSON.parse(readFileSync(join(NPM_PYO, "package.json"), "utf8")).version;
const lock = JSON.parse(readFileSync(join(NPM_PYO, "pyodide-lock.json"), "utf8"));
const packages = lockClosure(lock);
for (const name of packages) {
  const { file_name, sha256: expected } = lock.packages[name];
  writeFileSync(join(PYO, file_name), await fetchVerified(
    `https://cdn.jsdelivr.net/pyodide/v${version}/full/${file_name}`, file_name, expected));
}

const wheels = [];
for (const [name, pin] of Object.entries(PYPI)) {
  const res = await fetch(`https://pypi.org/pypi/${name}/${pin}/json`);
  if (!res.ok) throw new Error(`${name}==${pin}: HTTP ${res.status}`);
  const wheel = (await res.json()).urls.find((u) => u.filename.endsWith("py3-none-any.whl"));
  if (!wheel) throw new Error(`${name}==${pin}: no pure Python wheel`);
  writeFileSync(join(PYO, wheel.filename), await fetchVerified(wheel.url, wheel.filename, wheel.digests.sha256));
  wheels.push(wheel.filename);
}

const { zip, describe } = engineZip();
writeFileSync(join(PYO, "iris_engine.zip"), zip);
writeFileSync(join(PYO, "iris-web.json"), JSON.stringify({ packages, wheels, engine: "iris_engine.zip" }, null, 2));

let bytes = 0;
for (const f of readdirSync(PYO)) bytes += statSync(join(PYO, f)).size;
console.log(`dist-web: engine ${describe}, Pyodide ${version}, ${packages.length + wheels.length} packages, ${(bytes / 1e6).toFixed(1)} MB under pyodide/`);
