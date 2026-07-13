import { chromium } from "playwright";

/* E2E for the identifier role (orthogonal to the value type). Import a table
   where `well` (string) and `frame` (integer) TOGETHER key each row but neither
   does alone, plus a numeric `value` measure. Then, in the Data tab's hierarchy
   panel:

     1. Both well and frame auto-seed the spine — and `frame` is a NUMERIC
        identifier (an integer key that still carries a value type), the case the
        old type-union model couldn't express.
     2. A numeric measure (`value`) is promotable to an identifier (the old UI
        only offered the toggle for non-numeric columns); promotion only adds
        distinctions, so it never trips the uniqueness guard.
     3. Demoting `frame` would leave `well` unable to key the table (rows
        collide) — the engine rejects the schema change with a visible inline
        error and the toggle reverts, so the spine is left intact. This is the
        honesty guarantee: identifiers must jointly identify each row.

   Needs the engine (8765) and the vite dev server (5173); Chromium runs on a
   machine that has one. */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const fail = (m) => { console.error("FAIL:", m); process.exit(1); };

const rows = [];
for (const w of ["A", "B", "C"])
  for (const f of [1, 2, 3])
    rows.push(`${w},${f},${(f + w.charCodeAt(0) / 100).toFixed(3)}`);
const csv = "well,frame,value\n" + rows.join("\n");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: "networkidle" });

await page.click(".tb-btn:has-text('Import')");
await page.setInputFiles("input[type=file]",
  { name: "wf.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });

await page.click(".tb-seg button:has-text('Data')");
await page.waitForSelector(".hierarchy-panel", { timeout: 15000 });

// 1) well + frame seed a 2-level spine; frame is a numeric identifier (its
//    non-identifier role reads "measure", i.e. the value type is numeric).
let spine = await page.locator(".hierarchy-panel .hp-node").count();
if (spine !== 2) fail(`expected 2 spine levels (well, frame), saw ${spine}`);
const rowFor = (name) => page.locator(".hp-role-row",
  { has: page.locator(".hp-col", { hasText: new RegExp(`^${name}$`, "i") }) });
const frameNatural = await rowFor("frame").locator(".seg button").nth(1).innerText();
if (!/measure/i.test(frameNatural))
  fail(`frame should be a numeric identifier (natural role "measure"), saw "${frameNatural}"`);
console.log("ok: well + frame seed a 2-level spine, frame is a NUMERIC identifier");

// 2) a numeric measure is promotable to an identifier.
const valueRow = rowFor("value");
if (await valueRow.count() === 0) fail("no role row for the numeric measure `value`");
await valueRow.locator("button", { hasText: /^identifier$/ }).click();
await page.waitForTimeout(400);
spine = await page.locator(".hierarchy-panel .hp-node").count();
if (spine !== 3) fail(`promoting value should grow the spine to 3, saw ${spine}`);
if ((await page.locator(".hp-role-error").count()) > 0)
  fail("promotion should not raise a uniqueness error");
console.log("ok: a numeric measure promoted to identifier (spine 2 -> 3, no error)");
await valueRow.locator("button", { hasText: /^measure$/ }).click();
await page.waitForTimeout(400);

// 3) a demotion that breaks the key is rejected with a visible error; reverts.
await rowFor("frame").locator("button", { hasText: /^measure$/ }).click();
await page.waitForSelector(".hp-role-error", { timeout: 8000 });
const msg = (await page.locator(".hp-role-error").innerText()).trim();
if (!/uniquely identify/i.test(msg)) fail(`unexpected error text: ${msg}`);
spine = await page.locator(".hierarchy-panel .hp-node").count();
if (spine !== 2) fail(`the rejected demotion should leave the spine at 2, saw ${spine}`);
console.log("ok: breaking demotion rejected with a visible error; toggle reverted");

if (errs.length) fail("page errors: " + errs.join("; "));
console.log("identifiers e2e ok");
await browser.close();
