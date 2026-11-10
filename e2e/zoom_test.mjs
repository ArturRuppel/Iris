import { openApp, importCsv, addFirstPlot, fail } from "./helpers.mjs";

/* Item H — view-only PDF-style zoom in the figure pane. The zoom is a pure
   client-side CSS transform on the rendered SVG: it never hits the engine, never
   persists, and doesn't change the figure or exports. This test drives the real
   toolbar + gestures and asserts on the SVG's transform and on the editing
   grips, not on any engine round trip.

   The pane works like a sheet on a canvas: the figure starts FITTED to the
   viewport (whatever CSS scale that takes) and the toolbar's percentage is
   relative to that fit (100 % = whole sheet in view). The toolbar has an
   Edit | Pan switch: in Edit the grips (canvas corner `.resize-handle`,
   plot-area corner `.plot-resize`) stay usable at any zoom, in Pan they are
   hidden and a plain wheel zooms / a drag pans. Ctrl-wheel zooms in either
   mode. "Fit" (⤢) returns to the fitted view.

   Needs the engine and the vite dev server. */

const csv = [
  "group,value",
  "a,1", "a,2", "a,3", "b,4", "b,5", "b,6",
].join("\n");

const { browser, page } = await openApp();
await importCsv(page, "zoom_fixture.csv", csv);
const card = await addFirstPlot(page, { geom: "Box", x: "group", y: "value" });
await page.waitForTimeout(600);

const svg = card.locator(".figure-host svg");
const tools = card.locator(".figure-tools");
const transform = () => svg.evaluate((el) => el.style.transform || "none");
const scaleOf = (t) => { const m = /scale\(([\d.]+)\)/.exec(t); return m ? parseFloat(m[1]) : 1; };
const txOf = (t) => { const m = /translate\(([-\d.]+)px/.exec(t); return m ? parseFloat(m[1]) : 0; };
const pct = async () => (await card.locator(".zoom-pct").innerText()).trim();
const fitBtn = tools.locator("button[title='Fit the whole figure in view']");
const grips = async () => ({
  canvas: await card.locator(".resize-handle").count(),
  plot: await card.locator(".plot-resize").count(),
});

// Baseline: the fitted view, toolbar reads 100%, editing grips present (Edit mode).
const fitScale = scaleOf(await transform());
if (!(fitScale > 0)) fail(`expected a fitted scale on the svg, got ${await transform()}`);
if ((await pct()) !== "100%") fail(`expected the toolbar to read 100% initially, got ${await pct()}`);
let g = await grips();
if (g.canvas !== 1 || g.plot !== 1) fail(`expected the canvas and plot-area grips at fit, got ${JSON.stringify(g)}`);
if (!(await fitBtn.isDisabled())) fail("Fit should be disabled while already fitted");

// Zoom in via the toolbar "+" button.
await tools.locator("button[title='Zoom in']").click();
await page.waitForTimeout(150);
const zin = scaleOf(await transform());
if (!(zin > fitScale * 1.01)) fail(`zoom-in button did not scale the svg (fit ${fitScale} → ${zin})`);
if ((await pct()) === "100%") fail("toolbar still reads 100% after zooming in");
// Edit mode keeps the grips at any zoom (zoom in for precision).
g = await grips();
if (g.canvas !== 1 || g.plot !== 1) fail(`grips should stay usable while zoomed in Edit mode, got ${JSON.stringify(g)}`);

// Fit resets everything.
await fitBtn.click();
await page.waitForTimeout(150);
if (Math.abs(scaleOf(await transform()) - fitScale) > 1e-6) fail("Fit did not reset the zoom transform");
if ((await pct()) !== "100%") fail(`Fit did not reset the toolbar to 100% (got ${await pct()})`);

// Ctrl/Cmd-scroll zooms in any mode (here: Edit).
const box = await svg.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.keyboard.down("Control");
await page.mouse.wheel(0, -240);
await page.keyboard.up("Control");
await page.waitForTimeout(150);
const zwheel = scaleOf(await transform());
if (!(zwheel > fitScale * 1.01)) fail(`Ctrl-scroll did not zoom (fit ${fitScale} → ${zwheel})`);
await fitBtn.click();
await page.waitForTimeout(100);

// A plain wheel in Edit mode is left to the page (the inspector must still scroll).
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.wheel(0, -300);
await page.waitForTimeout(150);
if (Math.abs(scaleOf(await transform()) - fitScale) > 1e-6) fail("a plain wheel zoomed in Edit mode");

// Pan mode: grips hide, a plain wheel zooms, then a drag pans (translate changes).
await tools.locator("button", { hasText: /^Pan$/ }).click();
g = await grips();
if (g.canvas !== 0 || g.plot !== 0) fail(`grips should hide in Pan mode, got ${JSON.stringify(g)}`);
const box2 = await svg.boundingBox();
await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
await page.mouse.wheel(0, -300);
await page.waitForTimeout(150);
const tAfterWheel = await transform();
if (!(scaleOf(tAfterWheel) > fitScale * 1.01)) fail("plain wheel did not zoom in Pan mode");
const tx0 = txOf(tAfterWheel);
await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
await page.mouse.down();
await page.mouse.move(box2.x + box2.width / 2 + 80, box2.y + box2.height / 2 + 40, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(150);
const tx1 = txOf(await transform());
if (Math.abs(tx1 - tx0) < 20) fail(`drag did not pan in Pan mode (tx ${tx0} → ${tx1})`);

// Back to Edit: the grips return.
await tools.locator("button", { hasText: /^Edit$/ }).click();
g = await grips();
if (g.canvas !== 1 || g.plot !== 1) fail(`grips should return in Edit mode, got ${JSON.stringify(g)}`);

if (page.errors.length) fail("page errors: " + page.errors.slice(0, 4).join(" | "));

console.log(`zoom ok — toolbar +, Fit, Ctrl-scroll, Pan wheel-zoom & drag-pan all work (scale ${fitScale.toFixed(2)} → ${zwheel.toFixed(2)})`);
await browser.close();
