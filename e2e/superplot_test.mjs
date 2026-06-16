import { chromium } from "playwright";

/* Smoke for the data-hierarchy redesign: a superplot is *composed* from
   per-layer levels, not summoned by a preset. Build the nesting spine
   (subject › rep), then add layers bound to different levels — raw replicates at
   the rep level and one bold mark per subject at the subject level — and the
   figure draws point-groups for both. The pairing badge (derived from the spine)
   appears. Follows the documented fix pattern (TODO item 3): explicit CSV import
   via the hidden file input, explicit X/Y mapping, explicit `.add-layer-btn`
   flow. Needs the engine (8765) and the vite dev server (5173); no Chromium is
   installable in the build sandbox, so this runs on a machine that has one. */

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

// Fixture: 2 groups × 3 subjects × 3 technical replicates. `subject` is the
// independent unit (a spine level); `group` is the comparison qualifier; `value`
// is the measurement. `group` is constant per subject → unpaired across subjects.
const rows = ["group,subject,rep,value"];
for (const [grp, base] of [["ctrl", 10], ["drug", 14]])
  for (let s = 0; s < 3; s++)
    for (let r = 0; r < 3; r++)
      rows.push(`${grp},${grp}_s${s},${r},${base + s + r * 0.1}`);
const csv = rows.join("\n");

await page.click("button:has-text('Import data…')");
await page.setInputFiles("input[type=file]", {
  name: "superplot_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
});
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });

await page.click(".mode-toggle button:has-text('Analyses')");
await page.waitForSelector(".layer-rail", { timeout: 15000 });

// Map a group comparison (categorical X + numeric Y).
await page.locator(".enc-row", { hasText: "X" }).locator("select").selectOption("group");
await page.locator(".enc-row", { hasText: "Y" }).locator("select").selectOption("value");
await page.waitForTimeout(500);

// Build the nesting spine: add `subject` then `rep` as hierarchy levels.
const hier = page.locator(".hierarchy-card");
if (await hier.count() === 0) fail("no hierarchy card for a group comparison");
await hier.locator(".chip-btn", { hasText: "subject" }).click();
await hier.locator(".chip-btn", { hasText: "rep" }).click();
await page.waitForTimeout(300);
if (await hier.locator(".spine-level").count() !== 2)
  fail("spine did not gain two levels");

// Add a raw dot layer (rep level) + a bold dot layer bound to the subject level.
const addLayer = async (geom) => {
  await page.click(".add-layer-btn");
  await page.locator(".add-layer-menu button", { hasText: geom }).click();
  await page.waitForTimeout(200);
};
await addLayer("Dots");
await addLayer("Dots");
// bind the second dot layer to the subject level
const secondLayer = page.locator(".layer-card").nth(1);
await secondLayer.locator(".layer-level select").selectOption({ label: "per Subject" });
await page.waitForTimeout(1500);

const figure = await page.locator(".iris svg").count();
if (figure === 0) fail("no figure rendered");

// raw reps (2 groups) + one mark per subject (2×3 = 6) = 8 point-groups.
const ptsGroups = await page.locator('.iris svg g[id^="pts-"]').count();
if (ptsGroups < 8)
  fail(`expected ≥8 point-groups (2 raw + 6 subject), saw ${ptsGroups}`);
console.log(`superplot drew ${ptsGroups} point-groups`);

// the pairing verdict (derived from the spine) must surface.
const badge = page.locator(".pairing-badge");
if (await badge.count() === 0) fail("no pairing badge after building the spine");
console.log("pairing badge:", (await badge.first().innerText()).trim());

if (pageErrors.length) fail("page errors: " + pageErrors.slice(0, 4).join(" | "));

console.log("superplot e2e ok");
await browser.close();
