import { chromium } from "playwright";

/* E2E for the in-app stats Methods doc (item R reachability):
   1. the Methods tab renders the bundled docs/stats-recommendations.md, including
      the rank-floor section and an external citation link (opens in a new tab);
   2. the "Why this test?" link in the stats pane navigates to that same doc.
   Needs the engine (8765) and the vite dev server (5173). */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(URL);

// (1) Methods tab renders the doc.
await page.getByRole("button", { name: "Methods" }).click();
await page.waitForSelector(".methods-doc", { timeout: 10_000 });

const h1 = await page.locator(".methods-doc h1").first().textContent();
if (!/recommends a statistical test/i.test(h1 ?? ""))
  fail(`Methods doc heading unexpected: ${h1}`);

// The rank-floor section (the item-R content) must be present.
const body = await page.locator(".methods-doc").textContent();
if (!/rank-floor guard/i.test(body ?? "")) fail("rank-floor section missing from doc");
if (!/GraphPad Prism/i.test(body ?? "")) fail("sources missing from doc");

// An external citation link must render and open in a new tab.
const cite = page.locator('.methods-doc a[href^="https://"]').first();
if (await cite.count() === 0) fail("no external citation links rendered");
const target = await cite.getAttribute("target");
if (target !== "_blank") fail(`citation link target is ${target}, expected _blank`);

// (2) The contextual "Why this test?" link from the stats pane.
// Open a shipped example so an analysis (and the StatsPanel) is present.
await page.getByRole("button", { name: "Examples" }).click();
await page.waitForSelector(".gallery-open-btn", { timeout: 10_000 });
await page.locator(".gallery-open-btn").first().click();
await page.waitForSelector(".analyses-mode .iris", { timeout: 15_000 });

const why = page.getByRole("button", { name: "Why this test?" });
await why.waitFor({ timeout: 10_000 });
await why.click();
await page.waitForSelector(".methods-doc", { timeout: 10_000 });

console.log("PASS: Methods doc reachable from the tab and the stats-pane link");
await browser.close();
