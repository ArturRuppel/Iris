import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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

for (const hidden of ["New", "Load"])
  if (await iris.locator(`.topbar button:text-is('${hidden}')`).count()) fail(`${hidden} is still offered`);
if (!await iris.locator(".tb-seg button:has-text('Data')").count()) fail("the Data tab is gone");
if (!await iris.locator(".tb-seg button:has-text('Workbench')").count()) fail("the Workbench tab is gone");
if (!iris.url().includes("labbook=")) fail("the query was dropped, so a reload would lose the binding");
if (SHOTS) await iris.screenshot({ path: `${SHOTS}/bound.png` });

// edit: type a title into the plot's style pane
const irisBefore = read("fig.iris"), svgBefore = read("fig.svg").toString();
await iris.evaluate(() => { for (const d of document.querySelectorAll("[data-testid='plot-card'] details")) d.open = true; });
const title = iris.locator("[data-testid='plot-card'] input[type='text']").first();
await title.fill("Edited in the lab book");
await title.blur();
await until("the save", () => read("fig.svg").toString() !== svgBefore && sha(read("fig.iris")) !== sha(irisBefore));
await until("the saved status", async () => (await status.textContent()).includes("in the lab book"));
if (!read("fig.svg").toString().includes("<svg")) fail("the saved figure is not an SVG");

const versions = join(folder, ".versions/fig");
const names = readdirSync(versions);
const snapshot = names.find((n) => n.endsWith(".iris"));
if (!snapshot) fail(`no snapshot in ${names}`);
if (sha(readFileSync(join(versions, snapshot))) !== sha(irisBefore)) fail("the snapshot is not the previous file");
if (readFileSync(join(versions, snapshot.replace(".iris", ".svg"))).toString() !== svgBefore) fail("the snapshot SVG is not the previous one");

// the page shows the new figure when it is looked at again
await iris.bringToFront(); await book.bringToFront();
await book.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
await until("the image to reload", () => figure.evaluate((img, old) => img.src !== old, before));

// a second edit in the session adds a log line and no snapshot; a reload keeps it
const saved = sha(read("fig.iris"));
await title.fill("Edited twice");
await title.blur();
await until("the second save", () => sha(read("fig.iris")) !== saved);
await until("the saved status", async () => (await status.textContent()).includes("in the lab book"));
const log = readFileSync(join(versions, "log.jsonl"), "utf8").trim().split("\n");
if (log.length !== 2) fail(`expected 2 log lines, got ${log.length}`);
if (readdirSync(versions).filter((n) => n.endsWith(".iris")).length !== 1) fail("the same session snapshotted twice");

// a data edit saves too, so it reaches the file and redraws the figure
const beforeData = sha(read("fig.iris")), svgBeforeData = read("fig.svg").toString();
await iris.click(".tb-seg button:has-text('Data')");
if (SHOTS) await iris.screenshot({ path: `${SHOTS}/data-tab.png` });
const cell = iris.locator(".data-mode .ag-center-cols-container .ag-cell").first();
await cell.waitFor({ timeout: 15000 });
await cell.click();   // a categorical cell opens the list of its levels
await cell.locator(".ag-picker-field-wrapper").click();
await iris.locator(".ag-list-item:has-text('placebo')").click({ timeout: 10000 });
if (SHOTS) await iris.screenshot({ path: `${SHOTS}/data-edit.png` });
await until("the data edit to save", () => sha(read("fig.iris")) !== beforeData);
await until("the saved status", async () => (await status.textContent()).includes("in the lab book"));
if (read("fig.svg").toString() === svgBeforeData) fail("a data edit did not redraw the figure");
await iris.click(".tb-seg button:has-text('Workbench')");

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
const lines = () => readFileSync(join(versions, "log.jsonl"), "utf8").trim().split("\n").length;
await until("the first writer", () => lines() === 4);
const after = sha(read("fig.iris"));
await stale.bringToFront();
await stale.evaluate(() => { for (const d of document.querySelectorAll("[data-testid='plot-card'] details")) d.open = true; });
await stale.locator("[data-testid='plot-card'] input[type='text']").first().fill("Second writer");
await stale.locator(".tb-labbook:has-text('Not saved')").waitFor({ timeout: 15000 });
if (sha(read("fig.iris")) !== after) fail("a stale page overwrote the file");
await stale.close();

// a file with several plots opens but does not save back
const manyUrl = `${new URL(iris.url()).origin}/?labbook=${encodeURIComponent(`${BOOK}/documents/note/analysis/many.iris`)}`;
const many = await context.newPage();
await many.goto(manyUrl);
await many.locator(".tb-labbook:has-text('not saved to the lab book')").waitFor({ timeout: 60000 });
if (existsSync(join(folder, ".versions/many"))) fail("the three-plot file was saved");

console.log("PASS");
await browser.close();
