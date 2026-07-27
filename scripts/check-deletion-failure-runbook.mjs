import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const failures = [];
const maximumRunbookBytes = 32_768;
const runbookPath = resolve(root, "docs", "operations", "PROFILE_DELETION_FAILURE_RUNBOOK.md");
const rootPackagePath = resolve(root, "package.json");
const requestMigrationPath = resolve(
  root,
  "database",
  "migrations",
  "0002_identity_capabilities.sql",
);
const purgeMigrationPath = resolve(
  root,
  "database",
  "migrations",
  "0024_profile_deletion_purge.sql",
);
const terminalCleanupMigrationPath = resolve(
  root,
  "database",
  "migrations",
  "0032_terminal_deletion_job_retention_cleanup.sql",
);
const webPoolPath = resolve(root, "apps", "web", "lib", "pairing-database-pool.ts");
const webHttpPath = resolve(root, "apps", "web", "lib", "enrollment-http.ts");
const jobsCommandPath = resolve(root, "apps", "jobs", "src", "command.ts");
const jobsPoolPath = resolve(root, "apps", "jobs", "src", "database-pool.ts");
const schedulePath = resolve(root, "apps", "jobs-scheduler", "src", "schedule.ts");
const purgeTestPath = resolve(root, "database", "tests", "profile_deletion_purge.sql");
const terminalCleanupTestPath = resolve(root, "database", "tests", "deletion_job_cleanup.sql");
const databaseIntegrationPath = resolve(root, "scripts", "test-database-integration.mjs");
const jobsIntegrationPath = resolve(root, "scripts", "test-jobs-postgres-integration.mjs");

