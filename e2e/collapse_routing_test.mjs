import { chromium } from "playwright";

/* E2E for the transformation explorer's collapse-routing UI + guard badges —
   the integration proof for the un-force-nesting feature. Reusing the superplot
   harness: import a 2-group × 3-subject × 3-replicate CSV (so the spine is the
   two identifier columns `subject`, `rep` → a multi-level collapse plan), drop
   into Analyses, then exercise the routing panel and the explorer's badges:

     1. The Collapse routing panel renders with one row (.cr-step) per collapse
        step — >1 for a multi-level spine.
     2. Every collapse edge carries a white info badge (.edge-badge.info) from
        the start (what the step pools / groups per), no engine guard needed.
     3. Moving "Test reads at" to a FINER grain (Raw) trips the engine's
        pseudoreplication guard: an amber .edge-badge.caution appears AND the
        Stats node grows a .node-caution-dot.
     4. Removing a collapse step (the × button) drops a collapse node from the
        graph (one fewer .cr-step and one fewer `per …` grain node).

   Needs the engine (8765) and the vite dev server (5173); Chromium runs on a
   machine that has one. */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".app", { timeout: 30000 });
if (await page.locator(".engine-down").count() > 0)
  fail("engine not reachable — start the engine on 8765");

// Same fixture as the superplot e2e: `subject` and `rep` are identifier tokens,
// so the import seeds a 2-level spine and the default plan is a 2-step collapse.
const rows = ["group,subject,rep,value"];
for (const [grp, base] of [["ctrl", 10], ["drug", 14]])
  for (let s = 0; s < 3; s++)
    for (let r = 0; r < 3; r++)
      rows.push(`${grp},${grp}_s${s},${r},${base + s + r * 0.1}`);
const csv = rows.join("\n");

await page.click("button:has-text('Import data…')");
await page.setInputFiles("input[type=file]", {
  name: "collapse_routing_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
});
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });

// Into Analyses, map a categorical-X / numeric-Y comparison so a plot+test exist.
await page.click(".mode-toggle button:has-text('Analyses')");
await page.waitForSelector(".layer-rail", { timeout: 15000 });
await page.locator(".enc-row", { hasText: "X" }).locator("select").selectOption("group");
await page.locator(".enc-row", { hasText: "Y" }).locator("select").selectOption("value");

// Compose box(raw) + dot(subject) so inference sits at the subject grain by
// default (n = subjects), mirroring the canonical superplot.
const addLayer = async (geom) => {
  await page.click(".add-layer-btn");
  await page.locator(".add-layer-menu button", { hasText: geom }).click();
};
await addLayer("Box");
await addLayer("Dots");
await page.locator(".layer-card").nth(1).locator(".layer-level select").selectOption("subject");

// --- 1. Collapse routing renders with >1 step for a multi-level spine. ---
const panel = page.locator(".collapse-routing");
await panel.waitFor({ state: "visible", timeout: 15000 });
const steps = page.locator(".cr-step");
await steps.first().waitFor({ state: "visible", timeout: 15000 });
const stepCount = await steps.count();
if (stepCount < 2)
  fail(`collapse plan should have >1 step for a 2-level spine, saw ${stepCount}`);
console.log(`collapse routing renders ${stepCount} steps`);

// --- 2. Every collapse edge shows a white info badge from the start. ---
const infoBadge = page.locator(".edge-badge.info").first();
await infoBadge.waitFor({ state: "visible", timeout: 15000 });
console.log(`info badge visible (${await page.locator(".edge-badge.info").count()} total)`);

// --- 3. A finer "Test reads at" trips the pseudoreplication caution. ---
// Default grain sits at the coarsest (subject). Read at Raw (every row) — finer
// than subject → the engine flags pseudoreplication; the test edge gets an amber
// caution badge and the Stats node gets a caution dot.
const testGrain = page.locator(".cr-testgrain select");
await testGrain.selectOption("");   // "" == Raw (every row), the finest grain
const cautionBadge = page.locator(".edge-badge.caution").first();
await cautionBadge.waitFor({ state: "visible", timeout: 15000 });
const cautionDot = page.locator(".node-caution-dot");
await cautionDot.first().waitFor({ state: "visible", timeout: 15000 });
console.log("finer test grain raised an amber caution badge + a stats caution dot");

// --- 4. Removing a collapse step drops a collapse node from the graph. ---
const grainNodesBefore = await page.locator(".tx-node.tx-table", { hasText: "per " }).count();
const remove = page.locator(".cr-step button[aria-label*='remove level' i]").first();
await remove.click();
// the panel re-renders with one fewer row
await page.waitForFunction(
  (n) => document.querySelectorAll(".cr-step").length === n - 1, stepCount,
  { timeout: 15000 },
);
const stepCountAfter = await page.locator(".cr-step").count();
const grainNodesAfter = await page.locator(".tx-node.tx-table", { hasText: "per " }).count();
if (stepCountAfter !== stepCount - 1)
  fail(`removing a level should drop one cr-step (${stepCount} -> ${stepCount - 1}), saw ${stepCountAfter}`);
if (grainNodesAfter >= grainNodesBefore)
  fail(`removing a level should drop a grain node (was ${grainNodesBefore}, now ${grainNodesAfter})`);
console.log(`removed a level: cr-steps ${stepCount}->${stepCountAfter}, grain nodes ${grainNodesBefore}->${grainNodesAfter}`);

if (pageErrors.length) fail("page errors: " + pageErrors.slice(0, 4).join(" | "));

console.log("collapse routing e2e ok");
await browser.close();
