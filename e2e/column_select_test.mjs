import { chromium } from "playwright";

/* Selection-UX polish: clicking a column header selects the whole column as a
   real range (copy/Delete-able), and a click-drag across cells selects CELLS —
   it must NOT leave a native browser text selection (the bug we're fixing).
   Both grids share the model, so both are checked.

   Part A — the inline entry grid (empty state): column-header click selects the
   full column; a body drag selects a block and highlights no text.
   Part B — the grouped-sheet lens (group×day → 2 × 4): a leaf-header click
   selects one column; a band-header click selects the columns it spans; a body
   drag selects a block and highlights no text.

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
const selText = () => page.evaluate(() => window.getSelection().toString());

// drag from one element's centre to another's, dispatching real mouse events so
// the grid's mousedown/mouseenter range logic (and any native text-select) fire.
const dragBetween = async (from, to) => {
  const a = await from.boundingBox(), b = await to.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
};

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".app", { timeout: 30000 });

/* ---------- Part A: the inline entry grid ---------- */
await page.click(".tb-seg button:has-text('Data')");
await page.waitForSelector(".de-inline .de-grid", { timeout: 10000 });

const deRows = await page.locator(".de-grid tbody tr").count();

// click the header of column 0 → the whole column selects (de-sel down the body)
await page.click('.de-colcell[data-colhead="0"]');
const deColSel = await page.locator('.de-body.de-sel[data-c="0"]').count();
if (deColSel !== deRows) fail(`entry column-header click should select all ${deRows} body cells, got ${deColSel}`);
if (await page.locator('.de-body.de-sel[data-c="1"]').count() !== 0)
  fail("entry column-select must not bleed into the neighbouring column");
if (await page.locator('.de-colcell.de-sel[data-colhead="0"]').count() !== 1)
  fail("the clicked entry column header should light up");
// a single click selects — it must NOT open the label editor (cell-like)
if (await page.locator(".de-headinput").count() !== 0)
  fail("a single click on a header should select, not open the editor");
console.log(`entry: column-header click selected the whole column (${deColSel} cells)`);

// click-drag across column headers selects a range of columns (Excel's other
// gesture, alongside shift-click)
await dragBetween(
  page.locator('.de-colcell[data-colhead="0"]'),
  page.locator('.de-colcell[data-colhead="1"]'),
);
const deDragCols = await page.locator(".de-colcell.de-sel").count();
if (deDragCols !== 2) fail(`entry header-drag should select 2 columns, got ${deDragCols}`);
console.log(`entry: header drag selected ${deDragCols} columns`);

// double-click a header edits its label, exactly like a body cell
await page.dblclick('.de-colcell[data-colhead="1"]');
await page.waitForSelector('.de-colcell[data-colhead="1"] .de-headinput', { timeout: 5000 });
await page.fill('.de-colcell[data-colhead="1"] .de-headinput', "dose");
await page.keyboard.press("Enter");
await page.waitForSelector(".de-headinput", { state: "detached", timeout: 5000 });
const renamed = await page.locator('.de-colcell[data-colhead="1"] .de-headtext').innerText();
if (renamed.trim() !== "dose") fail(`double-click rename should commit "dose", got "${renamed}"`);
console.log("entry: double-click edits the header label (committed 'dose')");

// a body drag selects a block AND leaves no native text selection
await dragBetween(
  page.locator('.de-body[data-r="0"][data-c="0"]'),
  page.locator('.de-body[data-r="1"][data-c="1"]'),
);
const deBlock = await page.locator(".de-body.de-sel").count();
if (deBlock < 4) fail(`entry drag should select a 2×2 block, got ${deBlock} cells`);
if ((await selText()).trim() !== "") fail(`entry drag selected TEXT, not cells: "${await selText()}"`);
console.log(`entry: drag selected ${deBlock} cells with no text highlighted`);

// coarser grain in the entry grid: add a grouping row and drag across its cells —
// selecting columns must work above the lowest grain here too.
await page.click(".de-tools button:has-text('Grouping row')");
await page.waitForSelector(".de-band .de-groupcell");
const gc = page.locator(".de-band .de-groupcell");
await dragBetween(gc.nth(0), gc.nth(1));
const deBandCols = await page.locator(".de-colcell.de-sel").count();
if (deBandCols < 2) fail(`entry band-drag should select both groups' columns, got ${deBandCols}`);
console.log(`entry: grouping-row drag selected ${deBandCols} columns`);

// Ctrl+click builds a DISCONTIGUOUS selection. Add a 3rd value column so there's a
// middle column to leave unselected, then click header 0 and Ctrl+click header 2.
await page.locator(".de-tools button").nth(1).click();   // "＋ Column" → 3 value columns
await page.click('.de-colcell[data-colhead="0"]');
await page.click('.de-colcell[data-colhead="2"]', { modifiers: ["Control"] });
const deCtrlCols = await page.locator(".de-colcell.de-sel").count();
if (deCtrlCols !== 2) fail(`entry Ctrl+click should select 2 disjoint columns, got ${deCtrlCols}`);
if (await page.locator('.de-colcell.de-sel[data-colhead="1"]').count() !== 0)
  fail("entry Ctrl+click must leave the gap column (1) unselected");
