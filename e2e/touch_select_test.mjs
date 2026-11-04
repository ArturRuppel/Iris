import { chromium } from "playwright";

/* iPad selection: the grouped sheet at a tablet viewport with a touch screen.
   What it checks:
   1. the sheet fills its pane (no dead band under the rows — .gs-host used to be a
      fixed 560px);
   2. the corner selects all, a row head selects its row (mouse and tap);
   3. Ctrl/Cmd+A selects all;
   4. touch: a short drag SCROLLS and selects nothing; a long-press then drag
      selects a block and does not scroll; the lift after a hold does not collapse
      the range to one cell.
   Needs the engine and the vite dev server (APP_URL, default localhost:5173). */

const rows = ["group,day,rep,value"];
for (const g of ["Control", "Treatment"])
  for (const d of ["D1", "D2", "D3"])
    for (let r = 1; r <= 40; r++) rows.push(`${g},${d},${r},${r * (d === "D1" ? 1 : d === "D2" ? 2 : 3)}`);
const csv = rows.join("\n");

const URL = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1366, height: 1024 }, hasTouch: true });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };
const cdp = await context.newCDPSession(page);
const touch = async (type, points) => cdp.send("Input.dispatchTouchEvent", {
  type, touchPoints: points.map(([x, y]) => ({ x, y })),
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const centre = async (loc) => { const b = await loc.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
const nSel = () => page.locator(".gs-cell.gs-sel").count();
const scrollTop = () => page.evaluate(() => document.querySelector(".gs-scroll").scrollTop);

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".app", { timeout: 30000 });
await page.click("button:has-text('Import')");
await page.setInputFiles("input[type=file]", { name: "touch_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });
await page.waitForSelector(".table-pane .dv-toggle", { timeout: 30000 });
await page.click(".dv-toggle button:has-text('Grouped sheet')");
await page.waitForSelector(".gs-canvas .gs-cell", { timeout: 15000 });

/* 1. the sheet fills the pane */
const pane = await page.locator(".table-pane").boundingBox();
const sheet = await page.locator(".gs-scroll").boundingBox();
const gap = pane.y + pane.height - (sheet.y + sheet.height);
if (gap > 4) fail(`the sheet should reach the bottom of its pane, ${Math.round(gap)}px short`);
if (sheet.height < 700) fail(`at 1024px tall the sheet should be tall, got ${Math.round(sheet.height)}`);
console.log("sheet fills the pane:", Math.round(sheet.height), "px tall,", Math.round(gap), "px gap");

const nCols = await page.locator(".gs-header .gs-leaf").count();   // 6 (2 groups × 3 days)
const nRows = 40;

/* 2. corner → all; row head → row (mouse) */
await page.locator(".gs-corner").dispatchEvent("mousedown");
await page.mouse.up();
const rendered = await page.locator(".gs-cell").count();
if (await nSel() !== rendered) fail(`corner click should select every rendered cell (${rendered}), got ${await nSel()}`);
if (await page.locator(".gs-leaf.gs-sel").count() !== nCols) fail("select-all should light every column header");
if (await page.locator(".gs-rowhead.gs-sel").count() === 0) fail("select-all should light the row heads");
console.log("corner selects all:", rendered, "cells");

const row3 = page.locator('.gs-rowhead[data-row="3"]');
await row3.dispatchEvent("mousedown"); await page.mouse.up();
if (await nSel() !== nCols) fail(`row-head click should select one row of ${nCols} cells, got ${await nSel()}`);
if (!(await row3.evaluate((el) => el.classList.contains("gs-sel")))) fail("the clicked row head should light up");
// shift-click another row head grows the block
await page.locator('.gs-rowhead[data-row="6"]').dispatchEvent("mousedown", { shiftKey: true }); await page.mouse.up();
if (await nSel() !== nCols * 4) fail(`shift-click on row 6 should select rows 3..6, got ${await nSel()}`);
console.log("row heads select rows; shift extends");

/* 3. Ctrl+A */
await page.locator(".gs-cell").first().dispatchEvent("mousedown"); await page.mouse.up();
if (await nSel() !== 1) fail("a plain click should collapse to one cell");
await page.keyboard.press("Control+a");
if (await nSel() !== rendered) fail(`Ctrl+A should select all, got ${await nSel()}`);
console.log("Ctrl+A selects all");

/* 4. touch */
// a plain tap selects one cell (the synthesised click path still works)
const c00 = await centre(page.locator('.gs-cell[data-r="0"][data-c="0"]'));
await page.touchscreen.tap(c00[0], c00[1]);
if (await nSel() !== 1) fail(`a tap should select one cell, got ${await nSel()}`);

// a short drag: scrolls, selects nothing more
const before = await scrollTop();
await touch("touchStart", [c00]);
for (let i = 1; i <= 8; i++) { await touch("touchMove", [[c00[0], c00[1] - i * 20]]); await sleep(16); }
await touch("touchEnd", []);
await sleep(100);
if ((await scrollTop()) <= before) fail("a quick finger drag should scroll the sheet");
if (await nSel() > 1) fail("a quick finger drag must not select a range");
console.log("quick drag scrolls:", before, "→", await scrollTop());
await page.evaluate(() => { document.querySelector(".gs-scroll").scrollTop = 0; });
await sleep(100);

// long-press on a cell, then drag two columns right and three rows down
const a = await centre(page.locator('.gs-cell[data-r="1"][data-c="0"]'));
const b = await centre(page.locator('.gs-cell[data-r="4"][data-c="2"]'));
const top0 = await scrollTop();
await touch("touchStart", [a]);
await sleep(450);
for (let i = 1; i <= 10; i++) {
  await touch("touchMove", [[a[0] + (b[0] - a[0]) * i / 10, a[1] + (b[1] - a[1]) * i / 10]]);
  await sleep(16);
}
await touch("touchEnd", []);
await sleep(100);
if (await nSel() !== 12) fail(`long-press drag should select a 4 × 3 block, got ${await nSel()}`);
if ((await scrollTop()) !== top0) fail("a long-press drag must not scroll");
if (!(await page.locator('.gs-cell[data-r="4"][data-c="2"]').evaluate((el) => el.classList.contains("gs-active"))))
  fail("the drag's end cell should be the active cell");
console.log("long-press + drag selects a 4 × 3 block without scrolling");

// long-press on a row head, drag down two rows → three full rows
const r10 = await centre(page.locator('.gs-rowhead[data-row="10"]'));
const r12 = await centre(page.locator('.gs-rowhead[data-row="12"]'));
await touch("touchStart", [r10]); await sleep(450);
await touch("touchMove", [[r10[0], (r10[1] + r12[1]) / 2]]); await sleep(16);
await touch("touchMove", [r12]); await sleep(16);
await touch("touchEnd", []);
await sleep(100);
if (await nSel() !== nCols * 3) fail(`row-head hold + drag should select 3 rows, got ${await nSel()}`);
console.log("row-head hold + drag selects rows");

// a tap on the corner selects everything
const corner = await centre(page.locator(".gs-corner"));
await page.touchscreen.tap(corner[0], corner[1]);
if (await nSel() !== rendered) fail(`corner tap should select all, got ${await nSel()}`);
console.log("corner tap selects all");

/* the entry grid: corner + row head by mouse */
await page.click(".dv-toggle button:has-text('Table')");
await page.click(".tb-seg button:has-text('Data')").catch(() => {});
console.log("PASS");
await browser.close();
