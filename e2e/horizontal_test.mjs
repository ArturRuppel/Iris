import { openApp, importCsv, addFirstPlot, inspectorTab, fail } from "./helpers.mjs";

/* Smoke for Phase 3c horizontal orientation: a NUMERIC x + CATEGORICAL y maps to
   a horizontal group comparison. The group-comparison geoms (dot/box/violin/bar/
   summary) render with the categorical factor on Y and the measurement on X; the
   plot editor should still offer them for that pair (h_orient), and the figure
   should draw the categorical levels as y tick labels without crashing the UI
   wiring. The plot editor is the Plot card: the add-plot wizard picks the plot
   type first and then maps X/Y (its X/Y pickers narrow to the types the picked
   geom accepts, so mapping the swapped pair onto a Box is itself the h_orient
   offer); once the pair is mapped, the Layers tab's "Change plot type" select
   gates each geom on the mapped types, so the group-comparison geoms must stay
   enabled there. Needs the engine and the vite dev server. */

// Fixture: numeric measurement (X) + categorical treatment (Y).
const csv = [
  "treatment,response",
  "control,1", "control,2", "control,3", "control,4",
  "drug_a,5", "drug_a,6", "drug_a,7", "drug_a,8",
].join("\n");

const { browser, page } = await openApp();
await importCsv(page, "horizontal_fixture.csv", csv);

// Box, mapped with numeric X + categorical Y (the swapped, horizontal pair).
// The wizard's X picker must offer the numeric column for a Box.
const xOffered = async () => page.locator(".wiz-map .enc-row", { hasText: "X" })
  .locator("select option:not([disabled])").evaluateAll((els) => els.map((e) => e.value));
let card;
try {
  card = await addFirstPlot(page, { geom: "Box", x: "response", y: "treatment" });
} catch (e) {
  const offered = await xOffered().catch(() => []);
  fail(`could not map numeric X / categorical Y onto a Box (X offers ${JSON.stringify(offered)}) — h_orient gate regressed: ${e.message.split("\n")[0]}`);
}
await page.waitForTimeout(1500);

// With the pair mapped, Box (and the other group comparisons) must be offered,
// i.e. enabled, in the layer's plot-type select.
await inspectorTab(page, "Layers");
const geomSelect = card.locator(".layer-card select[title='Change plot type']").first();
const enabledGeoms = await geomSelect.locator("option:not([disabled])").evaluateAll(
  (els) => els.map((e) => e.value));
for (const g of ["box", "violin", "dot"])
  if (!enabledGeoms.includes(g))
    fail(`${g} not offered for numeric-x / categorical-y — h_orient gate regressed (enabled: ${enabledGeoms.join(", ")})`);
console.log("group-comparison geoms offered for the horizontal pair:", enabledGeoms.join(", "));

const figure = await card.locator(".figure-host svg").count();
const bar = await page.locator(".error-bar").count();
if (figure === 0 && bar === 0)
  fail("horizontal box: no figure and no status bar — rendered nothing");
if (figure > 0) {
  const svgText = await card.locator(".figure-host svg").textContent().catch(() => "");
  if (!svgText.includes("control") || !svgText.includes("drug_a"))
    fail("categorical levels not drawn as y tick labels in horizontal mode");
  console.log("horizontal figure rendered with categorical y levels");
} else {
  console.log("guard/status bar shown (no crash)");
}

if (page.errors.length) fail("page errors: " + page.errors.slice(0, 4).join(" | "));

console.log("horizontal e2e ok");
await browser.close();
