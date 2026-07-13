import { chromium } from "playwright";

/* Smoke for time-series support: NUMERIC x × NUMERIC y normally infers a
   `correlation` scatter, but adding a `line` (Trajectories) or `trend`
   (Mean ± band) layer must break that tie toward the describe-only
   `timeseries` family and draw connected curves rather than crash the UI
   wiring (the TEST_BY_FAMILY/StatsFamily class of bug that only surfaces
   through the UI — see tile_test.mjs). The geoms are offered on
   numeric/numeric like scatter (registry-driven, no offer-logic change).
   `frame` is an identifier token, so the test retypes it numeric in the import
   wizard before mapping it to X (the real time-on-X workflow). The workbench
   card reskin replaced the always-visible `.layer-rail` with the geom-editor
   card (reached via the figure node's right-click "Edit plot…"), and the
   stats panel is reached by left-clicking the figure node's Stats section.
   Needs the engine (8765) and the vite dev server (5173). */

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

// Fixture: a measure (area) over an ordered numeric x (frame), two conditions.
const rows = ["condition,frame,area"];
for (const [cond, base] of [["ctrl", 0], ["ko", 10]])
  for (let frame = 0; frame < 6; frame++)
    rows.push(`${cond},${frame},${base + frame}`);
const csv = rows.join("\n");

await page.click(".tb-btn:has-text('Add data')"); await page.click(".tb-menu button:has-text('Import…')");
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

await page.click(".tb-seg button:has-text('Workbench')");
const figureNode = page.locator(".txw-node.figure").first();
await figureNode.waitFor({ state: "visible", timeout: 15000 });
await figureNode.click({ button: "right" });
await page.waitForSelector(".txw-ctxmenu", { timeout: 15000 });
await page.locator(".txw-ctxmenu [role='menuitem']", { hasText: /edit plot/i }).click();
const geomCard = page.locator("[data-testid='geom-card']");
await geomCard.locator(".layer-rail").waitFor({ state: "visible", timeout: 15000 });

// Map numeric X (frame) + numeric Y (area) — the otherwise-correlation pair.
await geomCard.locator(".enc-row", { hasText: "X" }).locator("select").selectOption("frame");
await geomCard.locator(".enc-row", { hasText: "Y" }).locator("select").selectOption("area");
await page.waitForTimeout(500);

// Trajectories (line) and Mean ± band (trend) are offered on numeric/numeric.
await geomCard.locator(".add-layer-btn").click();
const lineBtn = geomCard.locator(".add-layer-menu button:has-text('Trajectories')");
if (await lineBtn.count() === 0)
  fail("Trajectories (line) not offered for numeric-x / numeric-y — timeseries gate regressed");
await lineBtn.click();
await page.waitForTimeout(1800);

const figure = await page.locator(".figure-host svg").count();
const bar = await page.locator(".error-bar").count();
if (figure === 0 && bar === 0)
  fail("timeseries line: no figure and no status bar — rendered nothing");
if (figure > 0) {
  // a connected trajectory is a <path> stroke, not scatter <use> point glyphs
  const paths = await page.locator(".figure-host svg path").count();
  if (paths === 0) fail("line layer drew no path — trajectories did not render");
  console.log("timeseries line rendered", paths, "paths");
} else {
  console.log("guard/status bar shown (no crash)");
}

// The stats panel must show the describe-only time-series model, not a test.
await figureNode.locator(".txw-figsec", { hasText: "Stats" }).click();
await page.waitForSelector("[data-testid='stats-card']", { timeout: 15000 });
const design = await page.locator("[data-testid='stats-card'] .reason").first().textContent().catch(() => "");
if (figure > 0 && !/over/.test(design))
  fail(`stats panel did not show the 'y over x' time-series design (got: ${design})`);

// Layer the aggregate trend on top — the layered spaghetti+mean figure.
await geomCard.locator(".add-layer-btn").click();
const trendBtn = geomCard.locator(".add-layer-menu button:has-text('Mean ± band')");
if (await trendBtn.count() > 0) {
  await trendBtn.click();
  await page.waitForTimeout(1500);
  if (await page.locator(".figure-host svg").count() === 0
      && await page.locator(".error-bar").count() === 0)
    fail("layered line+trend rendered nothing");
  console.log("layered line + trend ok");
} else {
  await geomCard.locator(".add-layer-menu .cancel").click().catch(() => {});
}

if (pageErrors.length) fail("page errors: " + pageErrors.slice(0, 4).join(" | "));

console.log("timeseries e2e ok");
await browser.close();