const expectedHeadings = Object.freeze([
  "# Profile deletion failure rehearsal runbook",
  "## Scope and evidence boundary",
  "## Roles and protected record",
  "## Preflight",
  "## Repository-owned local evidence",
  "## Classify and contain",
  "## Diagnose without mutation",
  "## Retry the bounded purge",
  "## Verify and retain",
  "## Failure and incident handoff",
  "## Prohibited actions",
]);
const expectedControls = Object.freeze([
  [
    "VR-DELETE-01",
    "Assign incident, privacy/deletion, Web/Auth, Jobs, database, security, and communication owners in the protected record.",
  ],
  [
    "VR-DELETE-02",
    "Pin the exact reviewed commit, immutable service artifacts, migration ledger, affected environment, and deployment-owned controllers privately.",
  ],
  [
    "VR-DELETE-03",
    "Classify the symptom as request failure, queued primary-purge failure, terminal-job cleanup failure, or cache/backup/restore risk; do not merge those states.",
  ],
  [
    "VR-DELETE-04",
    "Preserve redacted aggregate evidence and the original immutable artifacts before restart, retry, or repair.",
  ],
  [
    "VR-DELETE-05",
    "Prove protected routing, process-settlement, database-health, least-privilege, verified-TLS, and monitoring prerequisites exist; otherwise keep the incident contained.",
  ],
  [
    "VR-DELETE-06",
    "Record an explicit go or no-go only after every repository-owned local gate below succeeds from the pinned clean checkout.",
  ],
  [
    "VR-DELETE-07",
    "Treat an absent successful request result as unknown lock-down; do not claim the profile is hidden or authority is revoked until the protected atomic request oracle confirms it.",
  ],
  [
    "VR-DELETE-08",
    "For a confirmed successful request, require one aggregate oracle to confirm `deletion_pending`, hidden profile, revoked active authority, unlinked sources, cancelled approved pairing, and one non-terminal job without exposing row data.",
  ],
  [
    "VR-DELETE-09",
    "Preserve that lock-down throughout the incident; never unhide, reactivate, relink, recreate recovery authority, mint a session, or issue a replacement credential.",
  ],
  [
    "VR-DELETE-10",
    "If request lock-down is absent or inconsistent, use the checked capability containment runbook and deployment controls to prevent affected authority or public state from being used while the root cause is investigated.",
  ],
  [
    "VR-DELETE-11",
    "Stop new scheduler cycles and settle the active Jobs call through the reviewed deployment controller when corruption, repeated failure, role drift, or uncertain state could make another purge unsafe.",
  ],
  [
    "VR-DELETE-12",
    "Use a protected read-only aggregate oracle to distinguish due `queued`, due `retry_wait`, future, `purged`, missing, linked, and malformed state without returning a profile, handle, digest, job identifier, timestamp, error code, or row.",
  ],
  [
    "VR-DELETE-13",
    "Verify the pinned ledger, exact function ownership/grants, forced RLS, the fixed five deletion-intersecting maintenance mutexes, Jobs login probe, TLS, database read-write state, and resource saturation before considering a retry.",
  ],
  [
    "VR-DELETE-14",
    "Treat any observed `running` job, unreviewed state transition, caller-selected backoff, or claimed automatic retry as unsupported and hand it to incident command.",
  ],
  [
    "VR-DELETE-15",
    "Diagnose terminal-job retention separately; cleanup cannot complete or repair a non-terminal primary purge and must not run early to erase evidence.",
  ],
  [
    "VR-DELETE-16",
    "Classify cache invalidation, backup expiry, tombstone policy, and stale-backup deletion replay as open external work; do not infer them from primary-database success.",
  ],
  [
    "VR-DELETE-17",
    "Require a reviewed root-cause fix or documented transient cause, stable database health, clean immutable artifact, exact narrow Jobs authority, and incident-commander approval.",
  ],
  [
    "VR-DELETE-18",
    "Invoke the deployment-owned one-shot Jobs workflow once with its fixed primary purge command, maximum-ten server-selected batch, no profile/job selector, and no caller-chosen SQL, batch, cutoff, timeout, lock, or retry count.",
  ],
  [
    "VR-DELETE-19",
    "Permit only one active purge caller for the recovery attempt; do not overlap a manual workflow with the scheduler or another operator.",
  ],
  [
    "VR-DELETE-20",
    "Treat the generic process result as transport evidence only; require the protected aggregate database oracle before declaring a profile purged.",
  ],
  [
    "VR-DELETE-21",
    "After a reported success, require one protected aggregate oracle to prove the exact profile is absent, its personal rows cannot be reached, and the matching job alone is profile-free, terminal `purged`, lease-free, error-free, and completed.",
  ],
  [
    "VR-DELETE-22",
    "Recheck runtime-role denials, forced RLS, maintenance mutexes, database/session cleanup, scheduler settlement, and absence of unexpected mutation outside the approved batch.",
  ],
  [
    "VR-DELETE-23",
    "Retain the opaque terminal job for at least the fixed 30-day server-time window; terminal cleanup remains a separate bounded Jobs action and never proves user-data deletion.",
  ],
  [
    "VR-DELETE-24",
    "Keep cache, backup, tombstone, restore-replay, notification, legal-retention, and monitoring gaps open with named owners and deadlines; do not call the broader deletion complete.",
  ],
  [
    "VR-DELETE-25",
    "On any retry or verification mismatch, stop further attempts, keep authority and routing contained, settle Jobs, remove temporary authority, and hand the protected evidence to incident command.",
  ],
  [
    "VR-DELETE-26",
    "Close the rehearsal only after every temporary process/session/credential is gone, monitoring is stable, affected authority remains closed or deletion is exactly verified, and every residual risk has an owner and deadline.",
  ],
]);
const expectedControlIds = Object.freeze(expectedControls.map(([id]) => id));
const expectedCommands = Object.freeze([
  "pnpm run check:deletion-failure-runbook",
  "pnpm run test:deletion-failure-runbook-check",
  "pnpm run test:database-check",
  "pnpm run check:database",
  "pnpm run test:web:coverage",
  "pnpm run test:jobs:coverage",
  "pnpm run test:jobs-scheduler:coverage",
  "pnpm run test:database:integration",
  "pnpm run test:jobs:postgres-integration",
  "pnpm run verify:release:node",
]);
const expectedRootScripts = Object.freeze({
  "check:database": "node scripts/check-database.mjs",
  "check:deletion-failure-runbook": "node scripts/check-deletion-failure-runbook.mjs",
  "test:database-check": "node scripts/test-database-check.mjs",
  "test:database:integration": "node scripts/test-database-integration.mjs",
  "test:deletion-failure-runbook-check": "node scripts/test-deletion-failure-runbook-check.mjs",
  "test:jobs-scheduler:coverage": "pnpm --filter @viberacing/jobs-scheduler run test:coverage",
  "test:jobs:coverage": "pnpm --filter @viberacing/jobs run test:coverage",
  "test:jobs:postgres-integration": "node scripts/test-jobs-postgres-integration.mjs",
  "test:web:coverage": "pnpm --filter @viberacing/web run test:coverage",
  "verify:release:node": "node scripts/verify.mjs --release --node-only",
});
const requiredStatements = Object.freeze([
  "Neither the HTTP request nor Web startup runs the physical purge.",
  "No repository-owned controller currently claims, leases, transitions, backs off, or requeues a failed deletion job.",
  "Do not describe those schema fields or the hourly local scheduler as automatic retry, durable missed-slot recovery, deployed cadence, or monitoring.",
  "The retry is a new bounded call, not a resume of an application lease.",
  "A failed transaction leaves the previously committed request lock-down and non-terminal job available for diagnosis",
  "The separate terminal cleanup can delete only a profile-free `purged` job after at least 30 days; it is retention cleanup, not a purge retry or completion oracle.",
  "The current database has an unused tombstone table shape, but the request and purge intentionally do not populate it.",
  "There is no repository-owned user-notification system or private support channel.",
  "Do not read or edit private tables interactively.",
  "Do not run raw SQL, `psql`, a Jobs package command, or a scheduler entry point from this public runbook.",
]);

