import { openApp, importCsv, openMode, addFirstPlot, backToCanvas, fail } from "./helpers.mjs";

/* E2E for the merged Figure terminal node (Plot + Stats folded into one node).
   Imports a 2-group numeric CSV, opens the Workbench, and verifies the single
   figure terminal in both of its forms:
     - before any plot it carries BOTH a Plot and a Stats section, and
       left-clicking a section opens that facet's card (plot card / stats card);
     - once a plot rendered it is a picture: the thumbnail opens the plot card,
       the one-line stats summary under it the stats card;
   and right-clicking the node offers "Edit plot…"/"Edit test…", "Edit test…"
   bringing up the stats card (which holds the test picker; there is no separate
   test-editor card) and "Edit plot…" the plot card. A card opens full-screen
   over the canvas, one at a time, so the test returns to the canvas
   (`backToCanvas`) before each click on the node. Needs the engine and the
   vite dev server. */

const { browser, page } = await openApp();

const rows = ["group,value"];
for (const [g,b] of [["ctrl",10],["drug",14]]) for (let i=0;i<6;i++) rows.push(`${g},${b+i}`);
await importCsv(page, "f.csv", rows.join("\n"));

// Workbench (the analysis graph): the figure terminal renders directly here.
await openMode(page, "Workbench");
const figure = page.locator(".react-flow__node-arrayShape .txw-node.figure").first();
await figure.waitFor({ state: "visible", timeout: 15000 });

const plotCard = page.locator("[data-testid='plot-card']");
const statsCard = page.locator("[data-testid='stats-card']");

// 1. one figure terminal carrying BOTH sections (no plot yet)
const labels = await figure.locator(".txw-figsec .txw-eyebrow-text").allInnerTexts();
if (!labels.includes("Plot") || !labels.includes("Stats"))
  fail(`figure node needs Plot + Stats sections, saw ${JSON.stringify(labels)}`);
console.log(`figure node sections: ${JSON.stringify(labels)}`);

// 2. left-click Plot section -> plot card shown
await figure.locator(".txw-figsec.k-geom").click();
await plotCard.waitFor({ state: "visible", timeout: 15000 });
console.log("left-click Plot -> plot card shown");

// 3. left-click Stats section -> stats card shown, the plot card gone
await backToCanvas(page);
await figure.locator(".txw-figsec.k-test").click();
await statsCard.waitFor({ state: "visible", timeout: 15000 });
await plotCard.waitFor({ state: "hidden", timeout: 5000 });
console.log("left-click Stats -> stats card shown");

// 4. build a plot: the node becomes the picture, thumbnail + stats line
await backToCanvas(page);
await addFirstPlot(page, { geom: "Box", x: "group", y: "value" });
await backToCanvas(page);
const picture = page.locator(".react-flow__node-arrayShape .txw-node.figure.picture").first();
await picture.waitFor({ state: "visible", timeout: 20000 });
const thumb = picture.locator(".txw-figthumb-btn");
const stat = picture.locator(".txw-figstat");
if (await thumb.count() !== 1 || await stat.count() !== 1)
  fail(`the picture node needs one plot thumbnail and one stats line, saw ${await thumb.count()} / ${await stat.count()}`);
await thumb.click();
await plotCard.waitFor({ state: "visible", timeout: 15000 });
await backToCanvas(page);
await stat.click();
await statsCard.waitFor({ state: "visible", timeout: 15000 });
await plotCard.waitFor({ state: "hidden", timeout: 5000 });
console.log(`picture node: thumbnail -> plot card, stats line ('${(await stat.innerText()).trim()}') -> stats card`);

// 5. right-click figure -> Edit plot / Edit test menu
const openMenu = async () => {
  await backToCanvas(page);
  await picture.click({ button: "right" });
  await page.waitForSelector(".txw-ctxmenu", { timeout: 15000 });
};
await openMenu();
const items = await page.locator(".txw-ctxmenu [role='menuitem']").allInnerTexts();
if (!items.some(t=>/edit plot/i.test(t)) || !items.some(t=>/edit test/i.test(t)))
  fail(`menu needs Edit plot/Edit test, saw ${JSON.stringify(items)}`);
console.log(`right-click menu: ${JSON.stringify(items)}`);

// 6. Edit test -> the stats card (the test editor) is shown
await page.locator(".txw-ctxmenu [role='menuitem']", { hasText: /edit test/i }).click();
await statsCard.waitFor({ state: "visible", timeout: 15000 });
await plotCard.waitFor({ state: "hidden", timeout: 5000 }).catch(() =>
  fail("Edit test… left the plot card showing"));
console.log("Edit test... showed the stats card");

// 7. Edit plot -> the plot card
await openMenu();
await page.locator(".txw-ctxmenu [role='menuitem']", { hasText: /edit plot/i }).click();
await plotCard.waitFor({ state: "visible", timeout: 15000 });
await statsCard.waitFor({ state: "hidden", timeout: 5000 }).catch(() =>
  fail("Edit plot… left the stats card showing"));
console.log("Edit plot... showed the plot card");

if (page.errors.length) fail("page errors: " + page.errors.slice(0,4).join(" | "));
console.log("FIGURE NODE SMOKE OK");
await browser.close();
