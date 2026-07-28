import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const adminRoot = resolve(root, "apps", "admin");
const adminRequire = createRequire(resolve(adminRoot, "package.json"));
const contractsRoot = resolve(root, "packages", "contracts");
const contractsRequire = createRequire(resolve(contractsRoot, "package.json"));
const ingestRoot = resolve(root, "apps", "ingest");
const ingestRequire = createRequire(resolve(ingestRoot, "package.json"));
const ingestHostRoot = resolve(root, "apps", "ingest-host");
const ingestHostRequire = createRequire(resolve(ingestHostRoot, "package.json"));
const jobsRoot = resolve(root, "apps", "jobs");
const jobsRequire = createRequire(resolve(jobsRoot, "package.json"));
const jobsSchedulerRoot = resolve(root, "apps", "jobs-scheduler");
const jobsSchedulerRequire = createRequire(resolve(jobsSchedulerRoot, "package.json"));
const migrateRoot = resolve(root, "apps", "migrate");
const migrateRequire = createRequire(resolve(migrateRoot, "package.json"));
const webRoot = resolve(root, "apps", "web");
const webRequire = createRequire(resolve(webRoot, "package.json"));
const adminEslintBin = resolve(dirname(adminRequire.resolve("eslint")), "..", "bin", "eslint.js");
const adminTscBin = adminRequire.resolve("typescript/bin/tsc");
const adminVitestBin = resolve(dirname(adminRequire.resolve("vitest")), "vitest.mjs");
const contractsEslintBin = resolve(
  dirname(contractsRequire.resolve("eslint")),
  "..",
  "bin",
  "eslint.js",
);
const contractsTscBin = contractsRequire.resolve("typescript/bin/tsc");
const contractsVitestBin = resolve(dirname(contractsRequire.resolve("vitest")), "vitest.mjs");
const ingestEslintBin = resolve(dirname(ingestRequire.resolve("eslint")), "..", "bin", "eslint.js");
const ingestTscBin = ingestRequire.resolve("typescript/bin/tsc");
const ingestVitestBin = resolve(dirname(ingestRequire.resolve("vitest")), "vitest.mjs");
const ingestHostEslintBin = resolve(
  dirname(ingestHostRequire.resolve("eslint")),
  "..",
  "bin",
  "eslint.js",
);
const ingestHostTscBin = ingestHostRequire.resolve("typescript/bin/tsc");
const ingestHostVitestBin = resolve(dirname(ingestHostRequire.resolve("vitest")), "vitest.mjs");
const jobsEslintBin = resolve(dirname(jobsRequire.resolve("eslint")), "..", "bin", "eslint.js");
const jobsTscBin = jobsRequire.resolve("typescript/bin/tsc");
const jobsVitestBin = resolve(dirname(jobsRequire.resolve("vitest")), "vitest.mjs");
const jobsSchedulerEslintBin = resolve(
  dirname(jobsSchedulerRequire.resolve("eslint")),
  "..",
  "bin",
  "eslint.js",
);
const jobsSchedulerTscBin = jobsSchedulerRequire.resolve("typescript/bin/tsc");
const jobsSchedulerVitestBin = resolve(
  dirname(jobsSchedulerRequire.resolve("vitest")),
  "vitest.mjs",
);
const migrateEslintBin = resolve(
  dirname(migrateRequire.resolve("eslint")),
  "..",
  "bin",
  "eslint.js",
);
const migrateTscBin = migrateRequire.resolve("typescript/bin/tsc");
const migrateVitestBin = resolve(dirname(migrateRequire.resolve("vitest")), "vitest.mjs");
const eslintBin = resolve(dirname(webRequire.resolve("eslint")), "..", "bin", "eslint.js");
const nextBin = webRequire.resolve("next/dist/bin/next");
const tscBin = webRequire.resolve("typescript/bin/tsc");
const vitestBin = resolve(dirname(webRequire.resolve("vitest")), "vitest.mjs");
const nodeOnly = process.argv.includes("--node-only");
const releaseMode = process.argv.includes("--release");
const historyRefArguments = process.argv
  .slice(2)
  .filter((argument) => argument.startsWith("--history-ref="));
const historyRef =
  historyRefArguments.length === 1 ? historyRefArguments[0].slice("--history-ref=".length) : null;
const unknownArguments = process.argv
  .slice(2)
  .filter(
    (argument) =>
      argument !== "--node-only" &&
      argument !== "--release" &&
      !argument.startsWith("--history-ref="),
  );
if (
  unknownArguments.length > 0 ||
  historyRefArguments.length > 1 ||
  (historyRefArguments.length === 1 && historyRef.length === 0)
) {
  console.error(
    unknownArguments.length > 0
      ? `Unknown verification argument: ${unknownArguments[0]}`
      : "Verification accepts exactly one non-empty --history-ref=<revision> argument.",
  );
  process.exit(2);
}

