import { chromium } from "playwright";

/* Smoke test for the inline entry surface (Slice 5): "Enter data" no longer
   opens a modal — it reveals the grouped-sheet pane in its empty state, which
   IS the entry surface. Entry and lens are one continuous surface: typing here
   and hitting Create mints the session and the SAME pane flips to the live lens.

   Part A re-checks the Slice-0 select-then-act header machinery inline (add a
   grouping row, merge two band cells, delete a column). Part B fills value cells
   and creates, asserting the entry surface hands off to the live grouped lens.

   Needs the engine (port 8765) and the vite dev server (port 5173) running. */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".app", { timeout: 30000 });

// With no table yet, the Data view's grouped-sheet pane IS the inline entry
// surface (no modal, and no top-bar shortcut — that was removed). Data is the
// default view; click the mode button anyway to be explicit.
await page.click(".tb-seg button:has-text('Data')");
await page.waitForSelector(".de-inline .de-grid", { timeout: 10000 });
if (await page.locator(".de-modal").count() > 0)
  fail("entry should be inline now, not a modal (.de-modal must be gone)");
if ((await page.locator(".table-pane .provenance").innerText()).trim() !== "new table")
  fail("an empty entry surface should read as a new table");
console.log("inline entry surface revealed (no modal)");

// two default value columns, no bands yet
const cols0 = await page.locator(".de-heads .de-colcell").count();
if (cols0 !== 2) fail(`expected 2 starting columns, got ${cols0}`);

/* --- Part A: the select-then-act header machinery, inline --- */
// add a grouping row: a band cloned from the (two-cell) column partition
await page.click(".de-tools button:has-text('Grouping row')");
await page.waitForSelector(".de-band", { timeout: 5000 });
const bandCells0 = await page.locator(".de-band .de-groupcell").count();
if (bandCells0 !== 2) fail(`fresh grouping row should have 2 cells, got ${bandCells0}`);

// select both band cells (click, shift-click) and merge
const cells = page.locator(".de-band .de-groupcell");
await cells.nth(0).click();
await cells.nth(1).click({ modifiers: ["Shift"] });
if (await page.locator(".de-band .de-groupcell.de-sel").count() === 0)
  fail("selected header cells should carry the de-sel class");
await page.click(".de-tools button:has-text('Merge cells')");

const bandCells1 = await page.locator(".de-band .de-groupcell").count();
if (bandCells1 !== 1) fail(`after merge the band should have 1 cell, got ${bandCells1}`);
const span = await page.locator(".de-band .de-groupcell").first().getAttribute("colspan");
if (span !== "2") fail(`merged band cell should span 2, got colspan=${span}`);
console.log("merged two group cells into one band spanning", span, "columns");

// select the first value column and delete it → one column remains
await page.locator(".de-heads .de-colcell").first().click();
await page.click(".de-tools button:has-text('Delete columns')");
const cols1 = await page.locator(".de-heads .de-colcell").count();
if (cols1 !== 1) fail(`after deleting one column, expected 1 left, got ${cols1}`);
console.log("delete-selected-columns left", cols1, "column");

/* --- Part B: no Create button — switching to Workbench mints the table from
   whatever was typed (continuous), then Data shows the live lens. --- */
// back to two columns, then type a couple of values in each
await page.click(".de-tools button:has-text('Column')");
await page.waitForFunction(() =>
  document.querySelectorAll(".de-heads .de-colcell").length === 2, null, { timeout: 5000 });
// value cells are select-first now (Excel-like): double-click to open the editor,
// type the value, Enter to commit. (Single click selects; typing also overwrites.)
for (const [rc, v] of [["0:0", "1"], ["1:0", "2"], ["0:1", "3"], ["1:1", "4"]]) {
  const [r, c] = rc.split(":");
  await page.locator(`td[data-r="${r}"][data-c="${c}"]`).dblclick();
  await page.fill(`[data-cell="${rc}"]`, v);
  await page.keyboard.press("Enter");
}
if (await page.locator(".de-foot").count() > 0)
  fail("the explicit Create button/gate should be gone (minting is continuous now)");

// switch to Workbench: with no table but a filled entry grid, this mints first
await page.click(".tb-seg button:has-text('Workbench')");
await page.waitForSelector(".workbench-mode", { timeout: 15000 });
if (await page.locator(".analyses-empty").count() > 0)
  fail("Workbench should have data after the auto-mint, not the 'No data yet' empty state");
if (await page.locator(".error-bar").count() > 0)
  fail("auto-mint must not raise an engine error: " + await page.locator(".error-bar").innerText());
console.log("switching to Workbench auto-minted the table (no Create step)");

// back to Data: the entry surface is gone; the live grouped lens shows the data
await page.click(".tb-seg button:has-text('Data')");
await page.waitForSelector(".gs-canvas .gs-cell", { timeout: 15000 });
if (await page.locator(".de-inline").count() > 0)
  fail("with a table minted, Data should show the live lens, not the entry surface");
const prov = (await page.locator(".table-pane .provenance").innerText()).trim();
if (!/^\d+ × \d+$/.test(prov)) fail("the pane should show a grouped shape, got: " + prov);
console.log("Data now shows the live grouped lens, shape", prov);

console.log("PASS: inline entry — structural edits + continuous mint on the Workbench switch");
await browser.close();
