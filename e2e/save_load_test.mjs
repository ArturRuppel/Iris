import { chromium } from "playwright";

/* E2E for the .iris Save / Save As / Load flow (TODO item L).

   The File System Access API pickers open native OS dialogs Playwright can't
   drive, so we stub `showSaveFilePicker`/`showOpenFilePicker` with in-memory
   handles via addInitScript. That still exercises the REAL app logic — doSave
   reusing the retained handle, the second-save regression, and the
   showOpenFilePicker -> getFile -> /document/load engine round trip — only the
   native dialog is faked.

   The regression this guards: saving used to "work only once" (every save was a
   fresh data-URI download, never a write-back). We assert a second Save writes
   AGAIN to the same handle, and that the bytes are a real .iris (ZIP magic PK).
   Needs the engine (8765) and the vite dev server (5173). */

const csv = [
  "group,value",
  "a,1", "a,2", "a,3",
  "b,4", "b,5", "b,6",
].join("\n");

const URL = process.env.APP_URL ?? "http://localhost:5173";
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };

/* In-memory File System Access stub. Every close() records the concatenated
   bytes on window.__lastSaved and bumps window.__writeCount; getFile() reads
   them back so a Load round-trips the just-saved document. Bytes can also be
   seeded (window.__seedBytes) so a *fresh* page can load a doc saved earlier. */
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

async function importFixture(page) {
  await page.click(".tb-btn:has-text('Add data')");
  await page.setInputFiles("input[type=file]", {
    name: "save_load_fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
  });
  await page.waitForSelector(".modal-foot button.primary", { timeout: 15000 });
  await page.click(".modal-foot button.primary");
  await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 15000 });
  await page.click(".tb-seg button:has-text('Workbench')");
  await page.waitForSelector(".workbench-mode", { timeout: 60000 });
  await page.waitForSelector(".plottable-sidebar li", { timeout: 60000 });
}

const browser = await chromium.launch();

// ── Phase 1: import, then Save twice (the once-only regression) ───────────────
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.addInitScript(installPickerStub);
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".app", { timeout: 30000 });
await importFixture(page);

await page.click("header .tb-primary");
await page.waitForFunction(() => window.__writeCount === 1, null, { timeout: 30000 });
console.log("first Save wrote the file");

// The regression: a SECOND Save must write again (not silently no-op).
await page.click("header .tb-primary");
await page.waitForFunction(() => window.__writeCount === 2, null, { timeout: 30000 });
console.log("second Save wrote again (once-only bug is gone)");

if (await page.locator(".error-bar").count() > 0)
  fail("error bar after save: " + await page.locator(".error-bar").innerText());

// Bytes must be a real .iris (ZIP archive -> magic "PK").
const saved = await page.evaluate(() => {
  let s = ""; for (const b of window.__lastSaved) s += String.fromCharCode(b);
  return btoa(s);
});
const head = atob(saved).slice(0, 2);
if (head !== "PK") fail(`saved bytes are not a ZIP/.iris (got bytes ${head.charCodeAt(0)},${head.charCodeAt(1)})`);
console.log("saved bytes are a valid .iris archive (PK magic), length", atob(saved).length);

// Save As… must also write (always prompts, here the stub just returns a handle).
const beforeSaveAs = await page.evaluate(() => window.__writeCount);
await page.click(".tb-icon"); await page.click(".tb-menu-right button:has-text('Save As')");
await page.waitForFunction((n) => window.__writeCount === n + 1, beforeSaveAs, { timeout: 30000 });
console.log("Save As… wrote a file");
await page.close();

// ── Phase 2: a FRESH page loads the saved doc back (full round trip) ──────────
const page2 = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page2.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page2.addInitScript(installPickerStub, saved);   // seed the saved bytes
await page2.goto(URL, { waitUntil: "domcontentloaded" });
await page2.waitForSelector(".app", { timeout: 30000 });

await page2.click("header .tb-ghost:has-text('Load')");
// A successful load switches to analyses mode and shows the plottable + the
// loaded data (engine /document/load rebuilt the session from the saved bytes).
await page2.waitForSelector(".workbench-mode", { timeout: 60000 });
await page2.waitForSelector(".plottable-sidebar li", { timeout: 60000 });
if (await page2.locator(".error-bar").count() > 0)
  fail("error bar after load: " + await page2.locator(".error-bar").innerText());
const loadedCount = await page2.locator(".plottable-sidebar li").count();
if (loadedCount < 1) fail(`loaded doc shows no plottables (${loadedCount})`);
console.log("loaded the saved .iris in a fresh page;", loadedCount, "plottable(s) restored");

console.log("save/load e2e ok");
await browser.close();
