import { chromium } from "playwright";

/* Smoke test for the reduction-pipeline UI: Data/Analyses modes, the pipeline
   rail (add a step, prefix-grouped column picker), the live reduced-table
   preview, and plottable CRUD. No fixture CSV exists on disk, so the table is
   imported via an in-memory buffer through the ImportWizard's hidden file
   input — the `.template-pick` dropdown and auto-fetched sample dataset were
   removed in 111243b (see TODO.md), so this follows the documented fix
   pattern: explicit import before touching `.pipeline-section`. Needs the
   engine (port 8765) and the vite dev server (port 5173) running.

   AG Grid virtualizes rows, so we assert on the column count via the reduced
   note and on the pipeline wiring (a blank Select projects all columns away;
   toggling a prefix group brings columns back), not on exact row counts. */

const csv = [
  "group,site,value",
  "a,north,1", "a,north,2", "a,north,3",
  "b,north,4", "b,north,5", "b,north,6",
  "a,south,7", "a,south,8", "a,south,9",
  "b,south,10", "b,south,11", "b,south,12",
].join("\n");

const URL = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

const fail = (msg) => { console.error(msg); process.exit(1); };

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".app", { timeout: 30000 });

await page.click(".tb-btn:has-text('Add data')"); await page.click(".tb-menu button:has-text('Import…')");
await page.setInputFiles("input[type=file]", {
  name: "plottables_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
});
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });

// Switch to Analyses mode; the pipeline rail and reduced preview appear.
await page.click(".tb-seg button:has-text('Workbench')");
await page.waitForSelector(".workbench-mode", { timeout: 60000 });
await page.waitForSelector(".pipeline-section", { timeout: 60000 });

// The reduced-table preview loads (table upload + /reduce round trip).
await page.waitForSelector(".reduced-note", { timeout: 60000 });
const noteFull = await page.locator(".reduced-note").innerText();
if (!/\d+ column/.test(noteFull)) fail("reduced note missing column count: " + noteFull);
console.log("initial preview:", noteFull.replace(/\s+/g, " "));

// The Data (reduction) section is collapsed by default — expand it so the
// add-step control renders.
await page.click(".pipeline-section .card-toggle");
await page.waitForSelector(".add-step-btn", { timeout: 5000 });

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
// Toggling one prefix group back is a partial projection: it may not include the
// mapped Y column (so the axis-dropped-by-pipeline guidance may show) or may
// leave too many rows for a point-capped geom. Both are expected, actionable
// guidance — not a reduction failure. Fail only on a genuinely unexpected error bar.
if (await page.locator(".error-bar").count() > 0) {
  const msg = await page.locator(".error-bar").innerText();
  const expected = /too many to draw individually|point|removed by this analysis/i;
  if (!expected.test(msg)) fail("error-bar after select: " + msg);
}
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
