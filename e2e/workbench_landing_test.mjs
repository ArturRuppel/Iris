import { openApp, importCsv, openMode, showPlot, showStats, showTable, waitForFigure, inspectorTab, fail } from "./helpers.mjs";

/* E2E: workbench landing → add first plot → add second layer.
   Imports a 2-group numeric CSV (group = categorical, value = numeric),
   opens the Workbench and confirms the landing state: the canvas opens no card
   by itself, and the empty figure node offers "+ add plot". Then each card a
   node opens (over the canvas, one at a time) is checked: the stats card shows
   its "add a plot first" stub, the table card is populated, and the plot card
   shows the add-plot CTA.
   Then drives the PlotWizard through "first" mode (type → map X/Y → Done),
   verifies the plot card populates (CTA gone, figure + layer strip in the
   inspector's Layers tab) and the stats stub clears, then runs "addLayer" mode
   (type → grain → Done) and confirms two layer-geom selects exist in the layer
   strip. Needs the engine and the vite dev server. */

const csv = [
  "group,value",
  "a,1", "a,2", "a,3", "a,4",
  "b,5", "b,6", "b,7", "b,8",
].join("\n");

const { browser, page } = await openApp();

// ── import dataset ────────────────────────────────────────────────────────────
await importCsv(page, "wl_fixture.csv", csv);
console.log("dataset imported");

// ── navigate to Workbench ─────────────────────────────────────────────────────
await openMode(page, "Workbench");
await page.locator(".react-flow__node-arrayShape .txw-node-add-plot").first()
  .waitFor({ state: "visible", timeout: 15000 });
if (await page.locator(".txw-focus").count())
  fail("a card opened over the canvas by itself on landing");
console.log("workbench landed: canvas only, figure node offers '+ add plot'");

// ── 1. landing state, card by card ────────────────────────────────────────────

await showStats(page);
await page.locator("[data-testid='stats-card'] .txw-card-stub").waitFor({ state: "visible", timeout: 5000 });
console.log("stats card: 'add a plot first' stub shown");

const table = await showTable(page);
// populated: the table card renders its table, not its empty stub
if (await page.locator("[data-testid='table-card'].txw-card-stub").count())
  fail("table card shows its empty stub after an import");
await page.waitForFunction(() => {
  const t = document.querySelector("[data-testid='table-card']")?.textContent ?? "";
  return /group/.test(t) && /value/.test(t);
}, { timeout: 15000 }).catch(async () =>
  fail(`table card does not show the imported columns: ${((await table.textContent()) ?? "").slice(0, 200)}`));
console.log("table card: populated");

await showPlot(page);
await page.locator(".txw-add-plot").waitFor({ state: "visible", timeout: 5000 });
console.log("plot card: add-plot CTA shown");

// ── 2. click "+ add plot" ─────────────────────────────────────────────────────
await page.click(".txw-add-plot");
await page.waitForSelector("[data-testid='plot-wizard']", { timeout: 10000 });
console.log("wizard opened (type step)");

// ── 3. pick Box geom ─────────────────────────────────────────────────────────
// The gallery shows only geoms satisfiable by the current columns (group=categorical,
// value=numeric). Box (categorical×numeric) will be present.
await page.locator(".wiz-geom", { hasText: "Box" }).first().click();
await page.waitForSelector(".wiz-step.wiz-map", { timeout: 10000 });
console.log("map step reached");

// ── 4. map X = group, Y = value ──────────────────────────────────────────────
await page.locator(".wiz-map .enc-row", { hasText: "X" }).locator("select").selectOption("group");
await page.locator(".wiz-map .enc-row", { hasText: "Y" }).locator("select").selectOption("value");
console.log("X=group, Y=value mapped");

// ── 5. click Done (enabled once X + Y are both mapped) ────────────────────────
await page.waitForSelector(".wiz-done:not([disabled])", { timeout: 5000 });
await page.click(".wiz-done");
await page.waitForSelector("[data-testid='plot-wizard']", { state: "detached", timeout: 10000 });
console.log("Done clicked — wizard closed");

// ── 6. the plot card populated, and the stats stub cleared ────────────────────
await page.waitForSelector(".txw-add-plot", { state: "detached", timeout: 10000 });
await waitForFigure(page);
await inspectorTab(page, "Layers");
await page.waitForSelector("[data-testid='layer-strip']", { timeout: 10000 });
console.log("plot card populated: figure + layer strip");

await showStats(page);
await page.waitForFunction(() => {
  return !document.querySelector("[data-testid='stats-card'] .txw-card-stub");
}, { timeout: 10000 }).catch(() => fail("stats card still shows its stub after a plot was built"));
console.log("stats stub cleared");

await showPlot(page);
await inspectorTab(page, "Layers");

// ── 7. click "+ add layer" ───────────────────────────────────────────────────
await page.click(".add-layer-btn");
await page.waitForSelector("[data-testid='plot-wizard']", { timeout: 10000 });
console.log("add-layer wizard opened (type step)");

// ── 8. pick Dots (categorical×numeric, satisfiable with the same encoding) ──
await page.locator(".wiz-geom", { hasText: "Dots" }).first().click();
await page.waitForSelector(".wiz-step.wiz-grain", { timeout: 10000 });
console.log("grain step reached");

// ── 9. click Done (grain step — Done is always enabled here) ─────────────────
await page.click(".wiz-done");
await page.waitForSelector("[data-testid='plot-wizard']", { state: "detached", timeout: 10000 });
console.log("add-layer Done clicked — wizard closed");

// ── 10. assert two layers exist in the strip ──────────────────────────────────
// Each layer card renders a <select title="Change plot type"> for the geom.
await inspectorTab(page, "Layers");
await page.waitForFunction(() => {
  return document.querySelectorAll("select[title='Change plot type']").length >= 2;
}, { timeout: 10000 }).catch(() => {});
const layerSelects = await page.locator("select[title='Change plot type']").count();
if (layerSelects !== 2)
  fail(`expected 2 layer-geom selects, got ${layerSelects}`);
console.log(`layer count confirmed: ${layerSelects}`);

if (page.errors.length) fail("page errors: " + page.errors.slice(0, 4).join(" | "));

console.log("WORKBENCH LANDING E2E OK");
await browser.close();
