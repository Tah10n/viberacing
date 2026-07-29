import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const failures = [];
const maximumRunbookBytes = 32_768;
const runbookPath = resolve(root, "docs", "operations", "PROFILE_DELETION_FAILURE_RUNBOOK.md");
const rootPackagePath = resolve(root, "package.json");
const identityMigrationPath = resolve(
  root,
  "database",
  "migrations",
  "0001_roles_schemas_and_identity.sql",
);
const authenticationMigrationPath = resolve(
  root,
  "database",
  "migrations",
  "0002_authentication_passkeys_and_recovery.sql",
);
const deletionMigrationPath = resolve(
  root,
  "database",
  "migrations",
  "0006_retention_deletion_admin_and_audit.sql",
);
const webPoolPath = resolve(root, "apps", "web", "lib", "pairing-database-pool.ts");
const webHttpPath = resolve(root, "apps", "web", "lib", "enrollment-http.ts");
const webHttpTestPath = resolve(root, "apps", "web", "lib", "enrollment-http.test.ts");
const jobsCommandPath = resolve(root, "apps", "jobs", "src", "command.ts");
const jobsCommandTestPath = resolve(root, "apps", "jobs", "src", "command.test.ts");
const jobsMaintenancePath = resolve(root, "apps", "jobs", "src", "maintenance.ts");
const jobsPoolPath = resolve(root, "apps", "jobs", "src", "database-pool.ts");
const schedulePath = resolve(root, "apps", "jobs-scheduler", "src", "schedule.ts");
const scheduleTestPath = resolve(root, "apps", "jobs-scheduler", "src", "schedule.test.ts");
const retentionTestPath = resolve(root, "database", "tests", "retention_jobs.sql");
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
    "Pin the exact reviewed commit, immutable service artifacts, seven-revision migration ledger, affected environment, and deployment-owned controllers privately.",
  ],
  [
    "VR-DELETE-03",
    "Classify the symptom as request failure, snapshot-blocked primary purge, other primary-purge failure, terminal-job cleanup failure, or cache/backup/restore risk; do not merge those states.",
  ],
  [
    "VR-DELETE-04",
    "Preserve redacted aggregate evidence and the original immutable artifacts before restart, retry, or repair.",
  ],
  [
    "VR-DELETE-05",
    "Prove protected routing, process settlement, database health, least privilege, verified TLS, and monitoring prerequisites exist; otherwise keep the incident contained.",
  ],
  [
    "VR-DELETE-06",
    "Record an explicit go or no-go only after every repository-owned local gate below succeeds from the pinned clean checkout.",
  ],
  [
    "VR-DELETE-07",
    "Treat an absent successful request result as unknown lock-down; do not claim the profile or authority changed until the protected atomic request oracle confirms it.",
  ],
  [
    "VR-DELETE-08",
    "For a confirmed request, require one aggregate oracle to confirm `deletion_pending`, hidden public state, revoked sessions/passkeys/recovery authority/device keys/installations, unlinked AgentAccounts, expired pairing, and one `pending` deletion job without exposing row data.",
  ],
  [
    "VR-DELETE-09",
    "Preserve that lock-down throughout the incident; never unhide, reactivate, relink, recreate recovery authority, mint a session, or issue a replacement credential.",
  ],
  [
    "VR-DELETE-10",
    "If request lock-down is absent or inconsistent, use the checked capability-containment runbook and deployment controls to prevent affected authority or public state from being used while the root cause is investigated.",
  ],
  [
    "VR-DELETE-11",
    "Stop new scheduler cycles and settle the active Jobs call through the reviewed deployment controller when corruption, repeated failure, role drift, or uncertain state could make another purge unsafe.",
  ],
  [
    "VR-DELETE-12",
    "Use a protected read-only aggregate oracle to distinguish `pending`, snapshot-blocked, `completed`, missing, and malformed state without returning a profile, handle, UUID, digest, timestamp, or row.",
  ],
  [
    "VR-DELETE-13",
    "Verify the seven-row ledger, exact function ownership/grants, forced RLS, `profile_purge` and `deletion_job_cleanup` mutexes, published-snapshot state, Jobs login probe, TLS, database read-write state, and resource saturation before considering a retry.",
  ],
  [
    "VR-DELETE-14",
    "Treat any observed third deletion-job state, per-job lease/backoff metadata, caller-selected cutoff, or claimed durable automatic retry as unsupported and hand it to incident command.",
  ],
  [
    "VR-DELETE-15",
    "Diagnose terminal-job retention separately; cleanup cannot complete or repair a `pending` primary purge and must not run early to erase evidence.",
  ],
  [
    "VR-DELETE-16",
    "Classify cache invalidation, backup expiry, deletion-marker policy, and stale-backup replay as open external work; do not infer them from primary-database success.",
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
    "After a reported success, require one protected aggregate oracle to prove the exact profile and reachable personal rows are absent and the matching protected job alone is terminal `completed` with the exact 30-day retention deadline.",
  ],
  [
    "VR-DELETE-22",
    "Recheck runtime-role denials, forced RLS, both deletion mutexes, published-snapshot consistency, database/session cleanup, scheduler settlement, and absence of unexpected mutation outside the approved batch.",
  ],
  [
    "VR-DELETE-23",
    "Retain the protected terminal UUID row until its fixed 30-day server-time deadline; terminal cleanup remains a separate bounded Jobs action and never proves user-data deletion.",
  ],
  [
    "VR-DELETE-24",
    "Keep cache, backup, deletion-marker, restore-replay, notification, legal-retention, and monitoring gaps open with named owners and deadlines; do not call the broader deletion complete.",
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
  "The request transaction does not physically purge profile data.",
  "Neither the HTTP request nor Web startup runs the physical purge.",
  "The deletion job has only `pending` and `completed` states; it has no lease, attempt counter, error field, caller-selected cutoff, or per-job backoff.",
  "The purge refuses a profile while its handle remains in a published snapshot for a non-finalized season.",
  "A failed purge transaction leaves the previously committed request lock-down and `pending` job available for diagnosis.",
  "The retry is a new bounded scan of server-selected pending jobs, not a resume of an application lease.",
  "The separate terminal cleanup can delete only a `completed` job after its server-computed retention expiry; it is retention cleanup, not a purge retry or completion oracle.",
  "The retained terminal row still contains the opaque profile UUID and must remain protected personal data until cleanup.",
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

const identityMigration = normalizedFile(identityMigrationPath, "profile state migration");
const profileStateFunction = sectionBetween(
  identityMigration,
  "profile state migration",
  "CREATE FUNCTION viberacing_private.enforce_profile_update()",
  "CREATE TRIGGER profiles_enforce_update",
);
requireOrder(profileStateFunction, "profile state migration", [
  "IF NEW.state = 'deletion_pending' AND OLD.state <> 'deletion_pending' THEN",
  "NEW.public_visibility := 'hidden';",
  "NEW.hidden_at := NEW.updated_at;",
  "NEW.deletion_requested_at := NEW.updated_at;",
]);

const authenticationMigration = normalizedFile(
  authenticationMigrationPath,
  "profile recovery lock-down migration",
);
const recoveryLockdownFunction = sectionBetween(
  authenticationMigration,
  "profile recovery lock-down migration",
  "CREATE FUNCTION viberacing_private.revoke_recovery_authority_on_profile_deletion()",
  "CREATE TRIGGER profiles_revoke_recovery_authority",
);
requireOrder(recoveryLockdownFunction, "profile recovery lock-down migration", [
  "IF NEW.state = 'deletion_pending' AND OLD.state <> 'deletion_pending' THEN",
  "UPDATE viberacing_private.recovery_authorities",
  "SET state = 'revoked'",
  "WHERE profile_id = NEW.profile_id",
  "AND state = 'active';",
]);

const deletionMigration = normalizedFile(
  deletionMigrationPath,
  "profile deletion request and purge migration",
);
const requestFunction = sectionBetween(
  deletionMigration,
  "profile deletion request migration",
  "CREATE OR REPLACE FUNCTION viberacing_api.request_profile_deletion(",
  "CREATE FUNCTION viberacing_private.enqueue_profile_deletion_job()",
);
requireOrder(requestFunction, "profile deletion request migration", [
  "v_profile_id := viberacing_api.consume_auth_challenge(",
  "'profile_delete'",
  "UPDATE viberacing_private.profiles",
  "SET state = 'deletion_pending'",
  "UPDATE viberacing_private.pairing_transactions AS pairing",
  "SET state = 'expired'",
  "UPDATE viberacing_private.device_keys",
  "SET state = 'revoked'",
  "UPDATE viberacing_private.connector_installations",
  "SET state = 'revoked'",
  "UPDATE viberacing_private.agent_accounts",
  "SET state = 'unlinked'",
  "UPDATE viberacing_private.sessions",
  "SET state = 'revoked'",
  "UPDATE viberacing_private.passkeys",
  "SET state = 'revoked'",
]);
requireFragments(requestFunction, "profile deletion request migration", [
  "AND handle = p_typed_handle;",
  "IF NOT FOUND THEN",
  "AND state IN ('pending', 'active');",
  "AND state <> 'unlinked';",
]);
requireFragments(deletionMigration, "profile deletion request migration", [
  "CREATE TRIGGER profiles_enqueue_deletion_job",
  "AFTER UPDATE OF state ON viberacing_private.profiles",
  "IF OLD.state <> 'deletion_pending' AND NEW.state = 'deletion_pending' THEN",
  "INSERT INTO viberacing_private.profile_deletion_jobs",
  "NEW.deletion_requested_at",
]);

const webPool = normalizedFile(webPoolPath, "Web profile deletion database composition");
const webPoolQuery = sectionBetween(
  webPool,
  "Web profile deletion database composition",
  "const completeProfileDeletionQuery",
  "const createPasskeyAddChallengeQuery",
);
requireOrder(webPoolQuery, "Web profile deletion database composition", [
  "const completeProfileDeletionQuery = `WITH profile_deletion AS MATERIALIZED",
  "SELECT viberacing_api.request_profile_deletion(",
  "$8::text",
  "SELECT pg_catalog.count(*) = 1 AS deleted",
  "FROM profile_deletion",
]);

const webHttp = normalizedFile(webHttpPath, "Web profile deletion HTTP boundary");
const webHttpHandler = sectionBetween(
  webHttp,
  "Web profile deletion HTTP boundary",
  "async profileDeletionVerify(request: Request)",
  "async logout(request: Request)",
);
requireOrder(webHttpHandler, "Web profile deletion HTTP boundary", [
  'exactOrigin(request, currentRuntime, "/auth/profile/delete/verify")',
  "const deleted = await currentRuntime.service.completeProfileDeletion(",
  'if (!deleted) { return problem("unauthorized"); }',
  "const headers = noStoreHeaders();",
  "clearEnrollmentCookie(enrollmentCookieNames.session",
  "return new Response(null, { headers, status: 204 });",
]);

const purgeFunction = sectionBetween(
  deletionMigration,
  "primary profile purge migration",
  "CREATE FUNCTION viberacing_api.purge_profile_deletions(",
  "CREATE FUNCTION viberacing_api.cleanup_terminal_deletion_jobs(",
);
requireFragments(purgeFunction, "primary profile purge migration", [
  "viberacing_private.validate_maintenance_batch(p_batch_size, 10)",
  "viberacing_private.try_lock_maintenance('profile_purge')",
  "job.state = 'pending'",
  "profile.state = 'deletion_pending'",
  "FROM viberacing_private.leaderboard_published_snapshots AS published",
  "season.state <> 'finalized'",
  "snapshot_profile.handle = profile.handle",
  "ORDER BY job.requested_at, job.profile_id",
  "LIMIT p_batch_size",
  "FOR UPDATE OF job, profile SKIP LOCKED",
  "DELETE FROM viberacing_private.season_profile_totals",
  "DELETE FROM viberacing_private.ranking_events AS event",
  "DELETE FROM viberacing_private.usage_idempotency_records AS record",
  "DELETE FROM viberacing_private.agent_account_day_totals AS total",
  "DELETE FROM viberacing_private.usage_observations AS observation",
  "DELETE FROM viberacing_private.pairing_transactions AS pairing",
  "DELETE FROM viberacing_private.profiles",
  "GET DIAGNOSTICS changed_rows = ROW_COUNT",
  "IF changed_rows <> 1 THEN",
  "SET state = 'completed'",
  "retention_expires_at = v_now + interval '30 days'",
  "AND state = 'pending';",
]);
requireOrder(purgeFunction, "primary profile purge migration", [
  "DELETE FROM viberacing_private.profiles",
  "GET DIAGNOSTICS changed_rows = ROW_COUNT",
  "IF changed_rows <> 1 THEN",
  "UPDATE viberacing_private.profile_deletion_jobs",
  "SET state = 'completed'",
  "purged_profiles := purged_profiles + 1;",
]);

const terminalCleanupFunction = sectionBetween(
  deletionMigration,
  "terminal deletion-job cleanup migration",
  "CREATE FUNCTION viberacing_api.cleanup_terminal_deletion_jobs(",
  "CREATE FUNCTION viberacing_api.reset_expired_pairing_request_windows()",
);
requireFragments(terminalCleanupFunction, "terminal deletion-job cleanup migration", [
  "viberacing_private.validate_maintenance_batch(p_batch_size, 1000)",
  "viberacing_private.try_lock_maintenance('deletion_job_cleanup')",
  "job.state = 'completed'",
  "job.retention_expires_at <= pg_catalog.clock_timestamp()",
  "ORDER BY job.retention_expires_at, job.profile_id",
  "LIMIT p_batch_size",
  "FOR UPDATE OF job SKIP LOCKED",
  "DELETE FROM viberacing_private.profile_deletion_jobs AS job",
]);
requireFragments(deletionMigration, "profile deletion grants and RLS migration", [
  "state IN ('pending', 'completed')",
  "retention_expires_at = completed_at + interval '30 days'",
  "ALTER TABLE viberacing_private.profile_deletion_jobs FORCE ROW LEVEL SECURITY",
  "REVOKE ALL ON TABLE viberacing_private.profile_deletion_jobs FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin",
  "GRANT EXECUTE ON FUNCTION viberacing_api.purge_profile_deletions(integer) TO viberacing_jobs",
  "GRANT EXECUTE ON FUNCTION viberacing_api.cleanup_terminal_deletion_jobs(integer) TO viberacing_jobs",
]);

const jobsMaintenance = normalizedFile(jobsMaintenancePath, "Jobs deletion job validator");
requireFragments(jobsMaintenance, "Jobs deletion job validator", [
  "export const maximumCleanupBatchSize = 1_000;",
  "export const maximumProfileDeletionPurgeBatchSize = 10;",
  'kind === "purge_profile_deletions" ? maximumProfileDeletionPurgeBatchSize : maximumCleanupBatchSize',
]);

const jobsCommand = normalizedFile(jobsCommandPath, "Jobs deletion command parser");
requireFragments(jobsCommand, "Jobs deletion command parser", [
  "value.length !== 1",
  'case "purge-profile-deletions":',
  "batchSize: maximumProfileDeletionPurgeBatchSize",
  'kind: "purge_profile_deletions"',
  'case "cleanup-terminal-deletion-jobs":',
  "batchSize: maximumCleanupBatchSize",
  'kind: "cleanup_terminal_deletion_jobs"',
]);

const jobsPool = normalizedFile(jobsPoolPath, "Jobs deletion database adapter");
requireFragments(jobsPool, "Jobs deletion database adapter", [
  "FROM viberacing_api.purge_profile_deletions($1::integer) AS purge",
  "FROM viberacing_api.cleanup_terminal_deletion_jobs($1::integer) AS cleanup",
]);

const schedule = normalizedFile(schedulePath, "Jobs scheduler deletion catalog");
requireOrder(schedule, "Jobs scheduler deletion catalog", [
  'Object.freeze({ kind: "refresh_dirty_leaderboard" })',
  'batchSize: maximumProfileDeletionPurgeBatchSize, kind: "purge_profile_deletions"',
  'batchSize: maximumCleanupBatchSize, kind: "cleanup_terminal_deletion_jobs"',
]);
forbidFragments(
  [jobsCommand, jobsMaintenance, jobsPool, schedule]
    .filter((value) => value !== undefined)
    .join("\n"),
  "Jobs deletion runtime",
  ["retry_wait", "lease_token", "last_error_code", "available_at"],
);

const retentionTest = normalizedFile(retentionTestPath, "profile deletion PostgreSQL evidence");
requireFragments(retentionTest, "profile deletion PostgreSQL evidence", [
  "profile deletion did not atomically lock down every authority",
  "profile deletion did not revoke active recovery authority",
  "published non-finalized snapshot did not block profile purge",
  "FROM viberacing_api.purge_profile_deletions(10)",
  "profile deletion purge result is invalid",
  "FROM viberacing_api.cleanup_terminal_deletion_jobs(1000)",
  "profile purge terminal state is invalid",
  "snapshot-blocked profile deletion state is invalid",
]);

const webHttpTest = normalizedFile(webHttpTestPath, "Web profile deletion HTTP evidence");
requireFragments(webHttpTest, "Web profile deletion HTTP evidence", [
  "expect(verification.status).toBe(204)",
  'expect(verification.headers.get("cache-control")).toBe("no-store")',
  'expect(verification.headers.get("set-cookie")).toContain("viberacing_session=")',
]);

const jobsCommandTest = normalizedFile(jobsCommandTestPath, "Jobs deletion command evidence");
requireFragments(jobsCommandTest, "Jobs deletion command evidence", [
  '["purge-profile-deletions", { batchSize: 10, kind: "purge_profile_deletions" }]',
  '["cleanup-terminal-deletion-jobs", { batchSize: 1_000, kind: "cleanup_terminal_deletion_jobs" }]',
  "parses one closed no-argument command",
]);

const scheduleTest = normalizedFile(scheduleTestPath, "Jobs scheduler deletion evidence");
requireFragments(scheduleTest, "Jobs scheduler deletion evidence", [
  'expect(jobs[10]).toEqual({ batchSize: 10, kind: "purge_profile_deletions" })',
  'kinds.indexOf("purge_profile_deletions")',
  'kinds.indexOf("cleanup_terminal_deletion_jobs")',
]);

const databaseIntegration = normalizedFile(
  databaseIntegrationPath,
  "database integration deletion evidence",
);
requireFragments(databaseIntegration, "database integration deletion evidence", [
  'resolve(root, "database", "tests", "retention_jobs.sql")',
  '"retention and Jobs oracle"',
]);

const jobsIntegration = normalizedFile(jobsIntegrationPath, "Jobs PostgreSQL deletion evidence");
requireFragments(jobsIntegration, "Jobs PostgreSQL deletion evidence", [
  '"purge-profile-deletions"',
  '"cleanup-terminal-deletion-jobs"',
  "for (const command of commandCatalog)",
]);

if (failures.length > 0) {
  console.error(`Deletion failure runbook check failed with ${failures.length} finding(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Deletion failure runbook check passed (${expectedControlIds.length} controls, ${expectedCommands.length} commands, clean-slate request/snapshot-gated purge/terminal-retention bindings).`,
);
