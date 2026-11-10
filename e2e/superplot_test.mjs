import { openApp, importCsv, openMode, addFirstPlot, inspectorTab, showStats, fail } from "./helpers.mjs";

/* Smoke for the data-hierarchy redesign: a superplot is *composed* from
   per-layer levels, not summoned by a preset. The nesting spine is derived on
   import from the identifier columns (`subject`, `rep` are identifier tokens),
   shown in the Data tab's hierarchy panel. In the Workbench, layers bind to
   spine levels: raw replicates at the bottom + one bold mark per subject on
   top — the canonical box(raw) + dot(subject) superplot (engine:
   test_n_labels). Binding the prominent layer to `subject` moves the
   inferential grain there, so the per-group n counts *subjects* (3), not raw
   rows (9) — the spine driving inference is the user-visible payoff. The plot
   editor is the Plot card: the first layer (Box) comes from the "+ add plot"
   wizard, the second (Dots) from the inspector's "+ add layer", whose wizard
   asks for the layer's grain (data level) right after its plot type. The stats
   are their own card, shown by clicking the figure node's Stats section.
   Needs the engine and the vite dev server. */

// Fixture: 2 groups × 3 subjects × 3 technical replicates. `subject` is the
// independent unit (a spine level); `group` is the comparison qualifier; `value`
// is the measurement. `group` is constant per subject → unpaired across subjects.
const rows = ["group,subject,rep,value"];
for (const [grp, base] of [["ctrl", 10], ["drug", 14]])
  for (let s = 0; s < 3; s++)
    for (let r = 0; r < 3; r++)
      rows.push(`${grp},${grp}_s${s},${r},${base + s + r * 0.1}`);
const csv = rows.join("\n");

const { browser, page } = await openApp();
await importCsv(page, "superplot_fixture.csv", csv);

// The spine is seeded from the imported identifier columns — `subject` and `rep`
// are identifier tokens, so the hierarchy panel (Data tab) shows a 2-level spine
// with no manual building. (The app opens in Data mode by default.)
await openMode(page, "Data");
await page.waitForSelector(".hierarchy-panel", { timeout: 15000 });
const spineNodes = await page.locator(".hierarchy-panel .hp-node").count();
if (spineNodes !== 2)
  fail(`spine should have 2 levels (subject, rep) from the identifier columns, saw ${spineNodes}`);

// Compose the superplot over a group comparison (categorical X + numeric Y): a
// raw Box (replicate spread) first, then a Dots layer bound to the subject level
// (one bold mark per subject) — the documented superplot idiom.
const card = await addFirstPlot(page, { geom: "Box", x: "group", y: "value" });
await inspectorTab(page, "Layers");
await card.locator(".add-layer-btn").click();
await page.waitForSelector("[data-testid='plot-wizard']", { timeout: 10000 });
const dotsTile = page.locator(".wiz-geom", { hasText: /^Dots$/ });
if (await dotsTile.count() === 0) fail("Dots not offered as a second layer");
await dotsTile.click();
// the add-layer wizard's grain step: bind the new dot layer to the subject level
await page.waitForSelector(".wiz-step.wiz-grain", { timeout: 10000 });
await page.locator(".wiz-grain select").selectOption("subject");
await page.click(".wiz-done");
await page.waitForSelector("[data-testid='plot-wizard']", { state: "detached", timeout: 10000 });
await inspectorTab(page, "Layers");
const nLayers = await card.locator(".layer-card").count();
if (nLayers !== 2) fail(`expected 2 layers (Box + Dots), got ${nLayers}`);
// the dot layer (second card) shows the subject level in its Data level row
const dotLevel = await card.locator(".layer-card").nth(1).locator(".layer-level select").inputValue();
if (dotLevel !== "subject") fail(`dot layer should draw per subject, its level is "${dotLevel}"`);
await page.waitForTimeout(1500);

const figure = await card.locator(".figure-host svg").count();
if (figure === 0) fail("no figure rendered");

// Item I: dots draw as plain vector scatter calls (no per-point pts- gid). The
// subject-bound dot layer draws one mark per subject (2 groups × 3 = 6) as <use>
// glyphs inside matplotlib PathCollection groups.
const scatterColls = await card.locator('.figure-host svg g[id^="PathCollection_"]').count();
if (scatterColls < 1)
  fail(`expected ≥1 scatter collection for the subject dots, saw ${scatterColls}`);
const useMarks = await card.locator('.figure-host svg g[id^="PathCollection_"] use').count();
if (useMarks < 6)
  fail(`expected ≥6 subject marks (2 groups × 3 subjects), saw ${useMarks}`);
console.log(`superplot drew ${scatterColls} scatter collections, ${useMarks} marks`);

// The spine drives inference: with the prominent layer at the subject level, the
// per-group summary counts subjects (n = 3), not raw replicate rows (n = 9).
// The stats panel is its own card, opened by left-clicking the figure's Stats section.
const stats = await showStats(page);
await page.waitForTimeout(1000);
const statsText = (await stats.innerText().catch(() => "")).replace(/\s+/g, " ");
if (!/n = 3\b/.test(statsText))
  fail(`stats panel should report the subject-level n (n = 3 per group); got: ${statsText.slice(0, 400)}`);
if (/n = 9\b/.test(statsText))
  fail("stats panel reported the raw-row n (n = 9) — inference did not move to the subject level");
console.log("per-group n counts subjects (n = 3), not raw rows");

if (page.errors.length) fail("page errors: " + page.errors.slice(0, 4).join(" | "));

console.log("superplot e2e ok");
await browser.close();
