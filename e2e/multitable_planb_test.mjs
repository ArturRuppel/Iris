import { chromium } from "playwright";

/* E2E for Multiple Input Tables — Plan B (Task 7). Proves the capability Plan A
   could NOT: a workspace whose analyses are rooted in DIFFERENT main tables,
   saved de-duplicated into the top-level `tables/<name>/...` (2.1) section and
   reloaded intact, by REFERENCE.

   Plan A's e2e had ONE main table (a single analysis joined to a second pooled
   table). This test authors TWO analyses on DISTINCT main tables:
     • Analysis 1 rooted in `cells`, joined to `annot` on `key` (inner),
       mapped x=label (label exists only AFTER the join → proves the join
       computed), y=value.
     • Analysis 2 rooted in `annot`, mapped x=label, y=score (annot's own cols).
   `annot` is therefore referenced TWICE — as analysis-2's main table AND as
   analysis-1's join right — yet the saved .iris must store it ONCE (the heart of
   this test: the de-duplication assertion).

   Authoring is via the DEV-only store seam (window.__iris) — Plan B still has no
   per-analysis main-table picker UI. Note each import already appends a default
   analysis bound to the imported table, so after importing cells then annot the
   pool has two analyses (one per table); we author into those two rather than
   adding a third, keeping plottablesAtom at exactly 2.

   Needs the engine (8765) and the vite dev server (5173). The File System Access
   pickers are stubbed in-memory so Playwright can drive Save/Load. */

const cellsCsv = ["key,group,value",
  "x,a,1", "x,a,2", "y,b,3", "y,b,4", "z,a,5", "z,b,6"].join("\n");
const annotCsv = ["key,label,score",
  "x,P,10", "y,Q,20", "z,R,30"].join("\n");

const URL = process.env.APP_URL ?? "http://localhost:5173";
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };

