import { chromium } from "playwright";

/* Drag a label on a rendered figure and confirm the offset bakes in after
   re-render. No fixture CSV exists on disk, so the table is imported via an
   in-memory buffer through the ImportWizard's hidden file input — the
   `.template-pick` dropdown and auto-seeded layers/mappings were removed in
   111243b (see TODO.md), so this follows the documented fix pattern: explicit
   import, explicit mapping, explicit `.add-layer-btn` flow. A Distribution layer
   (aggregates, needs only Y) always renders regardless of sample size. */

const csv = [
  "value",
  "1", "2", "2", "3", "3", "3", "4", "4", "5", "6", "7", "8",
].join("\n");

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("console", (m) => console.log("[console]", m.type(), m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(process.env.APP_URL ?? "http://localhost:5173");
await page.waitForSelector(".app", { timeout: 30000 });

await page.click(".tb-btn:has-text('Add data')");
await page.setInputFiles("input[type=file]", {
  name: "drag_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
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
await page.waitForTimeout(800);

const lbl = page.locator(".figure-host g#lbl-y");
console.log("lbl-y groups found:", await lbl.count());
const box = await lbl.boundingBox();
console.log("lbl-y bbox:", box);
const cursor = await lbl.evaluate((el) => getComputedStyle(el).cursor);
console.log("cursor:", cursor);

// what element actually receives the pointer at the label's center?
const hit = await page.evaluate(([x, y]) => {
  const el = document.elementFromPoint(x, y);
  return { tag: el?.tagName, id: el?.id, parentId: el?.parentElement?.id,
           closestLbl: el?.closest("g#lbl-y") ? true : false };
}, [box.x + box.width / 2, box.y + box.height / 2]);
console.log("hit test:", JSON.stringify(hit));

// try the drag
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + 60, box.y - 40, { steps: 8 });
const during = await lbl.getAttribute("transform");
console.log("transform during drag:", during);
await page.mouse.up();
await page.waitForTimeout(1200); // debounce + re-render
const after = await page.evaluate(() =>
  document.querySelector(".figure-host g#lbl-y")?.getAttribute("transform"));
console.log("transform after re-render (should be null, offset baked in):", after);
await b.close();
