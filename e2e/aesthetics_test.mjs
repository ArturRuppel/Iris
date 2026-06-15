import { chromium } from "playwright";

/* Smoke for Phase 2 aesthetics: the Color picker appears in the encodings card,
   and mapping a second categorical to color produces a dodged figure WITH a
   legend (gid 'legend') rather than crashing. Seeds a Box (it aggregates, so it
   is never point-capped on the large default sample). Dataset-agnostic: if the
   sample has no second categorical to color by, the test skips that leg rather
   than failing. Needs the engine (8765) and the vite dev server (5173). */

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

// Seed a Box (aggregates → never point-capped, so it renders on any sample).
await page.selectOption(".template-pick", "box");
await page.waitForTimeout(1500);

// The Color picker must be offered (box accepts color).
const colorRow = page.locator(".enc-row", { hasText: "Color" });
if (await colorRow.count() === 0) fail("no Color picker after seeding a box");
const colorSelect = colorRow.locator("select");
console.log("color picker present");

// Pick the first categorical option that differs from the current X group.
const xVal = await page.locator(".enc-row", { hasText: "X" }).locator("select")
  .inputValue().catch(() => "");
const options = await colorSelect.locator("option").evaluateAll(
  (els) => els.map((e) => e.value));
const second = options.find((v) => v && v !== xVal);
if (!second) {
  console.log("no second categorical to color by — skipping color leg");
} else {
  await colorSelect.selectOption(second);
  await page.waitForTimeout(1800);
  const figure = await page.locator(".triad svg").count();
  const bar = await page.locator(".error-bar").count();
  if (figure === 0 && bar === 0)
    fail("color set: no figure and no status bar — rendered nothing");
  if (figure > 0) {
    const legend = await page.locator('.triad svg g[id="legend"]').count();
    if (legend === 0) fail("color mapped a second factor but no legend drawn");
    console.log("dodged figure with legend rendered");
  } else {
    console.log("guard/status bar shown (no crash)");
  }
}

if (pageErrors.length) fail("page errors: " + pageErrors.slice(0, 4).join(" | "));

console.log("aesthetics e2e ok");
await browser.close();
