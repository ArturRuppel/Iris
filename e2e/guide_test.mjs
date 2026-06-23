import { chromium } from "playwright";

/* E2E for the in-app Guide (merged Examples + stats Methods, item R reachability):
   1. the Guide tab renders the bundled src/examples/guide.md, including the
      rank-floor section and an external citation link (opens in a new tab);
   2. the "Why this test?" link in the stats pane deep-links into the Guide's
      "How Iris chooses the test" section.
   Needs the engine (8765) and the vite dev server (5173). */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(URL);

// (1) Guide tab renders the doc.
await page.getByRole("button", { name: "Guide" }).click();
await page.waitForSelector(".guide-doc", { timeout: 10_000 });

const h1 = await page.locator(".guide-doc h1").first().textContent();
if (!/a guided tour/i.test(h1 ?? ""))
  fail(`Guide doc heading unexpected: ${h1}`);

// The rank-floor section (the item-R content) must be present, with its sources.
const body = await page.locator(".guide-doc").textContent();
if (!/rank-floor guard/i.test(body ?? "")) fail("rank-floor section missing from doc");
if (!/GraphPad Prism/i.test(body ?? "")) fail("sources missing from doc");

// rehype-slug must give the rules section an id the deep-link can target.
if (await page.locator("#how-iris-chooses-the-test").count() === 0)
  fail("rules section has no slug id (rehype-slug not applied)");

// An external citation link must render and open in a new tab.
const cite = page.locator('.guide-doc a[href^="https://"]').first();
if (await cite.count() === 0) fail("no external citation links rendered");
const target = await cite.getAttribute("target");
if (target !== "_blank") fail(`citation link target is ${target}, expected _blank`);

// An inline example plot must render (the merged gallery half).
if (await page.locator(".gallery-figure svg").count() === 0)
  fail("no example figures rendered in the Guide");

// (2) The contextual "Why this test?" link from the stats pane.
// Open a shipped example so an analysis (and the StatsPanel) is present.
await page.locator(".gallery-open-btn").first().click();
await page.waitForSelector(".analyses-mode .iris", { timeout: 15_000 });

const why = page.getByRole("button", { name: "Why this test?" });
await why.waitFor({ timeout: 10_000 });
await why.click();
await page.waitForSelector(".guide-doc", { timeout: 10_000 });
await page.waitForSelector("#how-iris-chooses-the-test", { timeout: 10_000 });

console.log("PASS: Guide reachable from the tab and the stats-pane deep-link");
await browser.close();
