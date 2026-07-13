import { chromium } from "playwright";

/* Smoke for the composable layer rail: add/remove mutate the stack. No
   fixture CSV exists on disk, so the table is imported via an in-memory
   buffer through the ImportWizard's hidden file input — the `.template-pick`
   dropdown and auto-seeded layers/mappings were removed in 111243b (see
   TODO.md): a fresh plottable now starts with zero layers, so this test adds
   one explicitly via the `.add-layer-btn` flow rather than assuming one is
   seeded. Needs the engine (8765) and the vite dev server (5173). */

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
  fail("engine not reachable — start the engine on 8765");

await page.click(".tb-btn:has-text('Add data')"); await page.click(".tb-menu button:has-text('Import…')");
await page.setInputFiles("input[type=file]", {
  name: "layers_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
});
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });

await page.click(".tb-seg button:has-text('Workbench')");
await page.waitForSelector(".layer-rail", { timeout: 15000 });

// A fresh plottable starts with zero layers — map X/Y, then add the first one.
await page.locator(".enc-row", { hasText: "X" }).locator("select").selectOption("group");
await page.locator(".enc-row", { hasText: "Y" }).locator("select").selectOption("value");
const initial = await page.locator(".layer-card").count();
if (initial !== 0) fail(`expected a fresh plottable to start with 0 layers, got ${initial}`);

await page.click(".add-layer-btn");
await page.locator(".add-layer-menu button:not(.cancel)").first().click();
const seeded = await page.locator(".layer-card").count();
if (seeded !== 1) fail(`expected 1 layer after the first add, got ${seeded}`);
console.log("seeded layers:", seeded);

// Add a second layer via the add menu (if any geom is still addable).
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
// bar (e.g. the point-cap guard on a large sample) — never a blank crash.
await page.waitForTimeout(1500);
const figure = await page.locator(".iris svg").count();
const bar = await page.locator(".error-bar").count();
if (figure === 0 && bar === 0)
  fail("no figure and no status bar — the app rendered nothing");
console.log(figure ? "figure rendered" : "guard/status bar shown (no crash)");

if (pageErrors.length) fail("page errors: " + pageErrors.slice(0, 4).join(" | "));

console.log("layers e2e ok");
await browser.close();