function fail(message) {
  failures.push(message);
}

function normalizedFile(path, label) {
  try {
    return readFileSync(path, "utf8").replace(/\r\n/gu, "\n");
  } catch {
    fail(`${label} could not be read`);
    return undefined;
  }
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

function compact(value) {
  return value.replace(/\s+/gu, " ").trim();
}

function requireFragments(source, label, fragments) {
  if (source === undefined) {
    return;
  }
  const normalized = compact(source);
  for (const fragment of fragments) {
    if (!normalized.includes(compact(fragment))) {
      fail(`${label} is missing a deletion contract fragment: ${fragment}`);
    }
  }
}

function requireOrder(source, label, fragments) {
  if (source === undefined) {
    return;
  }
  const normalized = compact(source);
  let cursor = -1;
  for (const fragment of fragments) {
    const next = normalized.indexOf(compact(fragment), cursor + 1);
    if (next < 0) {
      fail(`${label} deletion operation order drifted at: ${fragment}`);
      return;
    }
    cursor = next;
  }
}

function requireOccurrences(source, label, fragment, expectedCount) {
  if (source === undefined) {
    return;
  }
  const normalized = compact(source);
  const needle = compact(fragment);
  let count = 0;
  let cursor = 0;
  while (true) {
    const index = normalized.indexOf(needle, cursor);
    if (index < 0) {
      break;
    }
    count += 1;
    cursor = index + needle.length;
  }
  if (count !== expectedCount) {
    fail(`${label} expected ${expectedCount} occurrence(s) of: ${fragment}`);
  }
}

function forbidFragments(source, label, fragments) {
  if (source === undefined) {
    return;
  }
  for (const fragment of fragments) {
    if (source.includes(fragment)) {
      fail(`${label} unexpectedly implements deletion retry metadata: ${fragment}`);
    }
  }
}

function sectionBetween(source, label, start, end) {
  if (source === undefined) {
    return undefined;
  }
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    fail(`${label} boundaries drifted`);
    return undefined;
  }
  return source.slice(startIndex, endIndex);
}

