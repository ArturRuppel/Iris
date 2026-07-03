import { chromium } from "playwright";

/* E2E for the in-app Guide (nested tree under docs/guide/):
   1. the Guide tab opens on the Home landing, exposes the page nav, and the
      Troubleshooting page carries the rank-floor section while the References
      page carries its sources and an external citation link (new tab);
   2. the "Why this test?" link in the stats pane deep-links into the Guide's
      "Choosing a test" page, scrolling to its "Two questions" section.
   Needs the engine (8765) and the vite dev server (5173). */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(URL);

// Page switches go through the sidebar nav; scope to it so an in-prose link of
// the same name (e.g. "references") can't shadow the nav button.
const nav = page.locator(".guide-nav");
const goToPage = (name) => nav.getByRole("button", { name, exact: true }).click();

// (1) Guide tab opens on the Home landing, with the page nav present.
await page.getByRole("button", { name: "Guide" }).click();
await page.waitForSelector(".guide-doc", { timeout: 10_000 });
await page.waitForSelector(".guide-nav", { timeout: 10_000 });

const home = (await page.locator(".guide-doc h1").first().textContent() ?? "").trim();
if (home !== "Iris") fail(`Home landing heading unexpected: ${home}`);

// The Troubleshooting page carries the rank-floor guard (the item-R content).
await goToPage("Troubleshooting");
const trouble = await page.locator(".guide-doc").textContent();
if (!/rank-floor guard/i.test(trouble ?? "")) fail("rank-floor section missing from Troubleshooting");

// rehype-slug must give that section an id (the choosing page links to it).
if (await page.locator("#a-rank-test-that-cannot-reach-significance").count() === 0)
  fail("rank-floor section has no slug id (rehype-slug not applied)");

// The References page carries the sources, with an external link in a new tab.
await goToPage("References");
const refs = await page.locator(".guide-doc").textContent();
if (!/GraphPad Prism/i.test(refs ?? "")) fail("sources missing from References");
const cite = page.locator('.guide-doc a[href^="https://"]').first();
if (await cite.count() === 0) fail("no external citation links rendered");
const target = await cite.getAttribute("target");
if (target !== "_blank") fail(`citation link target is ${target}, expected _blank`);

// An inline example plot must render on a gallery page (the merged gallery half).
await goToPage("Reading the result");
if (await page.locator(".gallery-figure svg").count() === 0)
  fail("no example figures rendered in the Guide");

// (2) The contextual "Why this test?" link from the stats pane. Open a shipped
// example so an analysis (and the StatsPanel) is present.
await page.locator(".gallery-open-btn").first().click();
await page.waitForSelector(".workbench-mode", { timeout: 15_000 });

const why = page.getByRole("button", { name: "Why this test?" });
await why.waitFor({ timeout: 10_000 });
await why.click();
await page.waitForSelector(".guide-doc", { timeout: 10_000 });
// The deep-link lands on the Choosing a test page and its "Two questions" id.
await page.waitForSelector("#two-questions", { timeout: 10_000 });

console.log("PASS: Guide reachable from the tab and the stats-pane deep-link");
await browser.close();
