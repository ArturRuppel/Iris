import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import * as pw from "playwright";

/* E2E for the static web build: no engine server exists, only files. Serves
   dist-web/ under /Iris/ because GitHub Pages and most static hosts use a subpath,
   and an absolute URL anywhere would break there and nowhere else.

     npm run build:web && node e2e/browser_runtime_test.mjs
     BROWSER=firefox ORIGIN=file node e2e/browser_runtime_test.mjs

   ORIGIN=file opens the site as colleagues do from the lab-book export on a file
   share, which is the stricter of the two: Chromium blocks fetch, modules and
   file-backed workers there. */

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist-web");
const PREFIX = "/Iris/";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm",
  ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".iris": "application/zip" };
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };

let bytesServed = 0;
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (!path.startsWith(PREFIX)) { res.writeHead(404).end(); return; }
  let file = normalize(join(DIST, path.slice(PREFIX.length)));
  if (file === DIST || file === `${DIST}/`) file = join(DIST, "index.html");
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  bytesServed += statSync(file).size;
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Cache-Control": "max-age=3600" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const overFile = process.env.ORIGIN === "file";
const URL_ = overFile ? `file://${join(DIST, "index.html")}` : `http://127.0.0.1:${server.address().port}${PREFIX}`;

const engineName = process.env.BROWSER ?? "chromium";
const browser = await pw[engineName].launch();
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
const hosts = new Set();
context.on("request", (r) => { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol) && u.host !== new URL(URL_).host && u.host !== "iris-payload.invalid") hosts.add(u.host); });

async function open() {
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  const t0 = Date.now();
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".app", { timeout: 180000 });
  return { page, seconds: (Date.now() - t0) / 1000 };
}

process.on("uncaughtException", async (e) => {
  console.error("FAIL:", e.message);
  for (const c of context.pages()) await c.screenshot({ path: process.env.FAILSHOT ?? "/tmp/iris-browser-e2e.png" }).catch(() => {});
  process.exit(1);
});

const csv = ["group,value", "a,1", "a,2", "a,3", "a,4", "b,5", "b,6", "b,7", "b,8"].join("\n");

// ── cold boot ────────────────────────────────────────────────────────────────
const cold = await open();
const page = cold.page;
console.log(`boot ${cold.seconds.toFixed(1)} s (${engineName}, ${overFile ? "file://" : "http"})`);
const snapshot = await page.evaluate(() => document.body.innerText.length);
if (!snapshot) fail("the app rendered nothing");
if (await page.locator(".recovery-bar").count()) fail("recovery offered on a fresh profile");
// served over http the page offers its one-file twin; over file:// it does not
const offline = await page.locator("header a.tb-offline").count();
if (overFile ? offline : offline !== 1) fail(`offline link count ${offline} over ${overFile ? "file://" : "http"}`);
if (!overFile && await page.locator("header a.tb-offline").getAttribute("href") !== "./iris-offline.html") fail("offline link target");

// ── a bundled example opens, because a file:// page cannot fetch one from disk ──
await page.click("button:has-text('Workbench')").catch(() => {});
await page.waitForSelector("button:has-text('Open example')", { timeout: 15000 });
await page.click("button:has-text('Open example')");
await page.waitForSelector("[data-testid='plot-card'] svg", { timeout: 60000 });
if (await page.locator(".error-bar").count()) fail(await page.locator(".error-bar").innerText());
console.log("bundled example opened");
await page.click("header .tb-ghost:has-text('New')");
await page.locator("button:has-text('Discard'), button:has-text('Don')").first().click({ timeout: 3000 }).catch(() => {});

// ── import, plot, compute ────────────────────────────────────────────────────
await page.click("header .tb-ghost:has-text('Import')");
await page.setInputFiles("input[type=file]", { name: "fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
await page.waitForSelector(".modal-foot button.primary", { timeout: 30000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 30000 }).catch(() => {});
await page.click(".tb-seg button:has-text('Workbench')");
await page.waitForSelector(".txw-add-plot", { timeout: 15000 });
await page.click(".txw-add-plot");
await page.waitForSelector("[data-testid='plot-wizard']", { timeout: 10000 });
await page.locator(".wiz-geom", { hasText: "Box" }).click();
await page.waitForSelector(".wiz-step.wiz-map", { timeout: 10000 });
await page.locator(".enc-row", { hasText: "X" }).locator("select").selectOption("group");
await page.locator(".enc-row", { hasText: "Y" }).locator("select").selectOption("value");
await page.waitForSelector(".wiz-done:not([disabled])", { timeout: 10000 });
await page.click(".wiz-done");
await page.waitForSelector("[data-testid='plot-wizard']", { state: "detached", timeout: 10000 });
await page.waitForSelector("[data-testid='plot-card'] svg", { timeout: 60000 });
const marks = await page.locator("[data-testid='plot-card'] svg path, [data-testid='plot-card'] svg use").count();
if (marks < 5) fail(`the figure drew only ${marks} marks`);
if (await page.locator(".error-bar").count()) fail(await page.locator(".error-bar").innerText());
console.log(`figure rendered in the browser (${marks} marks)`);
await page.screenshot({ path: process.env.SHOT ?? "/dev/null" }).catch(() => {});

// ── autosave survives the page ───────────────────────────────────────────────
await page.waitForTimeout(4000); // the debounced snapshot, then its flush to browser storage
await page.close();
const warm = await open();
console.log(`warm boot ${warm.seconds.toFixed(1)} s`);
await warm.page.waitForSelector(".recovery-bar", { timeout: 15000 });
await warm.page.click(".recovery-bar button:has-text('Restore')");
await warm.page.waitForSelector("[data-testid='plot-card'] svg", { timeout: 60000 });
console.log("autosave restored after closing the page");

// ── saving produces a real .iris file ────────────────────────────────────────
const hasPicker = await warm.page.evaluate(() => typeof window.showSaveFilePicker === "function");
if (hasPicker) {
  await warm.page.evaluate(() => {
    window.__saved = 0;
    window.showSaveFilePicker = async () => ({ name: "document.iris", kind: "file",
      async createWritable() { return { async write(d) { window.__saved += d.size ?? d.byteLength ?? 0; }, async close() {} }; } });
  });
  await warm.page.click("header .tb-primary");
  await warm.page.waitForFunction(() => window.__saved > 0, null, { timeout: 30000 });
} else {
  const [download] = await Promise.all([warm.page.waitForEvent("download", { timeout: 30000 }), warm.page.click("header .tb-primary")]);
  if (!download.suggestedFilename().endsWith(".iris")) fail(`saved ${download.suggestedFilename()}`);
}
console.log(`saved a document through ${hasPicker ? "the file picker" : "a download"}`);

// ── what left the machine ────────────────────────────────────────────────────
// the fonts are bundled too: nothing at all leaves the machine
if (hosts.size) fail(`contacted other hosts: ${[...hosts].join(", ")}`);
console.log("other hosts contacted: none");

console.log(`BROWSER RUNTIME E2E OK (${engineName})`);
await browser.close();
server.close();