let runbook;
if (!existsSync(runbookPath)) {
  fail("docs/operations/PROFILE_DELETION_FAILURE_RUNBOOK.md is missing");
} else {
  const metadata = lstatSync(runbookPath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    fail("deletion failure runbook must be one regular non-symlink file");
  } else {
    const bytes = readFileSync(runbookPath);
    if (bytes.length === 0 || bytes.length > maximumRunbookBytes) {
      fail(`deletion failure runbook must be between 1 and ${maximumRunbookBytes} bytes`);
    }
    runbook = bytes.toString("utf8");
    if (!Buffer.from(runbook, "utf8").equals(bytes) || runbook.includes("\0")) {
      fail("deletion failure runbook must be canonical UTF-8 text without NUL bytes");
    }
  }
}

if (runbook !== undefined) {
  const normalizedRunbook = compact(runbook);
  const headings = [...runbook.matchAll(/^(#{1,6} .+)$/gmu)].map((match) => match[1]);
  if (JSON.stringify(headings) !== JSON.stringify(expectedHeadings)) {
    fail("deletion failure runbook heading inventory or order drifted");
  }

  const controlIds = [...runbook.matchAll(/^- \[ \] (VR-DELETE-\d{2}):/gmu)].map(
    (match) => match[1],
  );
  if (JSON.stringify(controlIds) !== JSON.stringify(expectedControlIds)) {
    fail("deletion failure runbook control inventory or order drifted");
  }
  const lines = runbook.split(/\r?\n/u);
  const observedControls = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^- \[ \] (VR-DELETE-\d{2}):\s+(.+)$/u.exec(lines[index]);
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
    fail("deletion failure runbook control text drifted");
  }

  const fenceMarkers = [...runbook.matchAll(/^```.*$/gmu)].map((match) => match[0]);
  if (
    JSON.stringify(fenceMarkers) !==
    JSON.stringify(["```text", "``` "].map((value) => value.trim()))
  ) {
    fail("deletion failure runbook fenced command block inventory drifted");
  }
  const commands = [...runbook.matchAll(/```text\r?\n([\s\S]*?)```/gu)].flatMap((match) =>
    match[1]
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== ""),
  );
  if (JSON.stringify(commands) !== JSON.stringify(expectedCommands)) {
    fail("deletion failure runbook command inventory or order drifted");
  }
  for (const statement of requiredStatements) {
    if (!normalizedRunbook.includes(compact(statement))) {
      fail(`deletion failure runbook is missing required statement: ${statement}`);
    }
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
        fail(`root package script ${name} drifted from the deletion failure contract`);
      }
    }
  }
}

const requestMigration = normalizedFile(requestMigrationPath, "profile deletion request migration");
const requestFunction = sectionBetween(
  requestMigration,
  "profile deletion request migration",
  "CREATE FUNCTION viberacing_api.request_profile_deletion(",
  "REVOKE ALL ON TABLE viberacing_private.audit_events",
);
requireOrder(requestFunction, "profile deletion request migration", [
  "CREATE FUNCTION viberacing_api.request_profile_deletion(",
  "state = 'deletion_pending'",
  "UPDATE viberacing_private.sessions",
  "UPDATE viberacing_private.passkeys",
  "DELETE FROM viberacing_private.recovery_codes",
  "DELETE FROM viberacing_private.auth_challenges",
  "UPDATE viberacing_private.device_keys AS device",
  "UPDATE viberacing_private.codex_sources",
  "UPDATE viberacing_private.pairing_transactions",
  "INSERT INTO viberacing_private.deletion_jobs",
  "'queued'",
  "viberacing_private.append_audit_event",
]);
requireFragments(requestFunction, "profile deletion request migration", [
  "hidden_at = COALESCE(hidden_at, now_at)",
  "deletion_requested_at = now_at",
  "SET state = 'unlinked'",
  "SET state = 'cancelled'",
  "WHEN integrity_constraint_violation THEN",
]);

const webPool = normalizedFile(webPoolPath, "Web profile deletion database composition");
const webPoolQuery = sectionBetween(
  webPool,
  "Web profile deletion database composition",
  "const completeProfileDeletionQuery",
  "const createPasskeyAddChallengeQuery",
);
requireOrder(webPoolQuery, "Web profile deletion database composition", [
  "const completeProfileDeletionQuery",
  "challenge_consumption AS MATERIALIZED",
  "profile_deletion AS MATERIALIZED",
  "viberacing_api.request_profile_deletion(",
  "FROM challenge_consumption WHERE consumed",
  "AND pg_catalog.count(*) = 1 AS deleted",
]);

const webHttp = normalizedFile(webHttpPath, "Web profile deletion HTTP boundary");
const webHttpHandler = sectionBetween(
  webHttp,
  "Web profile deletion HTTP boundary",
  "async profileDeletionVerify(request: Request)",
  "async sourcePause(request: Request)",
);
requireOrder(webHttpHandler, "Web profile deletion HTTP boundary", [
  "async profileDeletionVerify(request: Request)",
  "const deleted = await currentRuntime.service.completeProfileDeletion(",
  'if (!deleted) { return problem("unauthorized"); }',
  "const headers = noStoreHeaders();",
  "clearEnrollmentCookie(enrollmentCookieNames.session",
  "return new Response(null, { headers, status: 204 });",
]);

const purgeMigration = normalizedFile(purgeMigrationPath, "primary profile purge migration");
requireFragments(purgeMigration, "primary profile purge migration", [
  "p_batch_size NOT BETWEEN 1 AND 10 THEN",
  "job_record.state IN ('queued', 'retry_wait')",
  "job_record.available_at <= now_at",
  "LIMIT p_batch_size FOR UPDATE SKIP LOCKED",
  "profile_record.state = 'deletion_pending'",
  "locked_mutex_count <> 5",
  "last_error_code = NULL",
  "REVOKE EXECUTE ON FUNCTION viberacing_api.purge_profile_deletions(integer) FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin",
  "GRANT EXECUTE ON FUNCTION viberacing_api.purge_profile_deletions(integer) TO viberacing_jobs",
]);
requireOccurrences(
  purgeMigration,
  "primary profile purge migration",
  "job_record.state IN ('queued', 'retry_wait')",
  2,
);
requireOccurrences(
  purgeMigration,
  "primary profile purge migration",
  "job_record.available_at <= now_at",
  2,
);
for (const mutex of [
  "auth_retention_cleanup",
  "community_scoring_refresh",
  "ingest_retention_cleanup",
  "pairing_retention_cleanup",
  "profile_deletion_purge",
]) {
  requireFragments(purgeMigration, "primary profile purge migration", [`'${mutex}'`]);
}
requireOrder(purgeMigration, "primary profile purge migration", [
  "UPDATE viberacing_private.deletion_jobs AS job_record",
  "state = 'purged'",
  "DELETE FROM viberacing_private.profiles AS profile_record",
  "purged_profiles := purged_profiles + 1",
]);

const terminalCleanupMigration = normalizedFile(
  terminalCleanupMigrationPath,
  "terminal deletion-job cleanup migration",
);
requireFragments(terminalCleanupMigration, "terminal deletion-job cleanup migration", [
  "p_batch_size NOT BETWEEN 1 AND 1000 THEN",
  "capability = 'profile_deletion_purge'",
  "pg_catalog.clock_timestamp() - INTERVAL '30 days'",
  "job_record.state = 'purged'",
  "job_record.profile_id IS NULL",
  "job_record.completed_at <= cutoff_at",
  "LIMIT p_batch_size FOR UPDATE SKIP LOCKED",
  "REVOKE EXECUTE ON FUNCTION viberacing_api.cleanup_terminal_deletion_jobs(integer) FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin",
  "GRANT EXECUTE ON FUNCTION viberacing_api.cleanup_terminal_deletion_jobs(integer) TO viberacing_jobs",
]);

const jobsCommand = normalizedFile(jobsCommandPath, "Jobs deletion command parser");
requireFragments(jobsCommand, "Jobs deletion command parser", [
  'argumentsValue.length === 1 && argumentsValue[0] === "purge-profile-deletions"',
  "batchSize: maximumProfileDeletionPurgeBatchSize",
  'argumentsValue.length === 1 && argumentsValue[0] === "cleanup-terminal-deletion-jobs"',
  "batchSize: maximumCleanupBatchSize",
]);

const jobsPool = normalizedFile(jobsPoolPath, "Jobs deletion database adapter");
requireFragments(jobsPool, "Jobs deletion database adapter", [
  "FROM viberacing_api.purge_profile_deletions($1::integer) AS purge",
  "FROM viberacing_api.cleanup_terminal_deletion_jobs($1::integer) AS cleanup",
]);

const schedule = normalizedFile(schedulePath, "Jobs scheduler deletion catalog");
requireOrder(schedule, "Jobs scheduler deletion catalog", [
  'batchSize: maximumProfileDeletionPurgeBatchSize, kind: "purge_profile_deletions"',
  'batchSize: maximumCleanupBatchSize, kind: "cleanup_terminal_deletion_jobs"',
]);
forbidFragments(
  [jobsCommand, jobsPool, schedule].filter((value) => value !== undefined).join("\n"),
  "Jobs deletion runtime",
  ["attempt_count", "available_at", "last_error_code", "lease_token_digest", "retry_wait"],
);

const purgeTest = normalizedFile(purgeTestPath, "primary profile purge SQL evidence");
requireFragments(purgeTest, "primary profile purge SQL evidence", [
  "one call purges at most ten oldest due profiles",
  "a retry-wait job is purged when its availability window is due",
  "state drift rolls the entire attempted purge back",
  "primary purge does not invent an unkeyed restore tombstone",
  "Web cannot purge profiles",
  "Ingest cannot purge profiles",
  "Admin cannot purge profiles",
  "a missing private deletion purge mutex fails closed",
]);

const terminalCleanupTest = normalizedFile(
  terminalCleanupTestPath,
  "terminal deletion-job cleanup SQL evidence",
);
requireFragments(terminalCleanupTest, "terminal deletion-job cleanup SQL evidence", [
  "recent, linked terminal evidence and non-terminal deletion authority remain untouched",
  "Web cannot run terminal deletion-job cleanup",
  "Ingest cannot run terminal deletion-job cleanup",
  "Admin cannot run terminal deletion-job cleanup",
  "a missing private deletion mutex fails terminal deletion-job cleanup closed",
]);

const databaseIntegration = normalizedFile(
  databaseIntegrationPath,
  "database integration deletion evidence",
);
requireFragments(databaseIntegration, "database integration deletion evidence", [
  "database/tests/profile_deletion_purge.sql",
  "database/tests/profile_deletion_purge_concurrency_setup.sql",
  "database/tests/profile_deletion_purge_concurrency_assertions.sql",
  "database/tests/deletion_job_cleanup.sql",
  "database/tests/deletion_job_cleanup_concurrency_setup.sql",
  "database/tests/deletion_job_cleanup_concurrency_assertions.sql",
]);

const jobsIntegration = normalizedFile(jobsIntegrationPath, "Jobs PostgreSQL deletion evidence");
requireFragments(jobsIntegration, "Jobs PostgreSQL deletion evidence", [
  '["purge-profile-deletions"]',
  '["cleanup-terminal-deletion-jobs"]',
]);

if (failures.length > 0) {
  console.error(`Deletion failure runbook check failed with ${failures.length} finding(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Deletion failure runbook check passed (${expectedControlIds.length} controls, ${expectedCommands.length} commands, atomic request/purge and terminal-retention bindings).`,
);
