import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const sourceRoot = resolve(import.meta.dirname, "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "viberacing-restore-runbook-check-"));
const runbookSource = readFileSync(
  join(sourceRoot, "docs", "operations", "CURRENT_SNAPSHOT_RESTORE_RUNBOOK.md"),
  "utf8",
);
const databaseIntegrationSource = readFileSync(
  join(sourceRoot, "scripts", "test-database-integration.mjs"),
  "utf8",
);
const composeSource = readFileSync(join(sourceRoot, "compose.yaml"), "utf8");
const identityAssertionsSource = readFileSync(
  join(sourceRoot, "database", "tests", "identity_bootstrap_assertions.sql"),
  "utf8",
);
const runbookPath = join(
  temporaryRoot,
  "docs",
  "operations",
  "CURRENT_SNAPSHOT_RESTORE_RUNBOOK.md",
);
const rootPackagePath = join(temporaryRoot, "package.json");
const databaseIntegrationPath = join(temporaryRoot, "scripts", "test-database-integration.mjs");
const composePath = join(temporaryRoot, "compose.yaml");
const identityAssertionsPath = join(
  temporaryRoot,
  "database",
  "tests",
  "identity_bootstrap_assertions.sql",
);

const validRootPackage = Object.freeze({
  scripts: {
    "check:database": "node scripts/check-database.mjs",
    "check:restore-runbook": "node scripts/check-restore-runbook.mjs",
    "test:database-check": "node scripts/test-database-check.mjs",
    "test:database:integration": "node scripts/test-database-integration.mjs",
    "test:restore-runbook-check": "node scripts/test-restore-runbook-check.mjs",
  },
});

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function restoreValidFixture() {
  writeFileSync(runbookPath, runbookSource, "utf8");
  writeJson(rootPackagePath, validRootPackage);
  writeFileSync(databaseIntegrationPath, databaseIntegrationSource, "utf8");
  writeFileSync(composePath, composeSource, "utf8");
  writeFileSync(identityAssertionsPath, identityAssertionsSource, "utf8");
}

function scan() {
  return spawnSync(
    process.execPath,
    [join(temporaryRoot, "scripts", "check-restore-runbook.mjs")],
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
  mkdirSync(join(temporaryRoot, "docs", "operations"), { recursive: true });
  mkdirSync(join(temporaryRoot, "database", "tests"), { recursive: true });
  copyFileSync(
    join(sourceRoot, "scripts", "check-restore-runbook.mjs"),
    join(temporaryRoot, "scripts", "check-restore-runbook.mjs"),
  );

  restoreValidFixture();
  expectPass("valid current-snapshot restore runbook contract");

  rmSync(runbookPath);
  expectFailure(
    "missing runbook",
    "docs/operations/CURRENT_SNAPSHOT_RESTORE_RUNBOOK.md is missing",
  );

  restoreValidFixture();
  writeFileSync(runbookPath, runbookSource.replace("## Verify", "## Inspect"), "utf8");
  expectFailure("heading drift", "heading inventory or order drifted");

  restoreValidFixture();
  writeFileSync(runbookPath, runbookSource.replace("VR-RESTORE-20", "VR-RESTORE-19"), "utf8");
  expectFailure("control inventory drift", "control inventory or order drifted");

  restoreValidFixture();
  writeFileSync(
    runbookPath,
    runbookSource.replace(/keep routing closed, quarantine or destroy/u, "retry automatically"),
    "utf8",
  );
  expectFailure("control meaning drift", "control text drifted");

  restoreValidFixture();
  writeFileSync(
    runbookPath,
    runbookSource.replace("pnpm run check:database", "pnpm run check:db"),
    "utf8",
  );
  expectFailure("documented command drift", "command inventory or order drifted");

  restoreValidFixture();
  writeFileSync(
    runbookPath,
    [runbookSource, "```bash", "not-a-reviewed-command", "```", ""].join("\n"),
    "utf8",
  );
  expectFailure("extra fenced command", "fenced command block inventory drifted");

  restoreValidFixture();
  writeJson(rootPackagePath, {
    scripts: { ...validRootPackage.scripts, "check:database": "node scripts/unsafe.mjs" },
  });
  expectFailure("root command drift", "root package script check:database drifted");

  restoreValidFixture();
  writeFileSync(
    databaseIntegrationPath,
    databaseIntegrationSource.replace(
      "const maximumRestoreArchiveBytes = 64 * 1024 * 1024;",
      "const maximumRestoreArchiveBytes = 128 * 1024 * 1024;",
    ),
    "utf8",
  );
  expectFailure("archive budget drift", "database restore integration drifted");

  restoreValidFixture();
  writeFileSync(
    databaseIntegrationPath,
    databaseIntegrationSource.replace(
      '"first restored semantic oracle"',
      '"first restored incomplete oracle"',
    ),
    "utf8",
  );
  expectFailure(
    "restore security-check drift",
    "no longer performs three archives, two restores, and two security checks",
  );

  restoreValidFixture();
  writeFileSync(
    databaseIntegrationPath,
    databaseIntegrationSource.replace(
      '"first restore resurrected deletion state or changed revoked-device authority"',
      '"first restore skipped deletion and revoked-device authority"',
    ),
    "utf8",
  );
  expectFailure(
    "restore authority-check drift",
    "no longer performs three archives, two restores, and two security checks",
  );

  restoreValidFixture();
  writeFileSync(
    databaseIntegrationPath,
    databaseIntegrationSource.replace(
      'container("stat", ["-c", "%s", archive])',
      'container("stat", ["--format=%s", archive])',
    ),
    "utf8",
  );
  expectFailure("portable archive-size probe drift", "database restore integration drifted");

  restoreValidFixture();
  writeFileSync(
    identityAssertionsPath,
    identityAssertionsSource.replace("WHERE revision = 7", "WHERE revision = 70"),
    "utf8",
  );
  expectFailure("clean ledger oracle drift", "restored identity oracle drifted");

  restoreValidFixture();
  writeFileSync(
    identityAssertionsPath,
    identityAssertionsSource.replace("v_private_table_count <> 36", "v_private_table_count <> 35"),
    "utf8",
  );
  expectFailure("forced-RLS inventory drift", "restored identity oracle drifted");

  restoreValidFixture();
  writeFileSync(
    databaseIntegrationPath,
    databaseIntegrationSource.replace('  "--project-name",', '  "--project-name-removed",'),
    "utf8",
  );
  expectFailure("Compose project isolation drift", "database restore integration drifted");

  restoreValidFixture();
  writeFileSync(composePath, composeSource.replace("    tmpfs:", "    volumes:"), "utf8");
  expectFailure("Compose isolation drift", "postgres-test Compose isolation drifted");

  restoreValidFixture();
  writeFileSync(
    runbookPath,
    runbookSource.replace(
      /No production or real-user restore\s+is\s+authorized by this document\./u,
      "",
    ),
    "utf8",
  );
  expectFailure("production boundary removal", "missing required statement");

  restoreValidFixture();
  writeFileSync(
    runbookPath,
    runbookSource.replace("Stale-backup deletion replay is not implemented.", ""),
    "utf8",
  );
  expectFailure("deletion boundary removal", "missing required statement");

  restoreValidFixture();
  const protectedAssignment = [["PG", "PASSWORD"].join(""), "synthetic"].join("=");
  writeFileSync(runbookPath, `${runbookSource}\n${protectedAssignment}\n`, "utf8");
  expectFailure("inline protected assignment", "inline protected database assignment");

  restoreValidFixture();
  writeFileSync(runbookPath, Buffer.from([0xff]));
  expectFailure("invalid UTF-8", "canonical UTF-8 text without NUL bytes");

  console.log("Restore runbook checker regressions passed (18 unsafe/drift variants).");
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