const corepackEntrypoint = [
  resolve(dirname(process.execPath), "node_modules", "corepack", "dist", "corepack.js"),
  resolve(
    dirname(process.execPath),
    "..",
    "lib",
    "node_modules",
    "corepack",
    "dist",
    "corepack.js",
  ),
].find((path) => existsSync(path));
if (corepackEntrypoint === undefined) {
  console.error("Corepack is required to run workspace verification with the pinned pnpm version.");
  process.exit(1);
}
const coreChecks = [
  [
    "public-file boundary",
    process.execPath,
    [resolve(import.meta.dirname, "check-public-files.mjs"), "--all"],
  ],
  ["configuration boundary", process.execPath, [resolve(import.meta.dirname, "check-config.mjs")]],
  ["versioned contracts", process.execPath, [resolve(import.meta.dirname, "check-contracts.mjs")]],
  ["database migrations", process.execPath, [resolve(import.meta.dirname, "check-database.mjs")]],
  [
    "workspace lint",
    process.execPath,
    [
      corepackEntrypoint,
      "pnpm",
      "--recursive",
      "--workspace-concurrency=4",
      "--if-present",
      "run",
      "lint",
    ],
  ],
  [
    "workspace types",
    process.execPath,
    [
      corepackEntrypoint,
      "pnpm",
      "--recursive",
      "--workspace-concurrency=4",
      "--if-present",
      "run",
      "typecheck",
    ],
  ],
  [
    "workspace unit tests",
    process.execPath,
    [
      corepackEntrypoint,
      "pnpm",
      "--recursive",
      "--workspace-concurrency=4",
      "--if-present",
      "run",
      "test",
    ],
  ],
];

