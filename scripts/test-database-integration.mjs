import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import { validateManifest } from "./check-database.mjs";

const root = resolve(import.meta.dirname, "..");
const projectName = `vr-dbtest-${process.pid}`;
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
const databaseUser = "viberacing_local";
const archiveOne = "/tmp/viberacing-clean-bootstrap-one.dump";
const archiveTwo = "/tmp/viberacing-clean-bootstrap-two.dump";
const archiveThree = "/tmp/viberacing-clean-bootstrap-three.dump";
const maximumToolOutput = 32 * 1024 * 1024;

function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: maximumToolOutput,
    timeout: 120_000,
    ...options,
  });
  if (result.error) {
    throw new Error(`Docker command could not complete: ${result.error.message}`);
  }
  return result;
}

function requireSuccess(result, label) {
  if (result.status === 0) {
    return result.stdout;
  }
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  throw new Error(`${label} failed${output ? `:\n${output}` : ""}`);
}

function psqlArgs(database = databaseName) {
  return [
    ...composePrefix,
    "exec",
    "-T",
    "postgres-test",
    "psql",
    "--no-psqlrc",
    "--quiet",
    "--tuples-only",
    "--no-align",
    "--username",
    databaseUser,
    "--dbname",
    database,
    "--set",
    "ON_ERROR_STOP=1",
    "--set",
    "VERBOSITY=terse",
  ];
}

function psql(sql, options = {}) {
  return docker(psqlArgs(options.database), {
    input: sql,
    timeout: options.timeout ?? 120_000,
  });
}

function psqlValue(sql, database = databaseName) {
  return requireSuccess(psql(sql, { database }), "PostgreSQL value query").trim();
}

function container(command, args, options = {}) {
  return docker([...composePrefix, "exec", "-T", "postgres-test", command, ...args], options);
}

function readCatalog() {
  const manifest = JSON.parse(
    readFileSync(resolve(root, "database", "migrations", "manifest.json"), "utf8"),
  );
  const migrationDirectory = resolve(root, "database", "migrations");
  const filesByPath = new Map();
  for (const entry of readdirSync(migrationDirectory, { withFileTypes: true })) {
    if (entry.name === "manifest.json") {
      continue;
    }
    assert.equal(entry.isFile(), true, `migration entry is not a file: ${entry.name}`);
    const path = `database/migrations/${entry.name}`;
    filesByPath.set(path, readFileSync(resolve(migrationDirectory, entry.name), "utf8"));
  }
  assert.deepEqual(validateManifest(manifest, filesByPath), []);
  return manifest.migrations.map((entry) => ({
    ...entry,
    sql: filesByPath.get(entry.path),
  }));
}

function spawnPsql(sql) {
  const child = spawn("docker", psqlArgs(), {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => {
    stdout.push(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr.push(chunk);
  });
  child.stdin.end(sql);
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("concurrent PostgreSQL contender exceeded its deadline"));
    }, 30_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        code,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      });
    });
  });
}

function startRefreshMutexHolder() {
  const child = spawn("docker", psqlArgs(), {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  let heldResolve;
  let heldReject;
  const held = new Promise((resolvePromise, reject) => {
    heldResolve = resolvePromise;
    heldReject = reject;
  });
  const done = new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("snapshot refresh mutex holder exceeded its deadline"));
    }, 15_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      heldReject(error);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const result = {
        code,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      };
      if (!result.stdout.includes("refresh-mutex-held")) {
        heldReject(new Error(`snapshot refresh mutex was not acquired: ${result.stderr}`));
      }
      resolvePromise(result);
    });
  });
  child.stdout.on("data", (chunk) => {
    stdout.push(chunk);
    if (Buffer.concat(stdout).toString("utf8").includes("refresh-mutex-held")) {
      heldResolve();
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr.push(chunk);
  });
  child.stdin.end(`
BEGIN;
SET ROLE viberacing_owner;
SELECT capability
FROM viberacing_private.maintenance_mutexes
WHERE capability = 'leaderboard_refresh'
FOR UPDATE;
SELECT 'refresh-mutex-held';
SELECT pg_catalog.pg_sleep(5);
ROLLBACK;
`);
  return { done, held };
}

