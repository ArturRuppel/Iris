import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/* Chromium refuses module scripts and `crossorigin` stylesheets on file:// pages,
   and the web build has to open straight from a file share. */
const classicHtml: Plugin = {
  name: "iris-classic-html",
  transformIndexHtml: {
    order: "post",
    handler: (html) => html
      .replace(/<script type="module" crossorigin/g, "<script defer")
      .replace(/<link rel="stylesheet" crossorigin/g, '<link rel="stylesheet"'),
  },
};

export default defineConfig(({ mode, command }) => {
  const web = mode === "web";
  return {
    plugins: web ? [react(), classicHtml] : [react()],
    clearScreen: false,
    server: { port: 5173, strictPort: true },
    // classic, because Chromium blocks module workers from a blob on file:// pages
    worker: { format: "iife" },
    // relative, so the served build also works under a sub-path (the lab book
    // mounts it at /iris/ on its own origin); the dev server stays at the root
    base: command === "serve" ? "/" : "./",
    build: web ? {
      outDir: "dist-web",
      modulePreload: { polyfill: false },
      // the bundled examples are fetched, and fetch cannot read a file:// sibling
      assetsInlineLimit: (file: string) => (file.endsWith(".iris") ? true : undefined),
      rollupOptions: { output: { format: "iife", inlineDynamicImports: true } },
    } : {},
  };
});
