import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const contractsRoot = resolve(root, "packages", "contracts");
const contractsRequire = createRequire(resolve(contractsRoot, "package.json"));
const webRoot = resolve(root, "apps", "web");
const webRequire = createRequire(resolve(webRoot, "package.json"));
const contractsEslintBin = resolve(
  dirname(contractsRequire.resolve("eslint")),
  "..",
  "bin",
  "eslint.js",
);
const contractsTscBin = contractsRequire.resolve("typescript/bin/tsc");
const contractsVitestBin = resolve(dirname(contractsRequire.resolve("vitest")), "vitest.mjs");
const eslintBin = resolve(dirname(webRequire.resolve("eslint")), "..", "bin", "eslint.js");
const nextBin = webRequire.resolve("next/dist/bin/next");
const tscBin = webRequire.resolve("typescript/bin/tsc");
const vitestBin = resolve(dirname(webRequire.resolve("vitest")), "vitest.mjs");
const nodeOnly = process.argv.includes("--node-only");
const checks = [
  [
    "PNG content policy behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-png-content-policy.mjs")],
  ],
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
    "Git history checker behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-git-history-check.mjs")],
  ],
  [
    "reachable Git history",
    process.execPath,
    [resolve(import.meta.dirname, "check-git-history.mjs")],
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
    "contract checker behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-contract-check.mjs")],
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
  [
    "external-link checker behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-external-links-check.mjs")],
  ],
  [
    "external-link policy",
    process.execPath,
    [resolve(import.meta.dirname, "check-external-links.mjs")],
  ],
  ["community health", process.execPath, [resolve(import.meta.dirname, "check-community.mjs")]],
  [
    "architecture contracts",
    process.execPath,
    [resolve(import.meta.dirname, "check-architecture.mjs")],
  ],
  ["versioned contracts", process.execPath, [resolve(import.meta.dirname, "check-contracts.mjs")]],
  ["configuration", process.execPath, [resolve(import.meta.dirname, "check-config.mjs")]],
  [
    "license checker behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-license-check.mjs")],
  ],
  ["dependency licenses", process.execPath, [resolve(import.meta.dirname, "check-licenses.mjs")]],
  [
    "spelling checker behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-spelling-check.mjs")],
  ],
  ["spelling", process.execPath, [resolve(import.meta.dirname, "check-spelling.mjs")]],
  ["contract lint", process.execPath, [contractsEslintBin, "."], contractsRoot],
  ["contract types", process.execPath, [contractsTscBin, "--noEmit"], contractsRoot],
  [
    "contract tests and coverage",
    process.execPath,
    [contractsVitestBin, "run", "--coverage"],
    contractsRoot,
  ],
  ["web lint", process.execPath, [eslintBin, "."], webRoot],
  ["web types", process.execPath, [tscBin, "--noEmit"], webRoot],
  ["web tests and coverage", process.execPath, [vitestBin, "run", "--coverage"], webRoot],
  [
    "web build checker behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-web-build-check.mjs")],
  ],
  ["web production build", process.execPath, [nextBin, "build"], webRoot],
  [
    "web production artifact",
    process.execPath,
    [resolve(import.meta.dirname, "check-web-build.mjs")],
  ],
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

for (const [label, command, args, cwd = root] of checks) {
  console.log(`\n==> Checking ${label}`);
  const result = spawnSync(command, args, {
    cwd,
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
