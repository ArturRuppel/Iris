import { chromium } from "playwright";

/* Smoke test for the Enter-data modal's select-then-act rework (Slice 0): add a
   grouping row, select two header cells and merge them into one band, then select
   a column and delete it. Exercises the selection model + the toolbar actions +
   the selection CSS end-to-end (the header math itself is unit-tested).

   Needs the engine (port 8765) and the vite dev server (port 5173) running. */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".app", { timeout: 30000 });

// open the Enter-data modal
await page.click(".tb-btn:has-text('Add data')");
await page.click(".tb-menu button:has-text('Enter data…')");
await page.waitForSelector(".de-modal .de-grid", { timeout: 10000 });

// two default value columns, no bands yet
const cols0 = await page.locator(".de-heads .de-colcell").count();
if (cols0 !== 2) fail(`expected 2 starting columns, got ${cols0}`);

// add a grouping row: a band cloned from the (two-cell) column partition
await page.click(".de-tools button:has-text('Grouping row')");
await page.waitForSelector(".de-band", { timeout: 5000 });
const bandCells0 = await page.locator(".de-band .de-groupcell").count();
if (bandCells0 !== 2) fail(`fresh grouping row should have 2 cells, got ${bandCells0}`);

// select both band cells (click, shift-click) and merge
const cells = page.locator(".de-band .de-groupcell");
await cells.nth(0).click();
await cells.nth(1).click({ modifiers: ["Shift"] });
// the selection tint (de-sel) is applied to the picked cells
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

console.log("PASS: select-then-act entry flow (merge + delete) works in-app");
await browser.close();
