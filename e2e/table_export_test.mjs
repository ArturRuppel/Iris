import { chromium } from "playwright";

/* Copy table / CSV in the Data pane head: the whole table, header = labels.
   Runs against the live build (APP_URL, default localhost:5173). */
const URL = process.env.APP_URL ?? "http://localhost:5173";
const csv = ["id,cond,value", "1,a,1.5", "2,b,", "3,\"c, d\",2"].join("\n");
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new globalThis.URL(URL).origin });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const fail = (m) => { console.error("FAIL:", m); process.exit(1); };
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".app", { timeout: 30000 });
await page.click("button:has-text('Import')");
await page.setInputFiles("input[type=file]", { name: "x.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
await page.waitForSelector(".modal-foot button.primary"); await page.click(".modal-foot button.primary");
await page.waitForSelector(".modal-overlay", { state: "detached" });
await page.waitForSelector(".table-pane .tx-export");
await page.tap(".tx-export button:has-text('Copy table')");
await page.waitForSelector(".tx-note:has-text('Copied 3 rows')", { timeout: 10000 });
const clip = await page.evaluate(() => navigator.clipboard.readText());
const lines = clip.trim().split("\n");
if (lines.length !== 4) fail(`expected header + 3 rows, got ${JSON.stringify(clip)}`);
if (!lines[3].includes("c, d")) fail(`text with a comma should survive: ${lines[3]}`);
console.log("copy:", JSON.stringify(clip));
const [dl] = await Promise.all([page.waitForEvent("download"), page.tap(".tx-export button:has-text('CSV')")]);
const body = (await (await dl.createReadStream()).toArray()).join("");
if (!body.includes('"c, d"')) fail(`CSV should quote a comma: ${body}`);
console.log("csv:", JSON.stringify(body));
await page.screenshot({ path: process.env.SHOT ?? "/dev/null" });
console.log("PASS");
await browser.close();
