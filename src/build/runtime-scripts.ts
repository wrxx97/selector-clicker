import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const runtimeScripts = ["site-rules.js", "picker.js", "content.js", "service-worker.js"] as const;
export type RuntimeScript = typeof runtimeScripts[number];

export function runtimeSource(file: RuntimeScript) {
  return fileURLToPath(new URL(`../extension/${file.replace(/\.js$/, ".ts")}`, import.meta.url));
}

// Chrome loads these files as classic scripts in multiple contexts.
export function compileRuntimeScript(file: RuntimeScript) {
  const fileName = runtimeSource(file);
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
