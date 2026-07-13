import { chromium } from "playwright";

/* E2E for autosave / crash recovery (ROADMAP Tier 2; design:
   docs/superpowers/specs/2026-07-02-autosave-crash-recovery-design.md).

   The loop this guards: build an analysis, kill the page WITHOUT saving,
   reload — the recovery banner offers the snapshot, Restore brings back the
   exact state (encodings + layers + title, asserted via the footer's spec
   JSON), and an explicit Save clears the slot so the next launch is quiet.

   Needs the engine (8765) and the vite dev server (5173). Start the engine
   with IRIS_AUTOSAVE_DIR pointing somewhere disposable — this test CLEARS the
   slot at both ends. Pass CHROMIUM_PATH to use a system chromium. */

const csv = [
  "group,value",
  "a,1", "a,2", "a,3", "a,4",
  "b,5", "b,6", "b,7", "b,8",
].join("\n");

const URL = process.env.APP_URL ?? "http://localhost:5173";
const ENGINE = process.env.ENGINE_URL ?? "http://127.0.0.1:8765";
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };

const status = async () => (await fetch(`${ENGINE}/autosave/status`)).json();
const waitForSlot = async (want, what, tries = 40) => {
  for (let i = 0; i < tries; i++) {
    if ((await status()).exists === want) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  fail(`autosave slot never became ${what}`);
};

/* the File System Access save picker, stubbed in-memory (native dialogs are
   undrivable) — same approach as save_load_test.mjs. */
function installSavePickerStub() {
  window.__writeCount = 0;
  window.showSaveFilePicker = async () => ({
    name: "document.iris", kind: "file",
    async createWritable() {
      return { async write() {}, async close() { window.__writeCount++; } };
    },
  });
}

async function importFixture(page) {
  await page.click(".tb-btn:has-text('Import')");
  await page.setInputFiles("input[type=file]", {
    name: "autosave_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
  });
  await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
  await page.click(".modal-foot button.primary");
  await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 }).catch(() => {});
}

/* the active analysis's spec, read from the footer's "Show analysis spec"
   dump — the exact-state fingerprint the restore must reproduce. */
async function readSpec(page) {
  if (await page.locator("footer pre").count() === 0)
    await page.click(".tb-icon"); await page.click(".tb-menu-right button:has-text('analysis spec')");
  const txt = await page.locator("footer pre").innerText();
  return JSON.parse(txt);
}

const launchOpts = process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH } : {};
const browser = await chromium.launch(launchOpts);

// a leftover slot from a previous run must not masquerade as this run's snapshot
await fetch(`${ENGINE}/autosave/clear`, { method: "POST" });

// ── Phase 1: build an analysis, never save ────────────────────────────────────
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".app", { timeout: 30000 });
if (await page.locator(".recovery-bar").count() > 0)
  fail("recovery banner shown with an empty autosave slot");
await importFixture(page);
console.log("dataset imported");

await page.click(".tb-seg button:has-text('Workbench')");
await page.waitForSelector(".txw-add-plot", { timeout: 15000 });
await page.click(".txw-add-plot");
await page.waitForSelector("[data-testid='plot-wizard']", { timeout: 10000 });
await page.locator(".wiz-geom", { hasText: "Box" }).click();
await page.waitForSelector(".wiz-step.wiz-map", { timeout: 10000 });
await page.locator(".enc-row", { hasText: "X" }).locator("select").selectOption("group");
await page.locator(".enc-row", { hasText: "Y" }).locator("select").selectOption("value");
await page.waitForSelector(".wiz-done:not([disabled])", { timeout: 5000 });
await page.click(".wiz-done");
await page.waitForSelector("[data-testid='plot-wizard']", { state: "detached", timeout: 10000 });
console.log("analysis built: Box, X=group, Y=value");

// the debounced snapshot (~1.5 s after the last edit) must land in the slot
await waitForSlot(true, "populated (debounced snapshot)");
const st = await status();
console.log(`snapshot landed: ${st.n_analyses} analyses on [${st.tables}]`);

const specBefore = await readSpec(page);

// kill the page with the work unsaved — the crash / accidental-close proxy
await page.close();
console.log("page killed without saving");

// ── Phase 2: fresh launch offers the snapshot; Restore reproduces the state ──
const page2 = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page2.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page2.addInitScript(installSavePickerStub);
await page2.goto(URL, { waitUntil: "domcontentloaded" });
await page2.waitForSelector(".app", { timeout: 30000 });
await page2.waitForSelector(".recovery-bar", { timeout: 15000 });
console.log("recovery banner shown on fresh launch");

await page2.click(".recovery-bar button:has-text('Restore')");
await page2.waitForSelector(".recovery-bar", { state: "detached", timeout: 15000 });
await page2.waitForSelector("[data-testid='plot-card']", { timeout: 30000 });
const specAfter = await readSpec(page2);

// the restore must reproduce the exact built state — encodings, layers, title.
// (stats.test / engine_snapshot are engine-derived and recomputed on open, so
// they are not part of "the state the user built".)
const fingerprint = (s) => JSON.stringify({
  title: s.title, encodings: s.encodings,
  layers: s.layers.map((l) => ({ geom: l.geom, level: l.level })),
  reduce: s.reduce, hierarchy: s.hierarchy,
});
if (fingerprint(specAfter) !== fingerprint(specBefore))
  fail(`restored spec differs:\nbefore ${fingerprint(specBefore)}\nafter  ${fingerprint(specAfter)}`);
console.log("restored state matches the pre-kill spec exactly");

if (await page2.locator(".error-bar").count() > 0)
  fail("error bar after restore: " + await page2.locator(".error-bar").innerText());

// ── Phase 3: an explicit Save clears the slot; the next launch is quiet ──────
await page2.click("header .tb-primary");
await page2.waitForFunction(() => window.__writeCount === 1, null, { timeout: 30000 });
await waitForSlot(false, "cleared (explicit Save)");
console.log("explicit Save cleared the snapshot slot");

await page2.close();
const page3 = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
await page3.goto(URL, { waitUntil: "domcontentloaded" });
await page3.waitForSelector(".app", { timeout: 30000 });
await page3.waitForTimeout(2000);   // give the launch-time status fetch time to land
if (await page3.locator(".recovery-bar").count() > 0)
  fail("recovery banner shown after the snapshot was cleared by Save");
console.log("no recovery offer after an explicit save");

// ── Phase 4: a tab closed INSIDE the debounce window still snapshots ─────────
// (the pagehide keepalive flush; the browser process stays alive, as in a real
// accidental tab close — browser.close() would kill the request mid-flight).
// Playwright's page.close() is a hard CDP target teardown — it does NOT dispatch
// pagehide/visibilitychange the way a real tab close does (verified: neither
// fires on close(), even with runBeforeUnload:true). A same-tab navigation away
// DOES fire them (confirmed), so that's the fidelity-preserving way to drive
// this from Playwright — the app can't tell the difference; both leave its
// pagehide listener as the last chance to flush.
await importFixture(page3);
await page3.goto("about:blank");   // well within the ~1.5 s debounce
await waitForSlot(true, "populated (pagehide flush)", 20);
console.log("pagehide flush snapshotted a tab closed inside the debounce");
await fetch(`${ENGINE}/autosave/clear`, { method: "POST" });   // leave the slot clean

console.log("AUTOSAVE / CRASH RECOVERY E2E OK");
await browser.close();
