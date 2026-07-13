import { chromium } from "playwright";

/* Smoke test for grouped-sheet structural edits (Slice 4): the header gestures
   that are ops on the canonical tidy table, each surfacing its cost.
     • delete a column  → delete_rows, confirmed with the exact row count
     • rename a header  → relabel_category (no collision: applied straight away)
     • rename onto a sibling → relabel_category that MERGES two levels, warned first
   Loads group×day (2 groups × 2 days × 2 reps → 2 × 4) and drives each in turn,
   asserting the honesty surface (confirm strip / notice) and that the shape
   changes exactly as the op says.

   Needs the engine (port 8765) and the vite dev server (port 5173) running. */

const csv = [
  "group,day,value",
  "Control,D1,1", "Control,D1,2",
  "Control,D2,3", "Control,D2,4",
  "Treatment,D1,5", "Treatment,D1,6",
  "Treatment,D2,7", "Treatment,D2,8",
].join("\n");

const URL = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".app", { timeout: 30000 });

await page.click(".tb-btn:has-text('Import')");
await page.setInputFiles("input[type=file]", {
  name: "structural_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
});
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });

await page.waitForSelector(".table-pane .dv-toggle", { timeout: 30000 });
await page.locator(".dv-toggle button:has-text('Grouped sheet')").click();
await page.waitForSelector(".gs-grid", { timeout: 15000 });

const prov = () => page.locator(".table-pane .provenance").innerText();
const leaves = () => page.locator(".gs-grid .de-heads .de-colcell");
const bands = () => page.locator(".gs-grid .de-band .de-groupcell");

if ((await prov()).trim() !== "2 × 4") fail("expected a 2 × 4 start, got " + await prov());
console.log("start:", (await prov()).trim());

/* --- 1. delete a leaf column: the first leaf is Control/D1 (2 rows). The × must
   raise a confirm that STATES the two rows before dropping them. --- */
const firstLeaf = leaves().nth(0);
await firstLeaf.hover();
await firstLeaf.locator(".gs-head-x").click();
await page.waitForSelector(".gs-confirm", { timeout: 5000 });
const confirmMsg = await page.locator(".gs-confirm-msg").innerText();
if (!/Delete 2 rows/.test(confirmMsg))
  fail("delete confirm must state the 2 rows it drops, got: " + confirmMsg);
await page.locator(".gs-confirm-go").click();
await page.waitForFunction(() => {
  const p = document.querySelector(".table-pane .provenance");
  return p && p.textContent.trim() === "2 × 3";
}, null, { timeout: 5000 });
const delNotice = await page.locator(".gs-notice").innerText();
if (!/Deleted 2 rows/.test(delNotice)) fail("expected a 'Deleted 2 rows' notice, got: " + delNotice);
console.log("deleted Control/D1 → shape", (await prov()).trim(), "· notice:", delNotice.trim());

/* --- 2. rename a band with a fresh name: no collision, applied immediately (no
   confirm strip), and stated after. Control → Ctrl. --- */
const controlBand = bands().filter({ hasText: "Control" }).first();
await controlBand.dblclick();
await page.locator(".gs-head-input").fill("Ctrl");
await page.locator(".gs-head-input").press("Enter");
await page.waitForFunction(() => {
  const b = document.querySelector(".gs-grid .de-band .de-groupcell .de-grouphead span");
  return b && b.textContent.trim() === "Ctrl";
}, null, { timeout: 5000 });
if (await page.locator(".gs-confirm").count() > 0)
  fail("a non-colliding rename must not raise a merge confirm");
const renNotice = await page.locator(".gs-notice").innerText();
if (!/Renamed .*Control.* to .*Ctrl/.test(renNotice)) fail("expected a rename notice, got: " + renNotice);
console.log("renamed Control → Ctrl · notice:", renNotice.trim());

/* --- 3. rename onto a sibling: Ctrl → Treatment collides with the other band, so
   it MERGES. That's lossy — a confirm must warn before it runs, and the merge
   collapses the two group bands into one. --- */
const ctrlBand = bands().filter({ hasText: "Ctrl" }).first();
await ctrlBand.dblclick();
await page.locator(".gs-head-input").fill("Treatment");
await page.locator(".gs-head-input").press("Enter");
await page.waitForSelector(".gs-confirm", { timeout: 5000 });
const mergeMsg = await page.locator(".gs-confirm-msg").innerText();
if (!/merge/i.test(mergeMsg)) fail("merge confirm must warn it merges the levels, got: " + mergeMsg);
await page.locator(".gs-confirm-go").click();
// after the merge every row is "Treatment": one band spanning the two days
await page.waitForFunction(() => {
  const cells = document.querySelectorAll(".gs-grid .de-band .de-groupcell");
  return cells.length === 1 && cells[0].textContent.includes("Treatment");
}, null, { timeout: 5000 });
const mergeNotice = await page.locator(".gs-notice").innerText();
if (!/Merged/.test(mergeNotice)) fail("expected a 'Merged' notice, got: " + mergeNotice);
if (await page.locator(".error-bar").count() > 0)
  fail("a structural edit must not raise an engine error: " + await page.locator(".error-bar").innerText());
console.log("merged Ctrl → Treatment → shape", (await prov()).trim(), "· notice:", mergeNotice.trim());

console.log("PASS: grouped-sheet structural edits are ops that surface their cost");
await browser.close();
