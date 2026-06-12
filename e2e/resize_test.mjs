import { chromium } from "playwright";

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1600, height: 1100 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto("http://localhost:5173");
await page.waitForSelector(".figure-host svg", { timeout: 20000 });
await page.waitForTimeout(400);

const dims0 = await page.locator(".figure-pane .provenance").textContent();
console.log("dims before:", dims0);

const h = page.locator(".resize-handle");
const hb = await h.boundingBox();
console.log("handle present:", !!hb);
await page.mouse.move(hb.x + 7, hb.y + 7);
await page.mouse.down();
await page.mouse.move(hb.x + 7 + 80, hb.y + 7 - 60, { steps: 6 });
console.log("badge during drag:", await page.locator(".figure-pane .provenance").textContent());
await page.mouse.up();
await page.waitForTimeout(1500); // debounce + engine round trip
console.log("dims after:", await page.locator(".figure-pane .provenance").textContent());

// open style drawer, flip a few new controls, confirm re-render doesn't error
await page.locator(".style-pane summary").click();
await page.locator(".style-pane").screenshot({ path: "/tmp/style_drawer.png" });
await page.getByLabel("notches (median CI)").check().catch(() => {});
const tickSel = page.locator("select").filter({ has: page.locator('option[value="inout"]') }).first();
await tickSel.selectOption("in");
await page.waitForTimeout(1200);
const svgOk = await page.evaluate(() => !!document.querySelector(".figure-host svg"));
const errBar = await page.locator(".error-bar").count();
console.log("svg still renders:", svgOk, "| error bars:", errBar);
await page.screenshot({ path: "/tmp/app_full.png", fullPage: true });
await b.close();
