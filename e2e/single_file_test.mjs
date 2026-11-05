import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as pw from "playwright";

/* A packed .iris opens by itself: alone in an empty folder, with the network off,
   and straight to its figure. Then the app packed alone (pack-iris --app, the
   offline download of the hosted page) boots the same way and opens an example.

     npm run build:web && node e2e/single_file_test.mjs
     BROWSER=firefox SHOTS=/tmp node e2e/single_file_test.mjs                    */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };
const dir = mkdtempSync(join(tmpdir(), "iris-single-"));
const source = join(dir, "figure.iris");
copyFileSync(join(ROOT, "src/examples/assets/contingency-2x2.iris"), source);
execFileSync("node", [join(ROOT, "tools/pack-iris.mjs"), source, join(dir, "packed.html")], { stdio: "inherit" });
const alone = mkdtempSync(join(tmpdir(), "iris-alone-"));
copyFileSync(join(dir, "packed.html"), join(alone, "figure.html"));
if (readdirSync(alone).length !== 1) fail("the folder is not empty");

const engineName = process.env.BROWSER ?? "chromium";
const browser = await pw[engineName].launch();
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
await context.setOffline(true);
const page = await context.newPage();
const outside = [];
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("request", (r) => {
  const url = r.url();
  if (!url.startsWith("data:") && !url.startsWith("blob:") && !url.endsWith("/figure.html")) outside.push(url);
});
const t0 = Date.now();
await page.goto(`file://${join(alone, "figure.html")}`, { waitUntil: "commit", timeout: 300000 });
await page.waitForSelector(".hm-status-band, .boot, #root *", { state: "attached", timeout: 120000 });
console.log(`first paint material at ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await page.waitForSelector("[data-testid='plot-card'] .figure-frame svg", { timeout: 300000 });
console.log(`figure at ${((Date.now() - t0) / 1000).toFixed(1)} s, file ${(statSync(join(alone, "figure.html")).size / 1e6).toFixed(0)} MB`);

if (outside.length) fail(`reached outside the file: ${outside.slice(0, 8).join(", ")}`);
if (!(await page.title()).startsWith("figure")) fail(`title is ${await page.title()}`);
if (await page.locator(".recovery-bar").count()) fail("a recovery offer covered the document");
const figureText = await page.locator("[data-testid='plot-card'] .figure-frame svg").count();
if (figureText < 1) fail("no figure");
if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/single-${engineName}.png` });

// the engine answers: a data edit reaches Python and the figure redraws
const before = await page.locator("[data-testid='plot-card'] .figure-frame svg").first().innerHTML();
await page.click(".tb-seg button:has-text('Data')");
const cell = page.locator(".data-mode .ag-center-cols-container .ag-cell").first();
await cell.click();
await cell.locator(".ag-picker-field-wrapper").click();
await page.locator(".ag-list-item:has-text('placebo')").click({ timeout: 10000 });
await page.click(".tb-seg button:has-text('Workbench')");
await page.waitForFunction((old) => {
  const svg = document.querySelector("[data-testid='plot-card'] .figure-frame svg");
  return svg && svg.innerHTML !== old;
}, before, { timeout: 60000 });
console.log("PASS document", engineName);
await page.close();

// ── the app alone: the offline download ─────────────────────────────────────
execFileSync("node", [join(ROOT, "tools/pack-iris.mjs"), "--app", join(dir, "app.html")], { stdio: "inherit" });
rmSync(join(alone, "figure.html"));
copyFileSync(join(dir, "app.html"), join(alone, "iris-offline.html"));
const app = await context.newPage();
const reached = [];
app.on("pageerror", (e) => console.log("[pageerror]", e.message));
app.on("request", (r) => {
  const url = r.url();
  if (!url.startsWith("data:") && !url.startsWith("blob:") && !url.endsWith("/iris-offline.html")) reached.push(url);
});
const t1 = Date.now();
await app.goto(`file://${join(alone, "iris-offline.html")}`, { waitUntil: "commit", timeout: 300000 });
await app.waitForSelector("header .tb-primary, h1:has-text('could not start')", { timeout: 300000 });
if (await app.locator("h1:has-text('could not start')").count()) fail("the app did not start");
console.log(`app at ${((Date.now() - t1) / 1000).toFixed(1)} s, file ${(statSync(join(alone, "iris-offline.html")).size / 1e6).toFixed(0)} MB`);
if ((await app.title()) !== "Iris") fail(`title is ${await app.title()}`);
if (await app.locator(".tb-offline").count()) fail("the offline file offers itself for download");
await app.click("button:has-text('Workbench')").catch(() => {});
await app.click("button:has-text('Open example')", { timeout: 15000 });
await app.waitForSelector("[data-testid='plot-card'] .figure-frame svg", { timeout: 120000 });
if (await app.locator(".error-bar").count()) fail(await app.locator(".error-bar").innerText());
const font = await app.evaluate(() => [...document.fonts].some((f) => f.family.includes("Archivo") && f.status === "loaded"));
if (!font) fail("Archivo is not loaded");
if (reached.length) fail(`reached outside the file: ${reached.slice(0, 8).join(", ")}`);
if (process.env.SHOTS) await app.screenshot({ path: `${process.env.SHOTS}/single-app-${engineName}.png` });
console.log("PASS app", engineName);
await browser.close();
rmSync(dir, { recursive: true, force: true });
rmSync(alone, { recursive: true, force: true });
