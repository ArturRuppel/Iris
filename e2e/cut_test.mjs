import { chromium } from "playwright";

/* Ctrl+X cut → Ctrl+V move (editor-ergonomics polish). Cutting stages a block:
   its content lands on the clipboard AND the cells get the dashed "prepared for
   cut" contour (gs-cut / de-cut with per-edge cut-t/r/b/l classes, drawn only on
   the region's boundary). The next paste MOVES the block — writes at the target,
   blanks the source — and clears the contour. Both grids share the model, so both
   are checked.

   Part A — the inline entry grid (empty state): two typed cells are cut and moved
   one column over; the source blanks, the contour clears.
   Part B — the grouped-sheet lens (grp×rep → 2 × 2): a column is cut and moved onto
   the neighbouring column; the move is one batched write, stated as "Moved 2 cells",
   and the source cells fall back to NA (blank).

   Needs the engine (port 8765) and a vite dev server (APP_URL, default 5173). */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await context.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };
const getClip = () => page.evaluate(() => navigator.clipboard.readText());

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".app", { timeout: 30000 });

/* ---------- Part A: the inline entry grid ---------- */
await page.click(".tb-seg button:has-text('Data')");
await page.waitForSelector(".de-inline .de-grid", { timeout: 10000 });

const deCell = (r, c) => page.locator(`.de-body[data-r="${r}"][data-c="${c}"]`);
const deText = (r, c) => deCell(r, c).locator(".de-celltext").innerText();
const deClass = (r, c) => deCell(r, c).getAttribute("class");

// make sure there are at least 3 rows to work with
const wantRows = 3;
while ((await page.locator(".de-grid tbody tr").count()) < wantRows)
  await page.click(".de-tools button:has-text('Row')");

// type two known values down column 0 (type-to-overwrite: first keystroke opens
// the editor, Enter commits and steps down)
const typeCell = async (r, c, text) => {
  await deCell(r, c).click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
};
await typeCell(0, 0, "10");
await typeCell(1, 0, "20");
if ((await deText(0, 0)) !== "10" || (await deText(1, 0)) !== "20")
  fail(`entry setup failed: expected 10/20, got ${await deText(0, 0)}/${await deText(1, 0)}`);

// select the 2×1 block and cut it
await deCell(0, 0).click();
await deCell(1, 0).click({ modifiers: ["Shift"] });
await page.keyboard.press("Control+x");

// the two cells carry the dashed contour; being a vertical block, the top cell is
// bounded on top and the bottom cell on the bottom, and neither on the shared edge
if (!(await deClass(0, 0)).includes("de-cut")) fail("entry: cut top cell should get de-cut");
if (!(await deClass(0, 0)).includes("cut-t")) fail("entry: cut top cell should draw its top edge");
if ((await deClass(0, 0)).includes("cut-b")) fail("entry: cut top cell must NOT draw the shared (bottom) edge");
if (!(await deClass(1, 0)).includes("cut-b")) fail("entry: cut bottom cell should draw its bottom edge");
if ((await getClip()) !== "10\n20") fail(`entry: cut should copy "10\\n20", got "${await getClip()}"`);
console.log("entry: Ctrl+X staged a 2-cell cut (dashed contour + clipboard)");

// move it one column over
await deCell(0, 1).click();
await page.keyboard.press("Control+v");
await page.waitForFunction(() => {
  const c = document.querySelector('.de-body[data-r="0"][data-c="1"] .de-celltext');
  return c && c.textContent.trim() === "10";
}, null, { timeout: 10000 });
if ((await deText(1, 1)) !== "20") fail(`entry: move should write 20 at (1,1), got "${await deText(1, 1)}"`);
if ((await deText(0, 0)).trim() !== "" || (await deText(1, 0)).trim() !== "")
  fail(`entry: move should blank the source, got "${await deText(0, 0)}"/"${await deText(1, 0)}"`);
if (await page.locator(".de-body.de-cut").count() !== 0)
  fail("entry: paste should clear the cut contour");
console.log("entry: Ctrl+V moved the block (source blanked, contour cleared)");

/* ---------- Part B: the grouped-sheet lens ---------- */
const csv = ["grp,rep,value", "A,r1,1", "A,r2,2", "B,r1,3", "B,r2,4"].join("\n");
await page.click(".tb-btn:has-text('Import')");
await page.setInputFiles("input[type=file]", {
  name: "cut_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
});
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });
await page.waitForSelector(".table-pane .dv-toggle", { timeout: 30000 });
await page.locator(".dv-toggle button:has-text('Grouped sheet')").click();
await page.waitForSelector('.gs-canvas .gs-cell[data-r="0"][data-c="0"]', { timeout: 15000 });

const gsCell = (r, c) => page.locator(`.gs-cell[data-r="${r}"][data-c="${c}"]`);
const gsText = (r, c) => gsCell(r, c).innerText();
const gsClass = (r, c) => gsCell(r, c).getAttribute("class");
const notice = () => page.locator(".gs-notice span").innerText();

const prov = (await page.locator(".table-pane .provenance").innerText()).trim();
if (prov !== "2 × 2") fail(`expected a 2 × 2 pivot, got ${prov}`);
if ((await gsText(0, 0)) !== "1" || (await gsText(1, 0)) !== "2")
  fail(`lens setup: expected column A = 1/2, got ${await gsText(0, 0)}/${await gsText(1, 0)}`);

// cut column A (cells (0,0),(1,0))
await gsCell(0, 0).click();
await gsCell(1, 0).click({ modifiers: ["Shift"] });
await page.keyboard.press("Control+x");
if (!(await gsClass(0, 0)).includes("gs-cut")) fail("lens: cut cell should get gs-cut");
if (!(await gsClass(0, 0)).includes("cut-t")) fail("lens: cut top cell should draw its top edge");
if ((await getClip()) !== "1\n2") fail(`lens: cut should copy "1\\n2", got "${await getClip()}"`);
console.log("lens: Ctrl+X staged a 2-cell cut (dashed contour + clipboard)");

// move it onto column B
await gsCell(0, 1).click();
await page.keyboard.press("Control+v");
await page.waitForFunction(() => {
  const c = document.querySelector('.gs-cell[data-r="0"][data-c="1"]');
  return c && c.textContent.trim() === "1";
}, null, { timeout: 10000 });
if ((await gsText(1, 1)) !== "2") fail(`lens: move should write 2 at (1,1), got "${await gsText(1, 1)}"`);
if (!/Moved 2 cells/.test(await notice())) fail("lens: move should state 'Moved 2 cells', got: " + await notice());
if ((await gsText(0, 0)).trim() !== "" || (await gsText(1, 0)).trim() !== "")
  fail(`lens: move should blank the source to NA, got "${await gsText(0, 0)}"/"${await gsText(1, 0)}"`);
if (await page.locator(".gs-cell.gs-cut").count() !== 0)
  fail("lens: paste should clear the cut contour");
console.log("lens: Ctrl+V moved the column in one batch:", (await notice()).trim());

console.log("PASS: Ctrl+X stages a dashed cut; Ctrl+V moves it (source blanks), in both grids");
await browser.close();
