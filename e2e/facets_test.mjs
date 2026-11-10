import { openApp, importCsv, addFirstPlot, inspectorTab, fail } from "./helpers.mjs";

/* Smoke for Phase 4 facets: importing data, mapping Facet Row to a categorical
   column, and adding an aggregating layer (Box — never point-capped) renders a
   multi-panel SVG grid instead of one pooled axes. No fixture CSV exists on
   disk, so the table is imported via an in-memory buffer. The plot editor is
   the Plot card: the add-plot wizard builds the Box with X/Y, then the
   inspector's Encoding tab hosts the EncodingsCard, where Facet Row is an
   optional channel behind the "+ encoding" adder. Needs the engine and the
   vite dev server. */

// Tiny fixture: a categorical group, a categorical site (the facet), a numeric value.
const csv = [
  "group,site,value",
  "a,north,1", "a,north,2", "a,north,3",
  "b,north,4", "b,north,5", "b,north,6",
  "a,south,7", "a,south,8", "a,south,9",
  "b,south,10", "b,south,11", "b,south,12",
].join("\n");

const { browser, page } = await openApp();
await importCsv(page, "facets_fixture.csv", csv);
// group on X, value on Y, a Box layer (aggregates → never point-capped).
const card = await addFirstPlot(page, { geom: "Box", x: "group", y: "value" });
await page.waitForTimeout(1000);

const figureBefore = await card.locator(".figure-host svg").count();
if (figureBefore === 0) fail("no figure rendered before faceting");
const axesBefore = await card.locator('.figure-host svg g[id^="axes_"]').count();
if (axesBefore !== 1) fail(`expected a single axes before faceting, got ${axesBefore}`);

// Facet Row is optional — reveal it, then map it. The figure should split into
// a 2-panel grid (north / south).
await inspectorTab(page, "Encoding");
await card.locator(".enc-add-btn").click();
const facetRowAdder = card.locator(".enc-add-menu button:has-text('Facet Row')");
if (await facetRowAdder.count() === 0) fail("no Facet Row option in the + encoding adder");
await facetRowAdder.click();
const facetRow = card.locator(".plot-inspector .enc-row", { hasText: "Facet Row" });
if (await facetRow.count() === 0) fail("no Facet Row picker in the encodings card");
await facetRow.locator("select").selectOption("site");
await page.waitForTimeout(1800);

if (page.errors.length) fail("page errors: " + page.errors.slice(0, 4).join(" | "));

const figureAfter = await card.locator(".figure-host svg").count();
if (figureAfter === 0) fail("no figure rendered after faceting");
const axesAfter = await card.locator('.figure-host svg g[id^="axes_"]').count();
if (axesAfter < 2) fail(`expected a multi-panel grid after faceting, got ${axesAfter} axes group(s)`);

console.log(`faceted grid rendered with ${axesAfter} axes groups`);
console.log("facets e2e ok");
await browser.close();
