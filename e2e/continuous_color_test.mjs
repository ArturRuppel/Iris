import { openApp, importCsv, addFirstPlot, inspectorTab, fail } from "./helpers.mjs";

/* Smoke for Phase 3b continuous color: mapping a NUMERIC column to Color on a
   per-point (dot) layer draws each dot through the colormap and a colorbar
   (labelled with the column) instead of a discrete legend — and doesn't crash
   the UI wiring. The plot editor is the Plot card: the add-plot wizard builds
   the Dots layer with X/Y, then the inspector's Encoding tab hosts the
   EncodingsCard, where Color is an optional channel behind the "+ encoding"
   adder. Needs the engine and the vite dev server. */

// Fixture: categorical group (X), numeric value (Y), numeric score (Color).
const csv = [
  "group,value,score",
  "a,1,10", "a,2,20", "a,3,30",
  "b,5,40", "b,6,50", "b,7,60",
].join("\n");

const { browser, page } = await openApp();
await importCsv(page, "continuous_color_fixture.csv", csv);
// Dots: per-point, so continuous color colours each dot.
const card = await addFirstPlot(page, { geom: "Dots", x: "group", y: "value" });
await inspectorTab(page, "Encoding");

// A numeric Color must be OFFERABLE now (Phase 3b made it renderable). It is the
// continuous case, so it draws a colorbar (labelled 'score'), not a legend.
await card.locator(".enc-add-btn").click();
await card.locator(".enc-add-menu button:has-text('Color')").click();
const colorRow = card.locator(".plot-inspector .enc-row", { hasText: "Color" });
if (await colorRow.count() === 0) fail("no Color picker after seeding a dot layer");
const colorSelect = colorRow.locator("select");
const enabled = await colorSelect.locator("option:not([disabled])").evaluateAll(
  (els) => els.map((e) => e.value));
if (!enabled.includes("score"))
  fail("numeric column 'score' not offered (enabled) under Color — Phase 3b regressed");

await colorSelect.selectOption("score");
await page.waitForTimeout(1800);

const figure = await card.locator(".figure-host svg").count();
const bar = await page.locator(".error-bar").count();
if (figure === 0 && bar === 0)
  fail("continuous color set: no figure and no status bar — rendered nothing");
if (figure > 0) {
  // numeric color is a colorbar, NOT a discrete legend
  const legend = await card.locator('.figure-host svg g[id="legend"]').count();
  if (legend > 0) fail("numeric color drew a discrete legend instead of a colorbar");
  const svgText = await card.locator(".figure-host svg").textContent().catch(() => "");
  if (!svgText.includes("score"))
    fail("no colorbar label 'score' in the figure for continuous color");
  console.log("continuous color: colorbar rendered, no discrete legend");
} else {
  console.log("guard/status bar shown (no crash)");
}

if (page.errors.length) fail("page errors: " + page.errors.slice(0, 4).join(" | "));

console.log("continuous color e2e ok");
await browser.close();
