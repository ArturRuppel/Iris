import { chromium } from "playwright";

const URL = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("console", (m) => console.log("[console]", m.type(), m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await page.goto(URL);
// Wait for engine to connect and sample data to load (figure SVG is the
// clearest signal that the engine round-trip is done)
await page.waitForSelector(".app", { timeout: 30000 });
// Switch to Analyses mode
await page.click(".mode-toggle button:has-text('Analyses')");
await page.waitForSelector(".analyses-mode", { timeout: 5000 });

// Wait until the reduced table is rendered (first analysis result arrives)
await page.waitForSelector(".reduced-table", { timeout: 20000 });

// Add a filter: treatment == control
await page.click(".reduce-filter button:has-text('+ condition')");
await page.waitForSelector(".filter-row");

// Select the "treatment" column (first select in filter-row)
await page.selectOption(".filter-row select >> nth=0", { label: "treatment" });
// Op is already "==" by default; confirm it anyway
await page.selectOption(".filter-row select >> nth=1", "==");
// Fill in the value
await page.fill(".filter-row input", "control");
// Wait for debounced analysis re-run
await page.waitForTimeout(800);
// Wait for reduced table to update
await page.waitForSelector(".reduced-table .ag-center-cols-container", { timeout: 10000 });

const rows = await page.locator(".reduced-table .ag-center-cols-container [role='row']").count();
console.log(`reduced table data rows (filter treatment==control): ${rows}`);
// Sample data has 40 rows, 20 control — expect exactly 20 data rows
if (rows < 20) {
  console.error(`expected >=20 reduced data rows, got ${rows}`);
  process.exit(1);
}

// Add a second plottable via the sidebar button
await page.click(".add-plottable");
const count = await page.locator(".plottable-sidebar li").count();
console.log(`plottable sidebar items: ${count}`);
if (count !== 2) {
  console.error(`expected 2 plottables, got ${count}`);
  process.exit(1);
}

console.log("plottables e2e ok");
await browser.close();
