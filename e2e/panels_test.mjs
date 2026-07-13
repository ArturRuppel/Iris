import { chromium } from "playwright";

/* Live walkthrough for spec 2.3 Stage 2 (panels): a plot is ONE figure that can
   hold several side-by-side panels, and a layer chooses which panel it draws
   into. This exercises the full loop the unit/engine tests only cover in pieces:
   author a second panel in the UI -> the canvas figure node shows two plot sinks
   ("Panel 1" / "Panel 2") -> the engine renders a figure with a second axes.

   The honesty property under test: the canvas advertises exactly as many panels
   as the render draws. Needs a 2c-or-newer engine + the vite dev server. Point
   it at the side servers with APP_URL (default 5173). */

const csv = [
  "group,value",
  "a,1", "a,2", "a,3", "a,4",
  "b,5", "b,6", "b,7", "b,8",
].join("\n");

const URL = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
const fail = (msg) => { console.error(msg); process.exit(1); };

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".app", { timeout: 30000 });
if (await page.locator(".engine-down").count() > 0)
  fail("engine not reachable");

// --- load a small two-group table via the in-memory import buffer ---
await page.click(".tb-btn:has-text('Add data')");
await page.setInputFiles("input[type=file]", {
  name: "panels_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
});
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });

// --- into the workbench, open the figure's plot editor ---
await page.click(".tb-seg button:has-text('Workbench')");
const figureNode = page.locator(".txw-node.figure").first();
await figureNode.waitFor({ state: "visible", timeout: 15000 });
await figureNode.click({ button: "right" });
await page.waitForSelector(".txw-ctxmenu", { timeout: 15000 });
await page.locator(".txw-ctxmenu [role='menuitem']", { hasText: /edit plot/i }).click();
const geomCard = page.locator("[data-testid='geom-card']");
await geomCard.locator(".layer-rail").waitFor({ state: "visible", timeout: 15000 });

// --- map X/Y and add two layers ---
await geomCard.locator(".enc-row", { hasText: "X" }).locator("select").selectOption("group");
await geomCard.locator(".enc-row", { hasText: "Y" }).locator("select").selectOption("value");
await geomCard.locator(".add-layer-btn").click();
await geomCard.locator(".add-layer-menu button:not(.cancel)").first().click();
await geomCard.locator(".add-layer-btn").click();
const addable = await geomCard.locator(".add-layer-menu button:not(.cancel)").count();
if (addable === 0) fail("could not add a second layer — need two to split across panels");
await geomCard.locator(".add-layer-menu button:not(.cancel)").first().click();
const nLayers = await geomCard.locator(".layer-card").count();
if (nLayers !== 2) fail(`expected 2 layers, got ${nLayers}`);

// --- baseline: one plot sink on the figure node, one axes in the render ---
await page.waitForTimeout(1500);
const axesCount = async () =>
  page.locator(".figure-host svg g[id^='axes_']").count();
const plotSinks = () => page.locator(".txw-node.figure .txw-figsec.k-geom");

const baseSinks = await plotSinks().count();
const baseAxes = await axesCount();
console.log(`baseline: ${baseSinks} plot sink(s), ${baseAxes} axes`);
if (baseSinks !== 1) fail(`expected 1 plot sink before splitting, got ${baseSinks}`);
if (baseAxes < 1) fail(`expected a rendered axes, got ${baseAxes}`);

// --- move the SECOND layer onto a new panel ---
const panelSelect = geomCard.locator(".layer-card").nth(1).locator(".layer-panel select");
await panelSelect.waitFor({ state: "visible", timeout: 10000 });
// options are Primary(0) then "New panel"(maxPanel+1); pick the last (new panel)
await panelSelect.selectOption({ label: "New panel" });

// --- the canvas must now show two labeled panel sinks ---
await page.waitForSelector(".txw-node.figure .txw-figsec.k-geom >> nth=1", { timeout: 10000 });
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

if (pageErrors.length) fail("page errors: " + pageErrors.slice(0, 4).join(" | "));

console.log("panels e2e ok — canvas sinks match rendered panels");
await browser.close();
