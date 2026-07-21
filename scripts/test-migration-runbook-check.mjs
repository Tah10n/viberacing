import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const sourceRoot = resolve(import.meta.dirname, "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "viberacing-migration-runbook-check-"));
const runbookSource = readFileSync(
  join(sourceRoot, "docs", "operations", "MIGRATION_RUNBOOK.md"),
  "utf8",
);
const runbookPath = join(temporaryRoot, "docs", "operations", "MIGRATION_RUNBOOK.md");
const rootPackagePath = join(temporaryRoot, "package.json");
const migratePackagePath = join(temporaryRoot, "apps", "migrate", "package.json");
const commandSourcePath = join(temporaryRoot, "apps", "migrate", "src", "command.ts");
const enablementSourcePath = join(temporaryRoot, "apps", "migrate", "src", "enablement.ts");

const validRootPackage = Object.freeze({
  scripts: {
    "build:migrate": "pnpm --filter @viberacing/migrate run build",
    "check:database": "node scripts/check-database.mjs",
    "check:migrate-entrypoint": "node scripts/check-migrate-entrypoint.mjs",
    "check:migration-runbook": "node scripts/check-migration-runbook.mjs",
    "test:database:integration": "node scripts/test-database-integration.mjs",
    "test:migrate:postgres-integration": "node scripts/test-migrate-postgres-integration.mjs",
    "test:migration-runbook-check": "node scripts/test-migration-runbook-check.mjs",
  },
});
const validMigratePackage = Object.freeze({ scripts: { start: "node dist/main.js" } });
const validCommandSource = 'const successMessage = "Vibe Racing migrations completed.\\n";\n';
const validEnablementSource = 'return environment.VIBERACING_MIGRATIONS_ENABLED === "true";\n';

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function restoreValidFixture() {
  writeFileSync(runbookPath, runbookSource, "utf8");
  writeJson(rootPackagePath, validRootPackage);
  writeJson(migratePackagePath, validMigratePackage);
  writeFileSync(commandSourcePath, validCommandSource, "utf8");
  writeFileSync(enablementSourcePath, validEnablementSource, "utf8");
}

function scan() {
  return spawnSync(
    process.execPath,
    [join(temporaryRoot, "scripts", "check-migration-runbook.mjs")],
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
  mkdirSync(join(temporaryRoot, "apps", "migrate", "src"), { recursive: true });
  copyFileSync(
    join(sourceRoot, "scripts", "check-migration-runbook.mjs"),
    join(temporaryRoot, "scripts", "check-migration-runbook.mjs"),
  );

  restoreValidFixture();
  expectPass("valid migration runbook contract");

  rmSync(runbookPath);
  expectFailure("missing runbook", "docs/operations/MIGRATION_RUNBOOK.md is missing");

  restoreValidFixture();
  writeFileSync(runbookPath, runbookSource.replace("## Apply", "## Execute"), "utf8");
  expectFailure("heading drift", "heading inventory or order drifted");

  restoreValidFixture();
  writeFileSync(runbookPath, runbookSource.replace("VR-MIG-18", "VR-MIG-17"), "utf8");
  expectFailure("control drift", "control inventory or order drifted");

  restoreValidFixture();
  writeFileSync(
    runbookPath,
    runbookSource.replace(/service rollback or\s+forward fix/u, "automatic retry"),
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
  writeJson(migratePackagePath, { scripts: { start: "node unsafe.js" } });
  expectFailure("migration start drift", "migration package start command drifted");

  restoreValidFixture();
  writeFileSync(commandSourcePath, 'const successMessage = "details";\n', "utf8");
  expectFailure("success output drift", "migration success output drifted");

  restoreValidFixture();
  writeFileSync(enablementSourcePath, "return Boolean(environment.flag);\n", "utf8");
  expectFailure("enablement drift", "migration enablement decision drifted");

  restoreValidFixture();
  writeFileSync(
    runbookPath,
    runbookSource.replace(/No\s+production deployment is authorized by this document\./u, ""),
    "utf8",
  );
  expectFailure("production boundary removal", "missing required statement");

  restoreValidFixture();
  const protectedAssignment = ["VIBERACING_MIGRATIONS_DATABASE_PASSWORD", "synthetic"].join("=");
  writeFileSync(runbookPath, `${runbookSource}\n${protectedAssignment}\n`, "utf8");
  expectFailure("inline protected assignment", "inline protected database assignment");

  restoreValidFixture();
  writeFileSync(runbookPath, Buffer.from([0xff]));
  expectFailure("invalid UTF-8", "canonical UTF-8 text without NUL bytes");

  console.log("Migration runbook checker regressions passed (13 unsafe/drift variants).");
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
