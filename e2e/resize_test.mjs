import { chromium } from "playwright";

/* Drag-resize the figure and confirm the style drawer still renders after a
   few control flips. No fixture CSV exists on disk, so the table is imported
   via an in-memory buffer through the ImportWizard's hidden file input — the
   `.template-pick` dropdown and auto-seeded layers/mappings were removed in
   111243b (see TODO.md), so this follows the documented fix pattern: explicit
   import, explicit mapping, explicit `.add-layer-btn` flow. A Distribution layer
   (aggregates, needs only Y) always renders regardless of sample size. */

const csv = [
  "value",
  "1", "2", "2", "3", "3", "3", "4", "4", "5", "6", "7", "8",
].join("\n");

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1600, height: 1100 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(process.env.APP_URL ?? "http://localhost:5173");
await page.waitForSelector(".app", { timeout: 30000 });

await page.click(".tb-btn:has-text('Import')");
await page.setInputFiles("input[type=file]", {
  name: "resize_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
});
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });

await page.click(".tb-seg button:has-text('Workbench')");
const figureNode = page.locator(".txw-node.figure").first();
await figureNode.waitFor({ state: "visible", timeout: 60000 });
await figureNode.click({ button: "right" });
await page.waitForSelector(".txw-ctxmenu", { timeout: 15000 });
await page.locator(".txw-ctxmenu [role='menuitem']", { hasText: /edit plot/i }).click();
const geomCard = page.locator("[data-testid='geom-card']");
await geomCard.locator(".layer-rail").waitFor({ state: "visible", timeout: 15000 });

await geomCard.locator(".enc-row", { hasText: "Y" }).locator("select").selectOption("value");
await geomCard.locator(".add-layer-btn").click();
await geomCard.locator(".add-layer-menu button:has-text('Distribution')").click();
await page.waitForSelector(".figure-host svg", { timeout: 30000 });
await page.waitForTimeout(600);

const dims0 = await page.locator(".figure-pane .provenance").textContent();
console.log("dims before:", dims0);

const h = page.locator(".resize-handle");
const hb = await h.boundingBox();
console.log("handle present:", !!hb);
await page.mouse.move(hb.x + 7, hb.y + 7);
await page.mouse.down();
await page.mouse.move(hb.x + 7 + 80, hb.y + 7 - 60, { steps: 6 });
console.log("badge during drag:", await page.locator(".figure-pane .provenance").textContent());
await page.mouse.up();
await page.waitForTimeout(1500); // debounce + engine round trip
console.log("dims after:", await page.locator(".figure-pane .provenance").textContent());

// open style drawer, flip a few controls, confirm re-render doesn't error
await page.locator(".style-pane summary").click();
await page.locator(".style-pane").screenshot({ path: "/tmp/style_drawer.png" });
await page.getByLabel("notches (median CI)").check().catch(() => {});
const tickSel = page.locator("select").filter({ has: page.locator('option[value="inout"]') }).first();
await tickSel.selectOption("in");
await page.waitForTimeout(1200);
const svgOk = await page.evaluate(() => !!document.querySelector(".figure-host svg"));
const errBar = await page.locator(".error-bar").count();
console.log("svg still renders:", svgOk, "| error bars:", errBar);
await page.screenshot({ path: "/tmp/app_full.png", fullPage: true });
await b.close();
