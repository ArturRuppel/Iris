import { chromium } from "playwright";

/* Excel-like editing on the tidy ENTRY surface (editor-ergonomics slice 3): the
   empty-state grid you type into before a table exists now uses the same shared
   interaction model as the grouped lens (useGridSelection) — select, range,
   arrow nav, copy, paste (growing to fit), clear. Entry holds arbitrary text and
   grows freely (no holes), which is the difference from the numeric lens body.

   Needs the engine (port 8765) and the vite dev server (port 5173) running. */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await context.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };
const td = (r, c) => page.locator(`td[data-r="${r}"][data-c="${c}"]`);
const text = (r, c) => td(r, c).locator(".de-celltext").innerText();
const setClip = (t) => page.evaluate((s) => navigator.clipboard.writeText(s), t);
const getClip = () => page.evaluate(() => navigator.clipboard.readText());
const cols = () => page.locator(".de-heads .de-colcell").count();
const enter = async (r, c, v) => {
  await td(r, c).dblclick();
  await page.fill(`[data-cell="${r}:${c}"]`, v);
  await page.keyboard.press("Enter");
};

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".app", { timeout: 30000 });
await page.click(".tb-seg button:has-text('Data')");
await page.waitForSelector(".de-inline .de-grid", { timeout: 10000 });
if (await cols() !== 2) fail(`entry should start with 2 columns, got ${await cols()}`);
console.log("empty entry surface: 2 starting columns");

/* --- fill a 2×2 block, then copy it as TSV --- */
await enter(0, 0, "1"); await enter(0, 1, "2");
await enter(1, 0, "3"); await enter(1, 1, "4");
await td(0, 0).click();
await td(1, 1).click({ modifiers: ["Shift"] });
if (await page.locator("td.de-body.de-sel").count() !== 4)
  fail(`shift-click should select a 2×2 block, got ${await page.locator("td.de-body.de-sel").count()}`);
await page.keyboard.press("Control+c");
const tsv = await getClip();
if (tsv !== "1\t2\n3\t4") fail(`copied TSV should be "1\\t2\\n3\\t4", got ${JSON.stringify(tsv)}`);
console.log("select range + Ctrl+C copied:", JSON.stringify(tsv));

/* --- clear the block --- */
await page.keyboard.press("Delete");
await page.waitForFunction(() => {
  const t = document.querySelector('td[data-r="0"][data-c="0"] .de-celltext');
  return t && t.textContent.trim() === "";
}, null, { timeout: 5000 });
if ((await text(1, 1)).trim() !== "") fail("clear should blank the whole selected block");
console.log("Delete cleared the selected block");

/* --- paste TEXT (entry is not numeric-only) anchored at (0,0) --- */
await td(0, 0).click();
await setClip("KO\tWT\nlow\thigh");
await page.keyboard.press("Control+v");
await page.waitForFunction(() => {
  const t = document.querySelector('td[data-r="0"][data-c="0"] .de-celltext');
  return t && t.textContent.trim() === "KO";
}, null, { timeout: 5000 });
if ((await text(0, 1)).trim() !== "WT" || (await text(1, 0)).trim() !== "low" || (await text(1, 1)).trim() !== "high")
  fail("paste should fill the 2×2 block with the clipboard text");
console.log("paste wrote a text block: KO/WT/low/high");

/* --- paste grows the grid: a 3-wide block adds a column (entry has no fixed grain) --- */
await td(0, 0).click();
await setClip("p\tq\tr");
await page.keyboard.press("Control+v");
await page.waitForFunction(() => document.querySelectorAll(".de-heads .de-colcell").length === 3,
  null, { timeout: 5000 });
if ((await text(0, 2)).trim() !== "r") fail("paste past the right edge should grow a new column and fill it");
console.log("paste past the edge grew the grid to", await cols(), "columns");

/* --- arrow navigation moves the active cell --- */
await td(0, 0).click();
await page.keyboard.press("ArrowDown");
if (!(await td(1, 0).getAttribute("class")).includes("de-active"))
  fail("ArrowDown should move the active cell down one row");
console.log("arrow nav moves the active cell");

console.log("PASS: entry surface edits like Excel — select, copy, clear, paste-with-growth, nav");
await browser.close();
