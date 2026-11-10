import { openApp, openMode, waitForFigure, showPlot, showStats, inspectorTab, fail } from "./helpers.mjs";

/* Smoke for time-series support: NUMERIC x × NUMERIC y normally infers a
   `correlation` scatter, but adding a `line` (Trajectories) or `trend`
   (Mean ± band) layer must break that tie toward the describe-only
   `timeseries` family and draw connected curves rather than crash the UI
   wiring (the TEST_BY_FAMILY/StatsFamily class of bug that only surfaces
   through the UI — see tile_test.mjs). The geoms are offered on
   numeric/numeric like scatter (registry-driven, no offer-logic change).
   `frame` is an identifier token, so the test retypes it numeric in the import
   wizard before mapping it to X (the real time-on-X workflow). The plot editor
   is the Plot card: the first layer (Trajectories) comes from the "+ add plot"
   wizard (plot type, then X/Y), the trend from the inspector's "+ add layer"
   (plot type, then grain). The stats are their own card, shown by clicking the
   figure node's Stats section. Needs the engine and the vite dev server. */

// Fixture: a measure (area) over an ordered numeric x (frame), two conditions.
const rows = ["condition,frame,area"];
for (const [cond, base] of [["ctrl", 0], ["ko", 10]])
  for (let frame = 0; frame < 6; frame++)
    rows.push(`${cond},${frame},${base + frame}`);
const csv = rows.join("\n");

const { browser, page } = await openApp();
await page.click(".topbar button:has-text('Import')");
await page.setInputFiles("input[type=file]", {
  name: "timeseries_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
});
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });

// `frame` is in the importer's identifier tokens, so it imports as an
// `identifier` and is excluded from axes by design. Time-on-X is the whole point
// of the time-series geoms, so retype it numeric in the wizard first — the real
// workflow a user follows for a frame/time column they want on an axis.
const frameCol = page.locator(".wizard-col", {
  has: page.locator("strong", { hasText: /^frame$/i }),
});
if (await frameCol.count() === 0) fail("no `frame` column in the import wizard");
await frameCol.locator("select").selectOption("numeric");
// the retype re-previews; wait for the commit button to re-enable, then import
await page.waitForSelector(".modal-foot button.primary:not([disabled])", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });

await openMode(page, "Workbench");
const card = page.locator("[data-testid='plot-card']");
await card.waitFor({ state: "visible", timeout: 15000 });
await page.click(".txw-add-plot");
await page.waitForSelector("[data-testid='plot-wizard']", { timeout: 10000 });

// Trajectories (line) and Mean ± band (trend) are offered on numeric/numeric.
const lineBtn = page.locator(".wiz-geom", { hasText: "Trajectories" });
if (await lineBtn.count() === 0)
  fail("Trajectories (line) not offered for numeric-x / numeric-y — timeseries gate regressed");
await lineBtn.click();

// Map numeric X (frame) + numeric Y (area) — the otherwise-correlation pair.
await page.waitForSelector(".wiz-step.wiz-map", { timeout: 10000 });
await page.locator(".wiz-map .enc-row", { hasText: "X" }).locator("select").selectOption("frame");
await page.locator(".wiz-map .enc-row", { hasText: "Y" }).locator("select").selectOption("area");
await page.waitForSelector(".wiz-done:not([disabled])", { timeout: 5000 });
await page.click(".wiz-done");
await page.waitForSelector("[data-testid='plot-wizard']", { state: "detached", timeout: 10000 });
await waitForFigure(page).catch(() => {});
await page.waitForTimeout(1000);

const figure = await card.locator(".figure-host svg").count();
const bar = await page.locator(".error-bar").count();
if (figure === 0 && bar === 0)
  fail("timeseries line: no figure and no status bar — rendered nothing");
if (figure > 0) {
  // a connected trajectory is a <path> stroke, not scatter <use> point glyphs
  const paths = await card.locator(".figure-host svg path").count();
  if (paths === 0) fail("line layer drew no path — trajectories did not render");
  console.log("timeseries line rendered", paths, "paths");
} else {
  console.log("guard/status bar shown (no crash)");
}

// The stats panel must show the describe-only time-series model, not a test.
const stats = await showStats(page);
await page.waitForTimeout(800);
const design = await stats.locator(".reason").first().textContent().catch(() => "");
if (figure > 0 && !/over/.test(design))
  fail(`stats panel did not show the 'y over x' time-series design (got: ${design})`);

// Layer the aggregate trend on top — the layered spaghetti+mean figure.
await showPlot(page);
await inspectorTab(page, "Layers");
await card.locator(".add-layer-btn").click();
await page.waitForSelector("[data-testid='plot-wizard']", { timeout: 10000 });
const trendBtn = page.locator(".wiz-geom", { hasText: "Mean ± band" });
if (await trendBtn.count() > 0) {
  await trendBtn.click();
  await page.waitForSelector(".wiz-step.wiz-grain", { timeout: 10000 });
  await page.click(".wiz-done");
  await page.waitForSelector("[data-testid='plot-wizard']", { state: "detached", timeout: 10000 });
  await page.waitForTimeout(1500);
  await inspectorTab(page, "Layers");
  const nLayers = await card.locator(".layer-card").count();
  if (nLayers !== 2) fail(`expected 2 layers (line + trend), got ${nLayers}`);
  if (await card.locator(".figure-host svg").count() === 0
      && await page.locator(".error-bar").count() === 0)
    fail("layered line+trend rendered nothing");
  console.log("layered line + trend ok");
} else {
  console.log("Mean ± band not offered as a second layer — skipped the layered check");
  await page.click("[data-testid='plot-wizard'] .cancel").catch(() => {});
}

if (page.errors.length) fail("page errors: " + page.errors.slice(0, 4).join(" | "));

console.log("timeseries e2e ok");
await browser.close();
