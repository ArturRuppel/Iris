import { chromium } from "playwright";

/* Smoke for Phase 4 facets: importing data, mapping Facet Row to a categorical
   column, and adding an aggregating layer (Box — never point-capped) renders a
   multi-panel SVG grid instead of one pooled axes. No fixture CSV exists on
   disk, so the table is imported via an in-memory buffer through the
   ImportWizard's hidden file input (the `.template-pick` dropdown and
   auto-seeded layers/mappings were removed in 111243b — see TODO.md — so this
   test follows its documented fix pattern: explicit import, explicit mapping,
   explicit `.add-layer-btn` flow, rather than relying on any of that).

   CAVEAT: written but NOT run in this sandbox — no Chromium is installable
   here (`npx playwright install` is blocked by the sandbox's network proxy),
   the same constraint already logged in TODO.md for the rest of e2e/. The
   "multiple `id="axes_"` groups in the SVG" assertion below was validated
   directly against the engine's matplotlib output (a 2-row faceted comparison
   figure produced two `id="axes_N"` groups, one per cell) — see the Phase 4
   plan/PR notes — but the browser-side wiring (click path through the
   Encodings card, `.add-layer-btn` flow) is unverified end-to-end.

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

// Tiny fixture: a categorical group, a categorical site (the facet), a numeric value.
const csv = [
  "group,site,value",
  "a,north,1", "a,north,2", "a,north,3",
  "b,north,4", "b,north,5", "b,north,6",
  "a,south,7", "a,south,8", "a,south,9",
  "b,south,10", "b,south,11", "b,south,12",
].join("\n");

await page.click("button:has-text('Import data…')");
await page.setInputFiles("input[type=file]", {
  name: "facets_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
});
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });

await page.click(".mode-toggle button:has-text('Analyses')");
await page.waitForSelector(".layer-rail", { timeout: 15000 });

// Map X/Y: group on X, value on Y.
await page.locator(".enc-row", { hasText: "X" }).locator("select").selectOption("group");
await page.locator(".enc-row", { hasText: "Y" }).locator("select").selectOption("value");
await page.waitForTimeout(500);

// Add a Box layer (aggregates → never point-capped).
await page.click(".add-layer-btn");
await page.click(".add-layer-menu button:has-text('Box')");
await page.waitForTimeout(1500);

const figureBefore = await page.locator(".iris svg").count();
if (figureBefore === 0) fail("no figure rendered before faceting");
const axesBefore = await page.locator('.iris svg g[id^="axes_"]').count();
if (axesBefore !== 1) fail(`expected a single axes before faceting, got ${axesBefore}`);

// Map Facet Row — the figure should split into a 2-panel grid (north / south).
const facetRow = page.locator(".enc-row", { hasText: "Facet Row" });
if (await facetRow.count() === 0) fail("no Facet Row picker in the encodings card");
await facetRow.locator("select").selectOption("site");
await page.waitForTimeout(1800);

if (pageErrors.length) fail("page errors: " + pageErrors.slice(0, 4).join(" | "));

const figureAfter = await page.locator(".iris svg").count();
if (figureAfter === 0) fail("no figure rendered after faceting");
const axesAfter = await page.locator('.iris svg g[id^="axes_"]').count();
if (axesAfter < 2) fail(`expected a multi-panel grid after faceting, got ${axesAfter} axes group(s)`);

console.log(`faceted grid rendered with ${axesAfter} axes groups`);
console.log("facets e2e ok");
await browser.close();
