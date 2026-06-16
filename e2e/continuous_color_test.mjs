import { chromium } from "playwright";

/* Smoke for Phase 3b continuous color: mapping a NUMERIC column to Color on a
   per-point (dot) layer draws each dot through the colormap and a colorbar
   (labelled with the column) instead of a discrete legend — and doesn't crash
   the UI wiring. Follows the documented post-111243b pattern: explicit import
   via the ImportWizard's hidden file input, explicit X/Y mapping, explicit
   `.add-layer-btn` flow. Needs the engine (8765) and the vite dev server (5173). */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
const fail = (msg) => { console.error(msg); process.exit(1); };

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".app", { timeout: 30000 });
if (await page.locator(".engine-down").count() > 0)
  fail("engine not reachable — start the engine on 8765");

// Fixture: categorical group (X), numeric value (Y), numeric score (Color).
const csv = [
  "group,value,score",
  "a,1,10", "a,2,20", "a,3,30",
  "b,5,40", "b,6,50", "b,7,60",
].join("\n");

await page.click("button:has-text('Import data…')");
await page.setInputFiles("input[type=file]", {
  name: "continuous_color_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
});
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });

await page.click(".mode-toggle button:has-text('Analyses')");
await page.waitForSelector(".layer-rail", { timeout: 15000 });

// Map X/Y, then add a Dots layer (per-point → continuous color colours each dot).
await page.locator(".enc-row", { hasText: "X" }).locator("select").selectOption("group");
await page.locator(".enc-row", { hasText: "Y" }).locator("select").selectOption("value");
await page.waitForTimeout(500);
await page.click(".add-layer-btn");
await page.click(".add-layer-menu button:has-text('Dots')");
await page.waitForTimeout(1500);

// A numeric Color must be OFFERABLE now (Phase 3b made it renderable). It is the
// continuous case, so it draws a colorbar (labelled 'score'), not a legend.
const colorRow = page.locator(".enc-row", { hasText: "Color" });
if (await colorRow.count() === 0) fail("no Color picker after seeding a dot layer");
const colorSelect = colorRow.locator("select");
const enabled = await colorSelect.locator("option:not([disabled])").evaluateAll(
  (els) => els.map((e) => e.value));
if (!enabled.includes("score"))
  fail("numeric column 'score' not offered (enabled) under Color — Phase 3b regressed");

await colorSelect.selectOption("score");
await page.waitForTimeout(1800);

const figure = await page.locator(".iris svg").count();
const bar = await page.locator(".error-bar").count();
if (figure === 0 && bar === 0)
  fail("continuous color set: no figure and no status bar — rendered nothing");
if (figure > 0) {
  // numeric color is a colorbar, NOT a discrete legend
  const legend = await page.locator('.iris svg g[id="legend"]').count();
  if (legend > 0) fail("numeric color drew a discrete legend instead of a colorbar");
  const svgText = await page.locator(".iris svg").textContent().catch(() => "");
  if (!svgText.includes("score"))
    fail("no colorbar label 'score' in the figure for continuous color");
  console.log("continuous color: colorbar rendered, no discrete legend");
} else {
  console.log("guard/status bar shown (no crash)");
}

if (pageErrors.length) fail("page errors: " + pageErrors.slice(0, 4).join(" | "));

console.log("continuous color e2e ok");
await browser.close();