function canonicalArchiveDigest(archive, section) {
  const result = container(
    "pg_restore",
    [
      "--file=-",
      "--restrict-key=cleanBootstrapRestore1",
      ...(section === "schema"
        ? ["--schema-only", "--create"]
        : ["--data-only", "--disable-triggers"]),
      archive,
    ],
    { encoding: null, maxBuffer: maximumToolOutput, timeout: 120_000 },
  );
  assert.equal(result.status, 0, `${section} archive render failed`);
  assert.ok(Buffer.isBuffer(result.stdout));
  assert.ok(result.stdout.byteLength > 0);
  const length = result.stdout.byteLength;
  const digest = createHash("sha256").update(result.stdout).digest("hex");
  result.stdout.fill(0);
  if (Buffer.isBuffer(result.stderr)) {
    result.stderr.fill(0);
  }
  return { digest, length };
}

function semanticSchemaDigest() {
  const canonical = psqlValue(`
SELECT pg_catalog.jsonb_build_object(
  'relations', (
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_array(
        namespace.nspname,
        relation.relname,
        relation.relkind,
        owner_role.rolname,
        relation.relrowsecurity,
        relation.relforcerowsecurity
      )
      ORDER BY namespace.nspname, relation.relname
    )
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = relation.relowner
    WHERE namespace.nspname IN ('viberacing_private', 'viberacing_api')
      AND relation.relkind IN ('r', 'i', 'S')
  ),
  'columns', (
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_array(
        namespace.nspname,
        relation.relname,
        attribute.attname,
        pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
        attribute.attnotnull,
        pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)
      )
      ORDER BY namespace.nspname, relation.relname, attribute.attnum
    )
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef AS default_value
      ON default_value.adrelid = attribute.attrelid
      AND default_value.adnum = attribute.attnum
    WHERE namespace.nspname IN ('viberacing_private', 'viberacing_api')
      AND relation.relkind = 'r'
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  'constraints', (
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_array(
        namespace.nspname,
        relation.relname,
        constraint_row.conname,
        constraint_row.contype,
        pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
      )
      ORDER BY namespace.nspname, relation.relname, constraint_row.conname
    )
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_row.conrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname IN ('viberacing_private', 'viberacing_api')
  ),
  'functions', (
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_array(
        namespace.nspname,
        procedure.proname,
        pg_catalog.pg_get_function_identity_arguments(procedure.oid),
        owner_role.rolname,
        procedure.prosecdef,
        procedure.provolatile,
        procedure.proconfig,
        procedure.prosrc
      )
      ORDER BY namespace.nspname, procedure.proname,
        pg_catalog.pg_get_function_identity_arguments(procedure.oid)
    )
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = procedure.proowner
    WHERE namespace.nspname IN ('viberacing_private', 'viberacing_api')
  ),
  'policies', (
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_array(
        namespace.nspname,
        relation.relname,
        policy.polname,
        policy.polcmd,
        policy.polpermissive,
        pg_catalog.pg_get_expr(policy.polqual, policy.polrelid),
        pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
      )
      ORDER BY namespace.nspname, relation.relname, policy.polname
    )
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname IN ('viberacing_private', 'viberacing_api')
  ),
  'routine_grants', (
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_array(
        grant_row.routine_schema,
        grant_row.routine_name,
        grant_row.grantee,
        grant_row.privilege_type
      )
      ORDER BY grant_row.routine_schema, grant_row.routine_name,
        grant_row.grantee, grant_row.privilege_type
    )
    FROM information_schema.routine_privileges AS grant_row
    WHERE grant_row.routine_schema IN ('viberacing_private', 'viberacing_api')
      AND grant_row.grantee <> 'viberacing_owner'
  )
)::text;
`);
  return {
    digest: createHash("sha256").update(canonical, "utf8").digest("hex"),
    length: Buffer.byteLength(canonical, "utf8"),
  };
}

