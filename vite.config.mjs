import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = import.meta.dirname;
const runtimeFiles = [
  "manifest.json", "site-rules.js", "picker.js", "content.js", "service-worker.js",
  ...[16, 24, 32, 48, 128].map((size) => `icons/icon-${size}.png`)
];

const extensionAssets = {
  name: "selector-clicker-extension-assets",
  buildStart() {
    for (const file of runtimeFiles) this.addWatchFile(resolve(root, file));
  },
  async generateBundle() {
    for (const file of runtimeFiles) {
      this.emitFile({ type: "asset", fileName: file, source: await readFile(resolve(root, file)) });
    }
  },
  transformIndexHtml() {
    return [{ tag: "script", attrs: { src: "./site-rules.js" }, injectTo: "head-prepend" }];
  }
};

export default defineConfig({
  base: "./",
  publicDir: false,
  plugins: [react(), tailwindcss(), extensionAssets],
  resolve: { alias: { "@": resolve(root, "src") } },
  build: {
    target: "chrome111",
    cssTarget: "chrome111",
    modulePreload: { polyfill: false },
    rolldownOptions: {
      input: { popup: resolve(root, "popup.html"), rules: resolve(root, "rules.html") }
    }
  }
});
