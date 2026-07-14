import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const checks = [
  ["public-file checker behavior", "test-public-file-check.mjs"],
  ["documentation checker behavior", "test-docs-check.mjs"],
  ["public files", "check-public-files.mjs", "--all"],
  ["documentation", "check-docs.mjs"],
];

for (const [label, script, ...args] of checks) {
  console.log(`\n==> Checking ${label}`);
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, script), ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("\nBaseline verification passed.");
