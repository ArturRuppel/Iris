import { chromium } from "playwright";

/* E2E for the merged Figure terminal node (Plot + Stats folded into one node).
   Imports a 2-group numeric CSV, opens the Workbench, and verifies the single
   figure terminal: it carries BOTH a Plot and a Stats section; left-clicking a
   section docks that facet's card (FigurePane / StatsResults) in the stash;
   right-clicking offers "Edit plot…"/"Edit test…"; and "Edit test…" opens the
   test editor card. Needs the engine (8765) and the vite dev server (5173);
   Chromium runs on a machine that has one. */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
const fail = (m) => { console.error("FAIL:", m); process.exit(1); };

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".app", { timeout: 30000 });
if (await page.locator(".engine-down").count() > 0) fail("engine down");

const rows = ["group,value"];
for (const [g,b] of [["ctrl",10],["drug",14]]) for (let i=0;i<6;i++) rows.push(`${g},${b+i}`);
await page.click("button:has-text('Import data…')");
await page.setInputFiles("input[type=file]", { name:"f.csv", mimeType:"text/csv", buffer:Buffer.from(rows.join("\n")) });
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state:"detached", timeout: 15000 }).catch(()=>{});

// Workbench (the analysis graph) — the "Analyses" mode was removed; the figure
// terminal renders directly here.
await page.click(".mode-toggle button:has-text('Workbench')");
const figure = page.locator(".txw-node.figure").first();
await figure.waitFor({ state: "visible", timeout: 15000 });

// 1. one figure terminal carrying BOTH sections
const labels = await figure.locator(".txw-figsec .txw-eyebrow-text").allInnerTexts();
if (!labels.includes("Plot") || !labels.includes("Stats"))
  fail(`figure node needs Plot + Stats sections, saw ${JSON.stringify(labels)}`);
console.log(`figure node sections: ${JSON.stringify(labels)}`);

// 2. left-click Plot section -> plot card docks in stash
await figure.locator(".txw-figsec", { hasText: "Plot" }).click();
await page.waitForSelector("[data-testid='plot-card']", { timeout: 15000 });
console.log("left-click Plot -> plot card pinned");

// 3. left-click Stats section -> stats card docks in stash
await figure.locator(".txw-figsec", { hasText: "Stats" }).click();
await page.waitForSelector("[data-testid='stats-card']", { timeout: 15000 });
console.log("left-click Stats -> stats card pinned");

// 4. right-click figure -> Edit plot / Edit test menu
await figure.click({ button: "right" });
await page.waitForSelector(".txw-ctxmenu", { timeout: 15000 });
const items = await page.locator(".txw-ctxmenu [role='menuitem']").allInnerTexts();
if (!items.some(t=>/edit plot/i.test(t)) || !items.some(t=>/edit test/i.test(t)))
  fail(`menu needs Edit plot/Edit test, saw ${JSON.stringify(items)}`);
console.log(`right-click menu: ${JSON.stringify(items)}`);

// 5. Edit test -> test editor card opens
await page.locator(".txw-ctxmenu [role='menuitem']", { hasText: /edit test/i }).click();
await page.waitForSelector("[data-testid='test-card']", { timeout: 15000 });
console.log("Edit test... opened the test editor");

if (pageErrors.length) fail("page errors: " + pageErrors.slice(0,4).join(" | "));
console.log("FIGURE NODE SMOKE OK");
await browser.close();
