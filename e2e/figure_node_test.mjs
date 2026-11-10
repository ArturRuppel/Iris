import { openApp, importCsv, openMode, fail } from "./helpers.mjs";

/* E2E for the merged Figure terminal node (Plot + Stats folded into one node).
   Imports a 2-group numeric CSV, opens the Workbench, and verifies the single
   figure terminal: it carries BOTH a Plot and a Stats section; left-clicking a
   section shows that facet's card (plot card / stats card) in the display
   panel; right-clicking offers "Edit plot…"/"Edit test…"; and "Edit test…"
   brings up the stats card, which holds the test picker (there is no separate
   test-editor card any more), and "Edit plot…" the plot card. Needs the engine
   and the vite dev server. */

const { browser, page } = await openApp();

const rows = ["group,value"];
for (const [g,b] of [["ctrl",10],["drug",14]]) for (let i=0;i<6;i++) rows.push(`${g},${b+i}`);
await importCsv(page, "f.csv", rows.join("\n"));

// Workbench (the analysis graph): the figure terminal renders directly here.
await openMode(page, "Workbench");
const figure = page.locator(".txw-node.figure").first();
await figure.waitFor({ state: "visible", timeout: 15000 });

const plotCard = page.locator("[data-testid='plot-card']");
const statsCard = page.locator("[data-testid='stats-card']");

// 1. one figure terminal carrying BOTH sections
const labels = await figure.locator(".txw-figsec .txw-eyebrow-text").allInnerTexts();
if (!labels.includes("Plot") || !labels.includes("Stats"))
  fail(`figure node needs Plot + Stats sections, saw ${JSON.stringify(labels)}`);
console.log(`figure node sections: ${JSON.stringify(labels)}`);

// 2. left-click Plot section -> plot card shown
await figure.locator(".txw-figsec.k-geom").click();
await plotCard.waitFor({ state: "visible", timeout: 15000 });
console.log("left-click Plot -> plot card shown");

// 3. left-click Stats section -> stats card replaces it
await figure.locator(".txw-figsec.k-test").click();
await statsCard.waitFor({ state: "visible", timeout: 15000 });
await plotCard.waitFor({ state: "hidden", timeout: 5000 });
console.log("left-click Stats -> stats card shown");

// back to the plot card, so "Edit test…" has to switch the panel
await figure.locator(".txw-figsec.k-geom").click();
await plotCard.waitFor({ state: "visible", timeout: 15000 });

// 4. right-click figure -> Edit plot / Edit test menu
const openMenu = async () => {
  await figure.click({ button: "right" });
  await page.waitForSelector(".txw-ctxmenu", { timeout: 15000 });
};
await openMenu();
const items = await page.locator(".txw-ctxmenu [role='menuitem']").allInnerTexts();
if (!items.some(t=>/edit plot/i.test(t)) || !items.some(t=>/edit test/i.test(t)))
  fail(`menu needs Edit plot/Edit test, saw ${JSON.stringify(items)}`);
console.log(`right-click menu: ${JSON.stringify(items)}`);

// 5. Edit test -> the stats card (the test editor) is shown
await page.locator(".txw-ctxmenu [role='menuitem']", { hasText: /edit test/i }).click();
await statsCard.waitFor({ state: "visible", timeout: 15000 });
await plotCard.waitFor({ state: "hidden", timeout: 5000 }).catch(() =>
  fail("Edit test… left the plot card showing"));
console.log("Edit test... showed the stats card");

// 6. Edit plot -> back to the plot card
await openMenu();
await page.locator(".txw-ctxmenu [role='menuitem']", { hasText: /edit plot/i }).click();
await plotCard.waitFor({ state: "visible", timeout: 15000 });
console.log("Edit plot... showed the plot card");

if (page.errors.length) fail("page errors: " + page.errors.slice(0,4).join(" | "));
console.log("FIGURE NODE SMOKE OK");
await browser.close();