function finalizedSnapshotEvidence() {
  return JSON.parse(
    psqlValue(`
SELECT pg_catalog.jsonb_build_object(
  'canonicalPayload', page.canonical_payload,
  'etag', snapshot.etag,
  'pageDigest', pg_catalog.encode(page.payload_digest, 'hex'),
  'revision', snapshot.revision,
  'seasonStart', snapshot.season_start,
  'snapshotDigest', pg_catalog.encode(snapshot.payload_digest, 'hex'),
  'snapshotId', snapshot.snapshot_id
)::text
FROM viberacing_private.seasons AS season
JOIN viberacing_private.leaderboard_published_snapshots AS published
  ON published.season_start = season.season_start
  AND published.trust_tier = season.trust_tier
JOIN viberacing_private.leaderboard_snapshots AS snapshot
  ON snapshot.snapshot_id = published.snapshot_id
JOIN viberacing_private.leaderboard_snapshot_pages AS page
  ON page.snapshot_id = snapshot.snapshot_id
  AND page.page_kind = 'leaderboard_page'
  AND page.page_number = 1
WHERE season.trust_tier = 'community'
  AND season.state = 'finalized'
  AND snapshot.finalized
  AND snapshot.state = 'published'
ORDER BY season.season_start
LIMIT 1;
`),
  );
}

function createArchive(database, archive) {
  requireSuccess(
    container("pg_dump", [
      "--format=custom",
      "--create",
      "--serializable-deferrable",
      "--lock-wait-timeout=5s",
      "--file",
      archive,
      "--username",
      databaseUser,
      "--dbname",
      database,
    ]),
    `snapshot archive for ${database}`,
  );
}

function restoreArchive(archive) {
  requireSuccess(
    psql(`DROP DATABASE ${databaseName} WITH (FORCE);`, { database: "postgres" }),
    "drop current snapshot database",
  );
  requireSuccess(
    container("pg_restore", [
      "--exit-on-error",
      "--create",
      "--username",
      databaseUser,
      "--dbname",
      "postgres",
      archive,
    ]),
    "restore current snapshot database",
  );
}

const catalog = readCatalog();
assert.ok(catalog.length >= 2 && catalog.length <= 7, "clean bootstrap must stay small");

