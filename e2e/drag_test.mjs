import { openApp, importCsv, addFirstPlot, fail } from "./helpers.mjs";

/* Drag a label on a rendered figure and confirm the offset bakes in after
   re-render. No fixture CSV exists on disk, so the table is imported via an
   in-memory buffer. The plot is built through the Plot card's add-plot
   wizard. A Distribution layer (aggregates, needs only Y) always renders
   regardless of sample size. */

const csv = [
  "value",
  "1", "2", "2", "3", "3", "3", "4", "4", "5", "6", "7", "8",
].join("\n");

const { browser, page } = await openApp();
page.on("console", (m) => { if (m.type() === "error") console.log("[console]", m.type(), m.text()); });
await importCsv(page, "drag_fixture.csv", csv);
/* Distribution needs only Y: the wizard hides X (no column can go there) and
   Done must enable once Y is mapped. */
let card;
try {
  card = await addFirstPlot(page, { geom: "Distribution", y: "value" });
} catch (e) {
  const doneDisabled = await page.locator(".wiz-done").isDisabled().catch(() => null);
  fail("could not build a Distribution (Y only) through the add-plot wizard"
    + (doneDisabled ? ": Done stays disabled with Y mapped (the wizard requires X and Y for every geom)" : "")
    + ` — ${e.message.split("\n")[0]}`);
}
await page.waitForTimeout(800);

const lbl = card.locator(".figure-host g#lbl-y");
const n = await lbl.count();
console.log("lbl-y groups found:", n);
if (n === 0) fail("no draggable y label (g#lbl-y) in the rendered figure");
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
if (!hit.closestLbl) fail("the y label does not receive the pointer at its centre");

// the drag: the label follows the pointer (a live transform) ...
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + 60, box.y - 40, { steps: 8 });
const during = await lbl.getAttribute("transform");
console.log("transform during drag:", during);
if (!during) fail("label did not move during the drag (no transform)");
await page.mouse.up();
// ... and after the debounce + re-render the offset is baked into the figure:
// no transform left, the label drawn at its new place.
await page.waitForTimeout(1500);
const after = await page.evaluate(() =>
  document.querySelector("[data-testid='plot-card'] .figure-host g#lbl-y")?.getAttribute("transform"));
console.log("transform after re-render (should be null, offset baked in):", after);
if (after) fail(`offset not baked in after re-render (transform still ${after})`);
const moved = await card.locator(".figure-host g#lbl-y").boundingBox();
console.log("lbl-y bbox after:", moved);
if (!moved || (Math.abs(moved.x - box.x) < 5 && Math.abs(moved.y - box.y) < 5))
  fail("label is back at its old place after re-render — the drag offset was lost");

if (page.errors.length) fail("page errors: " + page.errors.slice(0, 4).join(" | "));
console.log("drag e2e ok");
await browser.close();
