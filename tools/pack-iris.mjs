#!/usr/bin/env node
/* Fold the web build and one .iris into a single HTML file that needs nothing else:
   no install, no neighbouring files and no network. Build the site first:

     npm run build:web && npm run pack:iris -- figure.iris [out.html]

   Each payload stays base64 text, now in an inert <script type="text/plain"> that
   src/browserEngine.ts reads and hands to the worker. The app comes before them, so
   the loading screen can show while the browser parses the rest of the file. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist-web");
const CACHE = join(ROOT, "node_modules", ".cache", "iris-web");
const FONTS = "https://fonts.googleapis.com/css2?family=Archivo:wght@400..800&family=IBM+Plex+Mono:wght@400;500;600&display=swap";
/* Google picks the font format from this; a modern browser gets woff2 */
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const [input, outArg] = process.argv.slice(2);
if (!input) throw new Error("usage: pack-iris <figure.iris> [out.html]");
const document_ = readFileSync(input);
if (!("manifest.json" in unzipSync(document_, { filter: (f) => f.name === "manifest.json" })))
  throw new Error(`${input}: not a .iris file`);
if (!existsSync(join(DIST, "pyodide", "manifest.js"))) throw new Error("no web build: run npm run build:web first");
const name = basename(input);
const out = outArg ?? input.replace(/\.iris$/, "") + ".html";

/* The Latin subsets only, as data URLs, kept between runs. */
async function fontCss() {
  const cached = join(CACHE, "fonts-inline.css");
  if (existsSync(cached)) return readFileSync(cached, "utf8");
  const res = await fetch(FONTS, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`fonts: HTTP ${res.status}`);
  const blocks = (await res.text()).match(/\/\* latin \*\/\s*@font-face\s*\{[^}]*\}/g) ?? [];
  if (blocks.length === 0) throw new Error("fonts: no Latin subset in the answer");
  const inlined = await Promise.all(blocks.map(async (block) => {
    const url = block.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
    if (!url) throw new Error("fonts: a face without a woff2 file");
    const font = await fetch(url);
    if (!font.ok) throw new Error(`${url}: HTTP ${font.status}`);
    const base64 = Buffer.from(await font.arrayBuffer()).toString("base64");
    return block.replace(url, `data:font/woff2;base64,${base64}`);
  }));
  const css = inlined.join("\n");
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(cached, css);
  return css;
}

const safeInScript = (text) => text.replaceAll("</script", "<\\/script").replaceAll("<!--", "<\\!--");
const safeInStyle = (text) => text.replaceAll("</style", "<\\/style");

let html = readFileSync(join(DIST, "index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
const js = html.match(/<script[^>]*\ssrc="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/);
if (!js) throw new Error("index.html: no app script");
html = html.replace(js[0], "");
const css = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g)];
const appCss = css.map((m) => readFileSync(join(DIST, m[1]), "utf8")).join("\n");
for (const m of css) html = html.replace(m[0], "");
html = html.replace(/<link[^>]*(fonts\.g|rel="manifest"|rel="apple-touch-icon")[^>]*>\s*/g, "");
const icon = readFileSync(join(DIST, "iris-favicon.svg")).toString("base64");
html = html.replace(/<link[^>]*rel="icon"[^>]*>/, () => `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${icon}" />`);
const title = name.replace(/\.iris$/, "").replace(/[<>&"]/g, "");
html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${title} · Iris</title>`);
const fonts = await fontCss();
html = html.replace("</head>", () => `<style>${safeInStyle(fonts)}\n${safeInStyle(appCss)}</style>\n</head>`);

const manifestScript = readFileSync(join(DIST, "pyodide", "manifest.js"), "utf8");
const manifest = JSON.parse(manifestScript.slice(manifestScript.indexOf("(") + 1, manifestScript.lastIndexOf(")")));
const tag = (id, body, extra = "") => `<script type="text/plain" id="${id}"${extra}>${body}</script>\n`;
const payloadOf = (file) => {
  const text = readFileSync(join(DIST, "pyodide", file.script), "latin1");
  return text.slice(text.indexOf(',"') + 2, text.lastIndexOf('"'));
};

const before = tag("iris-document", document_.toString("base64"), ` data-name="${title}.iris"`)
  + tag("iris-manifest", JSON.stringify(manifest).replaceAll("<", "\\u003c"))
  + `<script>${safeInScript(readFileSync(join(DIST, js[1]), "utf8"))}</script>\n`;
const closing = html.lastIndexOf("</body>");
if (closing < 0) throw new Error("index.html: no </body>");
const parts = [html.slice(0, closing), before];
manifest.files.forEach((file, i) => parts.push(tag(`iris-file-${i}`, payloadOf(file))));
parts.push(html.slice(closing));
const bundle = Buffer.from(parts.join(""), "utf8");
writeFileSync(out, bundle);
console.log(`${out}: ${(bundle.length / 1e6).toFixed(1)} MB, ${(document_.length / 1e3).toFixed(0)} KB of it the document`);