const deCtrlBody = await page.locator(".de-body.de-sel").count();
if (deCtrlBody !== deRows * 2)
  fail(`entry Ctrl+click should light both columns' bodies (${deRows * 2}), got ${deCtrlBody}`);
if (await page.locator('.de-body.de-sel[data-c="1"]').count() !== 0)
  fail("entry Ctrl+click must not light the gap column's body");
console.log(`entry: Ctrl+click selected 2 disjoint columns (${deCtrlBody} body cells, gap unselected)`);

/* ---------- Part B: the grouped-sheet lens ---------- */
await page.click(".tb-btn:has-text('Import')");
await page.setInputFiles("input[type=file]", {
  name: "colsel_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
});
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });
await page.waitForSelector(".table-pane .dv-toggle", { timeout: 30000 });
await page.locator(".dv-toggle button:has-text('Grouped sheet')").click();
await page.waitForSelector('.gs-canvas .gs-cell[data-r="0"][data-c="0"]', { timeout: 15000 });

const gsCell = (r, c) => page.locator(`.gs-cell[data-r="${r}"][data-c="${c}"]`);

// leaf-header click selects that one column (both body rows)
await page.click('.gs-head.gs-leaf[data-c="2"]');
if (await page.locator('.gs-cell.gs-sel[data-c="2"]').count() !== 2)
  fail("lens leaf-header click should select both cells of column 2");
if (await gsCell(0, 0).evaluate((el) => el.classList.contains("gs-sel")))
  fail("lens leaf-header select must not touch other columns");
if (await page.locator('.gs-head.gs-leaf.gs-sel[data-c="2"]').count() !== 1)
  fail("the clicked lens leaf header should light up");
console.log("lens: leaf-header click selected its column");

// band-header click ("Treatment", spanning cols 2–3) selects both columns
await page.click('.gs-head.gs-band[data-c0="2"][data-c1="3"]');
const bandSel = await page.locator(".gs-cell.gs-sel").count();
if (bandSel !== 4) fail(`lens band-header click should select the 2×2 group (4 cells), got ${bandSel}`);
console.log("lens: band-header click selected the whole group");

// click-drag across leaf headers (col 0 → col 2) selects that column range
await dragBetween(
  page.locator('.gs-head.gs-leaf[data-c="0"]'),
  page.locator('.gs-head.gs-leaf[data-c="2"]'),
);
const gsDragSel = await page.locator(".gs-cell.gs-sel").count();
if (gsDragSel !== 6) fail(`lens header-drag (cols 0–2) should select 3×2=6 cells, got ${gsDragSel}`);
console.log(`lens: header drag selected ${gsDragSel} cells (3 columns)`);

// the coarser grain works too: drag across BAND headers (Control → Treatment)
// selects every column both groups span — not just the lowest grain.
await dragBetween(
  page.locator('.gs-head.gs-band[data-c0="0"][data-c1="1"]'),
  page.locator('.gs-head.gs-band[data-c0="2"][data-c1="3"]'),
);
const gsBandDrag = await page.locator(".gs-cell.gs-sel").count();
if (gsBandDrag !== 8) fail(`lens band-header drag should select all 4×2=8 cells, got ${gsBandDrag}`);
console.log(`lens: band-header drag selected ${gsBandDrag} cells (both groups)`);

// Ctrl+click builds a discontiguous column selection: leaf col 0 and leaf col 3,
// leaving the two middle columns unselected.
await page.click('.gs-head.gs-leaf[data-c="0"]');
await page.click('.gs-head.gs-leaf[data-c="3"]', { modifiers: ["Control"] });
const gsCtrlCols = await page.locator(".gs-cell.gs-sel").count();
if (gsCtrlCols !== 4) fail(`lens Ctrl+click (cols 0 & 3) should select 2×2=4 cells, got ${gsCtrlCols}`);
if (await page.locator('.gs-cell.gs-sel[data-c="1"]').count() !== 0)
  fail("lens Ctrl+click must leave the gap columns unselected");
if (await page.locator('.gs-head.gs-leaf.gs-sel[data-c="3"]').count() !== 1)
  fail("lens Ctrl+click should light the second disjoint column's header");
console.log(`lens: Ctrl+click selected 2 disjoint columns (${gsCtrlCols} cells, gap unselected)`);

// Ctrl+click two disjoint body cells selects exactly those two (no fill between)
await gsCell(0, 0).click();
await gsCell(1, 3).click({ modifiers: ["Control"] });
const gsCtrlCells = await page.locator(".gs-cell.gs-sel").count();
if (gsCtrlCells !== 2) fail(`lens Ctrl+click two body cells should select exactly 2, got ${gsCtrlCells}`);
console.log("lens: Ctrl+click selected two disjoint body cells");

// body drag selects a block and leaves no native text selection
await dragBetween(gsCell(0, 0), gsCell(1, 1));
const gsBlock = await page.locator(".gs-cell.gs-sel").count();
if (gsBlock < 4) fail(`lens drag should select a 2×2 block, got ${gsBlock} cells`);
if ((await selText()).trim() !== "") fail(`lens drag selected TEXT, not cells: "${await selText()}"`);
console.log(`lens: drag selected ${gsBlock} cells with no text highlighted`);

console.log("PASS: column-header click selects columns; drag selects cells, never text");
await browser.close();
