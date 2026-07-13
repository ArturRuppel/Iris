import { chromium } from "playwright";

/* Smoke for Phase 3c horizontal orientation: a NUMERIC x + CATEGORICAL y maps to
   a horizontal group comparison. The group-comparison geoms (dot/box/violin/bar/
   summary) render with the categorical factor on Y and the measurement on X; the
   add-layer menu should still offer them (h_orient), and the figure should draw
   the categorical levels as y tick labels without crashing the UI wiring. The
   workbench card reskin replaced the always-visible `.layer-rail` with the
   geom-editor card (reached via the figure node's right-click "Edit plot…"),
   which hosts the same EncodingsCard + add-layer-menu this test always drove.
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

// Fixture: numeric measurement (X) + categorical treatment (Y).
const csv = [
  "treatment,response",
  "control,1", "control,2", "control,3", "control,4",
  "drug_a,5", "drug_a,6", "drug_a,7", "drug_a,8",
].join("\n");

await page.click(".tb-btn:has-text('Add data')");
await page.setInputFiles("input[type=file]", {
  name: "horizontal_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
});
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });

await page.click(".tb-seg button:has-text('Workbench')");
const figureNode = page.locator(".txw-node.figure").first();
await figureNode.waitFor({ state: "visible", timeout: 15000 });
await figureNode.click({ button: "right" });
await page.waitForSelector(".txw-ctxmenu", { timeout: 15000 });
await page.locator(".txw-ctxmenu [role='menuitem']", { hasText: /edit plot/i }).click();
const geomCard = page.locator("[data-testid='geom-card']");
await geomCard.locator(".layer-rail").waitFor({ state: "visible", timeout: 15000 });

// Map numeric X + categorical Y (the swapped, horizontal pair).
await geomCard.locator(".enc-row", { hasText: "X" }).locator("select").selectOption("response");
await geomCard.locator(".enc-row", { hasText: "Y" }).locator("select").selectOption("treatment");
await page.waitForTimeout(500);

// Box must be offered for the horizontal pair (h_orient); add it.
await geomCard.locator(".add-layer-btn").click();
const boxBtn = geomCard.locator(".add-layer-menu button:has-text('Box')");
if (await boxBtn.count() === 0)
  fail("Box not offered for numeric-x / categorical-y — h_orient gate regressed");
await boxBtn.click();
await page.waitForTimeout(1800);

const figure = await page.locator(".figure-host svg").count();
const bar = await page.locator(".error-bar").count();
if (figure === 0 && bar === 0)
  fail("horizontal box: no figure and no status bar — rendered nothing");
if (figure > 0) {
  const svgText = await page.locator(".figure-host svg").textContent().catch(() => "");
  if (!svgText.includes("control") || !svgText.includes("drug_a"))
    fail("categorical levels not drawn as y tick labels in horizontal mode");
  console.log("horizontal figure rendered with categorical y levels");
} else {
  console.log("guard/status bar shown (no crash)");
}

if (pageErrors.length) fail("page errors: " + pageErrors.slice(0, 4).join(" | "));

console.log("horizontal e2e ok");
await browser.close();
