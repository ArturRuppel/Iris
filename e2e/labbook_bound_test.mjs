import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/* A figure on a served lab-book page opens in Iris bound to its file, and an edit
   reaches both files and the page. Needs a Mnemosyne and a served Iris, started on
   a throwaway data root holding documents/note/analysis/fig.{iris,svg} and a
   three-plot many.{iris,svg}:

     BOOK=http://127.0.0.1:5101 ROOT=/tmp/book node e2e/labbook_bound_test.mjs  */

const { BOOK, ROOT, SHOTS } = process.env;
const folder = join(ROOT, "documents/note/analysis");
const read = (name) => readFileSync(join(folder, name));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };
const until = async (what, test, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await test()) return; await new Promise((r) => setTimeout(r, 200)); }
  fail(`timed out waiting for ${what}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const book = await context.newPage();
await book.goto(`${BOOK}/documents.html`);
await book.click(".report-header");
const figure = book.locator("img[src*='fig.svg']").first();
await figure.waitFor();
await until("the figure link", () => figure.evaluate((img) => img.closest("a")?.href.includes("labbook=")));
if (await book.locator("img[src*='many.svg']").first().evaluate((img) => img.closest("a")?.href.includes("labbook=") ?? false))
  fail("a three-plot figure got a bound link");
const before = await figure.evaluate((img) => img.src);

const [iris] = await Promise.all([context.waitForEvent("page"), figure.click()]);
iris.on("pageerror", (e) => console.log("[pageerror]", e.message));
const status = iris.locator(".tb-labbook");
await until("the file to open", async () => (await status.textContent().catch(() => ""))?.includes("in the lab book"));
await iris.waitForSelector("[data-testid='plot-card'] .figure-frame svg", { timeout: 60000 });

for (const hidden of ["New", "Open"])
  if (await iris.locator(`.topbar button:text-is('${hidden}')`).count()) fail(`${hidden} is still offered`);
if (!await iris.locator(".tb-seg button:has-text('Data')").count()) fail("the Data tab is gone");
if (!await iris.locator(".tb-seg button:has-text('Workbench')").count()) fail("the Workbench tab is gone");
if (!iris.url().includes("labbook=")) fail("the query was dropped, so a reload would lose the binding");
if (SHOTS) await iris.screenshot({ path: `${SHOTS}/bound.png` });

const saveButton = iris.locator(".topbar button:has-text('Save to lab book')");
const inBook = () => until("the saved status", async () => (await status.textContent()).includes("in the lab book"));
const log = join(folder, "fig.log.jsonl");
const lines = () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").length : 0;

// an edit waits for Save to lab book: the file stays as it was, and the bar says so
const irisBefore = read("fig.iris"), svgBefore = read("fig.svg").toString();
await iris.evaluate(() => { for (const d of document.querySelectorAll("[data-testid='plot-card'] details")) d.open = true; });
const title = iris.locator("[data-testid='plot-card'] input[type='text']").first();
await title.fill("Edited in the lab book");
await title.blur();
await until("the unsaved status", async () => (await status.textContent()).includes("unsaved edits"));
await iris.waitForTimeout(5000);
if (sha(read("fig.iris")) !== sha(irisBefore)) fail("an edit rewrote the file without a save");

await saveButton.click();
await until("the save", () => read("fig.svg").toString() !== svgBefore && sha(read("fig.iris")) !== sha(irisBefore));
await inBook();
if (!read("fig.svg").toString().includes("<svg")) fail("the saved figure is not an SVG");
if (lines() !== 1) fail(`expected 1 log line, got ${lines()}`);
if (existsSync(join(folder, ".versions"))) fail("a save made a version folder");

// the page shows the new figure when it is looked at again
await iris.bringToFront(); await book.bringToFront();
await book.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
await until("the image to reload", () => figure.evaluate((img, old) => img.src !== old, before));

// a data edit saves too, and redraws the figure
const beforeData = sha(read("fig.iris")), svgBeforeData = read("fig.svg").toString();
await iris.bringToFront();
await iris.click(".tb-seg button:has-text('Data')");
if (SHOTS) await iris.screenshot({ path: `${SHOTS}/data-tab.png` });
const cell = iris.locator(".data-mode .ag-center-cols-container .ag-cell").first();
await cell.waitFor({ timeout: 15000 });
await cell.click();   // a categorical cell opens the list of its levels
await cell.locator(".ag-picker-field-wrapper").click();
await iris.locator(".ag-list-item:has-text('placebo')").click({ timeout: 10000 });
await until("the unsaved status", async () => (await status.textContent()).includes("unsaved edits"));
await saveButton.click();
await until("the data edit to save", () => sha(read("fig.iris")) !== beforeData);
await inBook();
if (read("fig.svg").toString() === svgBeforeData) fail("a data edit did not redraw the figure");
if (lines() !== 2) fail(`expected 2 log lines, got ${lines()}`);
await iris.click(".tb-seg button:has-text('Workbench')");

// the save marked the file and kept what the file already recorded
const python = process.env.PYTHON ?? "python3";
const provenance = JSON.parse(execFileSync(python, ["-c",
  `import sys,zipfile;print(zipfile.ZipFile(sys.argv[1]).read("provenance.json").decode())`, join(folder, "fig.iris")], { encoding: "utf8" }));
if (!provenance.hand_edited?.time) fail("the save did not mark the file as hand-edited");
if (provenance.source !== "e2e fixture") fail("the save dropped the provenance");

await iris.reload();
await until("the reopen", async () => (await status.textContent().catch(() => ""))?.includes("in the lab book"));
await iris.waitForSelector("[data-testid='plot-card'] .figure-frame svg", { timeout: 60000 });

// someone else changes the file: the next save is refused and says so
const stale = await context.newPage();
await stale.goto(iris.url());
await stale.locator(".tb-labbook:has-text('in the lab book')").waitFor({ timeout: 60000 });
await stale.waitForSelector("[data-testid='plot-card'] .figure-frame svg", { timeout: 60000 });
await iris.bringToFront();
await iris.evaluate(() => { for (const d of document.querySelectorAll("[data-testid='plot-card'] details")) d.open = true; });
await iris.locator("[data-testid='plot-card'] input[type='text']").first().fill("First writer");
await until("the first edit", async () => (await status.textContent()).includes("unsaved edits"));
await saveButton.click();
await until("the first writer", () => lines() === 3);
const after = sha(read("fig.iris"));
await stale.bringToFront();
await stale.evaluate(() => { for (const d of document.querySelectorAll("[data-testid='plot-card'] details")) d.open = true; });
await stale.locator("[data-testid='plot-card'] input[type='text']").first().fill("Second writer");
await stale.locator(".tb-labbook:has-text('unsaved edits')").waitFor({ timeout: 15000 });
await stale.locator(".topbar button:has-text('Save to lab book')").click();
await stale.locator(".tb-labbook:has-text('Not saved')").waitFor({ timeout: 15000 });
if (sha(read("fig.iris")) !== after) fail("a stale page overwrote the file");
await stale.close();

// a file with several plots opens but does not save back
const manyUrl = `${new URL(iris.url()).origin}/?labbook=${encodeURIComponent(`${BOOK}/documents/note/analysis/many.iris`)}`;
const many = await context.newPage();
await many.goto(manyUrl);
await many.locator(".tb-labbook:has-text('not saved to the lab book')").waitFor({ timeout: 60000 });
if (await many.locator(".topbar button:has-text('Save to lab book')").isEnabled()) fail("a three-plot file offered a save");
if (existsSync(join(folder, "many.log.jsonl"))) fail("the three-plot file was saved");

console.log("PASS");
await browser.close();
