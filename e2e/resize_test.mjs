import { openApp, importCsv, addFirstPlot, inspectorTab, fail } from "./helpers.mjs";

/* Drag-resize the figure and confirm the style controls still re-render it
   after a few flips. No fixture CSV exists on disk, so the table is imported
   via an in-memory buffer. The plot editor is the Plot card: the first plot is
   built through the "+ add plot" wizard (plot type, X, Y), and the old style
   drawer is now the plot inspector's tabs (a box knob on Layers, the tick
   direction on Axes). A Box plot on a two-group table renders at any sample
   size and owns the "Notch" knob this test flips.

   (This used to draw a Y-only Distribution of a one-column table; the wizard
   currently will not finish without an X mapping, see the report that came
   with this change.) */

const csv = [
  "group,value",
  "a,1", "a,2", "a,2", "a,3", "a,3", "a,3",
  "b,4", "b,4", "b,5", "b,6", "b,7", "b,8",
].join("\n");

const { browser, page } = await openApp({ viewport: { width: 1600, height: 1100 } });
await importCsv(page, "resize_fixture.csv", csv);
const card = await addFirstPlot(page, { geom: "Box", x: "group", y: "value" });
await page.waitForTimeout(600);

const dims = async () => (await card.locator(".figure-pane .provenance").textContent()).trim();
const dims0 = await dims();
console.log("dims before:", dims0);
const parse = (t) => { const m = /(\d+)\s*×\s*(\d+)\s*mm/.exec(t); return m ? [Number(m[1]), Number(m[2])] : null; };
if (!parse(dims0)) fail(`no figure size badge before the drag (got "${dims0}")`);

const h = card.locator(".resize-handle");
const hb = await h.boundingBox();
if (!hb) fail("no canvas resize handle on the figure");
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
await page.mouse.down();
await page.mouse.move(hb.x + hb.width / 2 + 80, hb.y + hb.height / 2 - 60, { steps: 6 });
const during = await dims();
console.log("badge during drag:", during);
await page.mouse.up();
await page.waitForTimeout(2000); // engine round trip at the new size
const dims1 = await dims();
console.log("dims after:", dims1);
const [w0, h0] = parse(dims0), after = parse(dims1);
if (!after) fail(`no figure size badge after the drag (got "${dims1}")`);
if (!(after[0] > w0 && after[1] < h0))
  fail(`dragging the corner right/up should widen and shorten the figure (${dims0} → ${dims1})`);

// Flip a few style controls; the figure must re-render without an error bar.
const svgBefore = await card.locator(".figure-host svg").innerHTML();
await inspectorTab(page, "Layers");
const notch = card.locator(".insp-row", { hasText: "Notch" }).locator("input[type=checkbox]");
if (await notch.count() === 0) fail("no Notch knob on the box layer in the Layers tab");
await notch.first().check();
await inspectorTab(page, "Axes");
const tickRow = card.locator(".insp-row", { hasText: "Tick direction" });
if (await tickRow.count() === 0) fail("no Tick direction control in the Axes tab");
await tickRow.locator("button", { hasText: /^in$/ }).click();
await page.waitForTimeout(2000);
const svgOk = await card.locator(".figure-host svg").count() > 0;
const errBar = await page.locator(".error-bar").count();
if (svgOk && (await card.locator(".figure-host svg").innerHTML()) === svgBefore)
  fail("flipping Notch and Tick direction did not re-render the figure");
console.log("svg still renders:", svgOk, "| error bars:", errBar);
if (!svgOk) fail("figure gone after flipping style controls");
if (errBar) fail("error bar after flipping style controls: " + await page.locator(".error-bar").first().innerText());
const dims2 = await dims();
if (dims2 !== dims1) fail(`the style flips changed the resized figure size (${dims1} → ${dims2})`);

if (page.errors.length) fail("page errors: " + page.errors.slice(0, 4).join(" | "));
console.log("resize e2e ok");
await browser.close();
