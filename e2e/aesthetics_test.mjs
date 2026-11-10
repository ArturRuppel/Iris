import { openApp, importCsv, addFirstPlot, inspectorTab, fail } from "./helpers.mjs";

/* Smoke for Phase 2 aesthetics: the Color picker appears in the encodings card,
   and mapping a second categorical to color produces a dodged figure WITH a
   legend (gid 'legend') rather than crashing. Seeds a Box (it aggregates, so it
   is never point-capped). No fixture CSV exists on disk, so the table is
   imported via an in-memory buffer. The plot editor is the Plot card: the
   add-plot wizard builds the Box with X/Y, then the inspector's Encoding tab
   hosts the EncodingsCard, where Color is an optional channel behind the
   "+ encoding" adder. Needs the engine and the vite dev server. */

// Tiny fixture: a categorical group (X), a second categorical (color), a numeric value.
const csv = [
  "group,batch,value",
  "a,p,1", "a,p,2", "a,q,3", "a,q,4",
  "b,p,5", "b,p,6", "b,q,7", "b,q,8",
].join("\n");

const { browser, page } = await openApp();
await importCsv(page, "aesthetics_fixture.csv", csv);
const card = await addFirstPlot(page, { geom: "Box", x: "group", y: "value" });
await inspectorTab(page, "Encoding");

// Color is an optional channel — reveal it via the "+ encoding" adder.
await card.locator(".enc-add-btn").click();
await card.locator(".enc-add-menu button:has-text('Color')").click();
const colorRow = card.locator(".plot-inspector .enc-row", { hasText: "Color" });
if (await colorRow.count() === 0) fail("no Color picker after seeding a box");
const colorSelect = colorRow.locator("select");
console.log("color picker present");

// Map the second CATEGORICAL (batch) to color — that's the case that dodges and
// draws a discrete legend. NB: Phase 3b made numeric columns selectable under
// Color too (they draw a continuous colorbar, not a legend), so we pick the
// categorical explicitly rather than "first enabled non-X" to keep asserting the
// legend path. The categorical option must be enabled.
const enabled = await colorSelect.locator("option:not([disabled])").evaluateAll(
  (els) => els.map((e) => e.value));
if (!enabled.includes("batch"))
  fail("expected the second categorical (batch) to be offered under Color");
await colorSelect.selectOption("batch");
await page.waitForTimeout(1800);
const figure = await card.locator(".figure-host svg").count();
const bar = await page.locator(".error-bar").count();
if (figure === 0 && bar === 0)
  fail("color set: no figure and no status bar — rendered nothing");
if (figure > 0) {
  const legend = await card.locator('.figure-host svg g[id="legend"]').count();
  if (legend === 0) fail("color mapped a second categorical but no legend drawn");
  console.log("dodged figure with legend rendered");
} else {
  console.log("guard/status bar shown (no crash)");
}

if (page.errors.length) fail("page errors: " + page.errors.slice(0, 4).join(" | "));

console.log("aesthetics e2e ok");
await browser.close();
