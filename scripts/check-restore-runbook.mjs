import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const runbookPath = resolve(root, "docs", "operations", "CURRENT_SNAPSHOT_RESTORE_RUNBOOK.md");
const rootPackagePath = resolve(root, "package.json");
const databaseIntegrationPath = resolve(root, "scripts", "test-database-integration.mjs");
const identityAssertionsPath = resolve(
  root,
  "database",
  "tests",
  "identity_bootstrap_assertions.sql",
);
const composePath = resolve(root, "compose.yaml");
const maximumRunbookBytes = 32 * 1024;
const failures = [];

const expectedHeadings = Object.freeze([
  "# Isolated current-snapshot restore rehearsal runbook",
  "## Scope and evidence boundary",
  "## Authority and prerequisites",
  "## Preflight",
  "## Local evidence",
  "## Isolate and restore",
  "## Verify",
  "## Stale-backup and deletion boundary",
  "## Failure and incident handoff",
  "## Prohibited actions",
]);
const expectedControls = Object.freeze([
  [
    "VR-RESTORE-01",
    "Pin the exact reviewed commit, immutable service artifacts, and backup workflow identity in the protected change record.",
  ],
  [
    "VR-RESTORE-02",
    "Assign backup, restore, database, privacy/deletion, and incident owners before the rehearsal window opens.",
  ],
  [
    "VR-RESTORE-03",
    "Prove the target is isolated, receives no public traffic, and shares no runtime credential or storage with another environment.",
  ],
  [
    "VR-RESTORE-04",
    "Classify the selected archive as a current synthetic snapshot and record its creation, retention, encryption, and expiry evidence privately.",
  ],
  [
    "VR-RESTORE-05",
    "Prove the restore controller can select only the approved archive and exact empty target through protected configuration.",
  ],
  [
    "VR-RESTORE-06",
    "Verify the pinned migration ledger, service compatibility matrix, database version, DNS name, trust material, and TLS policy privately.",
  ],
  [
    "VR-RESTORE-07",
    "Confirm protected monitoring, an append-only operator record, containment, and target-destruction authority are available before execution.",
  ],
  [
    "VR-RESTORE-08",
    "Record an explicit go or no-go decision after every repository-owned local gate below succeeds.",
  ],
  [
    "VR-RESTORE-09",
    "Open the protected change record and reconfirm the pinned archive, empty target, owners, controller identity, and window.",
  ],
  [
    "VR-RESTORE-10",
    "Hold public routing and every Web, Ingest, Jobs, scheduler, and migration process disabled for the isolated target.",
  ],
  [
    "VR-RESTORE-11",
    "Invoke the reviewed deployment-owned restore workflow once with no interactive archive, database, role, SQL, or filesystem override.",
  ],
  [
    "VR-RESTORE-12",
    "Keep the restored target isolated and prevent automatic migration, job, application, or traffic startup after database-tool settlement.",
  ],
  [
    "VR-RESTORE-13",
    "Remove restore authority after settlement and prove no controller, database session, temporary credential, or untracked archive copy remains.",
  ],
  [
    "VR-RESTORE-14",
    "Require the protected ledger oracle to equal the pinned contiguous migration manifest exactly before any service smoke.",
  ],
  [
    "VR-RESTORE-15",
    "Verify database ownership, forced RLS, runtime-role grants and denials, TLS, connection cleanup, and absence of unexpected schemas or extensions.",
  ],
  [
    "VR-RESTORE-16",
    "Compare protected canonical schema and data digest/length oracles with the approved source without exposing either dump.",
  ],
  [
    "VR-RESTORE-17",
    "Run the approved candidate and deployed-service read/write denial matrix while routing remains closed.",
  ],
  [
    "VR-RESTORE-18",
    "Record actual duration and residual risk without claiming an RPO, RTO, capacity, or recovery objective that this rehearsal did not prove.",
  ],
  [
    "VR-RESTORE-19",
    "Stop before service startup whenever the archive could predate a profile deletion or the protected deletion-marker oracle is absent, incomplete, or unverified.",
  ],
  [
    "VR-RESTORE-20",
    "On any failure, keep routing closed, quarantine or destroy the restored target, remove temporary authority, and hand the protected record to the assigned incident owner.",
  ],
]);
const expectedControlIds = Object.freeze(expectedControls.map(([id]) => id));
const expectedCommands = Object.freeze([
  "pnpm run check:restore-runbook",
  "pnpm run test:database-check",
  "pnpm run check:database",
  "pnpm run test:database:integration",
]);
const expectedRootScripts = Object.freeze({
  "check:database": "node scripts/check-database.mjs",
  "check:restore-runbook": "node scripts/check-restore-runbook.mjs",
  "test:database-check": "node scripts/test-database-check.mjs",
  "test:database:integration": "node scripts/test-database-integration.mjs",
  "test:restore-runbook-check": "node scripts/test-restore-runbook-check.mjs",
});
const protectedPostgresVariableNames = [
  "HOST",
  "PORT",
  "DATABASE",
  "USER",
  "PASSWORD",
  ["PASS", "FILE"].join(""),
  ["SSL", "MODE"].join(""),
  ["SSL", "ROOT", "CERT"].join(""),
  ["SSL", "CERT"].join(""),
  ["SSL", "KEY"].join(""),
]
  .map((suffix) => `PG${suffix}`)
  .join("|");
