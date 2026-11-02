import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

/* The figure must stay on screen while its controls scroll, in the side panel and
   in the maximized tile, wide and narrow. Runs on the static web build, so it needs
   no engine server:

     npm run build:web && node e2e/plot_layout_test.mjs                          */

const URL_ = `file://${join(dirname(fileURLToPath(import.meta.url)), "..", "dist-web", "index.html")}`;
const SHOTS = process.env.SHOTS;
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(URL_);
await page.waitForSelector(".app", { timeout: 180000 });
await page.click(".tb-seg button:has-text('Workbench')");
await page.click("button:has-text('Open example')");
await page.waitForSelector("[data-testid='plot-card'] .figure-frame svg", { timeout: 60000 });

async function check(name, scroller, { beside }) {
  await page.evaluate((sel) => { for (const d of document.querySelectorAll(`${sel} [data-testid='plot-card'] details`)) d.open = true; }, scroller);
  await page.waitForTimeout(300);
  const info = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const before = el.scrollHeight - el.clientHeight;
    el.scrollTop = el.scrollHeight;
    const box = (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
    return { range: before, scrolled: el.scrollTop, view: box(el),
      figure: box(el.querySelector("[data-testid='plot-card'] .figure-frame svg")),
      controls: box(el.querySelector("[data-testid='plot-card'] .plot-controls")) };
  }, scroller);
  if (info.range < 50) fail(`${name}: nothing to scroll, so this check proves nothing (${info.range} px)`);
  const visibleTop = Math.max(info.figure.top, info.view.top);
  const visibleBottom = Math.min(info.figure.bottom, info.view.bottom);
  if (visibleBottom - visibleTop < 150) fail(`${name}: figure scrolled away (${JSON.stringify(info)})`);
  if (beside && info.figure.right > info.controls.left + 1) fail(`${name}: controls are not beside the figure (${JSON.stringify(info)})`);
  if (!beside && info.controls.left > info.figure.left) fail(`${name}: controls should sit below the figure`);
  console.log(`${name}: figure stays in view after scrolling ${Math.round(info.scrolled)} px`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

await check("panel", ".txw-stash .txw-slot-body", { beside: false });
await page.click(".txw-slot-max");
await page.waitForSelector(".txw-focus");
if (SHOTS) await page.screenshot({ path: join(SHOTS, "maximized-full.png") });
await page.setViewportSize({ width: 1500, height: 600 }); // short, so the controls must scroll
await check("maximized-wide", ".txw-focus-body", { beside: true });
await page.setViewportSize({ width: 820, height: 1180 });
await check("maximized-narrow", ".txw-focus-body", { beside: false });

console.log("PLOT LAYOUT E2E OK");
await browser.close();
