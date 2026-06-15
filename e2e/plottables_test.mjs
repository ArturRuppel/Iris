import { chromium } from "playwright";

/* Smoke test for the reduction-pipeline UI: Data/Analyses modes, the pipeline
   rail (add a step, prefix-grouped column picker), the live reduced-table
   preview, and plottable CRUD. Dataset-agnostic so it works against either the
   wide cells_by_frame sample or the small synthetic fallback. Needs the engine
   (port 8765) and the vite dev server (port 5173) running.

   AG Grid virtualizes rows, so we assert on the column count via the reduced
   note and on the pipeline wiring (a blank Select projects all columns away;
   toggling a prefix group brings columns back), not on exact row counts. */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

const fail = (msg) => { console.error(msg); process.exit(1); };

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".app", { timeout: 30000 });

// Switch to Analyses mode; the pipeline rail and reduced preview appear.
await page.click(".mode-toggle button:has-text('Analyses')");
await page.waitForSelector(".analyses-mode", { timeout: 5000 });
await page.waitForSelector(".pipeline-rail", { timeout: 5000 });

// The reduced-table preview loads (table upload + /reduce round trip). The wide
// sample is large, so allow generous time.
await page.waitForSelector(".reduced-note", { timeout: 60000 });
const noteFull = await page.locator(".reduced-note").innerText();
if (!/\d+ column/.test(noteFull)) fail("reduced note missing column count: " + noteFull);
console.log("initial preview:", noteFull.replace(/\s+/g, " "));

// Add a Select step — it starts blank, projecting every column away.
await page.click(".add-step-btn");
await page.click(".add-step-menu button:has-text('Select columns')");
await page.waitForSelector(".column-picker", { timeout: 5000 });
await page.waitForFunction(
  () => /(^|\D)0 columns?/.test(document.querySelector(".reduced-note")?.innerText ?? ""),
  null, { timeout: 15000 });
console.log("blank Select projected all columns away");

// Toggle the first prefix group on — columns come back.
await page.click(".cp-group-label input >> nth=0");
await page.waitForFunction(
  () => !/(^|\D)0 columns?/.test(document.querySelector(".reduced-note")?.innerText ?? ""),
  null, { timeout: 15000 });
if (await page.locator(".error-bar").count() > 0)
  fail("error-bar after select: " + await page.locator(".error-bar").innerText());
// the step card shows a row-count funnel badge once the trace is back
await page.waitForSelector(".step-card .step-rows:has-text('rows')", { timeout: 15000 });
console.log("prefix-group toggle restored columns; step badge shows rows");

// Plottable CRUD: add a second analysis (starts with an empty pipeline).
await page.click(".add-plottable");
const count = await page.locator(".plottable-sidebar li").count();
if (count !== 2) fail(`expected 2 plottables, got ${count}`);
const stepsOnNew = await page.locator(".step-card").count();
if (stepsOnNew !== 0) fail(`new plottable should have 0 steps, got ${stepsOnNew}`);

// Switch back to the first plottable — its Select step is still there.
// Click the li's left padding (not the rename input, which stops propagation).
await page.locator(".plottable-sidebar li").first().click({ position: { x: 2, y: 8 } });
await page.waitForSelector(".step-card", { timeout: 5000 });
const stepsOnFirst = await page.locator(".step-card").count();
if (stepsOnFirst !== 1) fail(`first plottable should keep 1 step, got ${stepsOnFirst}`);

console.log("plottables e2e ok");
await browser.close();