const protectedDatabaseAssignmentPattern = new RegExp(
  `(?:DATABASE_URL|${protectedPostgresVariableNames}|VIBERACING_(?:WEB|INGEST|JOBS|MIGRATIONS)_DATABASE_(?:CA|HOST|NAME|PASSWORD|PORT|USER))\\s*=\\s*\\S+`,
  "iu",
);
const requiredStatements = Object.freeze([
  "No repository command restores a shared staging or production database.",
  "No production or real-user restore is authorized by this document.",
  "The local archive budget is 64 MiB",
  "each canonical schema or data buffer is bounded to 32 MiB",
  "the exact seven-row clean migration ledger",
  "all 36 private tables with forced RLS",
  "three bounded archives and two current-snapshot restores",
  "the same finalized snapshot identity and payload",
  "one completed synthetic deletion whose profile remains absent",
  "one independent revoked device whose authority remains revoked",
  "That is exact current-snapshot non-resurrection evidence only.",
  "Dump content is never emitted; bounded buffers are overwritten after hashing.",
  "A successful local result is prerequisite evidence only.",
  "Stale-backup deletion replay is not implemented.",
  "Do not run raw `pg_dump`, `pg_restore`, a database-drop client, or `psql` from this public runbook.",
]);
const requiredIntegrationFragments = Object.freeze([
  "const projectName = `vr-dbtest-${process.pid}`;\nconst composePrefix = [",
  '  "--project-name",\n  projectName,\n  "--profile",\n  "test",',
  'const archiveOne = "/tmp/viberacing-clean-bootstrap-one.dump";',
  'const archiveTwo = "/tmp/viberacing-clean-bootstrap-two.dump";',
  'const archiveThree = "/tmp/viberacing-clean-bootstrap-three.dump";',
  "const maximumToolOutput = 32 * 1024 * 1024;",
  "const maximumRestoreArchiveBytes = 64 * 1024 * 1024;",
  '"--format=custom"',
  '"--create"',
  '"--serializable-deferrable"',
  '"--lock-wait-timeout=5s"',
  'container("stat", ["-c", "%s", archive])',
  "Number.isSafeInteger(size) && size <= maximumRestoreArchiveBytes",
  '"--exit-on-error"',
  "function canonicalArchiveDigest(archive, section)",
  "function semanticSchemaDigest()",
  "function finalizedSnapshotEvidence()",
  "function seedRestoreSecurityState()",
  "function restoreSecurityEvidence()",
  "function createArchive(database, archive)",
  "function restoreArchive(archive)",
  "stdout.fill(0);",
  "createArchive(databaseName, archiveOne);",
  "restoreArchive(archiveOne);",
  '"first restored semantic oracle"',
  '"first restore changed the finalized snapshot"',
  '"first restore resurrected deletion state or changed revoked-device authority"',
  "createArchive(databaseName, archiveTwo);",
  '"first restored data archive drifted"',
  "restoreArchive(archiveTwo);",
  '"second restored semantic oracle"',
  '"second restore changed the finalized snapshot"',
  '"second restore resurrected deletion state or changed revoked-device authority"',
  '"normalized restored schema drifted across generations"',
  "createArchive(databaseName, archiveThree);",
  '"second restored data archive drifted"',
  'docker([...composePrefix, "down", "--volumes", "--remove-orphans"]',
  'docker([...composePrefix, "up", "--detach", "--wait", "postgres-test"]',
  "two current-snapshot restores preserving terminal deletion and revoked-device state with byte-stable",
]);
const requiredIdentityAssertionFragments = Object.freeze([
  "WHERE revision = 7\n      AND name = 'car_recipes'",
  "FROM viberacing_private.schema_migrations",
  ") <> 7 THEN",
  "v_private_table_count <> 36",
  "WHERE provider_code = 'codex'\n      AND state = 'recognized'",
  "AND NOT enabled_for_new_accounts",
  "'private tables are not exactly force-RLS protected'",
]);

