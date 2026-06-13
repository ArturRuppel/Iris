import { chromium } from "playwright";

/* Smoke test for the derived-plottables UI: Data/Analyses modes, the reduce
   panel (filter), the live reduced table, and plottable CRUD. Needs the engine
   (port 8765) and the vite dev server (port 5173) running.

   Note: AG Grid virtualizes rows, so we don't assert an exact reduced row
   count. Instead we filter on a numeric column and assert every rendered cell
   satisfies the predicate — robust to virtualization and meaningful. We filter
   `dose >= 25` (not `treatment == control`) so both treatment groups survive
   and the default group-comparison stats stay valid. */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

const fail = (msg) => { console.error(msg); process.exit(1); };

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".app", { timeout: 30000 });

// Switch to Analyses mode
await page.click(".mode-toggle button:has-text('Analyses')");
await page.waitForSelector(".analyses-mode", { timeout: 5000 });

// First analysis result populates the reduced table
await page.waitForSelector(".reduced-table .ag-center-cols-container [role='row']",
                           { timeout: 20000 });
const before = await page.locator(
  ".reduced-table .ag-center-cols-container [role='row']").count();
if (before === 0) fail("reduced table rendered no rows before filter");

// Add a filter: dose >= 25
await page.click(".reduce-filter button:has-text('+ condition')");
await page.waitForSelector(".filter-row");
await page.selectOption(".filter-row select >> nth=0", "dose"); // option value = column name
await page.selectOption(".filter-row select >> nth=1", ">=");
await page.fill(".filter-row input", "25");
await page.waitForTimeout(900); // debounced (200ms) analyze round-trip + render

if (await page.locator(".error-bar").count() > 0)
  fail("error-bar present after filter: " + await page.locator(".error-bar").innerText());

const doseCells = await page.locator(
  ".reduced-table .ag-cell[col-id='dose']").allInnerTexts();
if (doseCells.length === 0) fail("no dose cells rendered after filter");
const bad = doseCells.map(Number).filter((v) => !(v >= 25));
if (bad.length) fail("dose cells violating >= 25: " + JSON.stringify(bad));
console.log(`filter applied: ${doseCells.length} visible dose cells all >= 25`);

// Add a second plottable via the sidebar
await page.click(".add-plottable");
const count = await page.locator(".plottable-sidebar li").count();
if (count !== 2) fail(`expected 2 plottables, got ${count}`);

console.log("plottables e2e ok");
await browser.close();
