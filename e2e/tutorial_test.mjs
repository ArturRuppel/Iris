import { chromium } from "playwright";

/* E2E for the interactive tutorial (replaces the quickstart page). Proves the
   state-driven engine end to end: launch from the Guide, then walk all five steps
   performing the REAL actions, asserting that Next gates on live app state — it
   stays disabled until the user actually opens the Workbench and actually builds
   the mapped plot, and the final figure carries a real test. Needs the engine
   (8765) and the vite dev server (5173). */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };

const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".app", { timeout: 30_000 });
if (await page.locator(".engine-down").count() > 0)
  fail("engine not reachable — start the engine on 8765");

const next = page.locator(".tutorial-next");
const card = page.locator(".tutorial-card");
const waitStep = (n) => page.waitForFunction(
  (label) => new RegExp(`Step ${label} of 5`).test(
    document.querySelector(".tutorial-card")?.textContent ?? ""),
  String(n), { timeout: 15_000 });

// --- Launch from the Guide's Quickstart page ---------------------------------
await page.getByRole("button", { name: "Guide" }).click();
await page.waitForSelector(".guide-nav", { timeout: 10_000 });
await page.locator(".guide-nav").getByRole("button", { name: "Quickstart", exact: true }).click();
await page.getByRole("button", { name: /start the tutorial/i }).click();

// --- Step 1: the table (observational, opens in Data) ------------------------
await card.waitFor({ timeout: 15_000 });
if (!/Step 1 of 5/.test(await card.textContent() ?? "")) fail("did not open on step 1 of 5");
if (await page.locator(".data-mode").count() === 0) fail("step 1 should land in the Data view");
if (await next.isDisabled()) fail("step 1 is observational — Next should be enabled");
await next.click();

// --- Step 2: open the Workbench (auto-advances on viewMode) ------------------
if (!await next.isDisabled()) fail("step 2 Next must be disabled until the Workbench opens");
await page.locator("[data-tour='mode-workbench']").click();
await waitStep(3);          // opening the Workbench IS the step — it auto-advances, no click

// --- Step 3: make a plot (gated on layer + categorical→X + numeric→Y) --------
if (!await next.isDisabled()) fail("step 3 Next must be disabled until a mapped plot exists");
await page.locator("[data-tour='add-plot']").click();
await page.waitForSelector(".plot-wizard", { timeout: 10_000 });
await page.locator(".wiz-geom").first().click();               // pick a geom → step "map"
await page.locator(".enc-row", { hasText: "X" }).locator("select").selectOption("species");
await page.locator(".enc-row", { hasText: "Y" }).locator("select").selectOption("petal_length");
await page.locator(".wiz-done").click();
await waitStep(4);          // closing the wizard with a built plot auto-advances, no click

// --- Step 4: Iris suggests a test (observational) ----------------------------
await page.waitForSelector("[data-tour='stats']", { timeout: 10_000 });
const statsText = await page.locator("[data-tour='stats']").textContent() ?? "";
if (/add a plot to see a test/i.test(statsText))
  fail("stats card still shows the empty stub after a plot was built");
if (await next.isDisabled()) fail("step 4 is observational — Next should be enabled");
await next.click();

// --- Step 5: finish ----------------------------------------------------------
const finish = page.getByRole("button", { name: "Finish" });
if (await finish.count() === 0) fail("step 5 should offer a Finish action");
await finish.click();
await card.waitFor({ state: "detached", timeout: 10_000 });    // overlay torn down

// The analysis the user built stays behind, in the Workbench.
if (await page.locator(".workbench-mode").count() === 0)
  fail("finishing should leave the built analysis in the Workbench");

if (pageErrors.length) fail(`page errors during the walk: ${pageErrors.join(" | ")}`);

console.log("PASS: interactive tutorial walks table → workbench → plot → test → finish");
await browser.close();
