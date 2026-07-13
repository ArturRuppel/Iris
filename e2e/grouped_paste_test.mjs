import { chromium } from "playwright";

/* Paste & clear in the grouped-sheet lens (editor-ergonomics slice 2), including
   the honesty paths. A deliberately RAGGED fixture (group A has three values,
   group B one) pivots to a 3 × 2 stack with holes:

       col:   A    B
       row0:  1    9
       row1:  2   (hole)
       row2:  3   (hole)

   so we can prove paste/clear write only real tidy rows, skip holes and cells past
   the sheet edge, and STATE what they skipped (paste never grows the pivot — the
   grain is fixed by the spine). One batch edit_cells round-trip per paste/clear.
   Needs the engine (port 8765) and the vite dev server (port 5173) running. */

const csv = ["grp,value", "A,1", "A,2", "A,3", "B,9"].join("\n");

const URL = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await context.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };
const cell = (r, c) => page.locator(`.gs-cell[data-r="${r}"][data-c="${c}"]`);
const setClip = (t) => page.evaluate((s) => navigator.clipboard.writeText(s), t);
const getClip = () => page.evaluate(() => navigator.clipboard.readText());
const notice = () => page.locator(".gs-notice span").innerText();
const cellText = (r, c) => cell(r, c).innerText();
const hasClass = async (r, c, cls) => (await cell(r, c).getAttribute("class")).includes(cls);

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".app", { timeout: 30000 });

await page.click(".tb-btn:has-text('Import')");
await page.setInputFiles("input[type=file]", {
  name: "ragged_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
});
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });

await page.waitForSelector(".table-pane .dv-toggle", { timeout: 30000 });
await page.locator(".dv-toggle button:has-text('Grouped sheet')").click();
await page.waitForSelector(".gs-canvas .gs-cell", { timeout: 15000 });

const prov = (await page.locator(".table-pane .provenance").innerText()).trim();
if (prov !== "3 × 2") fail(`expected a 3 × 2 ragged stack, got ${prov}`);
if (!(await hasClass(1, 1, "gs-blank")) || !(await hasClass(2, 1, "gs-blank")))
  fail("group B's rows 1 and 2 should be holes (gs-blank)");
console.log("ragged stack 3 × 2 with two holes under group B");

/* --- 1. paste a single value writes through the batch path --- */
await cell(0, 0).click();
await setClip("50");
await page.keyboard.press("Control+v");
await page.waitForFunction(() => {
  const c = document.querySelector('.gs-cell[data-r="0"][data-c="0"]');
  return c && c.textContent.trim() === "50";
}, null, { timeout: 10000 });
if (!/Pasted 1 cell/.test(await notice())) fail("paste should state 'Pasted 1 cell', got: " + await notice());
console.log("paste wrote one cell (1 -> 50):", (await notice()).trim());

/* --- 2. copy across a hole: the hole comes out as an empty field --- */
await cell(0, 0).click();
await cell(2, 1).click({ modifiers: ["Shift"] });
await page.keyboard.press("Control+c");
const tsv = await getClip();
if (tsv !== "50\t9\n2\t\n3\t")
  fail(`copy across holes should be "50\\t9\\n2\\t\\n3\\t", got ${JSON.stringify(tsv)}`);
console.log("copy across holes keeps blanks aligned:", JSON.stringify(tsv));

/* --- 3. clear the selection: editable cells go NA, the two holes are skipped
   and reported --- */
await page.keyboard.press("Delete");
await page.waitForFunction(() => {
  const c = document.querySelector('.gs-cell[data-r="0"][data-c="0"]');
  return c && c.textContent.trim() === "";
}, null, { timeout: 10000 });
const clearMsg = await notice();
if (!/Cleared 4 cells/.test(clearMsg) || !/2 cells outside the data were skipped/.test(clearMsg))
  fail("clear should state 4 written + 2 skipped, got: " + clearMsg);
console.log("clear wrote 4, skipped 2 holes:", clearMsg.trim());

/* --- 4. paste ONTO a hole is refused honestly (no tidy row to write) --- */
await cell(1, 1).click();
await setClip("99");
await page.keyboard.press("Control+v");
await page.waitForFunction(() => {
  const n = document.querySelector(".gs-notice span");
  return n && /Nothing to paste/.test(n.textContent);
}, null, { timeout: 5000 });
if (!/outside the editable data/.test(await notice()))
  fail("pasting onto a hole should say the target is outside the editable data, got: " + await notice());
if ((await cellText(1, 1)).trim() !== "") fail("a hole must stay blank after a refused paste");
console.log("paste onto a hole refused honestly:", (await notice()).trim());

/* --- 5. paste past the sheet edge writes what fits and reports the overflow
   (paste never grows the pivot) --- */
await cell(2, 0).click();
await setClip("7\t8\n88\t99");   // 2×2 anchored bottom-left: only (2,0) is in bounds
await page.keyboard.press("Control+v");
await page.waitForFunction(() => {
  const c = document.querySelector('.gs-cell[data-r="2"][data-c="0"]');
  return c && c.textContent.trim() === "7";
}, null, { timeout: 10000 });
const overMsg = await notice();
if (!/Pasted 1 cell/.test(overMsg) || !/3 cells outside the data were skipped/.test(overMsg))
  fail("overflow paste should write 1 and skip 3, got: " + overMsg);
console.log("overflow paste wrote 1, skipped 3:", overMsg.trim());

if (await page.locator(".error-bar").count() > 0)
  fail("unexpected error-bar: " + await page.locator(".error-bar").innerText());

console.log("PASS: grouped-sheet paste & clear write real rows, skip holes/overflow, and say so");
await browser.close();
