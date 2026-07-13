import { chromium } from "playwright";

/* Smoke test for grouped-sheet factor edits (Slice 4c/4d): the two structural
   ops that reshape the *design* rather than edit cells, driven from the factor
   strip above the grid (kept apart from the in-grid cell/row/label gestures).
     • add a level to a factor → add_level, blank across the other factors
     • drop a whole factor      → drop_column, confirmed (lossy), schema shrinks
   Loads group×day (2 groups × 2 days × 2 reps → 2 × 4), adds a "day" level
   (fills it in under both groups, blank → 2 × 6), then drops the "day" grouping
   (its rows survive as undifferentiated replicates → 6 × 2).

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

await page.click(".tb-btn:has-text('Add data')");
await page.click(".tb-menu button:has-text('Import…')");
await page.setInputFiles("input[type=file]", {
  name: "factor_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
});
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });

await page.waitForSelector(".table-pane .dv-toggle", { timeout: 30000 });
await page.locator(".dv-toggle button:has-text('Grouped sheet')").click();
await page.waitForSelector(".gs-grid", { timeout: 15000 });

const prov = () => page.locator(".table-pane .provenance").innerText();
const waitShape = (s) => page.waitForFunction((want) => {
  const p = document.querySelector(".table-pane .provenance");
  return p && p.textContent.trim() === want;
}, s, { timeout: 5000 });

if ((await prov()).trim() !== "2 × 4") fail("expected a 2 × 4 start, got " + await prov());
console.log("start:", (await prov()).trim());

/* --- 1. add a level to "day": the ＋ on the day chip opens an inline input; a
   fresh name applies straight away (add is pure — no confirm) and fills the new
   level in under BOTH groups, blank. 2 × 4 → 2 × 6. --- */
const dayChip = page.locator(".gs-factor", { hasText: /day/i });
await dayChip.locator(".gs-fadd").click();
await page.waitForSelector(".gs-factor-add", { timeout: 5000 });
await page.locator(".gs-factor-add").fill("D3");
await page.locator(".gs-factor-add").press("Enter");
await waitShape("2 × 6");
if (await page.locator(".gs-confirm").count() > 0)
  fail("adding a level is pure addition and must not raise a confirm");
const addNotice = await page.locator(".gs-notice").innerText();
if (!/Added/.test(addNotice) || !/D3/.test(addNotice) || !/4 blank rows/.test(addNotice))
  fail("expected an 'Added D3 … 4 blank rows' notice, got: " + addNotice);
const leaves = await page.locator(".gs-grid .de-heads").innerText();
if ((leaves.match(/D3/g) || []).length < 2)
  fail("the new D3 level should appear under both groups, leaf headers: " + leaves);
console.log("added day=D3 → shape", (await prov()).trim(), "· notice:", addNotice.trim());

/* --- 2. drop the "day" factor: the ✕ on its chip is lossy, so it confirms
   first; removing it collapses the grouping — every row survives (the 12 rows,
   incl. the 4 blank D3) become undifferentiated replicates under group. The
   schema loses the factor: the strip drops to a single chip. 2 × 6 → 6 × 2. --- */
await page.locator(".gs-factor", { hasText: /day/i }).locator(".gs-fdrop").click();
await page.waitForSelector(".gs-confirm", { timeout: 5000 });
const dropMsg = await page.locator(".gs-confirm-msg").innerText();
if (!/Remove the .*day.* grouping/i.test(dropMsg))
  fail("drop confirm must name the grouping it removes, got: " + dropMsg);
await page.locator(".gs-confirm-go").click();
await waitShape("6 × 2");
const dropNotice = await page.locator(".gs-notice").innerText();
if (!/Removed the .*day.* grouping/i.test(dropNotice))
  fail("expected a 'Removed the day grouping' notice, got: " + dropNotice);
if (await page.locator(".gs-factor").count() !== 1)
  fail("after dropping a factor the strip should show one factor, got "
    + await page.locator(".gs-factor").count());
if (await page.locator(".error-bar").count() > 0)
  fail("a factor edit must not raise an engine error: " + await page.locator(".error-bar").innerText());
console.log("dropped day → shape", (await prov()).trim(), "· notice:", dropNotice.trim());

console.log("PASS: grouped-sheet factor edits add a level and drop a factor, honestly");
await browser.close();
