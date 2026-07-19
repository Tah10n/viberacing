import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import process from "node:process";

import { validateManifest } from "./check-database.mjs";

const root = resolve(import.meta.dirname, "..");
const projectName = `vr-jobs-it-${process.pid}`;
const containerName = `${projectName}-postgres`;
const composePrefix = [
  "compose",
  "--ansi",
  "never",
  "--project-name",
  projectName,
  "--profile",
  "test",
];
const databaseName = "viberacing_local";
const bootstrapUser = "viberacing_local";
const jobsLogin = "viberacing_jobs_login";
const jobsPassword = "synthetic-jobs-integration-password";
const wideJobsLogin = "viberacing_jobs_wide_login";
const wideJobsPassword = "synthetic-wide-jobs-integration-password";
const extraRole = "viberacing_jobs_extra";
const completedMessage = "Vibe Racing Jobs command completed.\n";
const failedMessage = "Vibe Racing Jobs command failed.\n";
const finalizedSeasonStart = "2000-01-03";

const fixture = Object.freeze({
  authChallengeId: "00000000-0000-4000-8000-000000031101",
  auditEventId: "00000000-0000-4000-8000-000000031901",
  carProfileId: "00000000-0000-4000-8000-000000031201",
  carProposalId: "00000000-0000-4000-8000-000000031202",
  inviteId: "00000000-0000-4000-8000-000000031701",
  pairingDeviceKeyId: "00000000-0000-4000-8000-000000031301",
  pairingId: "00000000-0000-4000-8000-000000031302",
  provenanceDeviceKeyId: "00000000-0000-4000-8000-000000031913",
  provenancePairingId: "00000000-0000-4000-8000-000000031914",
  provenancePasskeyId: "00000000-0000-4000-8000-000000031911",
  provenanceSessionId: "00000000-0000-4000-8000-000000031912",
  purgeJobId: "00000000-0000-4000-8000-000000031401",
  purgeProfileId: "00000000-0000-4000-8000-000000031402",
  scoringProfileId: "00000000-0000-4000-8000-000000031501",
  sessionId: "00000000-0000-4000-8000-000000031601",
  sessionProfileId: "00000000-0000-4000-8000-000000031602",
  terminalDeletionJobId: "00000000-0000-4000-8000-000000031801",
});

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 120_000,
    windowsHide: true,
    ...options,
  });
  if (result.error) {
    throw new Error(`${command} could not complete: ${result.error.message}`);
  }
  return result;
}

function requireSuccess(result, label) {
  if (result.status === 0) {
    return;
  }
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  throw new Error(`${label} failed${output ? `:\n${output}` : ""}`);
}

function docker(args, options = {}) {
  return run("docker", args, options);
}

function psqlArguments() {
  return [
    "exec",
    "-i",
    containerName,
    "psql",
    "--no-psqlrc",
    "--quiet",
    "--username",
    bootstrapUser,
    "--dbname",
    databaseName,
    "--set",
    "ON_ERROR_STOP=1",
    "--set",
    "VERBOSITY=terse",
  ];
}

function psql(sql, label) {
  const result = docker(psqlArguments(), { input: sql, timeout: 30_000 });
  requireSuccess(result, label);
}

function psqlScalar(sql, label) {
  const result = docker([...psqlArguments(), "--tuples-only", "--no-align", "--command", sql], {
    timeout: 10_000,
  });
  requireSuccess(result, label);
  return result.stdout.trim();
}

function buildWorkspace(relativePath, label) {
  const workspaceRoot = resolve(root, relativePath);
  const workspaceRequire = createRequire(resolve(workspaceRoot, "package.json"));
  const tsc = workspaceRequire.resolve("typescript/bin/tsc");
  const result = run(process.execPath, [tsc, "--project", "tsconfig.build.json"], {
    cwd: workspaceRoot,
  });
  requireSuccess(result, label);
}