function fail(message) {
  failures.push(message);
}

function readJson(path, label) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      fail(`${label} must be a JSON object`);
      return undefined;
    }
    return value;
  } catch {
    fail(`${label} could not be read as JSON`);
    return undefined;
  }
}

let runbook;
if (!existsSync(runbookPath)) {
  fail("docs/operations/CURRENT_SNAPSHOT_RESTORE_RUNBOOK.md is missing");
} else {
  const metadata = lstatSync(runbookPath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    fail("restore runbook must be one regular non-symlink file");
  } else {
    const bytes = readFileSync(runbookPath);
    if (bytes.length === 0 || bytes.length > maximumRunbookBytes) {
      fail(`restore runbook must be between 1 and ${maximumRunbookBytes} bytes`);
    }
    runbook = bytes.toString("utf8");
    if (!Buffer.from(runbook, "utf8").equals(bytes) || runbook.includes("\0")) {
      fail("restore runbook must be canonical UTF-8 text without NUL bytes");
    }
  }
}

if (runbook !== undefined) {
  const normalizedRunbook = runbook.replace(/\s+/gu, " ");
  const headings = [...runbook.matchAll(/^(#{1,6} .+)$/gmu)].map((match) => match[1]);
  if (JSON.stringify(headings) !== JSON.stringify(expectedHeadings)) {
    fail("restore runbook heading inventory or order drifted");
  }

  const controlIds = [...runbook.matchAll(/^- \[ \] (VR-RESTORE-\d{2}):/gmu)].map(
    (match) => match[1],
  );
  if (JSON.stringify(controlIds) !== JSON.stringify(expectedControlIds)) {
    fail("restore runbook control inventory or order drifted");
  }
  const lines = runbook.split(/\r?\n/u);
  const observedControls = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^- \[ \] (VR-RESTORE-\d{2}):\s+(.+)$/u.exec(lines[index]);
    if (match === null) {
      continue;
    }
    const textParts = [match[2]];
    while (index + 1 < lines.length && /^ {2,}\S/u.test(lines[index + 1])) {
      index += 1;
      textParts.push(lines[index].trim());
    }
    observedControls.push([match[1], textParts.join(" ")]);
  }
  if (JSON.stringify(observedControls) !== JSON.stringify(expectedControls)) {
    fail("restore runbook control text drifted");
  }

  const fenceMarkers = [...runbook.matchAll(/^```.*$/gmu)].map((match) => match[0]);
  if (JSON.stringify(fenceMarkers) !== JSON.stringify(["```text", "```"])) {
    fail("restore runbook fenced command block inventory drifted");
  }
  const commands = [...runbook.matchAll(/```text\r?\n([\s\S]*?)```/gu)].flatMap((match) =>
    match[1]
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== ""),
  );
  if (JSON.stringify(commands) !== JSON.stringify(expectedCommands)) {
    fail("restore runbook command inventory or order drifted");
  }

  for (const statement of requiredStatements) {
    if (!normalizedRunbook.includes(statement)) {
      fail(`restore runbook is missing required statement: ${statement}`);
    }
  }

  if (protectedDatabaseAssignmentPattern.test(runbook)) {
    fail("restore runbook must not contain an inline protected database assignment");
  }
}

const rootPackage = readJson(rootPackagePath, "root package manifest");
if (rootPackage !== undefined) {
  const scripts = rootPackage.scripts;
  if (scripts === null || typeof scripts !== "object" || Array.isArray(scripts)) {
    fail("root package scripts must be an object");
  } else {
    for (const [name, expected] of Object.entries(expectedRootScripts)) {
      if (scripts[name] !== expected) {
        fail(`root package script ${name} drifted from the restore runbook contract`);
      }
    }
  }
}

try {
  const source = readFileSync(databaseIntegrationPath, "utf8");
  const normalizedSource = source.replace(/\r\n/gu, "\n");
  for (const fragment of requiredIntegrationFragments) {
    if (!normalizedSource.includes(fragment)) {
      fail(`database restore integration drifted from the runbook contract: ${fragment}`);
    }
  }
  const restoreCalls = [
    ...normalizedSource.matchAll(/^\s*restoreArchive\(archive(?:One|Two)\);$/gmu),
  ].length;
  const archiveCalls = [
    ...normalizedSource.matchAll(
      /^\s*createArchive\(databaseName, archive(?:One|Two|Three)\);$/gmu,
    ),
  ].length;
  const restoredSecurityChecks = [
    ...normalizedSource.matchAll(/"(?:first|second) restored semantic oracle"/gu),
  ].length;
  const restoredAuthorityChecks = [
    ...normalizedSource.matchAll(
      /"(?:first|second) restore resurrected deletion state or changed revoked-device authority"/gu,
    ),
  ].length;
  if (
    restoreCalls !== 2 ||
    archiveCalls !== 3 ||
    restoredSecurityChecks !== 2 ||
    restoredAuthorityChecks !== 2
  ) {
    fail(
      "database restore integration no longer performs three archives, two restores, and two security checks",
    );
  }
} catch {
  fail("database restore integration source could not be read");
}

try {
  const identityAssertions = readFileSync(identityAssertionsPath, "utf8").replace(/\r\n/gu, "\n");
  for (const fragment of requiredIdentityAssertionFragments) {
    if (!identityAssertions.includes(fragment)) {
      fail(`restored identity oracle drifted from the runbook contract: ${fragment}`);
    }
  }
} catch {
  fail("restored identity oracle source could not be read");
}

try {
  const compose = readFileSync(composePath, "utf8");
  const testService = compose.match(
    /^  postgres-test:\r?\n([\s\S]*?)(?=^  [a-z0-9][a-z0-9-]*:\r?$|^volumes:\r?$)/mu,
  )?.[0];
  if (testService === undefined) {
    fail("postgres-test Compose service could not be read");
  } else if (
    !testService.includes('profiles: ["test"]') ||
    !testService.includes("tmpfs:") ||
    !testService.includes("/var/lib/postgresql:rw,noexec,nosuid,nodev") ||
    /^    (?:container_name|external_links|links|network_mode|ports|volumes):/mu.test(testService)
  ) {
    fail("postgres-test Compose isolation drifted from the restore runbook contract");
  }
} catch {
  fail("Compose configuration could not be read for the restore runbook contract");
}

if (failures.length > 0) {
  console.error(`Restore runbook check failed with ${failures.length} finding(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Restore runbook check passed (${expectedControlIds.length} controls, ${expectedCommands.length} commands).`,
);
