import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import * as pw from "playwright";

/* A figure in the lab-book export opens in the shipped Iris as a detached copy. The
   bundle is what eln/share.py writes: the page links the image to
   iris/index.html?embedded=../<figure>.iris.js, and that script hands Iris the file
   with its lab-book path and hash. Saving the copy keeps the figure's provenance and
   adds derived_from, and nothing leaves the folder.

     npm run build:web && node e2e/export_figure_test.mjs
     BROWSER=firefox SHOTS=/tmp node e2e/export_figure_test.mjs                    */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };

const bundle = mkdtempSync(join(tmpdir(), "iris-export-"));
symlinkSync(join(ROOT, "dist-web"), join(bundle, "iris"));
const figures = join(bundle, "reports", "x", "figures");
mkdirSync(figures, { recursive: true });
const data = readFileSync(join(ROOT, "src/examples/assets/contingency-2x2.iris"));
const sha256 = createHash("sha256").update(data).digest("hex");
const path = "reports/x/figures/fig.iris";
writeFileSync(join(figures, "fig.iris"), data);
writeFileSync(join(figures, "fig.iris.js"),
  `__irisDocument(${JSON.stringify({ name: "fig.iris", path, sha256, base64: data.toString("base64") })});\n`);
writeFileSync(join(figures, "fig.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
writeFileSync(join(bundle, "report-x.html"), '<!doctype html><title>x</title>'
  + '<a href="iris/index.html?embedded=../reports/x/figures/fig.iris.js" title="Open a copy in Iris">'
  + '<img src="reports/x/figures/fig.svg" alt="Fig"></a>');

const engineName = process.env.BROWSER ?? "chromium";
const browser = await pw[engineName].launch();
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
await context.setOffline(true);
const page = await context.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const outside = [];
/* the web build still takes its fonts from Google (a listed limit); everything else stays home */
page.on("request", (r) => { if (/^https?:/.test(r.url()) && !/^https:\/\/fonts\.g/.test(r.url())) outside.push(r.url()); });

await page.goto(`file://${join(bundle, "report-x.html")}`);
const t0 = Date.now();
await page.click("a[title='Open a copy in Iris']");
if (!page.url().includes("iris/index.html?embedded=")) fail(`the link went to ${page.url()}`);
await page.waitForSelector("[data-testid='plot-card'] .figure-frame svg", { timeout: 300000 });
console.log(`figure at ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (outside.length) fail(`reached outside the folder: ${outside.slice(0, 8).join(", ")}`);
if (await page.locator(".recovery-bar").count()) fail("a recovery offer covered the figure");
const save = page.locator("header .tb-primary");
if ((await save.textContent()).trim() !== "Save") fail(`the primary button says ${await save.textContent()}`);
if (!(await page.locator("header button:has-text('Load')").count())) fail("a detached copy should keep Load; it is missing");
if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/export-figure-${engineName}.png` });

// ── saving the copy: the figure's provenance survives, derived_from names the figure ──
const hasPicker = await page.evaluate(() => typeof window.showSaveFilePicker === "function");
let saved;
if (hasPicker) {
  await page.evaluate(() => {
    window.__saved = null;
    window.showSaveFilePicker = async () => ({ name: "document.iris", kind: "file",
      async createWritable() {
        return { async write(d) { window.__saved = btoa(String.fromCharCode(...new Uint8Array(await d.arrayBuffer()))); }, async close() {} };
      } });
  });
  await save.click();
  await page.waitForFunction(() => window.__saved !== null, null, { timeout: 30000 });
  saved = Buffer.from(await page.evaluate(() => window.__saved), "base64");
} else {
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), save.click()]);
  saved = readFileSync(await download.path());
}
const provenance = JSON.parse(new TextDecoder().decode(unzipSync(saved)["provenance.json"]));
if (provenance.source !== "iris-engine validation corpus") fail(`the figure's provenance was dropped: ${JSON.stringify(provenance)}`);
if (provenance.derived_from?.path !== path) fail(`derived_from is ${JSON.stringify(provenance.derived_from)}`);
if (provenance.derived_from.sha256 !== sha256) fail("derived_from carries the wrong hash");
if (!provenance.derived_from.time) fail("derived_from has no time");
console.log("PASS", engineName, `saved through ${hasPicker ? "the file picker" : "a download"}`);
await browser.close();
