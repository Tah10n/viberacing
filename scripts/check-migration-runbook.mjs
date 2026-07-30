import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const runbookPath = resolve(root, "docs", "operations", "MIGRATION_RUNBOOK.md");
const rootPackagePath = resolve(root, "package.json");
const migratePackagePath = resolve(root, "apps", "migrate", "package.json");
const migrateCommandPath = resolve(root, "apps", "migrate", "src", "command.ts");
const migrateEnablementPath = resolve(root, "apps", "migrate", "src", "enablement.ts");
const maximumRunbookBytes = 32 * 1024;
const failures = [];

const expectedHeadings = Object.freeze([
  "# Staging migration and forward-recovery runbook",
  "## Scope and evidence boundary",
  "## Authority and prerequisites",
  "## Preflight",
  "## Apply",
  "## Verify",
  "## Forward recovery",
  "## Incident handoff",
  "## Prohibited actions",
]);
const expectedControls = Object.freeze([
  [
    "VR-MIG-01",
    "Pin the exact reviewed commit and immutable build artifact in the protected change record.",
  ],
  [
    "VR-MIG-02",
    "Assign deployment, database, incident, and forward-recovery owners before the window opens.",
  ],
  [
    "VR-MIG-03",
    "Record the isolated staging target and prove the migration-controller replica count is exactly one.",
  ],
  [
    "VR-MIG-04",
    "Prove a current backup can restore into an isolated target and record its expiry privately.",
  ],
  [
    "VR-MIG-05",
    "Verify the candidate service matrix targets the exact clean-bootstrap schema and starts with every capability closed.",
  ],
  [
    "VR-MIG-06",
    "Verify the narrow login, owner membership, DNS name, trust material, and TLS policy privately.",
  ],
  [
    "VR-MIG-07",
    "Confirm protected monitoring and an append-only operator record are available before execution.",
  ],
  ["VR-MIG-08", "Record an explicit go or no-go decision after every local gate below succeeds."],
  [
    "VR-MIG-09",
    "Open the protected change record and confirm the pinned commit, target, owners, and window.",
  ],
  [
    "VR-MIG-10",
    "Inject the exact enable value and namespaced database configuration through the controller.",
  ],
  [
    "VR-MIG-11",
    "Start one argument-free migration process and retain only its bounded aggregate result.",
  ],
  [
    "VR-MIG-12",
    "Remove enablement after settlement and prove that no migration process or session remains.",
  ],
  [
    "VR-MIG-13",
    "Require the protected ledger oracle to equal the pinned contiguous manifest exactly.",
  ],
  [
    "VR-MIG-14",
    "Verify owner, forced-RLS, runtime-role, TLS, connection, and advisory-lock invariants.",
  ],
  ["VR-MIG-15", "Run the approved candidate-service smoke matrix before opening any traffic."],
  [
    "VR-MIG-16",
    "On any failure, stop new controllers, preserve the protected record, and contain affected routes.",
  ],
  [
    "VR-MIG-17",
    "Classify the exact committed ledger prefix and approve either a service rollback or forward fix.",
  ],
  [
    "VR-MIG-18",
    "Re-run the complete verification matrix and hand off residual risk before closing the incident.",
  ],
]);
const expectedControlIds = Object.freeze(expectedControls.map(([id]) => id));
const expectedCommands = Object.freeze([
  "pnpm run check:migration-runbook",
  "pnpm run check:database",
  "pnpm run build:migrate",
  "pnpm run check:migrate-entrypoint",
  "pnpm run test:database:integration",
  "pnpm run test:migrate:postgres-integration",
  "pnpm --filter @viberacing/migrate start",
]);
const expectedRootScripts = Object.freeze({
  "build:migrate": "corepack pnpm --filter @viberacing/migrate run build",
  "check:database": "node scripts/check-database.mjs",
  "check:migrate-entrypoint": "node scripts/check-migrate-entrypoint.mjs",
  "check:migration-runbook": "node scripts/check-migration-runbook.mjs",
  "test:database:integration": "node scripts/test-database-integration.mjs",
  "test:migrate:postgres-integration": "node scripts/test-migrate-postgres-integration.mjs",
  "test:migration-runbook-check": "node scripts/test-migration-runbook-check.mjs",
});
const requiredStatements = Object.freeze([
  "Starting Web, Ingest, Jobs, or the local site does not apply migrations.",
  "No production deployment is authorized by this document.",
  "`VIBERACING_MIGRATIONS_ENABLED` must be the exact string `true`",
  "`Vibe Racing migrations completed.`",
  "forward-only",
  "Do not paste protected configuration into a shell command, transcript, issue, or tracked file.",
  "Stale-backup deletion replay is not implemented",
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
  fail("docs/operations/MIGRATION_RUNBOOK.md is missing");
} else {
  const metadata = lstatSync(runbookPath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    fail("migration runbook must be one regular non-symlink file");
  } else {
    const bytes = readFileSync(runbookPath);
    if (bytes.length === 0 || bytes.length > maximumRunbookBytes) {
      fail(`migration runbook must be between 1 and ${maximumRunbookBytes} bytes`);
    }
    runbook = bytes.toString("utf8");
    if (!Buffer.from(runbook, "utf8").equals(bytes) || runbook.includes("\0")) {
      fail("migration runbook must be canonical UTF-8 text without NUL bytes");
    }
  }
}

if (runbook !== undefined) {
  const normalizedRunbook = runbook.replace(/\s+/gu, " ");
  const headings = [...runbook.matchAll(/^(#{1,6} .+)$/gmu)].map((match) => match[1]);
  if (JSON.stringify(headings) !== JSON.stringify(expectedHeadings)) {
    fail("migration runbook heading inventory or order drifted");
  }

  const controlIds = [...runbook.matchAll(/^- \[ \] (VR-MIG-\d{2}):/gmu)].map((match) => match[1]);
  if (JSON.stringify(controlIds) !== JSON.stringify(expectedControlIds)) {
    fail("migration runbook control inventory or order drifted");
  }
  const lines = runbook.split(/\r?\n/u);
  const observedControls = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^- \[ \] (VR-MIG-\d{2}):\s+(.+)$/u.exec(lines[index]);
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
    fail("migration runbook control text drifted");
  }

  const fenceMarkers = [...runbook.matchAll(/^```.*$/gmu)].map((match) => match[0]);
  if (JSON.stringify(fenceMarkers) !== JSON.stringify(["```text", "```", "```text", "```"])) {
    fail("migration runbook fenced command block inventory drifted");
  }
  const commands = [...runbook.matchAll(/```text\r?\n([\s\S]*?)```/gu)].flatMap((match) =>
    match[1]
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== ""),
  );
  if (JSON.stringify(commands) !== JSON.stringify(expectedCommands)) {
    fail("migration runbook command inventory or order drifted");
  }

  for (const statement of requiredStatements) {
    if (!normalizedRunbook.includes(statement)) {
      fail(`migration runbook is missing required statement: ${statement}`);
    }
  }

  if (/VIBERACING_MIGRATIONS_DATABASE_(?:CA|HOST|NAME|PASSWORD|PORT|USER)=\S+/u.test(runbook)) {
    fail("migration runbook must not contain an inline protected database assignment");
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
        fail(`root package script ${name} drifted from the runbook contract`);
      }
    }
  }
}

const migratePackage = readJson(migratePackagePath, "migration package manifest");
if (migratePackage !== undefined) {
  if (migratePackage.scripts?.start !== "node dist/main.js") {
    fail("migration package start command drifted from the runbook contract");
  }
}

try {
  const commandSource = readFileSync(migrateCommandPath, "utf8");
  if (!commandSource.includes('const successMessage = "Vibe Racing migrations completed.\\n";')) {
    fail("migration success output drifted from the runbook contract");
  }
} catch {
  fail("migration command source could not be read");
}

try {
  const enablementSource = readFileSync(migrateEnablementPath, "utf8");
  if (!enablementSource.includes('VIBERACING_MIGRATIONS_ENABLED === "true"')) {
    fail("migration enablement decision drifted from the runbook contract");
  }
} catch {
  fail("migration enablement source could not be read");
}

if (failures.length > 0) {
  console.error(`Migration runbook check failed with ${failures.length} finding(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Migration runbook check passed (${expectedControlIds.length} controls, ${expectedCommands.length} commands).`,
);
