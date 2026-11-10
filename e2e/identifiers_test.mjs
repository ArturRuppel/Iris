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
     3. Demoting `frame` leaves `well` unable to key the table (rows collide).
        That is allowed now (a coarse spine over replicates is the SuperPlot
        idiom), but never silent: the demotion applies and the panel shows an
        inline note that the identifiers don't uniquely key the table — the
        replication below the finest level — and it is a warning, not an error.
        This is the honesty guarantee: the user is told when identifiers stop
        jointly identifying each row.

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

await page.click(".topbar button:has-text('Import')");
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
if ((await page.locator(".hp-role-warning").count()) > 0)
  fail("promotion keeps the table keyed, so it should not note replication");
console.log("ok: a numeric measure promoted to identifier (spine 2 -> 3, no error)");
await valueRow.locator("button", { hasText: /^measure$/ }).click();
await page.waitForTimeout(400);

// 3) a demotion that breaks the key applies, with a visible replication note.
await rowFor("frame").locator("button", { hasText: /^measure$/ }).click();
await page.waitForSelector(".hp-role-warning", { timeout: 8000 });
const msg = (await page.locator(".hp-role-warning").innerText()).trim();
if (!/uniquely key/i.test(msg)) fail(`unexpected warning text: ${msg}`);
if (!/well/i.test(msg)) fail(`the note should name the identifier left on the spine (well): ${msg}`);
if ((await page.locator(".hp-role-error").count()) > 0)
  fail("a non-keying spine is allowed: it must be a warning, not an error: "
    + await page.locator(".hp-role-error").innerText());
spine = await page.locator(".hierarchy-panel .hp-node").count();
if (spine !== 1) fail(`the demotion should apply, leaving the spine at 1 (well), saw ${spine}`);
if (await rowFor("frame").locator("button[aria-pressed='true']").innerText() !== "measure")
  fail("frame's toggle should now read measure");
console.log("ok: key-breaking demotion applies with an inline replication warning:", msg.slice(0, 60) + "…");

if (errs.length) fail("page errors: " + errs.join("; "));
console.log("identifiers e2e ok");
await browser.close();
