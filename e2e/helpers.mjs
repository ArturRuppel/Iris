/* Shared steps for the end-to-end tests: the path every test walks before it
   reaches what it is about (open the app, import a table, build a first plot,
   show a card). Each test used to carry its own copy, and every UI change broke
   all of them in the same place; change the step here instead.

   The workbench shows ONE card at a time in the display panel on the right:
   click the Plot or the Stats section of the figure node, a table node, or a
   step's edge, and its card replaces the one before. */
import { chromium } from "playwright";

export const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
export const ENGINE_URL = process.env.ENGINE_URL ?? "http://127.0.0.1:8765";

export const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };

/* A browser page on the running app. Page errors are collected in
   `page.errors`; a recovery bar left by an earlier session is dismissed, so the
   test starts from an empty document. */
export async function openApp({ viewport = { width: 1500, height: 1000 }, context = {}, query = "" } = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport, ...context });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(APP_URL + query, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".app", { timeout: 30000 });
  if (await page.locator(".engine-down").count() > 0) fail("engine not reachable");
  const discard = page.locator(".recovery-bar button:has-text('Discard')");
  if (await discard.count()) await discard.click();
  return { browser, ctx, page };
}

/* Import a CSV through the wizard with its inferred types, as a user would. */
export async function importCsv(page, name, csv) {
  await page.click(".topbar button:has-text('Import')");
  await page.setInputFiles("input[type=file]", { name, mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
  await page.click(".modal-foot button.primary");
  await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });
}

export async function openMode(page, mode /* "Data" | "Workbench" | "Figure" */) {
  await page.click(`.tb-seg button:has-text('${mode}')`);
}

/* Show a card in the display panel and return its locator. */
export async function showPlot(page) {
  await page.locator(".txw-figsec.k-geom").first().click();
  const card = page.locator("[data-testid='plot-card']");
  await card.waitFor({ state: "visible", timeout: 15000 });
  return card;
}
export async function showStats(page) {
  await page.locator(".txw-figsec.k-test").first().click();
  const card = page.locator("[data-testid='stats-card']");
  await card.waitFor({ state: "visible", timeout: 15000 });
  return card;
}
export async function showTable(page, index = 0) {
  await page.locator(".react-flow__node:not(:has(.txw-figsec))").nth(index).click();
  const card = page.locator("[data-testid='table-card']");
  await card.waitFor({ state: "visible", timeout: 15000 });
  return card;
}

/* From a freshly imported table: go to the Workbench and build the first plot
   through the wizard (plot type, then X and Y). Returns the plot card, which
   then holds the figure and the inspector. `geom` is the label on the wizard's
   tile ("Box", "Dots", "Violin", …). */
export async function addFirstPlot(page, { geom, x, y }) {
  await openMode(page, "Workbench");
  const card = page.locator("[data-testid='plot-card']");
  await card.waitFor({ state: "visible", timeout: 15000 });
  await page.click(".txw-add-plot");
  await page.waitForSelector("[data-testid='plot-wizard']", { timeout: 10000 });
  await page.locator(".wiz-geom", { hasText: geom }).first().click();
  await page.waitForSelector(".wiz-step.wiz-map", { timeout: 10000 });
  if (x) await page.locator(".wiz-map .enc-row", { hasText: "X" }).locator("select").selectOption(x);
  if (y) await page.locator(".wiz-map .enc-row", { hasText: "Y" }).locator("select").selectOption(y);
  await page.waitForSelector(".wiz-done:not([disabled])", { timeout: 5000 });
  await page.click(".wiz-done");
  await page.waitForSelector("[data-testid='plot-wizard']", { state: "detached", timeout: 10000 });
  await waitForFigure(page);
  return card;
}

/* The rendered figure in the plot card (an inline <svg>). */
export async function waitForFigure(page, timeout = 20000) {
  await page.waitForSelector("[data-testid='plot-card'] .figure-pane svg", { timeout });
}

/* Open one of the plot inspector's tabs: Encoding, Layers, Axes, Text, Layout. */
export async function inspectorTab(page, name) {
  await page.locator(".plot-inspector button", { hasText: new RegExp(`^${name}$`) }).click();
}
