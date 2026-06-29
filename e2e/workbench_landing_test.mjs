import { chromium } from "playwright";

/* E2E: workbench landing → add first plot → add second layer.
   Imports a 2-group numeric CSV (group = categorical, value = numeric),
   opens the Workbench, confirms the two hero cards start disabled, drives
   the PlotWizard through "first" mode (type → map X/Y → Done), verifies
   both hero cards unlock, then runs "addLayer" mode (type → grain → Done)
   and confirms two layer-geom selects exist in the layer strip.
   Needs the engine (8765) and the vite dev server (5173). */

const csv = [
  "group,value",
  "a,1", "a,2", "a,3", "a,4",
  "b,5", "b,6", "b,7", "b,8",
].join("\n");

const URL = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
const fail = (m) => { console.error("FAIL:", m); process.exit(1); };

// ── boot ──────────────────────────────────────────────────────────────────────
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".app", { timeout: 30000 });
if (await page.locator(".engine-down").count() > 0)
  fail("engine not reachable — start the engine on 8765");

// ── import dataset ────────────────────────────────────────────────────────────
await page.click("button:has-text('Import data…')");
await page.setInputFiles("input[type=file]", {
  name: "wl_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
});
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 }).catch(() => {});
console.log("dataset imported");

// ── navigate to Workbench ─────────────────────────────────────────────────────
await page.click(".mode-toggle button:has-text('Workbench')");
// The landing row appears once HeroCards mounts.
await page.waitForSelector("[data-testid='hero-row']", { timeout: 15000 });
console.log("workbench landed");

// ── 1. assert landing state: Plot + Stats disabled, Table visible ──────────────
const heroPlot = page.locator("[data-testid='hero-plot']");
const heroStats = page.locator("[data-testid='hero-stats']");
const tableCard = page.locator("[data-testid='table-card']");

const plotClass = await heroPlot.getAttribute("class");
if (!plotClass?.includes("txw-card-disabled"))
  fail(`hero-plot should be disabled on landing, class was: ${plotClass}`);

const statsClass = await heroStats.getAttribute("class");
if (!statsClass?.includes("txw-card-disabled"))
  fail(`hero-stats should be disabled on landing, class was: ${statsClass}`);

await tableCard.waitFor({ state: "visible", timeout: 5000 });
console.log("landing assertions ok: hero-plot and hero-stats disabled, table-card visible");

// ── 2. click "+ add plot" ─────────────────────────────────────────────────────
await page.click(".txw-add-plot");
await page.waitForSelector("[data-testid='plot-wizard']", { timeout: 10000 });
console.log("wizard opened (type step)");

// ── 3. pick Box geom ─────────────────────────────────────────────────────────
// The gallery shows only geoms satisfiable by the current columns (group=categorical,
// value=numeric). Box (categorical×numeric) will be present.
await page.locator(".wiz-geom", { hasText: "Box" }).click();
// "first" mode: type → map
await page.waitForSelector(".wiz-step.wiz-map", { timeout: 10000 });
console.log("map step reached");

// ── 4. map X = group, Y = value via EncodingsCard selects ────────────────────
await page.locator(".enc-row", { hasText: "X" }).locator("select").selectOption("group");
await page.locator(".enc-row", { hasText: "Y" }).locator("select").selectOption("value");
console.log("X=group, Y=value mapped");

// ── 5. click Done (enabled once X + Y are both mapped) ────────────────────────
await page.waitForSelector(".wiz-done:not([disabled])", { timeout: 5000 });
await page.click(".wiz-done");
// wizard unmounts; plot card now shows FigurePane + LayerStrip
await page.waitForSelector("[data-testid='plot-wizard']", { state: "detached", timeout: 10000 });
console.log("Done clicked — wizard closed");

// ── 6. assert hero cards are now enabled ──────────────────────────────────────
// Give the spec a moment to propagate.
await page.waitForFunction(() => {
  const el = document.querySelector("[data-testid='hero-plot']");
  return el && !el.classList.contains("txw-card-disabled");
}, { timeout: 10000 });

const plotClassAfter = await heroPlot.getAttribute("class");
if (plotClassAfter?.includes("txw-card-disabled"))
  fail(`hero-plot should be enabled after add-plot, class: ${plotClassAfter}`);

const statsClassAfter = await heroStats.getAttribute("class");
if (statsClassAfter?.includes("txw-card-disabled"))
  fail(`hero-stats should be enabled after add-plot, class: ${statsClassAfter}`);

await page.waitForSelector("[data-testid='layer-strip']", { timeout: 10000 });
console.log("hero-plot and hero-stats enabled; layer-strip visible");

// ── 7. click "+ add layer" ───────────────────────────────────────────────────
await page.click(".add-layer-btn");
await page.waitForSelector("[data-testid='plot-wizard']", { timeout: 10000 });
console.log("add-layer wizard opened (type step)");

// ── 8. pick Dots (also categorical×numeric, satisfiable with same encoding) ──
// In addLayer mode the gallery only shows geoms compatible with the existing
// X/Y types. Dots is categorical×numeric → it will appear.
await page.locator(".wiz-geom", { hasText: "Dots" }).click();
// "addLayer" mode: type → grain
await page.waitForSelector(".wiz-step.wiz-grain", { timeout: 10000 });
console.log("grain step reached");

// ── 9. click Done (grain step — Done is always enabled here) ─────────────────
await page.click(".wiz-done");
await page.waitForSelector("[data-testid='plot-wizard']", { state: "detached", timeout: 10000 });
console.log("add-layer Done clicked — wizard closed");

// ── 10. assert two layers exist in the strip ──────────────────────────────────
// Each layer card renders a <select title="Change plot type"> for the geom.
await page.waitForFunction(() => {
  return document.querySelectorAll("select[title='Change plot type']").length >= 2;
}, { timeout: 10000 });
const layerSelects = await page.locator("select[title='Change plot type']").count();
if (layerSelects !== 2)
  fail(`expected 2 layer-geom selects, got ${layerSelects}`);
console.log(`layer count confirmed: ${layerSelects}`);

if (pageErrors.length) fail("page errors: " + pageErrors.slice(0, 4).join(" | "));

console.log("WORKBENCH LANDING E2E OK");
await browser.close();
