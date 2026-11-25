import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { compileRuntimeScript, runtimeScripts, runtimeSource } from "./runtime-scripts.ts";

const project = resolve(import.meta.dirname, "../..");
const source = resolve(project, "src");
const assets = [
  "manifest.json",
  ...[16, 24, 32, 48, 128].map((size) => `icons/icon-${size}.png`),
  ...["lavender", "rose", "amber", "night"].flatMap((theme) =>
    [16, 24, 32].map((size) => `icons/icon-${theme}-${size}.png`))
];

const extensionAssets: Plugin = {
  name: "selector-clicker-extension-assets",
  buildStart() {
    for (const file of assets) this.addWatchFile(resolve(project, file));
    for (const file of runtimeScripts) this.addWatchFile(runtimeSource(file));
  },
  async generateBundle() {
    for (const file of assets) {
      this.emitFile({ type: "asset", fileName: file, source: await readFile(resolve(project, file)) });
    }
    for (const file of runtimeScripts) {
      this.emitFile({ type: "asset", fileName: file, source: compileRuntimeScript(file) });
    }
  },
  transformIndexHtml() {
    return [{ tag: "script", attrs: { src: "./site-rules.js" }, injectTo: "head-prepend" }];
  }
};

export default defineConfig({
  root: source,
  base: "./",
  publicDir: false,
  plugins: [react(), tailwindcss(), extensionAssets],
  resolve: { alias: { "@": source } },
  build: {
    outDir: resolve(project, "dist"),
    emptyOutDir: true,
    target: "chrome111",
    cssTarget: "chrome111",
    modulePreload: { polyfill: false },
    rolldownOptions: {
      input: { popup: resolve(source, "popup.html"), rules: resolve(source, "rules.html") }
    }
  }
});
