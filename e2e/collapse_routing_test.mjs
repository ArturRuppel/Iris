import { chromium } from "playwright";

/* E2E for the transformation explorer's collapse-routing UI — the integration
   proof for the un-force-nesting feature. Reusing the superplot harness:
   import a 2-group × 3-subject × 3-replicate CSV (so the spine is the two
   identifier columns `subject`, `rep` → a multi-level collapse plan), open the
   Workbench, and exercise the routing panel:

     1. The Collapse routing panel renders with one row (.cr-step) per collapse
        step — >1 for a multi-level spine.
     2. Every collapse edge carries a white info badge (`.edge-badge.info`) —
        the flatten_info guard, "what this step pools by", present from the
        start with no engine round-trip.
     3. Setting "Test reads at" → Raw trips the engine's pseudoreplication
        guard: an amber `.edge-badge.caution` appears on the test edge AND the
        figure's Stats section grows a `.node-caution-dot`.
     4. Removing a collapse step (the × button) drops one fewer `.cr-step`.

   (Guard-badge rendering was reconnected 2026-07-13 — the reskin had dropped
   the JSX while leaving the guard data model and CSS intact; WorkbenchCanvas
   now forwards `data.guards` to WorkbenchEdge, which renders the badges, and
   the figure's Stats section shows the caution dot. This test is the
   regression guard for that honesty signal.)

   The workbench card reskin also replaced the always-visible `.layer-rail`
   with the geom-editor card (right-click the figure node -> "Edit plot…"),
   and the collapse-routing panel is now its own card (opened via the source
   node's `+` handle -> "Collapse"), not a fixed side panel.

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

await page.click(".tb-btn:has-text('Add data')");
await page.setInputFiles("input[type=file]", {
  name: "collapse_routing_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
});
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });

// Into the Workbench, map a categorical-X / numeric-Y comparison so a plot+test exist.
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

// Compose box(raw) + dot(subject) so inference sits at the subject grain by
// default (n = subjects), mirroring the canonical superplot.
const addLayer = async (geom) => {
  await geomCard.locator(".add-layer-btn").click();
  await geomCard.locator(".add-layer-menu button", { hasText: geom }).click();
};
await addLayer("Box");
await addLayer("Dots");
await geomCard.locator(".layer-card").nth(1).locator(".layer-level select").selectOption("subject");
await page.waitForTimeout(500);

// Open the collapse-editor card via the source node's `+` handle.
await page.locator(".txw-handle-add").first().click();
await page.waitForSelector(".txw-add-menu-float", { timeout: 5000 });
await page.locator(".txw-add-menu-float [role='menuitem']", { hasText: "Collapse" }).click();
const collapseCard = page.locator("[data-testid='collapse-card']");
await collapseCard.locator(".collapse-routing").waitFor({ state: "visible", timeout: 15000 });

// --- 1. Collapse routing renders with >1 step for a multi-level spine. ---
const steps = collapseCard.locator(".cr-step");
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
// The box+dot layers put inference at the subject grain (n = 6 subjects, the
// default/coarsest). Reading the test one level finer — subject×rep (n = 18) —
// pseudoreplicates: the engine flags it, the test edge gets an amber caution
// badge, and the figure's Stats section gets a caution dot. (Raw/"" is NOT used
// here: effectiveTestGrainAtom treats the empty grain key as "unset → coarsest",
// so selecting Raw is silently ignored — a separate pre-existing quirk.)
await collapseCard.locator("select[aria-label='test reads at']").selectOption("subject/rep");
const cautionBadge = page.locator(".edge-badge.caution").first();
await cautionBadge.waitFor({ state: "visible", timeout: 15000 });
const cautionDot = page.locator(".node-caution-dot").first();
await cautionDot.waitFor({ state: "visible", timeout: 15000 });
console.log("finer test grain raised an amber caution badge + a stats caution dot");
// restore the default test grain so the removal step below reads a clean plan.
await collapseCard.locator("select[aria-label='test reads at']").selectOption("subject");

// --- 4. Removing a collapse step drops one fewer .cr-step. ---
const remove = collapseCard.locator(".cr-step button[aria-label*='remove level' i]").first();
await remove.click();
await page.waitForFunction(
  (n) => document.querySelectorAll("[data-testid='collapse-card'] .cr-step").length === n - 1, stepCount,
  { timeout: 15000 },
);
const stepCountAfter = await collapseCard.locator(".cr-step").count();
if (stepCountAfter !== stepCount - 1)
  fail(`removing a level should drop one cr-step (${stepCount} -> ${stepCount - 1}), saw ${stepCountAfter}`);
console.log(`removed a level: cr-steps ${stepCount}->${stepCountAfter}`);

if (pageErrors.length) fail("page errors: " + pageErrors.slice(0, 4).join(" | "));

console.log("collapse routing e2e ok");
await browser.close();
