import { chromium } from "playwright";

/* E2E for the multi-table feature (Plan A, Task 13). Proves the whole seam:
   import TWO tables (the second ACCUMULATES into the pool, not replace), switch
   the active one via the new TableList, author a join on the active analysis
   referencing the second table (through a DEV-only store seam — Plan A has no
   drag-to-join UI yet), confirm it renders without an error bar (the join
   materialized + computed), save to .iris, then reload in a FRESH page and
   confirm the join survives — the inline-right was migrated back into a 2-entry
   pool. Needs the engine (8765) and the vite dev server (5173).

   The File System Access pickers are stubbed in-memory (copied from
   save_load_test.mjs) so Playwright can drive Save/Load without a native dialog. */

const cellsCsv = ["key,group,value",
  "x,a,1", "x,a,2", "y,b,3", "y,b,4", "z,a,5", "z,b,6"].join("\n");
const annotCsv = ["key,label",
  "x,P", "y,Q", "z,R"].join("\n");

const URL = process.env.APP_URL ?? "http://localhost:5173";
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };

/* In-memory File System Access stub (copied verbatim from save_load_test.mjs).
   Every close() records bytes on window.__lastSaved and bumps window.__writeCount;
   getFile() reads them back. Bytes can be seeded so a fresh page loads a doc
   saved earlier. */
function installPickerStub(seedBase64) {
  window.__writeCount = 0;
  window.__lastSaved = null;
  if (seedBase64) {
    const bin = atob(seedBase64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    window.__lastSaved = u;
  }
  const makeHandle = (name) => ({
    name,
    kind: "file",
    async createWritable() {
      const chunks = [];
      return {
        async write(data) { chunks.push(data); },
        async close() {
          const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
          window.__lastSaved = buf;
          window.__writeCount++;
        },
      };
    },
    async getFile() {
      return new File([window.__lastSaved], name, { type: "application/octet-stream" });
    },
  });
  window.showSaveFilePicker = async () => makeHandle("document.iris");
  window.showOpenFilePicker = async () => [makeHandle("document.iris")];
}

async function importCsv(page, name, csv) {
  await page.click("button:has-text('Import data…')");
  await page.setInputFiles("input[type=file]", {
    name, mimeType: "text/csv", buffer: Buffer.from(csv),
  });
  await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
  await page.click(".modal-foot button.primary");
  await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });
}

const browser = await chromium.launch();

// ── Phase 1: two-table import, TableList switch, author the join ──────────────
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.addInitScript(installPickerStub);
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".app", { timeout: 30000 });

// Import cells, then annot — the second must ACCUMULATE into the pool.
await importCsv(page, "cells.csv", cellsCsv);
await importCsv(page, "annot.csv", annotCsv);

// Data view shows the TableList pool with BOTH tables.
await page.click(".mode-toggle button:has-text('Data')");
await page.waitForSelector(".data-mode .table-list", { timeout: 30000 });
await page.waitForFunction(
  () => document.querySelectorAll(".table-list-item").length === 2,
  null, { timeout: 30000 });
console.log("pool shows 2 tables (second import accumulated)");

// The second item starts active (import selects the newly added table). Click the
// FIRST item — it becomes active and the second is no longer active.
await page.click(".table-list-item >> nth=0");
await page.waitForFunction(() => {
  const items = document.querySelectorAll(".table-list-item");
  return items[0]?.classList.contains("is-active")
    && !items[1]?.classList.contains("is-active");
}, null, { timeout: 15000 });
console.log("TableList selects the first table (active switched, second deselected)");

// Read the two pool ids — first imported = cells, second = annot.
const ids = await page.evaluate(
  () => window.__iris.store.get(window.__iris.atoms.tablesAtom).map((t) => t.id));
if (ids.length !== 2) fail(`expected 2 pool tables, got ${ids.length}`);
console.log("pool ids:", ids.join(", "));