function loadReviewedMigrations() {
  const migrationDirectory = resolve(root, "database", "migrations");
  const manifest = JSON.parse(readFileSync(resolve(migrationDirectory, "manifest.json"), "utf8"));
  const filesByPath = new Map();

  for (const entry of readdirSync(migrationDirectory, { withFileTypes: true })) {
    if (entry.name === "manifest.json") {
      continue;
    }
    if (entry.isSymbolicLink() || !entry.isFile() || !entry.name.endsWith(".sql")) {
      throw new Error(`unsafe migration directory entry: ${entry.name}`);
    }
    const path = `database/migrations/${entry.name}`;
    filesByPath.set(path, readFileSync(resolve(migrationDirectory, entry.name), "utf8"));
  }

  const findings = validateManifest(manifest, filesByPath);
  if (findings.length > 0) {
    throw new Error(`migration manifest validation failed:\n- ${findings.join("\n- ")}`);
  }

  return manifest.migrations.map((migration) => ({
    label: `migration ${migration.revision}: ${migration.name}`,
    sql: filesByPath.get(migration.path),
  }));
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitForHealthyContainer() {
  const deadline = Date.now() + 60_000;
  let lastStatus = "missing";
  while (Date.now() < deadline) {
    const result = docker(["inspect", "--format", "{{.State.Health.Status}}", containerName], {
      timeout: 10_000,
    });
    if (result.status === 0) {
      lastStatus = result.stdout.trim();
      if (lastStatus === "healthy") {
        return;
      }
      if (lastStatus === "unhealthy") {
        break;
      }
    }
    await sleep(250);
  }
  throw new Error(`isolated PostgreSQL did not become healthy (${lastStatus})`);
}

function readPublishedPostgresPort() {
  const result = docker(["port", containerName, "5432/tcp"], { timeout: 10_000 });
  requireSuccess(result, "isolated PostgreSQL port discovery");
  const output = result.stdout.trim();
  const match = /^127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(output);
  if (match === null) {
    throw new Error("isolated PostgreSQL did not publish one exact IPv4 loopback port");
  }
  const port = Number(match[1]);
  if (!Number.isSafeInteger(port) || port > 65_535) {
    throw new Error("isolated PostgreSQL returned an invalid loopback port");
  }
  return port;
}

function jobsEnvironment(databasePort, login, password) {
  return Object.freeze({
    NODE_ENV: "test",
    VIBERACING_JOBS_DATABASE_HOST: "127.0.0.1",
    VIBERACING_JOBS_DATABASE_NAME: databaseName,
    VIBERACING_JOBS_DATABASE_PASSWORD: password,
    VIBERACING_JOBS_DATABASE_PORT: String(databasePort),
    VIBERACING_JOBS_DATABASE_TLS_MODE: "disable",
    VIBERACING_JOBS_DATABASE_USER: login,
  });
}

function runJobsCommand(databasePort, login, password, args) {
  return run(process.execPath, [resolve(root, "apps", "jobs", "dist", "main.js"), ...args], {
    env: jobsEnvironment(databasePort, login, password),
    maxBuffer: 64 * 1024,
    timeout: 45_000,
  });
}

function assertSuccessfulCommand(result, label) {
  assert.equal(result.signal, null, `${label} must not be terminated by a signal`);
  assert.equal(result.status, 0, `${label} must exit successfully`);
  assert.equal(result.stdout, completedMessage, `${label} must emit one generic success sentence`);
  assert.equal(result.stderr, "", `${label} must not emit stderr`);
}

function assertRejectedCommand(result, label) {
  assert.equal(result.signal, null, `${label} must not be terminated by a signal`);
  assert.equal(result.status, 1, `${label} must exit with the closed failure code`);
  assert.equal(result.stdout, "", `${label} must not emit stdout`);
  assert.equal(result.stderr, failedMessage, `${label} must emit one generic failure sentence`);
}

function assertCanonicalMonday(value) {
  assert.match(value, /^\d{4}-\d{2}-\d{2}$/);
  const date = new Date(`${value}T00:00:00.000Z`);
  assert.equal(date.toISOString().slice(0, 10), value);
  assert.equal(date.getUTCDay(), 1);
}

function seedSyntheticState(currentSeasonStart) {
  psql(
    `BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.auth_challenges (
  challenge_id,
  purpose,
  challenge_digest,
  context_digest,
  created_at,
  expires_at
)
VALUES (
  '${fixture.authChallengeId}',
  'passkey_login',
  pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('12', 32), 'hex'),
  pg_catalog.statement_timestamp() - INTERVAL '10 minutes',
  pg_catalog.statement_timestamp() - INTERVAL '5 minutes'
);

INSERT INTO viberacing_private.audit_events (
  audit_event_id,
  event_type,
  actor_kind,
  request_id,
  occurred_at
)
VALUES (
  '${fixture.auditEventId}',
  'session.revoked',
  'system',
  'req_' || pg_catalog.repeat('K', 22),
  pg_catalog.statement_timestamp() - INTERVAL '200 days'
);

INSERT INTO viberacing_private.invites (
  invite_id,
  verifier_digest,
  created_at,
  expires_at
)
VALUES (
  '${fixture.inviteId}',
  pg_catalog.decode(pg_catalog.repeat('71', 32), 'hex'),
  pg_catalog.statement_timestamp() - INTERVAL '2 hours',
  pg_catalog.statement_timestamp() - INTERVAL '1 hour'
);

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES
  ('${fixture.carProfileId}', 900000000000031201, 'jobs-it-car', 'active'),
  ('${fixture.sessionProfileId}', 900000000000031602, 'jobs-it-session', 'active'),
  ('${fixture.scoringProfileId}', 900000000000031501, 'jobs-it-score', 'active');

INSERT INTO viberacing_private.passkeys (
  passkey_id,
  profile_id,
  credential_id,
  cose_public_key,
  label,
  created_at
)
VALUES (
  '${fixture.provenancePasskeyId}',
  '${fixture.sessionProfileId}',
  pg_catalog.decode(pg_catalog.repeat('A1', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('A2', 64), 'hex'),
  'Synthetic provenance passkey',
  pg_catalog.statement_timestamp() - INTERVAL '210 days'
);

INSERT INTO viberacing_private.profiles (
  profile_id,
  github_user_id,
  handle,
  state,
  created_at,
  updated_at,
  hidden_at,
  deletion_requested_at
)
VALUES (
  '${fixture.purgeProfileId}',
  900000000000031402,
  'jobs-it-purge',
  'deletion_pending',
  pg_catalog.statement_timestamp() - INTERVAL '2 hours',
  pg_catalog.statement_timestamp() - INTERVAL '1 hour',
  pg_catalog.statement_timestamp() - INTERVAL '1 hour',
  pg_catalog.statement_timestamp() - INTERVAL '1 hour'
);

INSERT INTO viberacing_private.car_recipe_proposals (
  proposal_id,
  profile_id,
  schema_version,
  chassis,
  nose,
  cockpit,
  wing,
  wheels,
  palette,
  trail,
  seed,
  created_at,
  expires_at
)
VALUES (
  '${fixture.carProposalId}',
  '${fixture.carProfileId}',
  1,
  'roadster',
  'classic',
  'open',
  'none',
  'street',
  'mint',
  'none',
  31,
  pg_catalog.statement_timestamp() - INTERVAL '2 hours',
  pg_catalog.statement_timestamp() - INTERVAL '1 hour'
);

INSERT INTO viberacing_private.origin_nonces (origin_key_id, nonce_digest, expires_at)
VALUES (
  'edge_jobs_integration',
  pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
  pg_catalog.statement_timestamp() - INTERVAL '5 minutes'
);

INSERT INTO viberacing_private.device_keys (
  device_key_id,
  public_key,
  label,
  connector_version,
  os_family,
  architecture,
  created_at
)
VALUES (
  '${fixture.pairingDeviceKeyId}',
  pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex'),
  'Synthetic expired pairing',
  '1.2.3',
  'linux',
  'x86_64',
  pg_catalog.statement_timestamp() - INTERVAL '20 minutes'
);

INSERT INTO viberacing_private.pairing_transactions (
  pairing_id,
  poll_verifier_digest,
  user_code_digest,
  challenge,
  pending_device_key_id,
  device_label,
  connector_version,
  os_family,
  architecture,
  created_at,
  expires_at
)
VALUES (
  '${fixture.pairingId}',
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('42', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('43', 32), 'hex'),
  '${fixture.pairingDeviceKeyId}',
  'Synthetic expired pairing',
  '1.2.3',
  'linux',
  'x86_64',
  pg_catalog.statement_timestamp() - INTERVAL '20 minutes',
  pg_catalog.statement_timestamp() - INTERVAL '10 minutes'
);

INSERT INTO viberacing_private.sessions (
  session_id,
  profile_id,
  verifier_digest,
  authentication_kind,
  authenticated_by_passkey_id,
  created_at,
  expires_at
)
VALUES
  (
    '${fixture.sessionId}',
    '${fixture.sessionProfileId}',
    pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex'),
    'enrollment',
    NULL,
    pg_catalog.statement_timestamp() - INTERVAL '2 hours',
    pg_catalog.statement_timestamp() - INTERVAL '1 hour'
  ),
  (
    '${fixture.provenanceSessionId}',
    '${fixture.sessionProfileId}',
    pg_catalog.decode(pg_catalog.repeat('A3', 32), 'hex'),
    'passkey',
    '${fixture.provenancePasskeyId}',
    pg_catalog.statement_timestamp() - INTERVAL '210 days',
    pg_catalog.statement_timestamp() - INTERVAL '190 days'
  );

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES (
  'src_' || pg_catalog.repeat('V', 22),
  '${fixture.sessionProfileId}'
);

INSERT INTO viberacing_private.device_keys (
  device_key_id,
  public_key,
  label,
  connector_version,
  os_family,
  architecture,
  created_at
)
VALUES (
  '${fixture.provenanceDeviceKeyId}',
  pg_catalog.decode(pg_catalog.repeat('A4', 32), 'hex'),
  'Synthetic provenance device',
  '9.0.0',
  'linux',
  'x86_64',
  pg_catalog.statement_timestamp() - INTERVAL '202 days'
);

INSERT INTO viberacing_private.pairing_transactions (
  pairing_id,
  poll_verifier_digest,
  user_code_digest,
  challenge,
  pending_device_key_id,
  device_label,
  connector_version,
  os_family,
  architecture,
  created_at,
  expires_at
)
VALUES (
  '${fixture.provenancePairingId}',
  pg_catalog.decode(pg_catalog.repeat('A5', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('A6', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('A7', 32), 'hex'),
  '${fixture.provenanceDeviceKeyId}',
  'Synthetic provenance device',
  '9.0.0',
  'linux',
  'x86_64',
  pg_catalog.statement_timestamp() - INTERVAL '202 days',
  pg_catalog.statement_timestamp() - INTERVAL '199 days'
);

UPDATE viberacing_private.pairing_transactions
SET
  state = 'approved',
  approved_profile_id = '${fixture.sessionProfileId}',
  source_choice = 'existing',
  approved_source_id = 'src_' || pg_catalog.repeat('V', 22),
  approved_by_session_id = '${fixture.provenanceSessionId}',
  approved_by_passkey_id = '${fixture.provenancePasskeyId}',
  approved_at = pg_catalog.statement_timestamp() - INTERVAL '201 days'
WHERE pairing_id = '${fixture.provenancePairingId}';

UPDATE viberacing_private.device_keys
SET
  state = 'active',
  source_id = 'src_' || pg_catalog.repeat('V', 22),
  device_id = 'dev_' || pg_catalog.repeat('V', 22),
  activated_at = pg_catalog.statement_timestamp() - INTERVAL '200 days'
WHERE device_key_id = '${fixture.provenanceDeviceKeyId}';

UPDATE viberacing_private.pairing_transactions
SET
  state = 'activated',
  activated_device_id = 'dev_' || pg_catalog.repeat('V', 22),
  activated_at = pg_catalog.statement_timestamp() - INTERVAL '200 days'
WHERE pairing_id = '${fixture.provenancePairingId}';

INSERT INTO viberacing_private.deletion_jobs (
  deletion_job_id,
  profile_id,
  profile_ref_digest,
  requested_at,
  available_at
)
VALUES (
  '${fixture.purgeJobId}',
  '${fixture.purgeProfileId}',
  pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex'),
  pg_catalog.statement_timestamp() - INTERVAL '1 hour',
  pg_catalog.statement_timestamp() - INTERVAL '1 hour'
);

INSERT INTO viberacing_private.deletion_jobs (
  deletion_job_id,
  profile_ref_digest,
  state,
  requested_at,
  available_at,
  completed_at
)
VALUES (
  '${fixture.terminalDeletionJobId}',
  pg_catalog.decode(pg_catalog.repeat('81', 32), 'hex'),
  'purged',
  pg_catalog.statement_timestamp() - INTERVAL '50 days',
  pg_catalog.statement_timestamp() - INTERVAL '50 days',
  pg_catalog.statement_timestamp() - INTERVAL '40 days'
);

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES ('src_' || pg_catalog.repeat('J', 22), '${fixture.scoringProfileId}');

INSERT INTO viberacing_private.source_day_values (
  source_id,
  codex_reported_date,
  tokens,
  accepted_sync_id,
  accepted_device_id,
  first_accepted_at,
  last_accepted_at
)
VALUES (
  'src_' || pg_catalog.repeat('J', 22),
  DATE '${currentSeasonStart}',
  12345,
  'syn_' || pg_catalog.repeat('J', 22),
  'dev_' || pg_catalog.repeat('J', 22),
  pg_catalog.statement_timestamp(),
  pg_catalog.statement_timestamp()
);
COMMIT;`,
    "synthetic Jobs integration fixture",
  );
}

async function main() {
  buildWorkspace("apps/jobs", "Jobs production build");

  let containerStarted = false;
  let primaryFailure;
  let cleanupFailure;

  try {
    const start = docker(
      [
        ...composePrefix,
        "run",
        "--detach",
        "--no-deps",
        "--name",
        containerName,
        "--publish",
        "127.0.0.1::5432",
        "postgres-test",
      ],
      { timeout: 120_000 },
    );
    requireSuccess(start, "isolated PostgreSQL start");
    containerStarted = true;
    await waitForHealthyContainer();
    const databasePort = readPublishedPostgresPort();

    psql(
      readFileSync(resolve(root, "database", "roles", "bootstrap.sql"), "utf8"),
      "database role bootstrap",
    );
    for (const migration of loadReviewedMigrations()) {
      psql(migration.sql, migration.label);
    }

    psql(
      `BEGIN;
CREATE ROLE ${extraRole} NOLOGIN;
CREATE ROLE ${jobsLogin}
  WITH LOGIN PASSWORD '${jobsPassword}'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT viberacing_jobs TO ${jobsLogin} WITH INHERIT FALSE, SET TRUE;
GRANT CONNECT ON DATABASE ${databaseName} TO ${jobsLogin};
ALTER ROLE ${jobsLogin} IN DATABASE ${databaseName}
  SET search_path TO pg_catalog, pg_temp;

CREATE ROLE ${wideJobsLogin}
  WITH LOGIN PASSWORD '${wideJobsPassword}'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT viberacing_jobs TO ${wideJobsLogin} WITH INHERIT FALSE, SET TRUE;
GRANT ${extraRole} TO ${wideJobsLogin};
GRANT CONNECT ON DATABASE ${databaseName} TO ${wideJobsLogin};
ALTER ROLE ${wideJobsLogin} IN DATABASE ${databaseName}
  SET search_path TO pg_catalog, pg_temp;
COMMIT;`,
      "narrow and deliberately widened synthetic Jobs logins",
    );

    const currentSeasonStart = psqlScalar(
      `SELECT (
  CURRENT_DATE - (pg_catalog.date_part('isodow', CURRENT_DATE)::integer - 1)
)::text;`,
      "current Community season discovery",
    );
    assertCanonicalMonday(currentSeasonStart);
    seedSyntheticState(currentSeasonStart);

    const rejected = runJobsCommand(databasePort, wideJobsLogin, wideJobsPassword, [
      "redact-aged-pairing-approval-provenance",
    ]);
    assertRejectedCommand(rejected, "widened Jobs login");
    assert.equal(
      psqlScalar(
        `SET ROLE viberacing_owner;
SELECT pg_catalog.count(*)::integer
FROM viberacing_private.pairing_transactions
WHERE pairing_id = '${fixture.provenancePairingId}'
  AND approved_by_session_id = '${fixture.provenanceSessionId}'
  AND approved_by_passkey_id = '${fixture.provenancePasskeyId}';`,
        "rejected-login stored-state verification",
      ),
      "1",
      "the runtime probe must fail before the requested cleanup mutates state",
    );

    const commands = [
      ["cleanup-expired-auth-state"],
      ["cleanup-expired-audit-events"],
      ["cleanup-expired-car-recipe-proposals"],
      ["cleanup-expired-invites"],
      ["cleanup-expired-ingest-state"],
      ["cleanup-expired-pairing-state"],
      ["redact-aged-pairing-approval-provenance"],
      ["cleanup-expired-sessions"],
      ["purge-profile-deletions"],
      ["cleanup-terminal-deletion-jobs"],
      ["refresh-community-season", currentSeasonStart],
      ["finalize-community-season", finalizedSeasonStart],
    ];
    for (const args of commands) {
      const result = runJobsCommand(databasePort, jobsLogin, jobsPassword, args);
      assertSuccessfulCommand(result, `Jobs command ${args[0]}`);
    }

    const storedState = JSON.parse(
      psqlScalar(
        `SET ROLE viberacing_owner;
SELECT pg_catalog.jsonb_build_object(
  'authChallengeCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '${fixture.authChallengeId}'
  ),
  'auditEventCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.audit_events
    WHERE audit_event_id = '${fixture.auditEventId}'
  ),
  'carProposalCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.car_recipe_proposals
    WHERE proposal_id = '${fixture.carProposalId}'
  ),
  'inviteCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.invites
    WHERE invite_id = '${fixture.inviteId}'
  ),
  'originNonceCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.origin_nonces
    WHERE origin_key_id = 'edge_jobs_integration'
  ),
  'pairingCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '${fixture.pairingId}'
  ),
  'pendingDeviceKeyCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.device_keys
    WHERE device_key_id = '${fixture.pairingDeviceKeyId}'
  ),
  'provenanceDeviceCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.device_keys
    WHERE device_key_id = '${fixture.provenanceDeviceKeyId}'
      AND state = 'active'
      AND source_id = 'src_' || pg_catalog.repeat('V', 22)
      AND device_id = 'dev_' || pg_catalog.repeat('V', 22)
  ),
  'provenancePairingCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '${fixture.provenancePairingId}'
      AND state = 'activated'
      AND approved_source_id = 'src_' || pg_catalog.repeat('V', 22)
      AND activated_device_id = 'dev_' || pg_catalog.repeat('V', 22)
  ),
  'provenancePairingRedacted', (
    SELECT approved_by_session_id IS NULL AND approved_by_passkey_id IS NULL
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '${fixture.provenancePairingId}'
  ),
  'provenancePasskeyCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.passkeys
    WHERE passkey_id = '${fixture.provenancePasskeyId}'
      AND state = 'active'
  ),
  'provenanceSessionCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.sessions
    WHERE session_id = '${fixture.provenanceSessionId}'
  ),
  'sessionCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.sessions
    WHERE session_id = '${fixture.sessionId}'
  ),
  'purgeProfileCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.profiles
    WHERE profile_id = '${fixture.purgeProfileId}'
  ),
  'purgeJobState', (
    SELECT state
    FROM viberacing_private.deletion_jobs
    WHERE deletion_job_id = '${fixture.purgeJobId}'
  ),
  'purgeJobProfileCleared', (
    SELECT profile_id IS NULL
    FROM viberacing_private.deletion_jobs
    WHERE deletion_job_id = '${fixture.purgeJobId}'
  ),
  'purgeJobCompleted', (
    SELECT completed_at IS NOT NULL
    FROM viberacing_private.deletion_jobs
    WHERE deletion_job_id = '${fixture.purgeJobId}'
  ),
  'terminalDeletionJobCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.deletion_jobs
    WHERE deletion_job_id = '${fixture.terminalDeletionJobId}'
  ),
  'refreshSeasonState', (
    SELECT state
    FROM viberacing_private.seasons
    WHERE season_start = DATE '${currentSeasonStart}'
  ),
  'refreshEntryCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.season_entries
    WHERE season_start = DATE '${currentSeasonStart}'
  ),
  'refreshDailyCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.season_daily_scores
    WHERE season_start = DATE '${currentSeasonStart}'
  ),
  'sourceDayTokens', (
    SELECT tokens
    FROM viberacing_private.source_day_values
    WHERE source_id = 'src_' || pg_catalog.repeat('J', 22)
      AND codex_reported_date = DATE '${currentSeasonStart}'
  ),
  'finalizedSeasonState', (
    SELECT state
    FROM viberacing_private.seasons
    WHERE season_start = DATE '${finalizedSeasonStart}'
  ),
  'finalizedAtSet', (
    SELECT finalized_at IS NOT NULL
    FROM viberacing_private.seasons
    WHERE season_start = DATE '${finalizedSeasonStart}'
  ),
  'finalizedEntryCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.season_entries
    WHERE season_start = DATE '${finalizedSeasonStart}'
  )
)::text;`,
        "Jobs stored-state verification",
      ),
    );
    assert.deepEqual(storedState, {
      authChallengeCount: 0,
      auditEventCount: 0,
      carProposalCount: 0,
      finalizedAtSet: true,
      finalizedEntryCount: 0,
      finalizedSeasonState: "finalized",
      inviteCount: 0,
      originNonceCount: 0,
      pairingCount: 0,
      pendingDeviceKeyCount: 0,
      provenanceDeviceCount: 1,
      provenancePairingCount: 1,
      provenancePairingRedacted: true,
      provenancePasskeyCount: 1,
      provenanceSessionCount: 0,
      purgeJobCompleted: true,
      purgeJobProfileCleared: true,
      purgeJobState: "purged",
      purgeProfileCount: 0,
      refreshDailyCount: 7,
      refreshEntryCount: 1,
      refreshSeasonState: "open",
      sessionCount: 0,
      sourceDayTokens: 12345,
      terminalDeletionJobCount: 0,
    });

    console.log(
      "Jobs PostgreSQL integration passed (twelve commands, least-privilege denial, generic output, and exact stored state).",
    );
  } catch (error) {
    primaryFailure = error;
  } finally {
    if (containerStarted) {
      const remove = docker(["rm", "--force", "--volumes", containerName], {
        timeout: 30_000,
      });
      if (remove.status !== 0) {
        cleanupFailure ??= new Error("isolated PostgreSQL container cleanup failed");
      }
    }
    const down = docker([...composePrefix, "down", "--volumes", "--remove-orphans"], {
      timeout: 30_000,
    });
    if (down.status !== 0) {
      cleanupFailure ??= new Error("isolated PostgreSQL network cleanup failed");
    }
  }

  if (primaryFailure !== undefined) {
    throw primaryFailure;
  }
  if (cleanupFailure !== undefined) {
    throw cleanupFailure;
  }
}

await main();
