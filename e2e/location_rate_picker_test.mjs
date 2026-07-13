import { chromium } from "playwright";

/* E2E: author a `location` (one-sample vs-reference) test and a `rate` (count
   GLM) test THROUGH THE GUI ALONE — no hand-edited spec — and confirm each
   figure renders and the stats panel reports the right test. This is the
   app-side proof for the two "engine can, GUI can't" families (TODO: App-side
   test-picker controls for the location & rate families).

   Flow per case: import a fixture → Workbench → add a plot via the wizard →
   open the test editor card (right-click figure → Edit test…) → tick the new
   picker control (reference / rate) → read back the family and the resolved
   test from the stats card.

   Needs the engine (8765, with statsmodels for the rate GLM) and the vite dev
   server (5173). Uses Playwright's bundled Chromium by default; pass
   CHROMIUM_PATH to use a system chromium instead (the hardcoded
   /opt/pw-browsers/chromium path only existed on one machine). */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const launchOpts = process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH } : {};
const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
const fail = (m) => { console.error("FAIL:", m); process.exit(1); };

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".app", { timeout: 30000 });
if (await page.locator(".engine-down").count() > 0) fail("engine down on 8765");

async function importCsv(name, csv) {
  await page.click(".tb-btn:has-text('Add data')");
  await page.setInputFiles("input[type=file]", {
    name, mimeType: "text/csv", buffer: Buffer.from(csv),
  });
  await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
  await page.click(".modal-foot button.primary");
  await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 }).catch(() => {});
}

async function figureMenu(itemRe, cardTestId) {
  const figure = page.locator(".txw-node.figure").first();
  await figure.waitFor({ state: "visible", timeout: 15000 });
  await figure.click({ button: "right" });
  await page.waitForSelector(".txw-ctxmenu", { timeout: 15000 });
  await page.locator(".txw-ctxmenu [role='menuitem']", { hasText: itemRe }).click();
  await page.waitForSelector(`[data-testid='${cardTestId}']`, { timeout: 15000 });
}
const openTestEditor = () => figureMenu(/edit test/i, "test-card");
const openPlotEditor = () => figureMenu(/edit plot/i, "geom-card");

// waits for the stats card body to reflect a settled render then returns its text
async function statsText() {
  // the stats section of the figure node also renders StatsResults; read the
  // pinned stats card if present, else the figure's stats section.
  await page.waitForTimeout(1500);
  const card = page.locator("[data-testid='stats-card']");
  if (await card.count()) return (await card.innerText()).replace(/\s+/g, " ");
  return (await page.locator(".txw-node.figure").first().innerText()).replace(/\s+/g, " ");
}

// ══════════════════════════════════════════════════════════════════════════════
// CASE 1 — location: only Y mapped + a reference value → one-sample test.
// ══════════════════════════════════════════════════════════════════════════════
{
  // a categorical `grp` (so a Dots geom is offerable) + a numeric `value`. We
  // author with X=grp, then UNMAP X in the encodings card to reach the ungrouped
  // "only Y mapped" shape — the wizard requires both axes, so unmapping is how a
  // Y-only plot is authored through the GUI.
  const rows = ["grp,value"];
  for (let i = 0; i < 12; i++) rows.push(`g${i % 2},${4 + (i % 5) * 0.5}`);
  await importCsv("loc.csv", rows.join("\n"));
  await page.click(".tb-seg button:has-text('Workbench')");

  await page.waitForSelector("[data-testid='plot-card']", { timeout: 15000 });
  await page.click(".txw-add-plot");
  await page.waitForSelector("[data-testid='plot-wizard']", { timeout: 10000 });
  await page.locator(".wiz-geom", { hasText: "Dots" }).click();
  await page.waitForSelector(".wiz-step.wiz-map", { timeout: 10000 });
  await page.locator(".enc-row", { hasText: "X" }).locator("select").selectOption("grp");
  await page.locator(".enc-row", { hasText: "Y" }).locator("select").selectOption("value");
  await page.waitForSelector(".wiz-done:not([disabled])", { timeout: 5000 });
  await page.click(".wiz-done");
  await page.waitForSelector("[data-testid='plot-wizard']", { state: "detached", timeout: 10000 });
  console.log("location: plot added (X=grp, Y=value)");

  // unmap X in the plot editor's encodings card → the ungrouped (Y-only) shape.
  await openPlotEditor();
  await page.locator("[data-testid='geom-card'] .enc-row", { hasText: "X" })
    .locator("select").selectOption("");
  console.log("location: X unmapped (only Y remains)");

  // open the test editor and tick "Test against a reference value".
  await openTestEditor();
  const testCard = page.locator("[data-testid='test-card']");
  const refToggle = testCard.locator(".describe-toggle", { hasText: /Test against a reference value/i });
  await refToggle.waitFor({ state: "visible", timeout: 10000 });
  await refToggle.locator("input[type=checkbox]").check();
  // the reference number field appears; the default is 0 — leave it.
  await testCard.locator("input[aria-label='reference value']").waitFor({ state: "visible", timeout: 5000 });
  console.log("location: reference toggle enabled (reference = 0)");

  // figure must render and the stats panel must report a one-sample test.
  const figSvg = await page.locator(".txw-node.figure svg, [data-testid='plot-card'] svg").count();
  if (figSvg === 0) fail("location: no figure rendered after enabling the reference test");
  const st = await statsText();
  if (!/one-?sample|reference|vs ref/i.test(st))
    fail(`location: stats panel did not report a one-sample/reference test; got: ${st.slice(0, 400)}`);
  console.log("location OK — figure rendered, stats report the one-sample test");
}

