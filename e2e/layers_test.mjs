import { chromium } from "playwright";

/* Smoke for the composable layer rail: the rail seeds layers from the default
   template, and add/remove mutate the stack. Dataset-agnostic: on the large
   cells_by_frame sample the default per-row dot geom is correctly point-capped
   (a red bar with an actionable message) rather than drawing 82k points, so we
   assert the app responds gracefully — a figure OR an informative bar, never a
   blank crash. Needs the engine (8765) and the vite dev server (5173). */

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

await page.click(".mode-toggle button:has-text('Analyses')");
await page.waitForSelector(".layer-rail", { timeout: 15000 });

// The default template seeds at least one layer card.
await page.waitForSelector(".layer-card", { timeout: 15000 });
const seeded = await page.locator(".layer-card").count();
if (seeded < 1) fail(`expected seeded layers, got ${seeded}`);
console.log("seeded layers:", seeded);

// Add a layer via the add menu (if any geom is still addable).
await page.click(".add-layer-btn");
const addable = await page.locator(".add-layer-menu button:not(.cancel)").count();
if (addable > 0) {
  await page.locator(".add-layer-menu button:not(.cancel)").first().click();
  const after = await page.locator(".layer-card").count();
  if (after !== seeded + 1) fail(`add layer: expected ${seeded + 1}, got ${after}`);
  console.log("added a layer:", after);
} else {
  await page.click(".add-layer-menu .cancel");
}

// Remove the last layer.
const before = await page.locator(".layer-card").count();
await page.locator(".layer-card .icon[title='Remove layer']").last().click();
const removed = await page.locator(".layer-card").count();
if (removed !== before - 1) fail(`remove layer: expected ${before - 1}, got ${removed}`);
console.log("removed a layer:", removed);

// The app responds gracefully: either a rendered figure, or an informative
// bar (e.g. the point-cap guard on the large sample) — never a blank crash.
await page.waitForTimeout(1500);
const figure = await page.locator(".iris svg").count();
const bar = await page.locator(".error-bar").count();
if (figure === 0 && bar === 0)
  fail("no figure and no status bar — the app rendered nothing");
console.log(figure ? "figure rendered" : "guard/status bar shown (no crash)");

if (pageErrors.length) fail("page errors: " + pageErrors.slice(0, 4).join(" | "));

console.log("layers e2e ok");
await browser.close();
