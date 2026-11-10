import { openApp, importCsv, addFirstPlot, inspectorTab, fail } from "./helpers.mjs";

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

   The plot is built in the Plot card (add-plot wizard, then the Layers tab's
   add-layer wizard for the subject-grain dots), and the collapse-routing panel
   is its own card (opened via the source node's `+` handle -> "Collapse"),
   not a fixed side panel.

   Needs the engine and the vite dev server; Chromium runs on a machine that
   has one. */

const { browser, page } = await openApp();

// Same fixture as the superplot e2e: `subject` and `rep` are identifier tokens,
// so the import seeds a 2-level spine and the default plan is a 2-step collapse.
const rows = ["group,subject,rep,value"];
for (const [grp, base] of [["ctrl", 10], ["drug", 14]])
  for (let s = 0; s < 3; s++)
    for (let r = 0; r < 3; r++)
      rows.push(`${grp},${grp}_s${s},${r},${base + s + r * 0.1}`);
await importCsv(page, "collapse_routing_fixture.csv", rows.join("\n"));

// A categorical-X / numeric-Y comparison so a plot+test exist: the first plot
// (Box, raw) through the add-plot wizard ...
const card = await addFirstPlot(page, { geom: "Box", x: "group", y: "value" });

// ... then compose dot(subject) on top through the add-layer wizard, so
// inference sits at the subject grain by default (n = subjects), mirroring the
// canonical superplot.
await inspectorTab(page, "Layers");
await card.locator(".add-layer-btn").click();
await page.waitForSelector("[data-testid='plot-wizard']", { timeout: 10000 });
await page.locator(".wiz-geom", { hasText: "Dots" }).first().click();
await page.waitForSelector(".wiz-step.wiz-grain", { timeout: 10000 });
await page.locator(".wiz-grain select").selectOption("subject");
await page.click(".wiz-done");
await page.waitForSelector("[data-testid='plot-wizard']", { state: "detached", timeout: 10000 });
await inspectorTab(page, "Layers");
const dotLevel = await card.locator(".layer-card").nth(1).locator(".layer-level select").inputValue();
if (dotLevel !== "subject") fail(`the Dots layer should read the subject grain, reads '${dotLevel}'`);
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

if (page.errors.length) fail("page errors: " + page.errors.slice(0, 4).join(" | "));

console.log("collapse routing e2e ok");
await browser.close();
