import { openApp, importCsv, addFirstPlot, inspectorTab, fail } from "./helpers.mjs";

/* Live walkthrough for spec 2.3 Stage 2 (panels): a plot is ONE figure that can
   hold several side-by-side panels, and a layer chooses which panel it draws
   into. This exercises the full loop the unit/engine tests only cover in pieces:
   author a second panel in the UI -> the canvas figure node shows two plot sinks
   ("Panel 1" / "Panel 2") -> the engine renders a figure with a second axes.

   The honesty property under test: the canvas advertises exactly as many panels
   as the render draws. The plot editor is the Plot card: the first layer comes
   from the "+ add plot" wizard, the second from the inspector's "+ add layer"
   (plot type, then grain), and each layer's "Panel" row lives on its card in
   the Layers tab. Needs the engine and the vite dev server. */

const csv = [
  "group,value",
  "a,1", "a,2", "a,3", "a,4",
  "b,5", "b,6", "b,7", "b,8",
].join("\n");

const { browser, page } = await openApp();
await importCsv(page, "panels_fixture.csv", csv);

// --- a Box plot of value by group, then a second layer (Dots) on top ---
const card = await addFirstPlot(page, { geom: "Box", x: "group", y: "value" });
await inspectorTab(page, "Layers");
await card.locator(".add-layer-btn").click();
await page.waitForSelector("[data-testid='plot-wizard']", { timeout: 10000 });
const addable = await page.locator(".wiz-geom").count();
if (addable === 0) fail("could not add a second layer — need two to split across panels");
const second = page.locator(".wiz-geom", { hasText: /^Dots$/ });
await (await second.count() ? second : page.locator(".wiz-geom").first()).click();
await page.waitForSelector(".wiz-step.wiz-grain", { timeout: 10000 });
await page.click(".wiz-done");
await page.waitForSelector("[data-testid='plot-wizard']", { state: "detached", timeout: 10000 });
await inspectorTab(page, "Layers");
const nLayers = await card.locator(".layer-card").count();
if (nLayers !== 2) fail(`expected 2 layers, got ${nLayers}`);

// --- baseline: one plot sink on the figure node, one axes in the render ---
await page.waitForTimeout(1500);
const axesCount = async () =>
  card.locator(".figure-host svg g[id^='axes_']").count();
const plotSinks = () => page.locator(".react-flow__node .txw-figsec.k-geom");

const baseSinks = await plotSinks().count();
const baseAxes = await axesCount();
console.log(`baseline: ${baseSinks} plot sink(s), ${baseAxes} axes`);
if (baseSinks !== 1) fail(`expected 1 plot sink before splitting, got ${baseSinks}`);
if (baseAxes < 1) fail(`expected a rendered axes, got ${baseAxes}`);

// --- move the SECOND layer onto a new panel ---
const panelSelect = card.locator(".layer-card").nth(1).locator(".layer-panel select");
await panelSelect.waitFor({ state: "visible", timeout: 10000 });
// options are Primary(0) then "New panel"(maxPanel+1); pick the last (new panel)
await panelSelect.selectOption({ label: "New panel" });

// --- the canvas must now show two labeled panel sinks ---
await plotSinks().nth(1).waitFor({ state: "visible", timeout: 10000 });
const splitSinks = await plotSinks().count();
if (splitSinks !== 2) fail(`expected 2 plot sinks after splitting, got ${splitSinks}`);
const sinkLabels = await plotSinks().locator(".txw-eyebrow-text").allInnerTexts();
console.log("panel sink labels:", JSON.stringify(sinkLabels));
if (!sinkLabels.some((t) => /panel 1/i.test(t)) || !sinkLabels.some((t) => /panel 2/i.test(t)))
  fail(`expected "Panel 1" and "Panel 2" labels, got ${JSON.stringify(sinkLabels)}`);

// --- and the render must actually grow a second axes ---
await page.waitForTimeout(2000);
const splitAxes = await axesCount();
console.log(`after split: ${splitSinks} plot sinks, ${splitAxes} axes`);
if (await page.locator(".error-bar").count() > 0) {
  const msg = await page.locator(".error-bar").first().innerText();
  fail(`render error bar after split: ${msg}`);
}
if (splitAxes <= baseAxes)
  fail(`expected more axes after splitting into panels (was ${baseAxes}, now ${splitAxes})`);

if (page.errors.length) fail("page errors: " + page.errors.slice(0, 4).join(" | "));

console.log("panels e2e ok — canvas sinks match rendered panels");
await browser.close();
