import { openApp, importCsv, addFirstPlot, openMode, inspectorTab, fail } from "./helpers.mjs";

/* Smoke for the composable layer stack: add/remove mutate the stack. No
   fixture CSV exists on disk, so the table is imported via an in-memory
   buffer. The plot editor is the Plot card: a fresh analysis has no layers
   (the card offers only "+ add plot"); the add-plot wizard seeds the first
   layer, the Layers tab of the plot inspector lists one `.layer-card` per
   layer, and its "+ add layer" button reopens the wizard in add-layer mode
   (plot type, then grain). Everything is scoped to the plot card. Needs the
   engine and the vite dev server. */

const csv = [
  "group,value",
  "a,1", "a,2", "a,3", "a,4",
  "b,5", "b,6", "b,7", "b,8",
].join("\n");

const { browser, page } = await openApp();
await importCsv(page, "layers_fixture.csv", csv);

// A fresh plottable starts with zero layers: the plot card offers only "+ add plot".
await openMode(page, "Workbench");
const card = page.locator("[data-testid='plot-card']");
await card.waitFor({ state: "visible", timeout: 15000 });
await card.locator(".txw-add-plot").waitFor({ state: "visible", timeout: 10000 });
const initial = await card.locator(".layer-card").count();
if (initial !== 0) fail(`expected a fresh plottable to start with 0 layers, got ${initial}`);

// The wizard seeds the first layer: the first plot type it offers, X/Y mapped.
// Peek at the gallery for that label, cancel (which must roll nothing in), then
// build it through the shared helper.
await page.click(".txw-add-plot");
await page.waitForSelector("[data-testid='plot-wizard']", { timeout: 10000 });
const geomLabel = (await page.locator(".wiz-geom").first().textContent()).trim();
await page.click("[data-testid='plot-wizard'] .cancel");
await page.waitForSelector("[data-testid='plot-wizard']", { state: "detached", timeout: 10000 });
await addFirstPlot(page, { geom: geomLabel, x: "group", y: "value" });
await inspectorTab(page, "Layers");
const seeded = await card.locator(".layer-card").count();
if (seeded !== 1) fail(`expected 1 layer after the first add, got ${seeded}`);
console.log(`seeded layers: ${seeded} (${geomLabel})`);

// Add a second layer through the add-layer wizard (if any geom is offered).
await card.locator(".add-layer-btn").click();
await page.waitForSelector("[data-testid='plot-wizard']", { timeout: 10000 });
const addable = await page.locator(".wiz-geom").count();
if (addable > 0) {
  await page.locator(".wiz-geom").first().click();
  await page.waitForSelector(".wiz-step.wiz-grain", { timeout: 10000 });
  await page.click(".wiz-done");
  await page.waitForSelector("[data-testid='plot-wizard']", { state: "detached", timeout: 10000 });
  await inspectorTab(page, "Layers");
  const after = await card.locator(".layer-card").count();
  if (after !== seeded + 1) fail(`add layer: expected ${seeded + 1}, got ${after}`);
  console.log("added a layer:", after);
} else {
  await page.click("[data-testid='plot-wizard'] .cancel");
  await page.waitForSelector("[data-testid='plot-wizard']", { state: "detached", timeout: 10000 });
  await inspectorTab(page, "Layers");
}

// Remove the last layer.
const before = await card.locator(".layer-card").count();
await card.locator(".layer-card .icon[title='Remove layer']").last().click();
const removed = await card.locator(".layer-card").count();
if (removed !== before - 1) fail(`remove layer: expected ${before - 1}, got ${removed}`);
console.log("removed a layer:", removed);

// The app responds gracefully: either a rendered figure, or an informative
// bar (e.g. the point-cap guard on a large sample) — never a blank crash.
await page.waitForTimeout(1500);
const figure = await card.locator(".figure-host svg").count();
const bar = await page.locator(".error-bar").count();
if (figure === 0 && bar === 0)
  fail("no figure and no status bar — the app rendered nothing");
console.log(figure ? "figure rendered" : "guard/status bar shown (no crash)");

if (page.errors.length) fail("page errors: " + page.errors.slice(0, 4).join(" | "));

console.log("layers e2e ok");
await browser.close();
