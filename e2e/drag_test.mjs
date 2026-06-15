import { chromium } from "playwright";

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("console", (m) => console.log("[console]", m.type(), m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(process.env.APP_URL ?? "http://localhost:5173");
await page.click(".mode-toggle button:has-text('Analyses')");
await page.waitForSelector(".layer-rail", { timeout: 60000 });
/* the default per-row geom is point-capped on the large sample (no figure);
   switch to a template that renders on the full table so there's a figure to
   drag. Harmless on the small synthetic sample (still renders). */
await page.selectOption(".layer-rail .template-pick", { label: "Histogram + density" })
  .catch(() => {});
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