// Root the ACTIVE analysis on cells (ids[0]) and give it a join referencing annot
// (ids[1]) on `key`. Also map x/label, y/value so the figure draws a joined column
// (label only exists AFTER the join — strong proof the join computed). Then make
// the active analysis the one we just edited and the active table cells.
await page.evaluate((ids) => {
  const { store, atoms, makeStep } = window.__iris;
  const aid = store.get(atoms.activePlottableIdAtom);
  const next = store.get(atoms.plottablesAtom).map((p) => p.id === aid
    ? { ...p, tableId: ids[0],
        mappings: { x: "label", y: "value" },
        reduce: { ...p.reduce, steps: [
          { ...makeStep("join"), on: ["key"], how: "inner", rightTableId: ids[1] }] } }
    : p);
  store.set(atoms.plottablesAtom, next);
  store.set(atoms.activeTableIdAtom, ids[0]);
}, ids);
console.log("authored join: cells ⋈ annot on key (inner), mapped x=label y=value");

// ── Phase 2: render — the join materializes + computes, no error bar ──────────
await page.click(".mode-toggle button:has-text('Workbench')");
await page.waitForSelector(".workbench-mode", { timeout: 60000 });
await page.waitForSelector(".plottable-sidebar li", { timeout: 60000 });
// Give the materialize → reduce → render round trips time to settle.
await page.waitForTimeout(3000);
if (await page.locator(".error-bar").count() > 0)
  fail("error bar after authoring the join: " + await page.locator(".error-bar").innerText());
console.log("join rendered with no error bar (materialized + computed)");

// Sanity: the join step is present with the annot rightTableId in the live store.
const joinOk = await page.evaluate((ids) => {
  const { store, atoms } = window.__iris;
  const aid = store.get(atoms.activePlottableIdAtom);
  const p = store.get(atoms.plottablesAtom).find((x) => x.id === aid);
  const j = p?.reduce.steps.find((s) => s.kind === "join");
  return !!j && j.rightTableId === ids[1];
}, ids);
if (!joinOk) fail("active analysis lost its join step / rightTableId before save");

// ── Phase 3: save to .iris ────────────────────────────────────────────────────
await page.click("header button:has-text('Save .iris')");
await page.waitForFunction(() => window.__writeCount === 1, null, { timeout: 60000 });
if (await page.locator(".error-bar").count() > 0)
  fail("error bar after save: " + await page.locator(".error-bar").innerText());
const saved = await page.evaluate(() => {
  let s = ""; for (const b of window.__lastSaved) s += String.fromCharCode(b);
  return btoa(s);
});
const head = atob(saved).slice(0, 2);
if (head !== "PK") fail(`saved bytes are not a ZIP/.iris (got ${head.charCodeAt(0)},${head.charCodeAt(1)})`);
console.log("saved a valid .iris (PK magic), length", atob(saved).length);
await page.close();

// ── Phase 4: FRESH page round-trip — load migrates the inline right back ──────
const page2 = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page2.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page2.addInitScript(installPickerStub, saved);
await page2.goto(URL, { waitUntil: "domcontentloaded" });
await page2.waitForSelector(".app", { timeout: 30000 });

await page2.click("header button:has-text('Load .iris')");
await page2.waitForSelector(".workbench-mode", { timeout: 60000 });
await page2.waitForSelector(".plottable-sidebar li", { timeout: 60000 });
await page2.waitForTimeout(3000);
if (await page2.locator(".error-bar").count() > 0)
  fail("error bar after load: " + await page2.locator(".error-bar").innerText());

// The load must have rebuilt the pool with the migrated right → 2 entries, and the
// restored analysis must still carry a join with a rightTableId pointing at one.
const after = await page2.evaluate(() => {
  const { store, atoms } = window.__iris;
  const pool = store.get(atoms.tablesAtom);
  const ps = store.get(atoms.plottablesAtom);
  const join = ps.flatMap((p) => p.reduce.steps).find((s) => s.kind === "join");
  return {
    poolLen: pool.length,
    poolIds: pool.map((t) => t.id),
    rightId: join?.rightTableId ?? null,
  };
});
if (after.poolLen !== 2)
  fail(`load did not rebuild a 2-entry pool (got ${after.poolLen}: ${after.poolIds.join(", ")})`);
if (!after.rightId || !after.poolIds.includes(after.rightId))
  fail(`restored join right (${after.rightId}) is not a pool member (${after.poolIds.join(", ")})`);
console.log("load migrated the inline join right back into a 2-entry pool;",
  "join rightTableId =", after.rightId);

console.log("multi-table e2e ok");
await browser.close();
process.exit(0);
