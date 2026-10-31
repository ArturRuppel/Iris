import { chromium } from "playwright";

/* E2E for opening a bundled example: click "Open example" on the empty
   workbench, and confirm the example loads into the workbench
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

// Open the bundled example from the empty workbench.
await page.locator("[data-tour='mode-workbench']").click();
await page.getByRole("button", { name: "Open example" }).click();

// It should land in the workbench view with a figure.
await page.waitForSelector(".workbench-mode", { timeout: 15_000 });

// Saving now must call the save picker (Save As) — the example is not bound.
await page.getByRole("button", { name: "Save", exact: true }).click();
await page.waitForFunction(() => window.__savePickerCalls > 0, { timeout: 10_000 })
  .catch(() => fail("Save did not prompt for a file — example may be bound as write target"));

console.log("PASS: the bundled example opens and saves as a new file");
await browser.close();
