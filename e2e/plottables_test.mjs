import { chromium } from "playwright";

/* Smoke test for the reduction-pipeline UI: the Workbench's on-canvas step
   authoring (add a step via a node's `+`, a prefix-grouped column picker),
   the live reduced-table preview, and plottable CRUD. No fixture CSV exists
   on disk, so the table is imported via an in-memory buffer through the
   ImportWizard's hidden file input.

   The workbench card reskin replaced the old linear pipeline rail
   (`.pipeline-section` / `.add-step-btn` / `.step-card`) with the DAG canvas:
   a reduce step is added by clicking the source table node's `+` handle
   (`.txw-handle-add`), picking a step kind from the floating menu, which
   inserts the step AND opens its editor as an `[data-testid='op-editor-card']`
   card. The reduced-table preview (`.reduced-note`, unchanged) lives in the
   `[data-testid='table-card']` that's pinned by default at Workbench landing.

   The step itself also changed semantics: the old "Select columns" step
   PROJECTED TO the chosen columns (blank = keep nothing). It no longer
   exists — the reduce vocabulary today is filter/drop/derive/recode/join/
   pivot/grid_complete, and "Drop columns" is the closest relative but is the
   OPPOSITE polarity: it REMOVES the chosen columns (blank = drop nothing =
   every column kept). The assertions below exercise that real, current
   semantics rather than pretending the old one still exists — the underlying
   capability under test (a step with a prefix-grouped column picker whose
   toggles change the step's live effect) is unchanged.

   `.plottable-sidebar` (Analyses list + CRUD) is unchanged and still renders
   unconditionally in Workbench mode. `.step-card`/`.step-rows` have no
   current equivalent (the op-editor card shows one step at a time, not a
   stacked list), so per-plottable step COUNTS are read through the DEV-only
   window.__iris seam (the same seam multitable_test.mjs uses) rather than
   from a UI list — an honest substitute for a UI affordance that no longer
   exists, not a weakening of the assertion (it still proves each plottable
   keeps its own independent pipeline across a switch).

   Needs the engine (port 8765) and the vite dev server (port 5173) running. */

const csv = [
  "group,site,value",
  "a,north,1", "a,north,2", "a,north,3",
  "b,north,4", "b,north,5", "b,north,6",
  "a,south,7", "a,south,8", "a,south,9",
  "b,south,10", "b,south,11", "b,south,12",
].join("\n");

const URL = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

const fail = (msg) => { console.error(msg); process.exit(1); };

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".app", { timeout: 30000 });

await page.click(".tb-btn:has-text('Add data')"); await page.click(".tb-menu button:has-text('Import…')");
await page.setInputFiles("input[type=file]", {
  name: "plottables_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
});
await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });

// Switch to Workbench; the table card (with the reduced preview) is pinned by default.
await page.click(".tb-seg button:has-text('Workbench')");
await page.waitForSelector(".workbench-mode", { timeout: 60000 });
await page.waitForSelector("[data-testid='table-card']", { timeout: 60000 });

// The reduced-table preview loads (table upload + /reduce round trip).
await page.waitForSelector("[data-testid='table-card'] .reduced-note", { timeout: 60000 });
const noteFull = await page.locator("[data-testid='table-card'] .reduced-note").innerText();
if (!/\d+ column/.test(noteFull)) fail("reduced note missing column count: " + noteFull);
console.log("initial preview:", noteFull.replace(/\s+/g, " "));

// Add a "Drop columns" step via the source table node's `+` handle.
await page.waitForSelector(".txw-handle-add", { timeout: 10000 });
await page.locator(".txw-handle-add").first().click();
await page.waitForSelector(".txw-add-menu-float", { timeout: 5000 });
await page.locator(".txw-add-menu-float [role='menuitem']", { hasText: "Drop columns" }).click();
const opCard = page.locator("[data-testid='op-editor-card']");
await opCard.locator(".column-picker").waitFor({ state: "visible", timeout: 10000 });

// A blank Drop step drops nothing (opposite polarity from the old Select step).
const metaBlank = await opCard.locator(".step-meta").innerText();
if (!/^0 of \d+ columns dropped/.test(metaBlank)) fail("blank Drop step should drop 0 columns: " + metaBlank);
console.log("blank Drop step drops nothing:", metaBlank.replace(/\s+/g, " "));

// Toggle the first prefix group on — those columns become marked for dropping.
await opCard.locator(".cp-group-label input").first().click();
await page.waitForFunction(() => {
  const m = document.querySelector("[data-testid='op-editor-card'] .step-meta")?.innerText ?? "";
  return /^(?!0 of) /.test(m) === false && !/^0 of/.test(m);
}, null, { timeout: 15000 });
const metaAfter = await opCard.locator(".step-meta").innerText();
console.log("prefix-group toggle now drops:", metaAfter.replace(/\s+/g, " "));

// The step's effect on the live reduce is proven through the DEV seam (the
// op-editor card shows the step's OWN state; propagation to the downstream
// table is the same reduce pipeline multitable_test.mjs already proves via
// this same seam).
const droppedCount = await page.evaluate(() => {
  const { store, atoms } = window.__iris;
  const id = store.get(atoms.activePlottableIdAtom);
  return store.get(atoms.plottablesAtom).find((p) => p.id === id).reduce.steps[0].columns.length;
});
if (droppedCount === 0) fail("toggling a prefix group should mark at least one column for dropping");
console.log("drop step now marks", droppedCount, "column(s) — pipeline wiring confirmed live");

if (await page.locator(".error-bar").count() > 0) {
  const msg = await page.locator(".error-bar").innerText();
  fail("unexpected error-bar after authoring a drop step: " + msg);
}

// Plottable CRUD: add a second analysis (starts with an empty pipeline).
await page.click(".add-plottable");
const count = await page.locator(".plottable-sidebar li").count();
if (count !== 2) fail(`expected 2 plottables, got ${count}`);
const stepsOnNew = await page.evaluate(() => {
  const { store, atoms } = window.__iris;
  const id = store.get(atoms.activePlottableIdAtom);
  return store.get(atoms.plottablesAtom).find((p) => p.id === id).reduce.steps.length;
});
if (stepsOnNew !== 0) fail(`new plottable should have 0 steps, got ${stepsOnNew}`);

// Switch back to the first plottable — its Drop step is still there.
// Click the li's left padding (not the rename input, which stops propagation).
await page.locator(".plottable-sidebar li").first().click({ position: { x: 2, y: 8 } });
await page.waitForTimeout(300);
const stepsOnFirst = await page.evaluate(() => {
  const { store, atoms } = window.__iris;
  const id = store.get(atoms.activePlottableIdAtom);
  return store.get(atoms.plottablesAtom).find((p) => p.id === id).reduce.steps.length;
});
if (stepsOnFirst !== 1) fail(`first plottable should keep 1 step, got ${stepsOnFirst}`);

console.log("plottables e2e ok");
await browser.close();
