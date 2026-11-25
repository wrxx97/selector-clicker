import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const directory = new URL(".", import.meta.url);
const files = readdirSync(directory, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
  .map((entry) => join(entry.parentPath, entry.name))
  .sort();

if (!files.length) throw new Error("No TypeScript test files found.");

const run = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { stdio: "inherit" });
if (run.error) throw run.error;
process.exitCode = run.status ?? 1;
