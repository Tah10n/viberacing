import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
if (!(args.length === 0 || (args.length === 2 && args[0] === "--root" && args[1]))) {
  console.error("Usage: node scripts/check-spelling.mjs [--root <directory>]");
  process.exit(2);
}

const root = args.length === 0 ? resolve(import.meta.dirname, "..") : resolve(args[1]);
const cspellEntry = fileURLToPath(import.meta.resolve("cspell/bin.mjs"));
const config = resolve(root, "cspell.json");
const result = spawnSync(
  process.execPath,
  [cspellEntry, "lint", "--config", config, "--no-progress", "--no-summary", "--no-color"],
  {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
