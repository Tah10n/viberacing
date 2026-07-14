import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const nodeOnly = process.argv.includes("--node-only");
const checks = [
  [
    "public-file checker behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-public-file-check.mjs")],
  ],
  [
    "public files",
    process.execPath,
    [resolve(import.meta.dirname, "check-public-files.mjs"), "--all"],
  ],
  [
    "documentation checker behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-docs-check.mjs")],
  ],
  [
    "community-health checker behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-community-check.mjs")],
  ],
  [
    "architecture checker behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-architecture-check.mjs")],
  ],
  [
    "publication-readiness checker behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-publication-check.mjs")],
  ],
  [
    "configuration checker behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-config-check.mjs")],
  ],
  ["documentation", process.execPath, [resolve(import.meta.dirname, "check-docs.mjs")]],
  ["community health", process.execPath, [resolve(import.meta.dirname, "check-community.mjs")]],
  [
    "architecture contracts",
    process.execPath,
    [resolve(import.meta.dirname, "check-architecture.mjs")],
  ],
  ["configuration", process.execPath, [resolve(import.meta.dirname, "check-config.mjs")]],
  [
    "formatting",
    process.execPath,
    [join(dirname(require.resolve("prettier")), "bin", "prettier.cjs"), "--check", "."],
  ],
  [
    "Markdown style",
    process.execPath,
    [join(dirname(require.resolve("markdownlint-cli2")), "markdownlint-cli2-bin.mjs")],
  ],
];

if (!nodeOnly) {
  checks.push([
    "Rust workspace",
    process.execPath,
    [resolve(import.meta.dirname, "check-rust.mjs")],
  ]);
}

for (const [label, command, args] of checks) {
  console.log(`\n==> Checking ${label}`);
  const result = spawnSync(command, args, {
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

console.log("\nRepository verification passed.");
