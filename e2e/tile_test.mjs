import { chromium } from "playwright";

/* Smoke for Phase 3d contingency tile: CATEGORICAL x × CATEGORICAL y is the
   describe-only contingency case. The only geom offered for that pair is the
   tile/heatmap (fill = count); adding it must draw a figure rather than crash
   the UI wiring (this is the exact class of bug — TEST_BY_FAMILY contingency
   key — that 111243b showed only surfaces through the UI). The workbench card
   reskin replaced the always-visible `.layer-rail` with the geom-editor card
   (reached via the figure node's right-click "Edit plot…"). Needs the engine
   (8765) and the vite dev server (5173). */

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

// Fixture: two categorical columns (X and Y); the value is the cell count.
const csv = [
  "treatment,outcome",
  "control,fail", "control,fail", "control,pass",
  "drug_a,pass", "drug_a,pass", "drug_a,fail",
].join("\n");

await page.click(".tb-btn:has-text('Import')");
await page.setInputFiles("input[type=file]", {
  name: "tile_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
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

// Map categorical X + categorical Y (the contingency pair).
await geomCard.locator(".enc-row", { hasText: "X" }).locator("select").selectOption("treatment");
await geomCard.locator(".enc-row", { hasText: "Y" }).locator("select").selectOption("outcome");
await page.waitForTimeout(500);

// The tile is the only geom offered for categorical × categorical; add it.
await geomCard.locator(".add-layer-btn").click();
const tileBtn = geomCard.locator(".add-layer-menu button:has-text('Tile')");
if (await tileBtn.count() === 0)
  fail("Tile not offered for categorical-x / categorical-y — contingency gate regressed");
await tileBtn.click();
await page.waitForTimeout(1800);

const figure = await page.locator(".figure-host svg").count();
const bar = await page.locator(".error-bar").count();
if (figure === 0 && bar === 0)
  fail("contingency tile: no figure and no status bar — rendered nothing");
if (figure > 0) {
  const svgText = await page.locator(".figure-host svg").textContent().catch(() => "");
  if (!svgText.includes("control") || !svgText.includes("fail"))
    fail("tile did not draw the categorical x/y levels");
  console.log("contingency tile rendered for categorical × categorical");
} else {
  console.log("guard/status bar shown (no crash)");
}

if (pageErrors.length) fail("page errors: " + pageErrors.slice(0, 4).join(" | "));

console.log("tile e2e ok");
await browser.close();
