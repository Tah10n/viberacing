import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const sourceRoot = resolve(import.meta.dirname, "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "viberacing-deletion-runbook-check-"));
const runbookRelativePath = join("docs", "operations", "PROFILE_DELETION_FAILURE_RUNBOOK.md");
const fixtureRelativePaths = Object.freeze([
  join("database", "migrations", "0002_identity_capabilities.sql"),
  join("database", "migrations", "0024_profile_deletion_purge.sql"),
  join("database", "migrations", "0032_terminal_deletion_job_retention_cleanup.sql"),
  join("apps", "web", "lib", "pairing-database-pool.ts"),
  join("apps", "web", "lib", "enrollment-http.ts"),
  join("apps", "jobs", "src", "command.ts"),
  join("apps", "jobs", "src", "database-pool.ts"),
  join("apps", "jobs-scheduler", "src", "schedule.ts"),
  join("database", "tests", "profile_deletion_purge.sql"),
  join("database", "tests", "deletion_job_cleanup.sql"),
  join("scripts", "test-database-integration.mjs"),
  join("scripts", "test-jobs-postgres-integration.mjs"),
]);
const fixtureSources = new Map(
  fixtureRelativePaths.map((path) => [path, readFileSync(join(sourceRoot, path), "utf8")]),
);
const runbookSource = readFileSync(join(sourceRoot, runbookRelativePath), "utf8");
const runbookPath = join(temporaryRoot, runbookRelativePath);
const rootPackagePath = join(temporaryRoot, "package.json");

const validRootPackage = Object.freeze({
  scripts: {
    "check:database": "node scripts/check-database.mjs",
    "check:deletion-failure-runbook": "node scripts/check-deletion-failure-runbook.mjs",
    "test:database-check": "node scripts/test-database-check.mjs",
    "test:database:integration": "node scripts/test-database-integration.mjs",
    "test:deletion-failure-runbook-check": "node scripts/test-deletion-failure-runbook-check.mjs",
    "test:jobs-scheduler:coverage": "pnpm --filter @viberacing/jobs-scheduler run test:coverage",
    "test:jobs:coverage": "pnpm --filter @viberacing/jobs run test:coverage",
    "test:jobs:postgres-integration": "node scripts/test-jobs-postgres-integration.mjs",
    "test:web:coverage": "pnpm --filter @viberacing/web run test:coverage",
    "verify:node": "node scripts/verify.mjs --node-only",
  },
});

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeFixture(relativePath, content) {
  const path = join(temporaryRoot, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function restoreValidFixture() {
  writeFixture(runbookRelativePath, runbookSource);
  writeJson(rootPackagePath, validRootPackage);
  for (const [path, source] of fixtureSources) {
    writeFixture(path, source);
  }
}

function mutateFixture(relativePath, search, replacement, replaceAll = false) {
  const source = fixtureSources.get(relativePath);
  if (source === undefined || !source.includes(search)) {
    throw new Error(`fixture mutation source was not found: ${relativePath}`);
  }
  writeFixture(
    relativePath,
    replaceAll ? source.replaceAll(search, replacement) : source.replace(search, replacement),
  );
}

function scan() {
  return spawnSync(
    process.execPath,
    [join(temporaryRoot, "scripts", "check-deletion-failure-runbook.mjs")],
    {
      cwd: temporaryRoot,
      encoding: "utf8",
    },
  );
}

function expectPass(label) {
  const result = scan();
  if (result.status !== 0) {
    throw new Error(`${label} unexpectedly failed:\n${result.stderr}`);
  }
}

function expectFailure(label, expectedFinding) {
  const result = scan();
  if (result.status === 0) {
    throw new Error(`${label} unexpectedly passed`);
  }
  if (!result.stderr.includes(expectedFinding)) {
    throw new Error(`${label} did not report ${expectedFinding}:\n${result.stderr}`);
  }
}

try {
  mkdirSync(join(temporaryRoot, "scripts"), { recursive: true });
  copyFileSync(
    join(sourceRoot, "scripts", "check-deletion-failure-runbook.mjs"),
    join(temporaryRoot, "scripts", "check-deletion-failure-runbook.mjs"),
  );

  restoreValidFixture();
  expectPass("valid profile deletion failure runbook contract");

  rmSync(runbookPath);
  expectFailure(
    "missing runbook",
    "docs/operations/PROFILE_DELETION_FAILURE_RUNBOOK.md is missing",
  );

  restoreValidFixture();
  writeFixture(
    runbookRelativePath,
    runbookSource.replace("## Diagnose without mutation", "## Fix"),
  );
  expectFailure("heading drift", "heading inventory or order drifted");

  restoreValidFixture();
  writeFixture(runbookRelativePath, runbookSource.replace("VR-DELETE-26", "VR-DELETE-25"));
  expectFailure("control inventory drift", "control inventory or order drifted");

  restoreValidFixture();
  writeFixture(
    runbookRelativePath,
    runbookSource.replace("Preserve that lock-down throughout the incident", "Undo lock-down"),
  );
  expectFailure("control meaning drift", "control text drifted");

  restoreValidFixture();
  writeFixture(
    runbookRelativePath,
    runbookSource.replace("pnpm run check:database", "pnpm run repair:database"),
  );
  expectFailure("documented command drift", "command inventory or order drifted");

  restoreValidFixture();
  writeFixture(
    runbookRelativePath,
    `${runbookSource}\nRun psql with an operator-selected profile.\n`,
  );
  expectFailure("unreviewed inline command", "content digest drifted");

  restoreValidFixture();
  writeJson(rootPackagePath, {
    scripts: {
      ...validRootPackage.scripts,
      "test:jobs:postgres-integration": "node scripts/unsafe.mjs",
    },
  });
  expectFailure("root command drift", "root package script test:jobs:postgres-integration drifted");

  restoreValidFixture();
  mutateFixture(
    join("database", "migrations", "0002_identity_capabilities.sql"),
    "SET\n    state = 'deletion_pending',",
    "SET\n    state = 'active',",
  );
  expectFailure("request lock-down drift", "profile deletion request migration");

  restoreValidFixture();
  mutateFixture(
    join("apps", "web", "lib", "pairing-database-pool.ts"),
    "profile_deletion AS MATERIALIZED",
    "profile_deletion AS NOT MATERIALIZED",
  );
  expectFailure("Web atomic composition drift", "Web profile deletion database composition");

  restoreValidFixture();
  mutateFixture(
    join("apps", "web", "lib", "enrollment-http.ts"),
    "return new Response(null, { headers, status: 204 });",
    "return new Response(null, { headers, status: 202 });",
    true,
  );
  expectFailure("Web success boundary drift", "Web profile deletion HTTP boundary");

  restoreValidFixture();
  mutateFixture(
    join("database", "migrations", "0024_profile_deletion_purge.sql"),
    "p_batch_size NOT BETWEEN 1 AND 10",
    "p_batch_size NOT BETWEEN 1 AND 100",
  );
  expectFailure("purge batch widening", "primary profile purge migration");

  restoreValidFixture();
  mutateFixture(
    join("database", "migrations", "0024_profile_deletion_purge.sql"),
    "job_record.state IN ('queued', 'retry_wait')",
    "job_record.state <> 'purged'",
    true,
  );
  expectFailure("purge eligibility drift", "primary profile purge migration");

  restoreValidFixture();
  mutateFixture(
    join("database", "migrations", "0024_profile_deletion_purge.sql"),
    "TO viberacing_jobs;",
    "TO viberacing_web;",
  );
  expectFailure("purge role widening", "primary profile purge migration");

  restoreValidFixture();
  mutateFixture(
    join("database", "migrations", "0024_profile_deletion_purge.sql"),
    "DELETE FROM viberacing_private.profiles AS profile_record",
    "SELECT profile_record.profile_id FROM viberacing_private.profiles AS profile_record",
  );
  expectFailure("purge atomic settlement drift", "primary profile purge migration");

  restoreValidFixture();
  mutateFixture(
    join("database", "migrations", "0032_terminal_deletion_job_retention_cleanup.sql"),
    "INTERVAL '30 days'",
    "INTERVAL '1 day'",
  );
  expectFailure("terminal retention shortening", "terminal deletion-job cleanup migration");

  restoreValidFixture();
  mutateFixture(
    join("database", "migrations", "0032_terminal_deletion_job_retention_cleanup.sql"),
    "job_record.state = 'purged'",
    "job_record.state <> 'queued'",
    true,
  );
  expectFailure("terminal eligibility drift", "terminal deletion-job cleanup migration");

  restoreValidFixture();
  mutateFixture(
    join("apps", "jobs", "src", "command.ts"),
    'argumentsValue[0] === "purge-profile-deletions"',
    'argumentsValue[0] === "purge-profile"',
  );
  expectFailure("Jobs command drift", "Jobs deletion command parser");

  restoreValidFixture();
  mutateFixture(
    join("apps", "jobs", "src", "database-pool.ts"),
    "viberacing_api.purge_profile_deletions($1::integer)",
    "viberacing_api.purge_any_profile($1::integer)",
  );
  expectFailure("Jobs adapter drift", "Jobs deletion database adapter");

  restoreValidFixture();
  mutateFixture(
    join("apps", "jobs-scheduler", "src", "schedule.ts"),
    'kind: "purge_profile_deletions"',
    'kind: "cleanup_profile_deletions"',
  );
  expectFailure("scheduler catalog drift", "Jobs scheduler deletion catalog");

  restoreValidFixture();
  mutateFixture(
    join("database", "tests", "profile_deletion_purge.sql"),
    "state drift rolls the entire attempted purge back",
    "state drift is ignored",
  );
  expectFailure("purge rollback evidence drift", "primary profile purge SQL evidence");

  restoreValidFixture();
  mutateFixture(
    join("database", "tests", "deletion_job_cleanup.sql"),
    "recent, linked terminal evidence and non-terminal deletion authority remain untouched",
    "all deletion jobs are removed",
  );
  expectFailure(
    "terminal preservation evidence drift",
    "terminal deletion-job cleanup SQL evidence",
  );

  restoreValidFixture();
  mutateFixture(
    join("scripts", "test-database-integration.mjs"),
    "database/tests/profile_deletion_purge_concurrency_assertions.sql",
    "database/tests/profile_deletion_purge_unchecked.sql",
  );
  expectFailure("database race evidence drift", "database integration deletion evidence");

  restoreValidFixture();
  mutateFixture(
    join("scripts", "test-jobs-postgres-integration.mjs"),
    '["purge-profile-deletions"]',
    '["purge-profile"]',
    true,
  );
  expectFailure("Jobs integration evidence drift", "Jobs PostgreSQL deletion evidence");

  restoreValidFixture();
  writeFixture(
    runbookRelativePath,
    runbookSource.replace(
      /No repository-owned controller currently claims, leases, transitions, backs\s+off, or requeues a failed deletion job\./u,
      "The scheduler retries every failed deletion job automatically.",
    ),
  );
  expectFailure("automatic retry claim", "missing required statement");

  restoreValidFixture();
  writeFileSync(runbookPath, Buffer.from([0xff]));
  expectFailure("invalid UTF-8", "canonical UTF-8 text without NUL bytes");

  console.log("Deletion failure runbook checker regressions passed (25 unsafe/drift variants).");
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
