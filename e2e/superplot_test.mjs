import { chromium } from "playwright";

/* Smoke for the data-hierarchy redesign: a superplot is *composed* from
   per-layer levels, not summoned by a preset. The nesting spine is derived on
   import from the identifier columns (`subject`, `rep` are identifier tokens),
   shown in the Data tab's hierarchy panel. In the Workbench, layers bind to
   spine levels: raw replicates at the bottom + one bold mark per subject on
   top — the canonical box(raw) + dot(subject) superplot (engine:
   test_n_labels). Binding the prominent layer to `subject` moves the
   inferential grain there, so the per-group n counts *subjects* (3), not raw
   rows (9) — the spine driving inference is the user-visible payoff. The
   workbench card reskin replaced the always-visible `.layer-rail` with the
   geom-editor card (reached via the figure node's right-click "Edit plot…"),
   and the stats panel is reached by left-clicking the figure node's Stats
   section. Needs the engine (8765) and the vite dev server (5173); no
   Chromium is installable in the build sandbox, so this runs on a machine
   that has one. */

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

await page.click(".tb-btn:has-text('Add data')"); await page.click(".tb-menu button:has-text('Import…')");
await page.setInputFiles("input[type=file]", {
  name: "superplot_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
});
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });

// The spine is seeded from the imported identifier columns — `subject` and `rep`
// are identifier tokens, so the hierarchy panel (Data tab) shows a 2-level spine
// with no manual building. (The app opens in Data mode by default.)
await page.click(".tb-seg button:has-text('Data')");
await page.waitForSelector(".hierarchy-panel", { timeout: 15000 });
const spineNodes = await page.locator(".hierarchy-panel .hp-node").count();
if (spineNodes !== 2)
  fail(`spine should have 2 levels (subject, rep) from the identifier columns, saw ${spineNodes}`);

await page.click(".tb-seg button:has-text('Workbench')");
const figureNode = page.locator(".txw-node.figure").first();
await figureNode.waitFor({ state: "visible", timeout: 15000 });
await figureNode.click({ button: "right" });
await page.waitForSelector(".txw-ctxmenu", { timeout: 15000 });
await page.locator(".txw-ctxmenu [role='menuitem']", { hasText: /edit plot/i }).click();
const geomCard = page.locator("[data-testid='geom-card']");
await geomCard.locator(".layer-rail").waitFor({ state: "visible", timeout: 15000 });

// Map a group comparison (categorical X + numeric Y).
await geomCard.locator(".enc-row", { hasText: "X" }).locator("select").selectOption("group");
await geomCard.locator(".enc-row", { hasText: "Y" }).locator("select").selectOption("value");
await page.waitForTimeout(500);

// Compose the superplot: a raw Box (replicate spread) + a Dots layer bound to the
// subject level (one bold mark per subject). The add menu excludes already-used
// geoms, so the two layers are distinct geoms — the documented superplot idiom.
const addLayer = async (geom) => {
  await geomCard.locator(".add-layer-btn").click();
  await geomCard.locator(".add-layer-menu button", { hasText: geom }).click();
  await page.waitForTimeout(200);
};
await addLayer("Box");
await addLayer("Dots");
// bind the dot layer (second card) to the subject level — its value is the column
const dotLayer = geomCard.locator(".layer-card").nth(1);
await dotLayer.locator(".layer-level select").selectOption("subject");
await page.waitForTimeout(1500);

const figure = await page.locator(".figure-host svg").count();
if (figure === 0) fail("no figure rendered");

// Item I: dots draw as plain vector scatter calls (no per-point pts- gid). The
// subject-bound dot layer draws one mark per subject (2 groups × 3 = 6) as <use>
// glyphs inside matplotlib PathCollection groups.
const scatterColls = await page.locator('.figure-host svg g[id^="PathCollection_"]').count();
if (scatterColls < 1)
  fail(`expected ≥1 scatter collection for the subject dots, saw ${scatterColls}`);
const useMarks = await page.locator('.figure-host svg g[id^="PathCollection_"] use').count();
if (useMarks < 6)
  fail(`expected ≥6 subject marks (2 groups × 3 subjects), saw ${useMarks}`);
console.log(`superplot drew ${scatterColls} scatter collections, ${useMarks} marks`);

// The spine drives inference: with the prominent layer at the subject level, the
// per-group summary counts subjects (n = 3), not raw replicate rows (n = 9).
// The stats panel is its own card, opened by left-clicking the figure's Stats section.
await figureNode.locator(".txw-figsec", { hasText: "Stats" }).click();
await page.waitForSelector("[data-testid='stats-card']", { timeout: 15000 });
const statsText = (await page.locator("[data-testid='stats-card']").innerText().catch(() => "")).replace(/\s+/g, " ");
if (!/n = 3\b/.test(statsText))
  fail(`stats panel should report the subject-level n (n = 3 per group); got: ${statsText.slice(0, 400)}`);
if (/n = 9\b/.test(statsText))
  fail("stats panel reported the raw-row n (n = 9) — inference did not move to the subject level");
console.log("per-group n counts subjects (n = 3), not raw rows");

if (pageErrors.length) fail("page errors: " + pageErrors.slice(0, 4).join(" | "));

console.log("superplot e2e ok");
await browser.close();
