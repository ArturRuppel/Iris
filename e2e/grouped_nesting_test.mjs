import { chromium } from "playwright";

/* Smoke test for grouped-sheet re-nesting (Slice 3): reordering the factors is a
   pure view respec — it swaps which column bands the header (outer ↔ inner) and
   never issues an engine op or changes a value. Loads group×day, flips "group"
   inward, and asserts the header restructures while the shape stays 2 × 4.

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
await page.setInputFiles("input[type=file]", {
  name: "nesting_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
});
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });

await page.waitForSelector(".table-pane .dv-toggle", { timeout: 30000 });
await page.locator(".dv-toggle button:has-text('Grouped sheet')").click();
await page.waitForSelector(".gs-grid", { timeout: 15000 });

// default nesting = schema order: outer band is "group" (Control / Treatment).
// read the label span (the header also carries a hover-only delete ✕ button).
const outerLabel = () => page.locator(".gs-grid .de-band .de-groupcell").first()
  .locator(".de-grouphead span").first().innerText();
if ((await outerLabel()).trim() !== "Control")
  fail("default outer band should be group=Control, got " + await outerLabel());
console.log("default nesting: outer band =", (await outerLabel()).trim());

// the re-nest control lists the factors outer → inner
await page.waitForSelector(".gs-controls .gs-factor", { timeout: 5000 });

// move "group" inward → nesting becomes [day, group]
await page.locator(".gs-factor", { hasText: "group" }).locator(".gs-fmove").nth(1).click();

// outer band is now "day" (D1 spanning its two groups)
await page.waitForFunction(() => {
  const cell = document.querySelector(".gs-grid .de-band .de-groupcell .de-grouphead span");
  return cell && cell.textContent.trim() === "D1";
}, null, { timeout: 5000 });
const span = await page.locator(".gs-grid .de-band .de-groupcell").first().getAttribute("colspan");
if (span !== "2") fail(`re-nested outer band "D1" should span 2, got colspan=${span}`);

// leaf headers are now the inner factor "group" (Control / Treatment)
const leaf = await page.locator(".gs-grid .de-heads").innerText();
if (!/Control/.test(leaf) || !/Treatment/.test(leaf))
  fail("after re-nest, leaf headers should be Control/Treatment: " + leaf);
console.log("re-nested: outer band = D1, leaf headers = group levels");

// pure view respec: shape unchanged, no engine error
const prov = await page.locator(".table-pane .provenance").innerText();
if (!/2 × 4/.test(prov)) fail("shape should stay 2 × 4 after re-nest, got: " + prov);
if (await page.locator(".error-bar").count() > 0)
  fail("re-nesting must not raise an engine error: " + await page.locator(".error-bar").innerText());
console.log("shape unchanged (", prov, ") — re-nest issued no engine op");

console.log("PASS: grouped-sheet re-nesting swaps the header without touching the data");
await browser.close();
