#!/usr/bin/env node
/* Fold the web build and one .iris into a single HTML file that needs nothing else:
   no install, no neighbouring files and no network. Build the site first:

     npm run build:web && npm run pack:iris -- figure.iris [out.html]

   Each payload stays base64 text, now in an inert <script type="text/plain"> that
   src/browserEngine.ts reads and hands to the worker. The app comes before them, so
   the loading screen can show while the browser parses the rest of the file. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist-web");

const [input, outArg] = process.argv.slice(2);
if (!input) throw new Error("usage: pack-iris <figure.iris> [out.html]");
const document_ = readFileSync(input);
if (!("manifest.json" in unzipSync(document_, { filter: (f) => f.name === "manifest.json" })))
  throw new Error(`${input}: not a .iris file`);
if (!existsSync(join(DIST, "pyodide", "manifest.js"))) throw new Error("no web build: run npm run build:web first");
const name = basename(input);
const out = outArg ?? input.replace(/\.iris$/, "") + ".html";

const safeInScript = (text) => text.replaceAll("</script", "<\\/script").replaceAll("<!--", "<\\!--");
const safeInStyle = (text) => text.replaceAll("</style", "<\\/style");

let html = readFileSync(join(DIST, "index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
const js = html.match(/<script[^>]*\ssrc="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/);
if (!js) throw new Error("index.html: no app script");
html = html.replace(js[0], "");
const css = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="\.\/([^"?]+\.css)"[^>]*>/g)];
/* the bundled fonts (public/fonts/) ride along as data URLs, relative to their stylesheet */
const appCss = css.map((m) => readFileSync(join(DIST, m[1]), "utf8").replace(
  /url\((["']?)([^"')]+\.woff2)\1\)/g, (_, _q, url) => {
    const file = join(DIST, dirname(m[1]), url);
    if (!existsSync(file)) throw new Error(`${m[1]}: no font file ${url}`);
    return `url(data:font/woff2;base64,${readFileSync(file).toString("base64")})`;
  })).join("\n");
for (const m of css) html = html.replace(m[0], "");
html = html.replace(/<link[^>]*(rel="manifest"|rel="apple-touch-icon")[^>]*>\s*/g, "");
const icon = readFileSync(join(DIST, "iris-favicon.svg")).toString("base64");
html = html.replace(/<link[^>]*rel="icon"[^>]*>/, () => `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${icon}" />`);
const title = name.replace(/\.iris$/, "").replace(/[<>&"]/g, "");
html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${title} · Iris</title>`);
html = html.replace("</head>", () => `<style>${safeInStyle(appCss)}</style>\n</head>`);

const manifestScript = readFileSync(join(DIST, "pyodide", "manifest.js"), "utf8");
const manifest = JSON.parse(manifestScript.slice(manifestScript.indexOf("(") + 1, manifestScript.lastIndexOf(")")));
const tag = (id, body, extra = "") => `<script type="text/plain" id="${id}"${extra}>${body}</script>\n`;
const payloadOf = (file) => {
  const text = readFileSync(join(DIST, "pyodide", file.script), "latin1");
  return text.slice(text.indexOf(',"') + 2, text.lastIndexOf('"'));
};

const before = tag("iris-document", document_.toString("base64"), ` data-name="${title}.iris"`)
  + tag("iris-manifest", JSON.stringify(manifest).replaceAll("<", "\\u003c"))
  + `<script>${safeInScript(readFileSync(join(DIST, js[1]), "utf8")
    .replaceAll("../iris-favicon.svg", `data:image/svg+xml;base64,${icon}`))}</script>\n`;
const closing = html.lastIndexOf("</body>");
if (closing < 0) throw new Error("index.html: no </body>");
const parts = [html.slice(0, closing), before];
manifest.files.forEach((file, i) => parts.push(tag(`iris-file-${i}`, payloadOf(file))));
parts.push(html.slice(closing));
const bundle = Buffer.from(parts.join(""), "utf8");
writeFileSync(out, bundle);
console.log(`${out}: ${(bundle.length / 1e6).toFixed(1)} MB, ${(document_.length / 1e3).toFixed(0)} KB of it the document`);