/* In-memory File System Access stub (copied verbatim from multitable_test.mjs).
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
  await page.click(".tb-btn:has-text('Add data')"); await page.click(".tb-menu button:has-text('Import…')");
  await page.setInputFiles("input[type=file]", {
    name, mimeType: "text/csv", buffer: Buffer.from(csv),
  });
  await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
  await page.click(".modal-foot button.primary");
  await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });
}

const browser = await chromium.launch();

// ── Phase 1: two-table import, author two analyses on DISTINCT main tables ─────
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.addInitScript(installPickerStub);
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".app", { timeout: 30000 });

// Import cells, then annot — the second ACCUMULATES into the pool (pool → 2).
await importCsv(page, "cells.csv", cellsCsv);
await importCsv(page, "annot.csv", annotCsv);

// Read the two pool ids via the seam — first imported = cells, second = annot.
const ids = await page.evaluate(
  () => window.__iris.store.get(window.__iris.atoms.tablesAtom).map((t) => t.id));
if (ids.length !== 2) fail(`expected 2 pool tables, got ${ids.length}: ${ids.join(", ")}`);
const [cellsId, annotId] = ids;
console.log("pool ids:", cellsId, "(cells),", annotId, "(annot)");

// Author the two analyses (one per import-created plottable). The analysis rooted
// in cells gets the join to annot; the one rooted in annot maps annot's own cols.
const authored = await page.evaluate(({ cellsId, annotId }) => {
  const { store, atoms, makeStep } = window.__iris;
  const next = store.get(atoms.plottablesAtom).map((p) => {
    if (p.tableId === cellsId)
      return { ...p, tableId: cellsId,
        mappings: { x: "label", y: "value" },
        reduce: { ...p.reduce, steps: [
          { ...makeStep("join"), on: ["key"], how: "inner", rightTableId: annotId }] } };
    if (p.tableId === annotId)
      return { ...p, tableId: annotId, mappings: { x: "label", y: "score" }, reduce: { steps: [] } };
    return p;
  });
  store.set(atoms.plottablesAtom, next);
  // remember which plottable id is which main table, for the render passes.
  const cellsPid = next.find((p) => p.tableId === cellsId)?.id ?? null;
  const annotPid = next.find((p) => p.tableId === annotId)?.id ?? null;
  return { count: next.length, cellsPid, annotPid,
    tableIds: next.map((p) => p.tableId),
    joinRight: next.find((p) => p.id === cellsPid)?.reduce.steps.find((s) => s.kind === "join")?.rightTableId ?? null };
}, { cellsId, annotId });

if (authored.count !== 2)
  fail(`expected 2 analyses, got ${authored.count} (tableIds: ${authored.tableIds.join(", ")})`);
if (!authored.tableIds.includes(cellsId) || !authored.tableIds.includes(annotId))
  fail(`analyses are not rooted in the two distinct main tables (tableIds: ${authored.tableIds.join(", ")})`);
if (authored.joinRight !== annotId)
  fail(`analysis-1 join right is ${authored.joinRight}, expected annot ${annotId}`);
console.log("authored 2 analyses: A1 cells⋈annot on key (x=label,y=value), A2 annot (x=label,y=score)");

// ── Phase 2: both main tables render — no error bar on either ──────────────────
await page.click(".tb-seg button:has-text('Workbench')");
await page.waitForSelector(".workbench-mode", { timeout: 60000 });
await page.waitForSelector(".plottable-sidebar li", { timeout: 60000 });

// Analysis 1 (cells, with the join) active first.
await page.evaluate((pid) => {
  const { store, atoms } = window.__iris;
  store.set(atoms.activePlottableIdAtom, pid);
  store.set(atoms.activeTableIdAtom, store.get(atoms.plottablesAtom).find((p) => p.id === pid).tableId);
}, authored.cellsPid);
await page.waitForTimeout(3000);
if (await page.locator(".error-bar").count() > 0)
  fail("error bar on analysis 1 (cells⋈annot): " + await page.locator(".error-bar").innerText());
console.log("analysis 1 (cells main table, joined to annot) rendered, no error bar");

// Analysis 2 (annot main table) active.
await page.evaluate((pid) => {
  const { store, atoms } = window.__iris;
  store.set(atoms.activePlottableIdAtom, pid);
  store.set(atoms.activeTableIdAtom, store.get(atoms.plottablesAtom).find((p) => p.id === pid).tableId);
}, authored.annotPid);
await page.waitForTimeout(3000);
if (await page.locator(".error-bar").count() > 0)
  fail("error bar on analysis 2 (annot): " + await page.locator(".error-bar").innerText());
console.log("analysis 2 (annot main table) rendered, no error bar");

// ── Phase 3: save to .iris ─────────────────────────────────────────────────────
await page.click("header .tb-primary");
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

// ── Phase 3b: DE-DUPLICATION — annot stored ONCE despite two references ────────
// Scan the raw zip byte stream for `tables/<name>/table.parquet` entries. ZIP
// filenames are ASCII and appear twice each (local header + central dir), so the
// Set dedups to the distinct table NAMES actually stored. annot is referenced by
// analysis-2 (main) AND analysis-1 (join right) but must be a single stored table.
const storedNames = await page.evaluate((saved) => {
  const bytes = atob(saved);
  return [...new Set([...bytes.matchAll(/tables\/([^/]+)\/table\.parquet/g)].map((m) => m[1]))];
}, saved);
const storedSet = new Set(storedNames);
if (storedSet.size !== 2)
  fail(`expected exactly 2 stored tables (annot NOT duplicated), got ${storedSet.size}: ${storedNames.join(", ")}`);
if (!storedSet.has(cellsId) || !storedSet.has(annotId))
  fail(`stored tables ${storedNames.join(", ")} are not exactly {${cellsId}, ${annotId}}`);
console.log("de-duplicated: saved stores exactly 2 tables", JSON.stringify(storedNames),
  "(annot referenced twice, stored once)");
await page.close();

// ── Phase 4: FRESH page round-trip — pool + both main tables survive by REFERENCE
const page2 = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page2.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page2.addInitScript(installPickerStub, saved);
await page2.goto(URL, { waitUntil: "domcontentloaded" });
await page2.waitForSelector(".app", { timeout: 30000 });

await page2.click("header .tb-ghost");
await page2.waitForSelector(".workbench-mode", { timeout: 60000 });
await page2.waitForSelector(".plottable-sidebar li", { timeout: 60000 });
await page2.waitForTimeout(3000);
if (await page2.locator(".error-bar").count() > 0)
  fail("error bar after load: " + await page2.locator(".error-bar").innerText());

// The 2.1 load rebuilds the pool from `tables[]` (by reference — no inline-right
// migration); the join carries its right_table_id pointing at a pool member; and
// the two analyses keep their two DISTINCT main tables.
const after = await page2.evaluate(() => {
  const { store, atoms } = window.__iris;
  const pool = store.get(atoms.tablesAtom);
  const ps = store.get(atoms.plottablesAtom);
  const join = ps.flatMap((p) => p.reduce.steps).find((s) => s.kind === "join");
  return {
    poolLen: pool.length,
    poolIds: pool.map((t) => t.id),
    rightId: join?.rightTableId ?? null,
    analyses: ps.map((p) => ({ id: p.id, tableId: p.tableId })),
  };
});
if (after.poolLen !== 2)
  fail(`load did not rebuild a 2-entry pool (got ${after.poolLen}: ${after.poolIds.join(", ")})`);
if (!after.poolIds.includes(cellsId) || !after.poolIds.includes(annotId))
  fail(`reloaded pool ${after.poolIds.join(", ")} is not {${cellsId}, ${annotId}}`);
if (!after.rightId || !after.poolIds.includes(after.rightId))
  fail(`restored join right (${after.rightId}) is not a pool member (${after.poolIds.join(", ")})`);
if (after.analyses.length !== 2)
  fail(`expected 2 analyses after load, got ${after.analyses.length}`);
const tableIds = after.analyses.map((a) => a.tableId).sort();
const expected = [cellsId, annotId].sort();
if (tableIds[0] !== expected[0] || tableIds[1] !== expected[1])
  fail(`analyses' main tables ${tableIds.join(", ")} are not the two distinct pool tables ${expected.join(", ")}`);
console.log("load rebuilt the 2-entry pool by reference; join right =", after.rightId,
  "; analyses rooted in", tableIds.join(" and "));

// Each analysis renders with its correct main table after reload.
for (const a of after.analyses) {
  await page2.evaluate((pid) => {
    const { store, atoms } = window.__iris;
    store.set(atoms.activePlottableIdAtom, pid);
    store.set(atoms.activeTableIdAtom, store.get(atoms.plottablesAtom).find((p) => p.id === pid).tableId);
  }, a.id);
  await page2.waitForTimeout(3000);
  if (await page2.locator(".error-bar").count() > 0)
    fail(`error bar after load on analysis rooted in ${a.tableId}: ` + await page2.locator(".error-bar").innerText());
  console.log("reloaded analysis rooted in", a.tableId, "rendered, no error bar");
}

console.log("multi-table Plan B e2e ok");
await browser.close();
process.exit(0);
