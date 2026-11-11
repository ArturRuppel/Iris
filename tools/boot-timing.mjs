#!/usr/bin/env node
/* How long the browser build takes to come up, stage by stage, and then to show
   its first figure and test: the default example a first visit lands on, and a
   table of one's own imported and plotted. The yardstick for any change to the
   boot pipeline.

     npm run build:web && node tools/boot-timing.mjs    # dist-web/ over file://
     ORIGIN=http node tools/boot-timing.mjs             # dist-web/ from a private static server
     node tools/boot-timing.mjs https://arturruppel.github.io/Iris/
     node tools/boot-timing.mjs file:///path/to/iris-offline.html
     RUNS=3 node tools/boot-timing.mjs                  # median of three runs

   Every run is a cold boot in a fresh browser context (empty cache and browser
   storage, so no recovery offer), followed by a warm boot: the page closed and
   reopened in the same context, which an http origin answers from the HTTP cache. Over file://
   there is no HTTP cache and "warm" only means the files are in the OS cache.
   Stage times come from the worker's own progress messages, so they do not
   depend on what the page shows. ORIGIN=http serves dist-web/ under /Iris/ with
   a one-hour max-age, as e2e/browser_runtime_test.mjs does. */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist-web");
const runs = Number(process.env.RUNS ?? 1);
const csv = ["group,value", "a,1", "a,2", "a,3", "a,4", "b,5", "b,6", "b,7", "b,8"].join("\n");
const T = 300000;

let server = null;
let url = process.argv[2];
if (!url && process.env.ORIGIN === "http") {
  const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
    ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm",
    ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".iris": "application/zip" };
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!path.startsWith("/Iris/")) { res.writeHead(404).end(); return; }
    let file = normalize(join(DIST, path.slice("/Iris/".length)));
    if (file === DIST || file === `${DIST}/`) file = join(DIST, "index.html");
    if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Cache-Control": "max-age=3600" });
    createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}/Iris/`;
}
url ??= `file://${join(DIST, "index.html")}`;
if (url.startsWith("file://") && !existsSync(fileURLToPath(url))) {
  console.error(`${fileURLToPath(url)} is missing: run npm run build:web first`); process.exit(2);
}

/* Runs in the page before the app: every worker the page starts reports the
   messages that cross it, with the time they crossed. */
const hook = () => {
  const log = (window.__irisTiming = []);
  const now = () => performance.timeOrigin + performance.now();
  const Base = window.Worker;
  window.Worker = class extends Base {
    constructor(...args) {
      super(...args);
      this.addEventListener("message", ({ data }) => {
        if (data?.type === "progress") log.push({ t: now(), kind: "stage", stage: data.stage });
        else if (data?.type === "response") log.push({ t: now(), kind: "response", id: data.id });
        else if (data?.type === "failed") log.push({ t: now(), kind: "failed", message: data.message });
      });
    }
    postMessage(message, transfer) {
      if (message?.type === "request") log.push({ t: now(), kind: "request", id: message.id, url: message.url });
      return super.postMessage(message, transfer);
    }
  };
};

/* Open the app and wait for the shell and for the engine. */
async function boot(context, bytes) {
  const page = await context.newPage();
  page.on("response", async (r) => { try { bytes.n += (await r.body()).length; } catch {} });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "commit", timeout: T });
  const shell = page.waitForSelector("header.topbar", { timeout: T }).then(() => Date.now() - t0);
  /* ready = the first /health answer, which the worker holds until Python is up */
  await page.waitForFunction(() => {
    const log = window.__irisTiming ?? [];
    const health = log.find((e) => e.kind === "request" && e.url.endsWith("/health"));
    return log.some((e) => e.kind === "failed")
      || (health && log.some((e) => e.kind === "response" && e.id === health.id));
  }, null, { timeout: T, polling: 100 });
  const failed = await page.evaluate(() => window.__irisTiming.find((e) => e.kind === "failed")?.message);
  if (failed) throw new Error(`the engine failed to start: ${failed}`);
  return { page, t0, shell: (await shell) / 1000, ready: (Date.now() - t0) / 1000 };
}

/* Seconds from the first request to `path` to its response, from the worker log. */
const firstCall = (log, path) => {
  const q = log.find((e) => e.kind === "request" && e.url.endsWith(path));
  const a = q && log.find((e) => e.kind === "response" && e.id === q.id);
  return a ? (a.t - q.t) / 1000 : null;
};

