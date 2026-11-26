import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { compileRuntimeScript, localizationSources, manifestLocaleAssets, runtimeScripts, runtimeSource } from "./runtime-scripts.ts";

const project = resolve(import.meta.dirname, "../..");
const source = resolve(project, "src");
const licenseReport = "THIRD_PARTY_LICENSES.md";
const additionalLicenses = [
  ["Tailwind CSS", "node_modules/tailwindcss/LICENSE"],
  ["tw-animate-css", "node_modules/tw-animate-css/LICENSE"],
  // The published npm package omits its upstream license file.
  ["react-remove-scroll-bar", "src/build/licenses/react-remove-scroll-bar.txt"]
];
const assets = [
  "manifest.json", "LICENSE", "NOTICE",
  ...[16, 24, 32, 48, 128].map((size) => `icons/icon-${size}.png`),
  ...["lavender", "rose", "amber", "night"].flatMap((theme) =>
    [16, 24, 32].map((size) => `icons/icon-${theme}-${size}.png`))
];

const extensionAssets: Plugin = {
  name: "selector-clicker-extension-assets",
  buildStart() {
    for (const file of assets) this.addWatchFile(resolve(project, file));
    for (const file of runtimeScripts) this.addWatchFile(runtimeSource(file));
    for (const file of localizationSources) this.addWatchFile(file);
    for (const [, file] of additionalLicenses) this.addWatchFile(resolve(project, file));
  },
  async generateBundle() {
    for (const file of assets) {
      this.emitFile({ type: "asset", fileName: file, source: await readFile(resolve(project, file)) });
    }
    for (const asset of manifestLocaleAssets()) this.emitFile({ type: "asset", ...asset });
    for (const file of runtimeScripts) {
      this.emitFile({ type: "asset", fileName: file, source: compileRuntimeScript(file) });
    }
  },
  transformIndexHtml() {
    return [{ tag: "script", attrs: { src: "./site-rules.js" }, injectTo: "head-prepend" }];
  }
};

const dependencyLicenses: Plugin = {
  name: "selector-clicker-dependency-licenses",
  generateBundle: {
    order: "post",
    async handler(_options, bundle) {
      const report = bundle[licenseReport];
      if (report?.type !== "asset" || typeof report.source !== "string") {
        throw new Error("Could not find the generated dependency license report.");
      }
      const additional = await Promise.all(additionalLicenses.map(async ([name, file]) =>
        `## ${name}\n\n${(await readFile(resolve(project, file), "utf8")).trim()}\n`
      ));
      report.source += "\n" + additional.join("\n");
    }
  }
};

export default defineConfig({
  root: source,
  base: "./",
  publicDir: false,
  plugins: [react(), tailwindcss(), extensionAssets, dependencyLicenses],
  resolve: { alias: { "@": source } },
  build: {
    outDir: resolve(project, "dist"),
    emptyOutDir: true,
    target: "chrome111",
    license: { fileName: licenseReport },
    cssTarget: "chrome111",
    modulePreload: { polyfill: false },
    rolldownOptions: {
      input: { popup: resolve(source, "popup.html"), rules: resolve(source, "rules.html") }
    }
  }
});
