import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const sourceRoot = resolve(import.meta.dirname, "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "viberacing-deletion-runbook-check-"));
const runbookRelativePath = join("docs", "operations", "PROFILE_DELETION_FAILURE_RUNBOOK.md");
const fixtureRelativePaths = Object.freeze([
  join("database", "migrations", "0001_roles_schemas_and_identity.sql"),
  join("database", "migrations", "0002_authentication_passkeys_and_recovery.sql"),
  join("database", "migrations", "0006_retention_deletion_admin_and_audit.sql"),
  join("apps", "web", "lib", "pairing-database-pool.ts"),
  join("apps", "web", "lib", "enrollment-http.ts"),
  join("apps", "web", "lib", "enrollment-http.test.ts"),
  join("apps", "jobs", "src", "command.ts"),
  join("apps", "jobs", "src", "command.test.ts"),
  join("apps", "jobs", "src", "maintenance.ts"),
  join("apps", "jobs", "src", "database-pool.ts"),
  join("apps", "jobs-scheduler", "src", "schedule.ts"),
  join("apps", "jobs-scheduler", "src", "schedule.test.ts"),
  join("database", "tests", "retention_jobs.sql"),
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
    "test:jobs-scheduler:coverage":
      "corepack pnpm --filter @viberacing/jobs-scheduler run test:coverage",
    "test:jobs:coverage": "corepack pnpm --filter @viberacing/jobs run test:coverage",
    "test:jobs:postgres-integration": "node scripts/test-jobs-postgres-integration.mjs",
    "test:web:coverage": "corepack pnpm --filter @viberacing/web run test:coverage",
    "verify:release:node": "node scripts/verify.mjs --release --node-only",
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
  expectPass("valid clean-slate profile deletion failure runbook contract");

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
    `${runbookSource}\n\`\`\`text\npsql --file operator-selected.sql\n\`\`\`\n`,
  );
  expectFailure("unreviewed command block", "fenced command block inventory drifted");

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
    join("database", "migrations", "0001_roles_schemas_and_identity.sql"),
    "NEW.public_visibility := 'hidden';",
    "NEW.public_visibility := 'public';",
  );
  expectFailure("profile hide drift", "profile state migration");

  restoreValidFixture();
  mutateFixture(
    join("database", "migrations", "0002_authentication_passkeys_and_recovery.sql"),
    "CREATE FUNCTION viberacing_private.revoke_recovery_authority_on_profile_deletion()",
    "CREATE FUNCTION viberacing_private.keep_recovery_authority_on_profile_deletion()",
  );
  expectFailure("recovery authority drift", "profile recovery lock-down migration");

  restoreValidFixture();
  mutateFixture(
    join("database", "migrations", "0006_retention_deletion_admin_and_audit.sql"),
    "UPDATE viberacing_private.agent_accounts\n  SET state = 'unlinked'",
    "UPDATE viberacing_private.agent_accounts\n  SET state = 'active'",
  );
  expectFailure("AgentAccount lock-down drift", "profile deletion request migration");

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
    join("database", "migrations", "0006_retention_deletion_admin_and_audit.sql"),
    "viberacing_private.validate_maintenance_batch(p_batch_size, 10)",
    "viberacing_private.validate_maintenance_batch(p_batch_size, 100)",
  );
  expectFailure("purge batch widening", "primary profile purge migration");

  restoreValidFixture();
  mutateFixture(
    join("database", "migrations", "0006_retention_deletion_admin_and_audit.sql"),
    "season.state <> 'finalized'",
    "season.state = 'finalized'",
  );
  expectFailure("published snapshot safety drift", "primary profile purge migration");

  restoreValidFixture();
  mutateFixture(
    join("database", "migrations", "0006_retention_deletion_admin_and_audit.sql"),
    "GRANT EXECUTE ON FUNCTION viberacing_api.purge_profile_deletions(integer)\n  TO viberacing_jobs;",
    "GRANT EXECUTE ON FUNCTION viberacing_api.purge_profile_deletions(integer)\n  TO viberacing_web;",
  );
  expectFailure("purge role widening", "profile deletion grants and RLS migration");

  restoreValidFixture();
  mutateFixture(
    join("database", "migrations", "0006_retention_deletion_admin_and_audit.sql"),
    "DELETE FROM viberacing_private.profiles\n    WHERE profile_id = candidate.profile_id",
    "SELECT 1 FROM viberacing_private.profiles\n    WHERE profile_id = candidate.profile_id",
  );
  expectFailure("purge atomic settlement drift", "primary profile purge migration");

  restoreValidFixture();
  mutateFixture(
    join("database", "migrations", "0006_retention_deletion_admin_and_audit.sql"),
    "retention_expires_at = completed_at + interval '30 days'",
    "retention_expires_at = completed_at + interval '1 day'",
  );
  expectFailure("terminal retention shortening", "profile deletion grants and RLS migration");

  restoreValidFixture();
  mutateFixture(
    join("database", "migrations", "0006_retention_deletion_admin_and_audit.sql"),
    "WHERE job.state = 'completed'\n      AND job.retention_expires_at",
    "WHERE job.state = 'pending'\n      AND job.retention_expires_at",
  );
  expectFailure("terminal eligibility drift", "terminal deletion-job cleanup migration");

  restoreValidFixture();
  mutateFixture(
    join("apps", "jobs", "src", "command.ts"),
    'case "purge-profile-deletions":',
    'case "purge-profile":',
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
    join("database", "tests", "retention_jobs.sql"),
    "published non-finalized snapshot did not block profile purge",
    "published state was ignored",
  );
  expectFailure("snapshot-block evidence drift", "profile deletion PostgreSQL evidence");

  restoreValidFixture();
  mutateFixture(
    join("scripts", "test-database-integration.mjs"),
    'resolve(root, "database", "tests", "retention_jobs.sql")',
    'resolve(root, "database", "tests", "retention_unchecked.sql")',
  );
  expectFailure("database integration evidence drift", "database integration deletion evidence");

  restoreValidFixture();
  mutateFixture(
    join("scripts", "test-jobs-postgres-integration.mjs"),
    '"purge-profile-deletions"',
    '"purge-profile"',
  );
  expectFailure("Jobs integration evidence drift", "Jobs PostgreSQL deletion evidence");

  restoreValidFixture();
  writeFixture(
    runbookRelativePath,
    runbookSource.replace(
      "The deletion job has only `pending` and `completed` states",
      "The scheduler automatically retries failed deletion jobs with durable per-job backoff",
    ),
  );
  expectFailure("automatic retry claim", "missing required statement");

  console.log("Deletion failure runbook checker regressions passed (25 unsafe/drift variants).");
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