// fresh page for the second case (clean workspace).
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".app", { timeout: 30000 });

// ══════════════════════════════════════════════════════════════════════════════
// CASE 2 — rate: grouped counts + exposure → count-GLM rate estimate.
// ══════════════════════════════════════════════════════════════════════════════
{
  // 3 groups × several replicates of (count, hours) with distinct per-hour rates.
  const rows = ["grp,count,hours"];
  const spec = [["a", 2], ["b", 6], ["c", 4]];
  for (const [g, rate] of spec)
    for (let r = 0; r < 6; r++) {
      const hrs = 1 + (r % 3);
      rows.push(`${g},${Math.round(rate * hrs)},${hrs}`);
    }
  await importCsv("rate.csv", rows.join("\n"));
  await page.click(".tb-seg button:has-text('Workbench')");

  await page.waitForSelector("[data-testid='plot-card']", { timeout: 15000 });
  await page.click(".txw-add-plot");
  await page.waitForSelector("[data-testid='plot-wizard']", { timeout: 10000 });
  // Estimate ± CI (pointrange) is the rate geom; it is categorical×numeric.
  const pr = page.locator(".wiz-geom", { hasText: /Estimate|CI/i });
  if (await pr.count()) await pr.first().click();
  else await page.locator(".wiz-geom", { hasText: "Dots" }).click();
  await page.waitForSelector(".wiz-step.wiz-map", { timeout: 10000 });
  await page.locator(".enc-row", { hasText: "X" }).locator("select").selectOption("grp");
  await page.locator(".enc-row", { hasText: "Y" }).locator("select").selectOption("count");
  await page.waitForSelector(".wiz-done:not([disabled])", { timeout: 5000 });
  await page.click(".wiz-done");
  await page.waitForSelector("[data-testid='plot-wizard']", { state: "detached", timeout: 10000 });
  console.log("rate: plot added (X=grp, Y=count)");

  // open the test editor, tick "Model counts as a rate", pick the exposure.
  await openTestEditor();
  const testCard = page.locator("[data-testid='test-card']");
  const rateToggle = testCard.locator(".describe-toggle", { hasText: /Model counts as a rate/i });
  await rateToggle.waitFor({ state: "visible", timeout: 10000 });
  await rateToggle.locator("input[type=checkbox]").check();
  // exposure + model selects appear in the .rate-config block.
  await testCard.locator(".rate-config").waitFor({ state: "visible", timeout: 5000 });
  await testCard.locator("select[aria-label='exposure column']").selectOption("hours");
  console.log("rate: rate toggle enabled, exposure = hours");

  const figSvg = await page.locator(".txw-node.figure svg, [data-testid='plot-card'] svg").count();
  if (figSvg === 0) fail("rate: no figure rendered after enabling the rate model");
  const st = await statsText();
  if (!/rate|GLM|binomial|Poisson/i.test(st))
    fail(`rate: stats panel did not report a rate/GLM estimate; got: ${st.slice(0, 400)}`);
  console.log("rate OK — figure rendered, stats report the count-GLM rate");
}

if (pageErrors.length) fail("page errors: " + pageErrors.slice(0, 4).join(" | "));
console.log("LOCATION + RATE PICKER E2E OK");
await browser.close();