const releaseChecks = [
  [
    "agent-skill checker behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-agent-skills-check.mjs")],
  ],
  ["agent skills", process.execPath, [resolve(import.meta.dirname, "check-agent-skills.mjs")]],
  [
    "PNG content policy behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-png-content-policy.mjs")],
  ],
  [
    "Phase 1 visual-baseline capture guardrails",
    process.execPath,
    [resolve(import.meta.dirname, "test-phase1-visual-baseline-capture.mjs")],
  ],
  [
    "Phase 1 visual-baseline checker behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-phase1-visual-baselines-check.mjs")],
  ],
  [
    "Phase 1 visual baselines",
    process.execPath,
    [resolve(import.meta.dirname, "check-phase1-visual-baselines.mjs")],
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
    [
      resolve(import.meta.dirname, "check-git-history.mjs"),
      ...(historyRef === null ? [] : ["--ref", historyRef]),
    ],
  ],
  [
    "documentation checker behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-docs-check.mjs")],
  ],
  [
    "documentation currentness checker behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-documentation-currentness-check.mjs")],
  ],
  [
    "migration runbook checker behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-migration-runbook-check.mjs")],
  ],
  [
    "restore runbook checker behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-restore-runbook-check.mjs")],
  ],
  [
    "containment runbook checker behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-containment-runbook-check.mjs")],
  ],
  [
    "profile deletion failure runbook checker behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-deletion-failure-runbook-check.mjs")],
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
    "Codex compatibility checker behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-codex-compatibility-check.mjs")],
  ],
  [
    "contract checker behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-contract-check.mjs")],
  ],
  [
    "database checker behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-database-check.mjs")],
  ],
  [
    "Web query-plan evidence behavior",
    process.execPath,
    [resolve(import.meta.dirname, "test-web-query-plan-evidence.mjs")],
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
    "documentation currentness",
    process.execPath,
    [resolve(import.meta.dirname, "check-documentation-currentness.mjs")],
  ],
  [
    "migration runbook",
    process.execPath,
    [resolve(import.meta.dirname, "check-migration-runbook.mjs")],
  ],
  [
    "restore runbook",
    process.execPath,
    [resolve(import.meta.dirname, "check-restore-runbook.mjs")],
  ],
  [
    "containment runbook",
    process.execPath,
    [resolve(import.meta.dirname, "check-containment-runbook.mjs")],
  ],
  [
    "profile deletion failure runbook",
    process.execPath,
    [resolve(import.meta.dirname, "check-deletion-failure-runbook.mjs")],
  ],
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
  [
    "Codex compatibility evidence",
    process.execPath,
    [resolve(import.meta.dirname, "check-codex-compatibility.mjs")],
  ],
  ["versioned contracts", process.execPath, [resolve(import.meta.dirname, "check-contracts.mjs")]],
  ["database migrations", process.execPath, [resolve(import.meta.dirname, "check-database.mjs")]],
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
  ["Admin lint", process.execPath, [adminEslintBin, "."], adminRoot],
  ["Admin types", process.execPath, [adminTscBin, "--noEmit"], adminRoot],
  ["Admin tests and coverage", process.execPath, [adminVitestBin, "run", "--coverage"], adminRoot],
  [
    "Admin production build",
    process.execPath,
    [adminTscBin, "--project", "tsconfig.build.json"],
    adminRoot,
  ],
  ["contract lint", process.execPath, [contractsEslintBin, "."], contractsRoot],
  ["contract types", process.execPath, [contractsTscBin, "--noEmit"], contractsRoot],
  [
    "contract tests and coverage",
    process.execPath,
    [contractsVitestBin, "run", "--coverage"],
    contractsRoot,
  ],
  [
    "contract production build",
    process.execPath,
    [contractsTscBin, "--project", "tsconfig.build.json"],
    contractsRoot,
  ],
  ["Ingest lint", process.execPath, [ingestEslintBin, "."], ingestRoot],
  ["Ingest types", process.execPath, [ingestTscBin, "--noEmit"], ingestRoot],
  [
    "Ingest tests and coverage",
    process.execPath,
    [ingestVitestBin, "run", "--coverage"],
    ingestRoot,
  ],
  [
    "Ingest production build",
    process.execPath,
    [ingestTscBin, "--project", "tsconfig.build.json"],
    ingestRoot,
  ],
  [
    "Cloudflare edge lint",
    process.execPath,
    [corepackEntrypoint, "pnpm", "--filter", "@viberacing/edge", "run", "lint"],
  ],
  [
    "Cloudflare edge tests",
    process.execPath,
    [corepackEntrypoint, "pnpm", "--filter", "@viberacing/edge", "run", "test"],
  ],
  [
    "Cloudflare edge and Ingest verifier compatibility",
    process.execPath,
    [resolve(import.meta.dirname, "test-edge-ingest-compatibility.mjs")],
  ],
  ["Ingest host lint", process.execPath, [ingestHostEslintBin, "."], ingestHostRoot],
  ["Ingest host types", process.execPath, [ingestHostTscBin, "--noEmit"], ingestHostRoot],
  [
    "Ingest host tests and coverage",
    process.execPath,
    [ingestHostVitestBin, "run", "--coverage"],
    ingestHostRoot,
  ],
  [
    "Ingest host production build",
    process.execPath,
    [ingestHostTscBin, "--project", "tsconfig.build.json"],
    ingestHostRoot,
  ],
  [
    "Ingest host built entry point",
    process.execPath,
    [resolve(import.meta.dirname, "check-ingest-host-entrypoint.mjs")],
  ],
  ["Jobs lint", process.execPath, [jobsEslintBin, "."], jobsRoot],
  ["Jobs types", process.execPath, [jobsTscBin, "--noEmit"], jobsRoot],
  ["Jobs tests and coverage", process.execPath, [jobsVitestBin, "run", "--coverage"], jobsRoot],
  [
    "Jobs production build",
    process.execPath,
    [jobsTscBin, "--project", "tsconfig.build.json"],
    jobsRoot,
  ],
  ["Jobs scheduler lint", process.execPath, [jobsSchedulerEslintBin, "."], jobsSchedulerRoot],
  ["Jobs scheduler types", process.execPath, [jobsSchedulerTscBin, "--noEmit"], jobsSchedulerRoot],
  [
    "Jobs scheduler tests and coverage",
    process.execPath,
    [jobsSchedulerVitestBin, "run", "--coverage"],
    jobsSchedulerRoot,
  ],
  [
    "Jobs scheduler production build",
    process.execPath,
    [jobsSchedulerTscBin, "--project", "tsconfig.build.json"],
    jobsSchedulerRoot,
  ],
  [
    "Jobs scheduler built entry point",
    process.execPath,
    [resolve(import.meta.dirname, "check-jobs-scheduler-entrypoint.mjs")],
  ],
  ["migration runner lint", process.execPath, [migrateEslintBin, "."], migrateRoot],
  ["migration runner types", process.execPath, [migrateTscBin, "--noEmit"], migrateRoot],
  [
    "migration runner tests and coverage",
    process.execPath,
    [migrateVitestBin, "run", "--coverage"],
    migrateRoot,
  ],
  [
    "migration runner production build",
    process.execPath,
    [migrateTscBin, "--project", "tsconfig.build.json"],
    migrateRoot,
  ],
  [
    "migration runner built entry point",
    process.execPath,
    [resolve(import.meta.dirname, "check-migrate-entrypoint.mjs")],
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
    "web standalone runtime",
    process.execPath,
    [resolve(import.meta.dirname, "test-web-standalone.mjs")],
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

const checks = releaseMode ? releaseChecks : coreChecks;

if (!nodeOnly) {
  checks.push([
    "Rust workspace",
    process.execPath,
    [resolve(import.meta.dirname, "check-rust.mjs")],
  ]);
  if (releaseMode && process.platform === "win32" && process.arch === "x64") {
    checks.push(
      [
        "Windows release-profile connector build",
        "cargo",
        [
          "build",
          "--release",
          "--locked",
          "--target-dir",
          "target",
          "--package",
          "viberacing-connector",
          "--bin",
          "viberacing-connector",
        ],
      ],
      [
        "Windows portable connector lifecycle",
        process.execPath,
        [resolve(import.meta.dirname, "test-connector-windows-portable.mjs")],
      ],
    );
  }
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

console.log(`\nRepository ${releaseMode ? "release" : "core"} verification passed.`);
