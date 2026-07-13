import { chromium } from "playwright";

/* Proof that the grouped-sheet grid virtualises columns (Slice 2): a pivot far
   wider than the viewport renders only the visible column window, so a far-right
   column is NOT in the DOM until you scroll to it (and a far-left one unmounts).
   This is the behavioural difference from the old full-<table> render — not that
   it looks the same, but that it no longer materialises every cell.

   30 categorical groups × 3 rows each -> a 30-column ragged stack, ~2500px wide
   (>40 distinct string values would import as an identifier, not a categorical,
   so we stay at 30 to keep `grp` a banding column). Needs the engine (port 8765)
   and the vite dev server (port 5173) running. */

const rows = ["grp,value"];
for (let g = 0; g < 30; g++) {
  const name = `g${String(g).padStart(2, "0")}`;   // g00 … g29
  for (let r = 0; r < 3; r++) rows.push(`${name},${g * 10 + r}`);
}
const csv = rows.join("\n");

const URL = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".app", { timeout: 30000 });

await page.click(".tb-btn:has-text('Import')");
await page.setInputFiles("input[type=file]", {
  name: "wide_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
});
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });

await page.waitForSelector(".table-pane .dv-toggle", { timeout: 30000 });
await page.locator(".dv-toggle button:has-text('Grouped sheet')").click();
await page.waitForSelector(".gs-canvas .gs-cell", { timeout: 15000 });

const leafCount = (name) =>
  page.locator(".gs-header .gs-leaf span", { hasText: new RegExp(`^${name}$`) }).count();

// initially: the leftmost group is rendered, the far-right one is not (windowed)
if (await leafCount("g00") === 0) fail("g00 should be rendered at the left edge");
if (await leafCount("g29") !== 0) fail("g29 must NOT be in the DOM before scrolling (not windowed)");
console.log("initial window: g00 present, g29 absent (columns are virtualised)");

// scroll the port hard right; the window shifts to the far columns
await page.locator(".gs-scroll").evaluate((el) => el.scrollTo({ left: 99999 }));
await page.waitForFunction(() => {
  const leaves = [...document.querySelectorAll(".gs-header .gs-leaf span")];
  return leaves.some((s) => s.textContent.trim() === "g29");
}, null, { timeout: 5000 });

if (await leafCount("g29") === 0) fail("g29 should be rendered after scrolling right");
if (await leafCount("g00") !== 0) fail("g00 should have unmounted after scrolling away from it");
console.log("after scroll: g29 present, g00 unmounted (window followed the scroll)");

if (await page.locator(".error-bar").count() > 0)
  fail("unexpected error-bar: " + await page.locator(".error-bar").innerText());

console.log("PASS: grouped-sheet grid virtualises columns on scroll");
await browser.close();
