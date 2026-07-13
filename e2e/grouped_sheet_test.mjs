import { chromium } from "playwright";

/* Smoke test for the grouped-sheet lens (Slice 1): the Data tab's read-only
   projection of the tidy table into the wide, merged-header layout. Imports a
   nested group×day table, flips the Data view to "Grouped sheet", and asserts
   the merged bands, leaf headers, and value body render from the tidy rows.

   Needs the engine (port 8765) and the vite dev server (port 5173) running. */

const csv = [
  "group,day,value",
  "Control,D1,1", "Control,D1,2",
  "Control,D2,3", "Control,D2,4",
  "Treatment,D1,5", "Treatment,D1,6",
  "Treatment,D2,7", "Treatment,D2,8",
].join("\n");

const URL = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".app", { timeout: 30000 });

// import the fixture through the wizard's hidden file input
await page.click(".tb-btn:has-text('Add data')");
await page.setInputFiles("input[type=file]", {
  name: "grouped_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
});
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });

// default view is Data; the toggle lives in the pane head
await page.waitForSelector(".table-pane .dv-toggle", { timeout: 30000 });

// the grouped option must be enabled for this (one value + two categorical) table
const groupedBtn = page.locator(".dv-toggle button:has-text('Grouped sheet')");
if (await groupedBtn.isDisabled()) fail("Grouped sheet toggle should be enabled for a pivotable table");
await groupedBtn.click();

await page.waitForSelector(".gs-grid", { timeout: 15000 });

// outer band: "Control" and "Treatment", each spanning its two days
const control = page.locator(".gs-grid .de-band .de-groupcell", { hasText: "Control" });
await control.waitFor({ timeout: 5000 });
const span = await control.getAttribute("colspan");
if (span !== "2") fail(`"Control" band should span 2 leaf columns, got colspan=${span}`);
console.log("merged band: Control spans", span, "columns");

// leaf headers: the inner factor "day" (D1, D2 under each group)
const leafText = await page.locator(".gs-grid .de-heads").innerText();
if (!/D1/.test(leafText) || !/D2/.test(leafText)) fail("leaf headers missing D1/D2: " + leafText);

// value body: first data row, first column = 1 (Control/D1, first replicate)
const firstCell = await page.locator(".gs-grid tbody tr").first()
  .locator("td.gs-cell").first().innerText();
if (firstCell.trim() !== "1") fail(`first value cell should be 1, got "${firstCell}"`);
console.log("value body reads from tidy rows: first cell =", firstCell.trim());

// the shape provenance shows rows × cols (2 replicates × 4 combos)
const prov = await page.locator(".table-pane .provenance").innerText();
if (!/2 × 4/.test(prov)) fail("provenance should read 2 × 4, got: " + prov);
console.log("shape:", prov);

// Slice 2: edit a value cell in the grouped shape. Change Control/D1's first
// replicate (1 → 42); the edit rides engine.editCell → version bump → refetch →
// re-pivot, so the same cell must show 42 afterwards.
const cell00 = page.locator(".gs-grid tbody tr").first().locator("td.gs-cell").first();
await cell00.click();
const editor = page.locator(".gs-input");
await editor.waitFor({ timeout: 5000 });
await editor.fill("42");
await editor.press("Enter");
await page.waitForFunction(() => {
  const c = document.querySelector(".gs-grid tbody tr td.gs-cell");
  return c && c.textContent.trim() === "42";
}, null, { timeout: 10000 });
console.log("value edit round-tripped through the engine: 1 → 42");

// the edit landed on the canonical tidy table: the tidy grid shows 42 too
await page.locator(".dv-toggle button:has-text('Table')").click();
await page.waitForSelector(".grid-host", { timeout: 10000 });
await page.waitForFunction(() => {
  const cells = [...document.querySelectorAll(".ag-center-cols-container .ag-cell")];
  return cells.some((c) => c.textContent.trim() === "42");
}, null, { timeout: 10000 });
console.log("edit is canonical: the tidy table shows 42");

if (await page.locator(".error-bar").count() > 0)
  fail("unexpected error-bar: " + await page.locator(".error-bar").innerText());

console.log("PASS: grouped-sheet lens renders the tidy table wide and round-trips the toggle");
await browser.close();
