import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import ts from "typescript";

export const runtimeScripts = ["site-rules.js", "picker.js", "content.js", "service-worker.js"] as const;
export type RuntimeScript = typeof runtimeScripts[number];

const localeSources = {
  en: new URL("../i18n/locales/en/translation.json", import.meta.url),
  zh_CN: new URL("../i18n/locales/zh-CN/translation.json", import.meta.url)
};
export const localizationSources = [new URL("../i18n/core.ts", import.meta.url), ...Object.values(localeSources)]
  .map((url) => fileURLToPath(url));
export const manifestLocales = ["en", "zh_CN"] as const;
export const manifestLocalePath = (locale: typeof manifestLocales[number]) => `_locales/${locale}/messages.json`;

export function manifestLocaleAssets() {
  return manifestLocales.map((locale) => {
    const { appName, appDescription } = JSON.parse(readFileSync(localeSources[locale], "utf8")) as
      typeof import("../i18n/locales/en/translation.json");
    return {
      fileName: manifestLocalePath(locale),
      source: JSON.stringify({ appName: { message: appName }, appDescription: { message: appDescription } }, null, 2) + "\n"
    };
  });
}

export function runtimeSource(file: RuntimeScript) {
  return fileURLToPath(new URL(`../extension/${file.replace(/\.js$/, ".ts")}`, import.meta.url));
}

// Chrome loads these files as classic scripts in multiple contexts.
function compileClassicScript(fileName: string) {
  const result = ts.transpileModule(readFileSync(fileName, "utf8"), {
    fileName,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, alwaysStrict: false }
  });
  const errors = result.diagnostics?.filter(({ category }) => category === ts.DiagnosticCategory.Error);
  if (errors?.length) {
    throw new Error(errors.map(({ messageText }) => ts.flattenDiagnosticMessageText(messageText, "\n")).join("\n"));
  }
  return result.outputText;
}

export function compileRuntimeScript(file: RuntimeScript) {
  if (file !== "picker.js") return compileClassicScript(runtimeSource(file));

  // Chrome injects the picker as a classic script together with content.js.
  const [output] = buildSync({
    entryPoints: [runtimeSource(file)],
    bundle: true,
    format: "iife",
    globalName: "selectorClickerPicker",
    target: "chrome111",
    minify: true,
    write: false
  }).outputFiles;
  return output.text;
}
