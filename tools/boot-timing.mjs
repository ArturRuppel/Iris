#!/usr/bin/env node
/* How long the browser build takes to come up, stage by stage, and then to draw
   its first figure (whose /analyze request also runs the first statistical test).
   The yardstick for any change to the boot pipeline.

     node tools/boot-timing.mjs                         # dist-web/ over file://
     node tools/boot-timing.mjs https://arturruppel.github.io/Iris/
     node tools/boot-timing.mjs file:///path/to/iris-offline.html
     RUNS=3 node tools/boot-timing.mjs                  # median of three cold boots

   Every run is a cold boot in a fresh browser context. Stage times come from the
   worker's own progress messages, so they do not depend on what the page shows. */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.argv[2] ?? `file://${join(ROOT, "dist-web", "index.html")}`;
const runs = Number(process.env.RUNS ?? 1);
const csv = ["group,value", "a,1", "a,2", "a,3", "a,4", "b,5", "b,6", "b,7", "b,8"].join("\n");

/* Runs in the page before the app: every worker the page starts reports the
   messages that cross it, with the time they crossed. */
const hook = () => {
  const t0 = performance.timeOrigin;
  const log = (window.__irisTiming = []);
  const now = () => (t0 + performance.now());
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

async function once(browser) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await context.addInitScript(hook);
  const page = await context.newPage();
  let bytes = 0;
  page.on("response", async (r) => { try { bytes += (await r.body()).length; } catch {} });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "commit", timeout: 300000 });
  const shell = page.waitForSelector("header.topbar", { timeout: 300000 }).then(() => Date.now() - t0);
  /* ready = the first /health answer, which the worker holds until Python is up */
  await page.waitForFunction(() => {
    const log = window.__irisTiming ?? [];
    const health = log.find((e) => e.kind === "request" && e.url.endsWith("/health"));
    return log.some((e) => e.kind === "failed")
      || (health && log.some((e) => e.kind === "response" && e.id === health.id));
  }, null, { timeout: 300000, polling: 100 });
  const tShell = await shell;
  const tReady = Date.now() - t0;

  /* the first figure: import a table, add a box plot, wait for its SVG */
  await page.click("header .tb-ghost:has-text('Import')");
  await page.setInputFiles("input[type=file]", { name: "fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.waitForSelector(".modal-foot button.primary", { timeout: 60000 });
  await page.click(".modal-foot button.primary");
  await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 60000 }).catch(() => {});
  await page.click(".tb-seg button:has-text('Workbench')");
  await page.waitForSelector(".txw-add-plot", { timeout: 15000 });
  await page.click(".txw-add-plot");
  await page.locator(".wiz-geom", { hasText: "Box" }).click();
  await page.waitForSelector(".wiz-step.wiz-map", { timeout: 10000 });
  await page.locator(".enc-row", { hasText: "X" }).locator("select").selectOption("group");
  await page.locator(".enc-row", { hasText: "Y" }).locator("select").selectOption("value");
  await page.waitForSelector(".wiz-done:not([disabled])", { timeout: 10000 });
  const tAsk = Date.now() - t0;
  await page.click(".wiz-done");
  await page.waitForSelector("[data-testid='plot-card'] svg", { timeout: 120000 });
  const tPlot = Date.now() - t0;

  const log = await page.evaluate(() => window.__irisTiming);
  const start = log.length ? Math.min(...log.map((e) => e.t)) : 0;
  const navStart = await page.evaluate(() => performance.timeOrigin);
  const rel = (t) => (t - navStart) / 1000;
  const stages = [];
  for (const e of log) if (e.kind === "stage" && stages.at(-1)?.stage !== e.stage) stages.push({ stage: e.stage, at: rel(e.t) });
  const ids = new Map(log.filter((e) => e.kind === "request").map((e) => [e.id, e]));
  const analyze = log.find((e) => e.kind === "request" && e.url.endsWith("/analyze"));
  const analyzeDone = analyze && log.find((e) => e.kind === "response" && e.id === analyze.id);
  await context.close();
  void start; void ids;
  return {
    stages, bytes, shell: tShell / 1000, ready: tReady / 1000, plot: tPlot / 1000,
    afterAsk: (tPlot - tAsk) / 1000,
    analyze: analyzeDone ? (analyzeDone.t - analyze.t) / 1000 : null,
  };
}

const browser = await chromium.launch();
const results = [];
for (let i = 0; i < runs; i++) results.push(await once(browser));
await browser.close();

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const pick = (k) => median(results.map((r) => r[k]));
console.log(`${url}  (${runs} cold boot${runs > 1 ? "s" : ""}, median)`);
const first = results[Math.floor(results.length / 2)];
for (const [i, s] of first.stages.entries()) {
  const next = first.stages[i + 1]?.at ?? first.ready;
  console.log(`  ${s.stage.padEnd(40)} ${s.at.toFixed(1).padStart(6)} s  (${(next - s.at).toFixed(1)} s)`);
}
console.log(`  app shell visible                        ${pick("shell").toFixed(1).padStart(6)} s`);
console.log(`  engine ready (/health answered)          ${pick("ready").toFixed(1).padStart(6)} s`);
console.log(`  first plot + test (/analyze)             ${pick("plot").toFixed(1).padStart(6)} s  (${pick("afterAsk").toFixed(1)} s after Done, /analyze ${pick("analyze")?.toFixed(2)} s)`);
console.log(`  bytes read                               ${(pick("bytes") / 1e6).toFixed(1).padStart(6)} MB decoded`);
