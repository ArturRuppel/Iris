import { openApp, importCsv, openMode, waitForFigure, fail } from "./helpers.mjs";

/* Smoke for Phase 3d contingency tile: CATEGORICAL x × CATEGORICAL y is the
   describe-only contingency case. The tile/heatmap (fill = count) is the geom
   for that pair; adding it must draw a figure rather than crash the UI wiring
   (this is the exact class of bug — TEST_BY_FAMILY contingency key — that
   111243b showed only surfaces through the UI). The plot editor is the Plot
   card: a fresh analysis's figure node offers "+ add plot", which opens the
   plot card (full-screen over the canvas) with its wizard started; it lists the plot types
   the table's columns can satisfy (two categorical columns, no numeric one),
   then maps X and Y. Needs the engine and the vite dev server. */

// Fixture: two categorical columns (X and Y); the value is the cell count.
const csv = [
  "treatment,outcome",
  "control,fail", "control,fail", "control,pass",
  "drug_a,pass", "drug_a,pass", "drug_a,fail",
].join("\n");

const { browser, page } = await openApp();
await importCsv(page, "tile_fixture.csv", csv);

await openMode(page, "Workbench");
// the empty figure node's "+ add plot" opens the plot card with the wizard started
await page.locator(".react-flow__node-arrayShape .txw-node-add-plot").first().click();
const card = page.locator("[data-testid='plot-card']");
await card.waitFor({ state: "visible", timeout: 15000 });
await page.waitForSelector("[data-testid='plot-wizard']", { timeout: 10000 });

// The tile must be offered for a table of two categorical columns.
const offered = (await page.locator(".wiz-geom").allInnerTexts()).map((t) => t.trim());
console.log("plot types offered:", JSON.stringify(offered));
const tileBtn = page.locator(".wiz-geom", { hasText: "Tile" });
if (await tileBtn.count() === 0)
  fail("Tile not offered for categorical-x / categorical-y — contingency gate regressed");
await tileBtn.first().click();

// Map categorical X + categorical Y (the contingency pair).
await page.waitForSelector(".wiz-step.wiz-map", { timeout: 10000 });
await page.locator(".wiz-map .enc-row", { hasText: "X" }).locator("select").selectOption("treatment");
await page.locator(".wiz-map .enc-row", { hasText: "Y" }).locator("select").selectOption("outcome");
await page.waitForSelector(".wiz-done:not([disabled])", { timeout: 5000 });
await page.click(".wiz-done");
await page.waitForSelector("[data-testid='plot-wizard']", { state: "detached", timeout: 10000 });
await waitForFigure(page).catch(() => {});
await page.waitForTimeout(1000);

const figure = await card.locator(".figure-host svg").count();
const bar = await page.locator(".error-bar").count();
if (figure === 0 && bar === 0)
  fail("contingency tile: no figure and no status bar — rendered nothing");
if (figure > 0) {
  const svgText = await card.locator(".figure-host svg").textContent().catch(() => "");
  if (!svgText.includes("control") || !svgText.includes("fail"))
    fail("tile did not draw the categorical x/y levels");
  console.log("contingency tile rendered for categorical × categorical");
} else {
  console.log("guard/status bar shown (no crash)");
}

if (page.errors.length) fail("page errors: " + page.errors.slice(0, 4).join(" | "));

console.log("tile e2e ok");
await browser.close();