let restoreEvidence;
try {
  requireSuccess(
    docker([...composePrefix, "up", "--detach", "--wait", "postgres-test"], {
      timeout: 120_000,
    }),
    "start disposable PostgreSQL",
  );

  requireSuccess(
    psql(readFileSync(resolve(root, "database", "roles", "bootstrap.sql"), "utf8")),
    "role bootstrap",
  );
  for (const migration of catalog) {
    requireSuccess(psql(migration.sql), `migration ${migration.revision}`);
  }

  requireSuccess(
    psql(
      readFileSync(resolve(root, "database", "tests", "identity_bootstrap_assertions.sql"), "utf8"),
    ),
    "clean bootstrap semantic oracle",
  );
  requireSuccess(
    psql(readFileSync(resolve(root, "database", "tests", "identity_auth.sql"), "utf8")),
    "identity and authentication oracle",
  );
  requireSuccess(
    psql(readFileSync(resolve(root, "database", "tests", "agent_accounts_pairing.sql"), "utf8")),
    "agent-account and batch-pairing oracle",
  );
  requireSuccess(
    psql(readFileSync(resolve(root, "database", "tests", "usage_accounting.sql"), "utf8")),
    "atomic usage-accounting oracle",
  );
  requireSuccess(
    psql(readFileSync(resolve(root, "database", "tests", "seasons_snapshots.sql"), "utf8"), {
      timeout: 120_000,
    }),
    "season ranking and snapshot oracle",
  );

  const refreshMutexHolder = startRefreshMutexHolder();
  await refreshMutexHolder.held;
  const blockedRefresh = await spawnPsql(`
SET ROLE viberacing_jobs;
SELECT outcome
FROM viberacing_api.refresh_next_dirty_community_season();
`);
  assert.equal(blockedRefresh.code, 0, blockedRefresh.stderr);
  assert.equal(
    blockedRefresh.stdout.trim(),
    "busy",
    "concurrent snapshot refresh did not fail closed at the mutex",
  );
  const refreshMutexHolderResult = await refreshMutexHolder.done;
  assert.equal(refreshMutexHolderResult.code, 0, refreshMutexHolderResult.stderr);

  const directRead = psql(`
SET SESSION AUTHORIZATION viberacing_web;
SELECT profile_id FROM viberacing_private.profiles;
`);
  assert.notEqual(directRead.status, 0, "Web unexpectedly read a private table");

  const crossCapability = psql(`
SET SESSION AUTHORIZATION viberacing_ingest;
SELECT * FROM viberacing_api.read_private_profile(
  '00000000-0000-4000-8000-000000000001',
  pg_catalog.decode(pg_catalog.repeat('01', 32), 'hex')
);
`);
  assert.notEqual(crossCapability.status, 0, "Ingest unexpectedly executed a Web capability");

  const githubId = 9_100_000_000_001;
  const contender = (suffix, digestByte) => `
SET ROLE viberacing_web;
SELECT created
FROM viberacing_api.open_github_profile(
  '20000000-0000-4000-8000-${suffix}',
  ${githubId},
  'concurrent-driver',
  'en',
  '21000000-0000-4000-8000-${suffix}',
  pg_catalog.decode(pg_catalog.repeat('${digestByte}', 32), 'hex'),
  pg_catalog.transaction_timestamp() + interval '20 minutes',
  NULL
);
`;
  const [first, second] = await Promise.all([
    spawnPsql(contender("000000000001", "31")),
    spawnPsql(contender("000000000002", "32")),
  ]);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(
    psqlValue(
      `SELECT pg_catalog.count(*) FROM viberacing_private.profiles WHERE github_user_id = ${githubId};`,
    ),
    "1",
    "concurrent OAuth completion created more than one profile",
  );
  assert.equal(
    psqlValue(
      `SELECT pg_catalog.count(*) FROM viberacing_private.sessions
       WHERE profile_id = (
         SELECT profile_id FROM viberacing_private.profiles WHERE github_user_id = ${githubId}
       );`,
    ),
    "2",
    "both converged OAuth completions must retain their own bounded session",
  );

  requireSuccess(
    psql(`
SET ROLE viberacing_owner;
INSERT INTO viberacing_private.seasons (
  season_start,
  trust_tier,
  season_end,
  metric_version,
  accounting_policy_version,
  state,
  opened_at,
  grace_ends_at
)
SELECT
  season_start,
  'community',
  season_start + 6,
  'provider_reported_tokens_v1',
  'agent_account_cumulative_utc_v1',
  'open',
  season_start::timestamp AT TIME ZONE 'UTC',
  ((season_start + 7)::timestamp AT TIME ZONE 'UTC') + interval '48 hours'
FROM (
  SELECT
    (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
      - (
        extract(
          isodow FROM (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
        )::integer - 1
      ) AS season_start
) AS current_season
ON CONFLICT (season_start, trust_tier) DO NOTHING;
UPDATE viberacing_private.agent_providers
SET state = 'supported'
WHERE provider_code = 'codex';
UPDATE viberacing_private.agent_accounting_revisions
SET enabled_for_new_accounts = true
WHERE provider_code = 'codex'
  AND accounting_revision = 1;
INSERT INTO viberacing_private.profiles (
  profile_id, github_user_id, handle, locale, hidden_at
)
VALUES (
  '50000000-0000-4000-8000-000000000001',
  940000000000001,
  'concurrent-usage',
  'en',
  pg_catalog.transaction_timestamp()
);
UPDATE viberacing_private.profiles
SET state = 'active'
WHERE profile_id = '50000000-0000-4000-8000-000000000001';
INSERT INTO viberacing_private.agent_accounts (
  agent_account_id,
  profile_id,
  provider_code,
  accounting_revision,
  scope_kind,
  fingerprint_kind,
  account_fingerprint_digest,
  private_label,
  identity_assurance
)
VALUES (
  'acc_CCCCCCCCCCCCCCCCCCCCCC',
  '50000000-0000-4000-8000-000000000001',
  'codex',
  1,
  'agent_account',
  'stable_opaque',
  pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex'),
  'Concurrent usage',
  'community_local'
);
INSERT INTO viberacing_private.connector_installations (
  installation_id,
  profile_id,
  installation_public_key,
  label,
  connector_version,
  os_family,
  architecture,
  state,
  activated_at,
  last_seen_at
)
VALUES
  (
    'ins_CCCCCCCCCCCCCCCCCCCCCC',
    '50000000-0000-4000-8000-000000000001',
    pg_catalog.decode(pg_catalog.repeat('52', 32), 'hex'),
    'Concurrent one',
    '0.0.0',
    'windows',
    'x86_64',
    'active',
    pg_catalog.transaction_timestamp(),
    pg_catalog.transaction_timestamp()
  ),
  (
    'ins_DDDDDDDDDDDDDDDDDDDDDD',
    '50000000-0000-4000-8000-000000000001',
    pg_catalog.decode(pg_catalog.repeat('53', 32), 'hex'),
    'Concurrent two',
    '0.0.0',
    'linux',
    'aarch64',
    'active',
    pg_catalog.transaction_timestamp(),
    pg_catalog.transaction_timestamp()
  );
INSERT INTO viberacing_private.device_keys (
  device_key_id,
  device_id,
  profile_id,
  installation_id,
  agent_account_id,
  public_key
)
VALUES
  (
    'key_CCCCCCCCCCCCCCCCCCCCCC',
    'dev_CCCCCCCCCCCCCCCCCCCCCC',
    '50000000-0000-4000-8000-000000000001',
    'ins_CCCCCCCCCCCCCCCCCCCCCC',
    'acc_CCCCCCCCCCCCCCCCCCCCCC',
    pg_catalog.decode(pg_catalog.repeat('54', 32), 'hex')
  ),
  (
    'key_DDDDDDDDDDDDDDDDDDDDDD',
    'dev_DDDDDDDDDDDDDDDDDDDDDD',
    '50000000-0000-4000-8000-000000000001',
    'ins_DDDDDDDDDDDDDDDDDDDDDD',
    'acc_CCCCCCCCCCCCCCCCCCCCCC',
    pg_catalog.decode(pg_catalog.repeat('55', 32), 'hex')
  );
`),
    "concurrent usage fixture",
  );

  const usageContender = (marker, total) => `
SET ROLE viberacing_ingest;
SELECT outcome
FROM viberacing_api.submit_usage_sync(
  'obs_${marker.repeat(22)}',
  'evt_${marker.repeat(22)}',
  'edge_test',
  pg_catalog.decode(pg_catalog.repeat('${marker === "C" ? "6c" : "6d"}', 32), 'hex'),
  pg_catalog.transaction_timestamp() + interval '30 seconds',
  'key_${marker.repeat(22)}',
  'dev_${marker.repeat(22)}',
  'acc_CCCCCCCCCCCCCCCCCCCCCC',
  'syn_${marker.repeat(22)}',
  pg_catalog.transaction_timestamp(),
  '0.0.0',
  'codex_app_server_0_144_5_v1',
  pg_catalog.decode(pg_catalog.repeat('${marker === "C" ? "7c" : "7d"}', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('${marker === "C" ? "8c" : "8d"}', 64), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('${marker === "C" ? "9c" : "9d"}', 32), 'hex'),
  ARRAY[(pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date],
  ARRAY['${total}']::text[]
);
`;
  const [lowerUsage, higherUsage] = await Promise.all([
    spawnPsql(usageContender("C", "100")),
    spawnPsql(usageContender("D", "200")),
  ]);
  assert.equal(lowerUsage.code, 0, lowerUsage.stderr);
  assert.equal(higherUsage.code, 0, higherUsage.stderr);

  const concurrentUsageEvidence = JSON.parse(
    psqlValue(`
SELECT pg_catalog.json_build_object(
  'dayTotal', (
    SELECT cumulative_token_total::text
    FROM viberacing_private.agent_account_day_totals
    WHERE agent_account_id = 'acc_CCCCCCCCCCCCCCCCCCCCCC'
  ),
  'observationCount', (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.usage_observations
    WHERE agent_account_id = 'acc_CCCCCCCCCCCCCCCCCCCCCC'
  ),
  'acceptedCount', (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.usage_observations
    WHERE agent_account_id = 'acc_CCCCCCCCCCCCCCCCCCCCCC'
      AND outcome = 'accepted'
  ),
  'quarantinedCount', (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.usage_observations
    WHERE agent_account_id = 'acc_CCCCCCCCCCCCCCCCCCCCCC'
      AND outcome = 'quarantined'
  ),
  'eventCount', (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.ranking_events
    WHERE agent_account_id = 'acc_CCCCCCCCCCCCCCCCCCCCCC'
  ),
  'chainHeadCount', (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.ranking_events AS event
    WHERE event.agent_account_id = 'acc_CCCCCCCCCCCCCCCCCCCCCC'
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.ranking_events AS successor
        WHERE successor.agent_account_id = event.agent_account_id
          AND successor.previous_event_digest = event.event_digest
      )
  )
)::text;
`),
  );
  assert.equal(concurrentUsageEvidence.dayTotal, "200");
  assert.equal(Number(concurrentUsageEvidence.observationCount), 2);
  assert.ok(
    Number(concurrentUsageEvidence.acceptedCount) === 1 ||
      Number(concurrentUsageEvidence.acceptedCount) === 2,
  );
  assert.equal(
    Number(concurrentUsageEvidence.acceptedCount) +
      Number(concurrentUsageEvidence.quarantinedCount),
    2,
  );
  assert.equal(Number(concurrentUsageEvidence.eventCount), 2);
  assert.equal(Number(concurrentUsageEvidence.chainHeadCount), 1);

  requireSuccess(
    psql(`
SET ROLE viberacing_owner;
UPDATE viberacing_private.agent_accounting_revisions
SET enabled_for_new_accounts = false
WHERE provider_code = 'codex'
  AND accounting_revision = 1;
UPDATE viberacing_private.agent_providers
SET state = 'recognized'
WHERE provider_code = 'codex';
`),
    "restore pre-reader provider state after concurrency oracle",
  );

  const ledger = JSON.parse(
    psqlValue(`
SELECT pg_catalog.json_agg(
  pg_catalog.json_build_object('revision', revision, 'name', name)
  ORDER BY revision
)::text
FROM viberacing_private.schema_migrations;
`),
  );
  assert.deepEqual(
    ledger,
    catalog.map(({ name, revision }) => ({ name, revision })),
    "database ledger drifted from the reviewed clean catalog",
  );

  const sourceFinalizedSnapshot = finalizedSnapshotEvidence();
  createArchive(databaseName, archiveOne);
  const sourceData = canonicalArchiveDigest(archiveOne, "data");
  restoreArchive(archiveOne);
  requireSuccess(
    psql(
      readFileSync(resolve(root, "database", "tests", "identity_bootstrap_assertions.sql"), "utf8"),
    ),
    "first restored semantic oracle",
  );
  assert.deepEqual(
    finalizedSnapshotEvidence(),
    sourceFinalizedSnapshot,
    "first restore changed the finalized snapshot",
  );

  const firstRestoredSchema = semanticSchemaDigest();
  createArchive(databaseName, archiveTwo);
  const firstRestoredData = canonicalArchiveDigest(archiveTwo, "data");
  assert.deepEqual(firstRestoredData, sourceData, "first restored data archive drifted");

  restoreArchive(archiveTwo);
  requireSuccess(
    psql(
      readFileSync(resolve(root, "database", "tests", "identity_bootstrap_assertions.sql"), "utf8"),
    ),
    "second restored semantic oracle",
  );
  assert.deepEqual(
    finalizedSnapshotEvidence(),
    sourceFinalizedSnapshot,
    "second restore changed the finalized snapshot",
  );
  const secondRestoredSchema = semanticSchemaDigest();
  assert.deepEqual(
    secondRestoredSchema,
    firstRestoredSchema,
    "normalized restored schema drifted across generations",
  );
  createArchive(databaseName, archiveThree);
  const secondRestoredData = canonicalArchiveDigest(archiveThree, "data");
  assert.deepEqual(secondRestoredData, sourceData, "second restored data archive drifted");
  restoreEvidence = {
    dataBytes: sourceData.length,
    schemaBytes: firstRestoredSchema.length,
  };
} finally {
  docker([...composePrefix, "down", "--volumes", "--remove-orphans"], {
    timeout: 120_000,
  });
}

console.log(
  `Database integration passed (${catalog.length} clean logical migrations, forced-RLS and least-privilege identity/auth semantics, concurrent GitHub convergence, adversarial multi-account pairing/device lifecycle, atomic exact-decimal usage with deterministic two-device concurrency, direct-token ranking across 208 public profiles, immutable last-good/final snapshots, two-session refresh-overlap suppression, and two snapshot restores with byte-stable ${restoreEvidence.schemaBytes}-byte schema/${restoreEvidence.dataBytes}-byte data evidence).`,
);
