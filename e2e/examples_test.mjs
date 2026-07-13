import { chromium } from "playwright";

/* E2E for the Examples gallery: switch to the view, confirm an inline plot
   renders, click "Open in Iris", and confirm the example loads into Analyses
   AND that the next Save is a Save As (showSaveFilePicker is called) — i.e. the
   shipped example is never bound as the write-back target.
   Needs the engine (8765) and the vite dev server (5173). */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };

/* Stub the FS Access save picker so a later Save can't open a native dialog and
   so we can detect that Save fell through to "pick a file" (Save As). */
function installSavePickerStub() {
  let calls = 0;
  Object.defineProperty(window, "showSaveFilePicker", {
    configurable: true,
    value: async () => {
      window.__savePickerCalls = ++calls;
      const chunks = [];
      return {
        name: "untitled.iris",
        createWritable: async () => ({
          write: async (b) => chunks.push(b),
          close: async () => {},
        }),
      };
    },
  });
  window.__savePickerCalls = 0;
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(installSavePickerStub);
await page.goto(URL);

// Switch to the Guide view and open a page that carries example figures (the
// Home landing has none).
await page.getByRole("button", { name: "Guide" }).click();
await page.getByRole("button", { name: "Plot types" }).click();

// An inline plot SVG must render (no unknown-example placeholders).
await page.waitForSelector(".gallery-figure svg", { timeout: 10_000 });
const missing = await page.locator(".gallery-missing").count();
if (missing > 0) fail(`${missing} unresolved example token(s) in the guide`);

// Open the first example into the session.
await page.locator(".gallery-open-btn").first().click();

// It should land in the workbench view with a figure.
await page.waitForSelector(".workbench-mode", { timeout: 15_000 });

// Saving now must call the save picker (Save As) — the example is not bound.
await page.getByRole("button", { name: "Save", exact: true }).click();
await page.waitForFunction(() => window.__savePickerCalls > 0, { timeout: 10_000 })
  .catch(() => fail("Save did not prompt for a file — example may be bound as write target"));

console.log("PASS: examples gallery opens and saves as a new file");
await browser.close();
