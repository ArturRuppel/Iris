#!/usr/bin/env node
/* Run the end-to-end tests against a dev stack this script starts and stops.

     node e2e/run.mjs                 every e2e/*_test.mjs
     node e2e/run.mjs zoom panels     only those

   The stack is private to the run: the engine listens on a spare port
   (E2E_ENGINE_PORT, default 18765) and autosaves into a temporary folder, so a
   run never touches a developer's or the served app's recovery snapshot, and
   the snapshot is cleared between tests so one test's leftovers cannot put the
   recovery bar in front of the next. The frontend is vite on 5173, the one
   origin the engine's CORS allows; the run refuses to start if 5173 is taken.
   Tests that need another setup (the static web build, a lab book) say so in
   their header and are skipped here: see NEEDS_OTHER. */
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE_PORT = process.env.E2E_ENGINE_PORT ?? "18765";
const ENGINE = `http://127.0.0.1:${ENGINE_PORT}`;
const APP = "http://localhost:5173";
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 240000);
/* these drive the built web site or a lab-book server, not the dev stack */
const NEEDS_OTHER = new Set(["browser_runtime", "single_file", "export_figure", "labbook_bound"]);

const free = (port) => new Promise((res) => {
  const s = net.createConnection({ port, host: "127.0.0.1" });
  s.once("connect", () => { s.destroy(); res(false); });
  s.once("error", () => res(true));
});
const up = async (url) => { try { return (await fetch(url)).ok; } catch { return false; } };
const waitFor = async (url, what) => {
  for (let i = 0; i < 120; i++) { if (await up(url)) return; await new Promise((r) => setTimeout(r, 500)); }
  throw new Error(`${what} did not come up at ${url}`);
};

const wanted = process.argv.slice(2).map((a) => a.replace(/(_test)?(\.mjs)?$/, ""));
const all = readdirSync(join(ROOT, "e2e")).filter((f) => f.endsWith("_test.mjs"))
  .map((f) => f.replace(/_test\.mjs$/, "")).sort();
const tests = wanted.length ? wanted : all.filter((t) => !NEEDS_OTHER.has(t));

if (!(await free(5173))) { console.error("port 5173 is in use: stop the dev server first"); process.exit(2); }
if (!(await free(Number(ENGINE_PORT)))) { console.error(`port ${ENGINE_PORT} is in use (set E2E_ENGINE_PORT)`); process.exit(2); }

const autosave = mkdtempSync(join(tmpdir(), "iris-e2e-"));
const py = process.env.E2E_PYTHON ?? join(ROOT, ".venv", "bin", "python");
const procs = [
  spawn(py, ["-m", "iris_engine.main"], { cwd: join(ROOT, "engine"), stdio: "ignore",
    env: { ...process.env, ENGINE_PORT, IRIS_AUTOSAVE_DIR: autosave } }),
  spawn("npx", ["vite", "--port", "5173", "--strictPort"], { cwd: ROOT, stdio: "ignore",
    env: { ...process.env, VITE_ENGINE_PORT: ENGINE_PORT } }),
];
const stop = () => { for (const p of procs) p.kill(); rmSync(autosave, { recursive: true, force: true }); };
process.on("SIGINT", () => { stop(); process.exit(130); });

const results = [];
try {
  await waitFor(`${ENGINE}/health`, "engine");
  await waitFor(APP, "frontend");
  for (const t of tests) {
    await fetch(`${ENGINE}/autosave/clear`, { method: "POST" }).catch(() => {});
    const t0 = Date.now();
    const out = [];
    const code = await new Promise((res) => {
      const p = spawn(process.execPath, [join(ROOT, "e2e", `${t}_test.mjs`)], {
        cwd: ROOT, env: { ...process.env, APP_URL: APP, ENGINE_URL: ENGINE } });
      const timer = setTimeout(() => { out.push("TIMEOUT"); p.kill("SIGKILL"); }, TIMEOUT_MS);
      p.stdout.on("data", (d) => out.push(String(d)));
      p.stderr.on("data", (d) => out.push(String(d)));
      p.on("close", (c) => { clearTimeout(timer); res(c ?? 1); });
    });
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    results.push({ t, ok: code === 0 });
    console.log(`${code === 0 ? "PASS" : "FAIL"}  ${t}  (${secs}s)`);
    if (code !== 0) {
      const lines = out.join("").split("\n").filter((l) => l.trim());
      console.log(lines.slice(-12).map((l) => "      " + l).join("\n"));
    }
  }
} finally { stop(); }
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed` +
  (failed.length ? `: ${failed.map((r) => r.t).join(", ")}` : ""));
process.exit(failed.length ? 1 : 0);