async function once(browser) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await context.addInitScript(hook);
  const bytes = { n: 0 };
  const { page, t0, shell, ready } = await boot(context, bytes);

  /* a first visit lands on the default example: its plot as the lane's picture,
     and its Welch test */
  await page.waitForSelector(".txw-node.figure.picture .txw-figthumb", { timeout: T });
  await page.waitForFunction(() => /Welch/.test(document.body.innerText), null, { timeout: T });
  const example = (Date.now() - t0) / 1000;
  const coldLog = await page.evaluate(() => window.__irisTiming);
  const navStart = await page.evaluate(() => performance.timeOrigin);
  const stages = [];
  for (const e of coldLog) if (e.kind === "stage" && stages.at(-1)?.stage !== e.stage) stages.push({ stage: e.stage, at: (e.t - navStart) / 1000 });
  const coldBytes = bytes.n;

  /* a warm boot: the first page closed, a second one in the same context
     (the untouched example is not unsaved work, so no recovery offer) */
  await page.close();
  const warm = await boot(context, { n: 0 });
  await warm.page.waitForSelector(".txw-node.figure.picture .txw-figthumb", { timeout: T });
  await warm.page.waitForFunction(() => /Welch/.test(document.body.innerText), null, { timeout: T });
  const warmExample = (Date.now() - warm.t0) / 1000;

  /* one's own table, on the warm page: New, import, a box plot through the wizard */
  const page2 = warm.page;
  await page2.click("header .tb-ghost:has-text('New')");
  await page2.locator("button:has-text('Discard'), button:has-text('Don')").first().click({ timeout: 3000 }).catch(() => {});
  await page2.waitForFunction(() => !document.querySelector(".txw-lanehead"), null, { timeout: 15000 });
  await page2.click("header .tb-ghost:has-text('Import')");
  await page2.setInputFiles("input[type=file]", { name: "fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page2.waitForSelector(".modal-foot button.primary", { timeout: 60000 });
  await page2.click(".modal-foot button.primary");
  await page2.waitForSelector(".modal-overlay", { state: "detached", timeout: 60000 }).catch(() => {});
  await page2.click(".tb-seg button:has-text('Workbench')");
  await page2.waitForSelector(".txw-node-add-plot", { timeout: 15000 });
  await page2.click(".txw-node-add-plot");
  await page2.waitForSelector("[data-testid='plot-wizard']", { timeout: 10000 });
  await page2.locator(".wiz-geom", { hasText: "Box" }).click();
  await page2.waitForSelector(".wiz-step.wiz-map", { timeout: 10000 });
  await page2.locator(".wiz-map .enc-row", { hasText: "X" }).locator("select").selectOption("group");
  await page2.locator(".wiz-map .enc-row", { hasText: "Y" }).locator("select").selectOption("value");
  await page2.waitForSelector(".wiz-done:not([disabled])", { timeout: 10000 });
  const tAsk = Date.now();
  await page2.click(".wiz-done");
  await page2.waitForSelector("[data-testid='plot-card'] .figure-pane svg", { timeout: 120000 });
  const afterDone = (Date.now() - tAsk) / 1000;

  await context.close();
  return {
    stages, bytes: coldBytes, shell, ready, example, analyze: firstCall(coldLog, "/analyze"),
    warmShell: warm.shell, warmReady: warm.ready, warmExample, afterDone,
  };
}

const browser = await chromium.launch();
const results = [];
try {
  for (let i = 0; i < runs; i++) {
    const r = await once(browser);
    results.push(r);
    if (runs > 1) console.log(`run ${i + 1}: shell ${r.shell.toFixed(1)} s, ready ${r.ready.toFixed(1)} s, example ${r.example.toFixed(1)} s; ` +
      `warm ${r.warmShell.toFixed(1)} / ${r.warmReady.toFixed(1)} / ${r.warmExample.toFixed(1)} s; own plot ${r.afterDone.toFixed(1)} s after Done`);
  }
} finally {
  await browser.close();
  server?.close();
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const pick = (k) => median(results.map((r) => r[k]));
const s = (k) => pick(k).toFixed(1).padStart(6) + " s";
console.log(`${url}  (${runs} run${runs > 1 ? "s" : ""}${runs > 1 ? ", median" : ""})`);
const mid = results[Math.floor(results.length / 2)];
for (const [i, st] of mid.stages.entries()) {
  const next = mid.stages[i + 1]?.at ?? mid.ready;
  console.log(`  ${st.stage.padEnd(40)} ${st.at.toFixed(1).padStart(6)} s  (${(next - st.at).toFixed(1)} s)`);
}
console.log(`  cold: app shell visible                  ${s("shell")}`);
console.log(`  cold: engine ready (/health answered)    ${s("ready")}`);
console.log(`  cold: default example (plot + Welch)     ${s("example")}  (first /analyze ${pick("analyze")?.toFixed(2)} s)`);
console.log(`  warm: app shell visible                  ${s("warmShell")}`);
console.log(`  warm: engine ready                       ${s("warmReady")}`);
console.log(`  warm: default example                    ${s("warmExample")}`);
console.log(`  own table: box plot after Done           ${s("afterDone")}`);
console.log(`  bytes read, cold                         ${(pick("bytes") / 1e6).toFixed(1).padStart(6)} MB decoded`);
