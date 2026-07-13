import { chromium } from "playwright";

/* Excel-like editing in the grouped-sheet lens (editor-ergonomics slice 1):
   single click selects (does not edit), click+shift-click makes a rectangular
   range, arrows / shift+arrows move and grow the active cell, typing overwrites,
   and Ctrl+C copies the selection as spreadsheet-pasteable TSV.

   Fixture group×day (2 groups × 2 days × 2 reps) pivots to a 2 × 4 sheet:
       cols: Control/D1  Control/D2  Treatment/D1  Treatment/D2
       row0:    1            3            5             7
       row1:    2            4            6             8
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
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await context.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };
const clip = () => page.evaluate(() => navigator.clipboard.readText());
const cell = (r, c) => page.locator(`.gs-cell[data-r="${r}"][data-c="${c}"]`);

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".app", { timeout: 30000 });

await page.click(".tb-btn:has-text('Import')");
await page.setInputFiles("input[type=file]", {
  name: "excel_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
});
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });

await page.waitForSelector(".table-pane .dv-toggle", { timeout: 30000 });
await page.locator(".dv-toggle button:has-text('Grouped sheet')").click();
await page.waitForSelector(".gs-canvas .gs-cell", { timeout: 15000 });

/* --- 1. single click selects, does NOT edit --- */
await cell(0, 0).click();
if (await page.locator(".gs-input").count() > 0)
  fail("a single click must select, not open the editor");
if (!(await cell(0, 0).getAttribute("class")).includes("gs-active"))
  fail("the clicked cell should be the active cell (gs-active)");
console.log("single click selects without editing");

/* --- 2. shift-click makes a rectangular range; Ctrl+C copies it as TSV --- */
await cell(1, 1).click({ modifiers: ["Shift"] });
const selCount = await page.locator(".gs-cell.gs-sel").count();
if (selCount !== 4) fail(`shift-click should select a 2×2 block (4 cells), got ${selCount}`);
await page.keyboard.press("Control+c");
const tsv1 = await clip();
if (tsv1 !== "1\t3\n2\t4")
  fail(`copied TSV should be the 2×2 block "1\\t3\\n2\\t4", got ${JSON.stringify(tsv1)}`);
console.log("shift-click range + Ctrl+C copied spreadsheet TSV:", JSON.stringify(tsv1));

/* --- 3. keyboard: arrows move the active cell, shift+arrow grows the range --- */
await cell(0, 0).click();                    // collapse to a single cell
await page.keyboard.press("ArrowRight");     // active -> (0,1) = value 3
if (!(await cell(0, 1).getAttribute("class")).includes("gs-active"))
  fail("ArrowRight should move the active cell one column right");
await page.keyboard.press("Shift+ArrowDown"); // extend down -> (0,1)+(1,1)
await page.keyboard.press("Control+c");
const tsv2 = await clip();
if (tsv2 !== "3\n4")
  fail(`shift+arrow range copy should be "3\\n4", got ${JSON.stringify(tsv2)}`);
console.log("arrow nav + shift-extend + copy:", JSON.stringify(tsv2));

/* --- 4. type-to-overwrite: a digit opens the editor pre-filled, Enter commits
   and advances down (Excel). Overwrite Control/D1 row0 (1 -> 77). --- */
await cell(0, 0).click();
await page.keyboard.press("7");
await page.keyboard.type("7");
const editor = page.locator(".gs-input");
await editor.waitFor({ timeout: 5000 });
if (await editor.inputValue() !== "77")
  fail(`typing should overwrite the cell (draft "77"), got ${JSON.stringify(await editor.inputValue())}`);
await page.keyboard.press("Enter");
await page.waitForFunction(() => {
  const c = document.querySelector('.gs-cell[data-r="0"][data-c="0"]');
  return c && c.textContent.trim() === "77";
}, null, { timeout: 10000 });
if (!(await cell(1, 0).getAttribute("class")).includes("gs-active"))
  fail("Enter should commit and advance the active cell down one row");
console.log("type-to-overwrite committed (1 -> 77) and Enter advanced down");

if (await page.locator(".error-bar").count() > 0)
  fail("unexpected error-bar: " + await page.locator(".error-bar").innerText());

console.log("PASS: grouped-sheet edits like Excel — select, range, keyboard nav, copy");
await browser.close();
