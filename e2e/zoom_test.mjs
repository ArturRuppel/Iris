import { chromium } from "playwright";

/* Item H — view-only PDF-style zoom in the figure pane. The zoom is a pure
   client-side CSS transform on the rendered SVG: it never hits the engine, never
   persists, and doesn't change the figure or exports. This test drives the real
   toolbar + gestures and asserts on the SVG's transform and the editing-grip
   suspension, not on any engine round trip.

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

const csv = [
  "group,value",
  "a,1", "a,2", "a,3", "b,4", "b,5", "b,6",
].join("\n");

await page.click(".tb-btn:has-text('Import')");
await page.setInputFiles("input[type=file]", {
  name: "zoom_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
});
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
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
await geomCard.locator(".enc-row", { hasText: "X" }).locator("select").selectOption("group");
await geomCard.locator(".enc-row", { hasText: "Y" }).locator("select").selectOption("value");
await page.waitForTimeout(400);
await geomCard.locator(".add-layer-btn").click();
await geomCard.locator(".add-layer-menu button:has-text('Box')").click();
await page.waitForSelector(".figure-host svg", { timeout: 15000 });
await page.waitForTimeout(400);

const svg = page.locator(".figure-host svg");
const transform = () => svg.evaluate((el) => el.style.transform || "none");
const scaleOf = (t) => { const m = /scale\(([\d.]+)\)/.exec(t); return m ? parseFloat(m[1]) : 1; };

// Baseline: no zoom, editing grips present, toolbar reads 100%.
if (scaleOf(await transform()) !== 1) fail("expected no zoom transform initially");
if (await page.locator(".plot-move").count() !== 1) fail("expected the plot-area move grip at zoom 1");
if ((await page.locator(".zoom-pct").innerText()).trim() !== "100%")
  fail("expected the toolbar to read 100% initially");

// Zoom in via the toolbar "+" button.
await page.click(".figure-tools button[title='Zoom in']");
await page.waitForTimeout(150);
const zin = scaleOf(await transform());
if (!(zin > 1)) fail(`zoom-in button did not scale the svg (scale=${zin})`);
if ((await page.locator(".zoom-pct").innerText()).trim() === "100%")
  fail("toolbar still reads 100% after zooming in");
// Editing grips must be suspended while zoomed (it's a viewing magnify).
if (await page.locator(".plot-move").count() !== 0) fail("plot-area grip should hide while zoomed");
if (await page.locator(".resize-handle").count() !== 0) fail("canvas resize handle should hide while zoomed");

// Fit resets everything.
await page.click(".figure-tools button[title='Fit — reset zoom']");
await page.waitForTimeout(150);
if (scaleOf(await transform()) !== 1) fail("Fit did not reset the zoom transform");
if (await page.locator(".plot-move").count() !== 1) fail("plot-area grip should return after Fit");

// Ctrl/Cmd-scroll zooms in any mode (without toggling zoom mode on).
const box = await svg.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.keyboard.down("Control");
await page.mouse.wheel(0, -240);
await page.keyboard.up("Control");
await page.waitForTimeout(150);
const zwheel = scaleOf(await transform());
if (!(zwheel > 1)) fail(`Ctrl-scroll did not zoom (scale=${zwheel})`);
await page.click(".figure-tools button[title='Fit — reset zoom']");
await page.waitForTimeout(100);

// Zoom mode: plain wheel zooms, then a drag pans (translate changes).
await page.click(".figure-tools button[title^='Zoom mode']");
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.wheel(0, -300);
await page.waitForTimeout(150);
const tAfterWheel = await transform();
if (!(scaleOf(tAfterWheel) > 1)) fail("plain wheel did not zoom in zoom mode");
const txOf = (t) => { const m = /translate\(([-\d.]+)px/.exec(t); return m ? parseFloat(m[1]) : 0; };
const tx0 = txOf(tAfterWheel);
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(150);
const tx1 = txOf(await transform());
if (Math.abs(tx1 - tx0) < 20) fail(`drag did not pan in zoom mode (tx ${tx0} → ${tx1})`);

if (pageErrors.length) fail("page errors: " + pageErrors.slice(0, 4).join(" | "));

console.log(`zoom ok — toolbar +, Fit, Ctrl-scroll, wheel-zoom & drag-pan all work (scale up to ${zwheel.toFixed(2)})`);
await browser.close();
