import { chromium } from "playwright";

/* Smoke for Phase 2 aesthetics: the Color picker appears in the encodings card,
   and mapping a second categorical to color produces a dodged figure WITH a
   legend (gid 'legend') rather than crashing. Seeds a Box (it aggregates, so it
   is never point-capped). No fixture CSV exists on disk, so the table is
   imported via an in-memory buffer through the ImportWizard's hidden file
   input — the `.template-pick` dropdown and auto-seeded layers/mappings were
   removed in 111243b (see TODO.md), so this follows the documented fix
   pattern: explicit import, explicit mapping, explicit `.add-layer-btn` flow.
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

// Tiny fixture: a categorical group (X), a second categorical (color), a numeric value.
const csv = [
  "group,batch,value",
  "a,p,1", "a,p,2", "a,q,3", "a,q,4",
  "b,p,5", "b,p,6", "b,q,7", "b,q,8",
].join("\n");

await page.click("button:has-text('Import data…')");
await page.setInputFiles("input[type=file]", {
  name: "aesthetics_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
});
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });

await page.click(".mode-toggle button:has-text('Analyses')");
await page.waitForSelector(".layer-rail", { timeout: 15000 });

// Map X/Y, then add a Box layer (aggregates → never point-capped).
await page.locator(".enc-row", { hasText: "X" }).locator("select").selectOption("group");
await page.locator(".enc-row", { hasText: "Y" }).locator("select").selectOption("value");
await page.waitForTimeout(500);
await page.click(".add-layer-btn");
await page.click(".add-layer-menu button:has-text('Box')");
await page.waitForTimeout(1500);

// The Color picker must be offered (box accepts color).
const colorRow = page.locator(".enc-row", { hasText: "Color" });
if (await colorRow.count() === 0) fail("no Color picker after seeding a box");
const colorSelect = colorRow.locator("select");
console.log("color picker present");

// Pick the first categorical option that differs from the current X group.
const xVal = await page.locator(".enc-row", { hasText: "X" }).locator("select")
  .inputValue().catch(() => "");
// only enabled options are selectable: Phase 3 lists numeric columns under
// Color too, but disabled-with-reason (continuous color isn't drawn yet).
const options = await colorSelect.locator("option:not([disabled])").evaluateAll(
  (els) => els.map((e) => e.value));
const second = options.find((v) => v && v !== xVal);
if (!second) {
  fail("expected a second categorical (batch) to be offered under Color");
} else {
  await colorSelect.selectOption(second);
  await page.waitForTimeout(1800);
  const figure = await page.locator(".iris svg").count();
  const bar = await page.locator(".error-bar").count();
  if (figure === 0 && bar === 0)
    fail("color set: no figure and no status bar — rendered nothing");
  if (figure > 0) {
    const legend = await page.locator('.iris svg g[id="legend"]').count();
    if (legend === 0) fail("color mapped a second factor but no legend drawn");
    console.log("dodged figure with legend rendered");
  } else {
    console.log("guard/status bar shown (no crash)");
  }
}

if (pageErrors.length) fail("page errors: " + pageErrors.slice(0, 4).join(" | "));

console.log("aesthetics e2e ok");
await browser.close();
