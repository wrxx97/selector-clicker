import assert from "node:assert/strict";
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";
import { zipSync } from "fflate";
import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { manifestLocalePath, manifestLocales, runtimeScripts } from "./runtime-scripts.ts";

const project = resolve(import.meta.dirname, "../..");
const dist = resolve(project, "dist");

function pageAssets(html: string, page: string) {
  const files = new Set<string>();
  function visit(node: DefaultTreeAdapterTypes.Node) {
    if ("tagName" in node) {
      const attribute = node.tagName === "script" ? "src" : node.tagName === "link" ? "href" : null;
      const asset = node.attrs.find(({ name }) => name === attribute)?.value;
      if (node.tagName === "script" && !asset) throw new Error("Inline scripts are prohibited in extension pages.");
      if (asset) {
        if (/^(?:[a-z][a-z0-9+.-]*:|[\\/])/i.test(asset)) {
          throw new Error(`Extension resources must use relative paths: ${asset}`);
        }
        files.add(posix.join(posix.dirname(page), asset.split(/[?#]/, 1)[0]));
      }
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  }
  visit(parse(html));
  return files;
}

async function collectFiles() {
  const manifest = JSON.parse(await readFile(resolve(dist, "manifest.json"), "utf8").catch(() => {
    throw new Error("The extension build is missing. Run pnpm run build first.");
  })) as chrome.runtime.ManifestV3;
  const source = JSON.parse(await readFile(resolve(project, "manifest.json"), "utf8"));
  assert.deepEqual(manifest, source, "The extension build is out of date. Run pnpm run build again.");
  const popup = manifest.action?.default_popup;
  const options = manifest.options_ui?.page;
  const worker = manifest.background?.service_worker;
  if (!popup || !options || !worker) throw new Error("The manifest is missing an extension entry.");

  const files = new Set([
    "manifest.json", "LICENSE", "NOTICE", "THIRD_PARTY_LICENSES.md",
    ...manifestLocales.map(manifestLocalePath), ...runtimeScripts, popup, options, worker
  ]);
  for (const icon of Object.values(manifest.icons ?? {})) files.add(icon);
  const actionIcons = manifest.action?.default_icon;
  if (typeof actionIcons === "string") files.add(actionIcons);
  else for (const icon of Object.values(actionIcons ?? {})) files.add(icon);

  for (const page of [popup, options]) {
    for (const asset of pageAssets(await readFile(resolve(dist, page), "utf8"), page)) files.add(asset);
  }
  for (const entry of await readdir(resolve(dist, "icons"), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".png")) files.add("icons/" + entry.name);
  }
  for (const entry of await readdir(resolve(dist, "assets"), { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) files.add(relative(dist, resolve(entry.parentPath, entry.name)).split(sep).join("/"));
  }
  return [...files].sort();
}

async function main() {
  const output = process.argv[2];
  if (!output) throw new Error("Usage: pnpm run package <extension.zip>");
  const directory = await realpath(dist).catch(() => {
    throw new Error("The extension build is missing. Run pnpm run build first.");
  });
  const archive: Record<string, Uint8Array> = Object.create(null);
  for (const file of await collectFiles()) {
    const path = await realpath(resolve(directory, file));
    const subpath = relative(directory, path);
    if (!subpath || subpath === ".." || subpath.startsWith(".." + sep) || isAbsolute(subpath) || !(await stat(path)).isFile()) {
      throw new Error(`Invalid extension resource: ${file}`);
    }
    archive[file] = await readFile(path);
  }
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, zipSync(archive, { level: 6 }));
  console.log(`Created ${output}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
