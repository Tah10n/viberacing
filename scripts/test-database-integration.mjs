import { spawn, spawnSync } from "node:child_process";
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

function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
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
    return;
  }
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  throw new Error(`${label} failed${output ? `:\n${output}` : ""}`);
}

function psqlArguments() {
  return [
    ...composePrefix,
    "exec",
    "-T",
    "postgres-test",
    "psql",
    "--no-psqlrc",
    "--username",
    "viberacing_local",
    "--dbname",
    "viberacing_local",
    "--set",
    "ON_ERROR_STOP=1",
    "--set",
    "VERBOSITY=terse",
  ];
}

function psql(sql) {
  return docker(psqlArguments(), { input: sql, timeout: 30_000 });
}

function startPsql(sql, readyMarker) {
  let stdout = "";
  let stderr = "";
  let readySettled = false;
  let resolveReady;
  let rejectReady;

  const ready = new Promise((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise;
    rejectReady = rejectPromise;
  });

  if (!readyMarker) {
    readySettled = true;
    resolveReady();
  }

  const completion = new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("docker", psqlArguments(), {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const timeout = setTimeout(() => {
      const error = new Error("concurrent PostgreSQL command exceeded 30 seconds");
      child.kill();
      if (!readySettled) {
        readySettled = true;
        rejectReady(error);
      }
      rejectPromise(error);
    }, 30_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (!readySettled && stdout.includes(readyMarker)) {
        readySettled = true;
        resolveReady();
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdin.on("error", (error) => {
      stderr += `\nstdin: ${error.message}`;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (!readySettled) {
        readySettled = true;
        rejectReady(error);
      }
      rejectPromise(error);
    });
    child.on("close", (status, signal) => {
      clearTimeout(timeout);
      if (!readySettled) {
        readySettled = true;
        rejectReady(new Error(`lock holder exited before marker ${readyMarker}`));
      }
      resolvePromise({ status, signal, stdout, stderr });
    });
    child.stdin.end(sql);
  });

  return { ready, completion };
}

async function expectOneConcurrentWinner(label, lockSql, readyMarker, contenderSql) {
  const lockHolder = startPsql(lockSql, readyMarker);
  try {
    await lockHolder.ready;
  } catch (error) {
    await lockHolder.completion.catch(() => undefined);
    throw error;
  }

  const contenders = contenderSql.map((sql) => startPsql(sql).completion);
  const [lockResult, contenderResults] = await Promise.all([
    lockHolder.completion,
    Promise.all(contenders),
  ]);
  requireSuccess(lockResult, `${label} lock holder`);

  const winners = contenderResults.filter((result) => result.status === 0);
  const losers = contenderResults.filter((result) => result.status !== 0);
  const expectedClosedFailure = losers.every((result) =>
    /operation cannot be completed/i.test(`${result.stdout}\n${result.stderr}`),
  );
  if (winners.length !== 1 || losers.length !== 1 || !expectedClosedFailure) {
    const evidence = contenderResults
      .map(
        (result, index) =>
          `contender ${index + 1} status=${result.status}\n${result.stdout}\n${result.stderr}`,
      )
      .join("\n");
    throw new Error(`${label} did not produce one winner and one closed loser:\n${evidence}`);
  }
}

function expectDenied(role, statement, label) {
  const result = psql(`SET ROLE ${role};\n${statement}\n`);
  if (result.status === 0) {
    throw new Error(`${label} unexpectedly succeeded`);
  }
  const output = `${result.stdout}\n${result.stderr}`;
  if (!/permission denied/i.test(output)) {
    throw new Error(`${label} failed for an unexpected reason`);
  }
}

function loadReviewedMigrations() {
  const manifest = JSON.parse(
    readFileSync(resolve(root, "database/migrations/manifest.json"), "utf8"),
  );
  const filesByPath = new Map();
  const migrationDirectory = resolve(root, "database", "migrations");

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

let started = false;
try {
  const start = docker([...composePrefix, "up", "--detach", "--wait", "postgres-test"], {
    stdio: "inherit",
  });
  started = true;
  requireSuccess(start, "isolated PostgreSQL start");

  const databaseInputs = [
    {
      label: "database role bootstrap",
      sql: readFileSync(resolve(root, "database/roles/bootstrap.sql"), "utf8"),
    },
    ...loadReviewedMigrations(),
    {
      label: "identity and role invariants",
      sql: readFileSync(resolve(root, "database/tests/identity_invariants.sql"), "utf8"),
    },
    {
      label: "identity capability scenarios",
      sql: readFileSync(resolve(root, "database/tests/identity_capabilities.sql"), "utf8"),
    },
    {
      label: "source-bound pairing scenarios",
      sql: readFileSync(resolve(root, "database/tests/pairing_capabilities.sql"), "utf8"),
    },
    {
      label: "pairing concurrency setup",
      sql: readFileSync(resolve(root, "database/tests/pairing_concurrency_setup.sql"), "utf8"),
    },
  ];
  for (const { sql, label } of databaseInputs) {
    requireSuccess(psql(sql), label);
  }

  await expectOneConcurrentWinner(
    "single pairing approval race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT pairing_id
FROM viberacing_private.pairing_transactions
WHERE pairing_id = '00000000-0000-4000-8000-000000008501'
FOR UPDATE;
\\echo pairing-race-lock-ready
SELECT pg_catalog.pg_sleep(2);
COMMIT;`,
    "pairing-race-lock-ready",
    [
      `SET ROLE viberacing_web;
SELECT viberacing_api.approve_pairing(
  '00000000-0000-4000-8000-000000008201',
  pg_catalog.decode(pg_catalog.repeat('81', 32), 'hex'),
  '00000000-0000-4000-8000-000000008501',
  '00000000-0000-4000-8000-000000008701',
  pg_catalog.decode(pg_catalog.repeat('22', 32), 'hex'),
  '00000000-0000-4000-8000-000000008801',
  'req_' || pg_catalog.repeat('C', 22)
);`,
      `SET ROLE viberacing_web;
SELECT viberacing_api.approve_pairing(
  '00000000-0000-4000-8000-000000008202',
  pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
  '00000000-0000-4000-8000-000000008501',
  '00000000-0000-4000-8000-000000008702',
  pg_catalog.decode(pg_catalog.repeat('24', 32), 'hex'),
  '00000000-0000-4000-8000-000000008802',
  'req_' || pg_catalog.repeat('D', 22)
);`,
    ],
  );

  await expectOneConcurrentWinner(
    "source ceiling race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT profile_id
FROM viberacing_private.profiles
WHERE profile_id = '00000000-0000-4000-8000-000000008103'
FOR UPDATE;
\\echo source-cap-lock-ready
SELECT pg_catalog.pg_sleep(2);
COMMIT;`,
    "source-cap-lock-ready",
    [
      `SET ROLE viberacing_web;
SELECT viberacing_api.approve_pairing(
  '00000000-0000-4000-8000-000000008203',
  pg_catalog.decode(pg_catalog.repeat('83', 32), 'hex'),
  '00000000-0000-4000-8000-000000008502',
  '00000000-0000-4000-8000-000000008703',
  pg_catalog.decode(pg_catalog.repeat('26', 32), 'hex'),
  '00000000-0000-4000-8000-000000008803',
  'req_' || pg_catalog.repeat('E', 22)
);`,
      `SET ROLE viberacing_web;
SELECT viberacing_api.approve_pairing(
  '00000000-0000-4000-8000-000000008204',
  pg_catalog.decode(pg_catalog.repeat('84', 32), 'hex'),
  '00000000-0000-4000-8000-000000008503',
  '00000000-0000-4000-8000-000000008704',
  pg_catalog.decode(pg_catalog.repeat('28', 32), 'hex'),
  '00000000-0000-4000-8000-000000008804',
  'req_' || pg_catalog.repeat('F', 22)
);`,
    ],
  );

  await expectOneConcurrentWinner(
    "device authority ceiling race",
    `BEGIN;
SET LOCAL ROLE viberacing_owner;
SELECT profile_id
FROM viberacing_private.profiles
WHERE profile_id = '00000000-0000-4000-8000-000000008104'
FOR UPDATE;
\\echo device-cap-lock-ready
SELECT pg_catalog.pg_sleep(2);
COMMIT;`,
    "device-cap-lock-ready",
    [
      `SET ROLE viberacing_web;
SELECT viberacing_api.approve_pairing(
  '00000000-0000-4000-8000-000000008205',
  pg_catalog.decode(pg_catalog.repeat('85', 32), 'hex'),
  '00000000-0000-4000-8000-000000008504',
  '00000000-0000-4000-8000-000000008705',
  pg_catalog.decode(pg_catalog.repeat('2a', 32), 'hex'),
  '00000000-0000-4000-8000-000000008805',
  'req_' || pg_catalog.repeat('G', 22)
);`,
      `SET ROLE viberacing_web;
SELECT viberacing_api.approve_pairing(
  '00000000-0000-4000-8000-000000008206',
  pg_catalog.decode(pg_catalog.repeat('86', 32), 'hex'),
  '00000000-0000-4000-8000-000000008505',
  '00000000-0000-4000-8000-000000008706',
  pg_catalog.decode(pg_catalog.repeat('2c', 32), 'hex'),
  '00000000-0000-4000-8000-000000008806',
  'req_' || pg_catalog.repeat('H', 22)
);`,
    ],
  );

  requireSuccess(
    psql(readFileSync(resolve(root, "database/tests/pairing_concurrency_assertions.sql"), "utf8")),
    "pairing concurrency assertions",
  );

  for (const role of [
    "viberacing_web",
    "viberacing_ingest",
    "viberacing_jobs",
    "viberacing_admin",
  ]) {
    expectDenied(role, "SELECT count(*) FROM viberacing_private.profiles;", `${role} private read`);
    expectDenied(
      role,
      "CREATE TABLE viberacing_api.forbidden (value integer);",
      `${role} API schema mutation`,
    );
  }

  expectDenied(
    "viberacing_web",
    `SELECT viberacing_api.issue_invite(
      '00000000-0000-4000-8000-000000009001',
      pg_catalog.decode(pg_catalog.repeat('90', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '1 hour',
      '00000000-0000-4000-8000-000000009002',
      'req_' || pg_catalog.repeat('Z', 22),
      'SECURITY_REVIEW'
    );`,
    "web invite issuance",
  );
  expectDenied(
    "viberacing_admin",
    `SELECT viberacing_api.enroll_profile(
      '00000000-0000-4000-8000-000000009011',
      pg_catalog.decode(pg_catalog.repeat('91', 32), 'hex'),
      '00000000-0000-4000-8000-000000009012',
      900000000000009012,
      'denied-driver',
      'en',
      'neon-night',
      'system',
      true,
      '00000000-0000-4000-8000-000000009013',
      pg_catalog.decode(pg_catalog.repeat('92', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '1 hour',
      '00000000-0000-4000-8000-000000009014',
      'req_' || pg_catalog.repeat('Y', 22)
    );`,
    "admin profile enrollment",
  );
  expectDenied(
    "viberacing_ingest",
    `SELECT viberacing_api.revoke_session(
      '00000000-0000-4000-8000-000000009021',
      pg_catalog.decode(pg_catalog.repeat('93', 32), 'hex'),
      '00000000-0000-4000-8000-000000009022',
      'req_' || pg_catalog.repeat('X', 22)
    );`,
    "ingest session revocation",
  );
  expectDenied(
    "viberacing_jobs",
    `SELECT viberacing_api.consume_auth_challenge(
      '00000000-0000-4000-8000-000000009031',
      pg_catalog.decode(pg_catalog.repeat('94', 32), 'hex'),
      '00000000-0000-4000-8000-000000009032',
      'profile_deletion',
      pg_catalog.decode(pg_catalog.repeat('95', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('96', 32), 'hex')
    );`,
    "jobs challenge consumption",
  );
  expectDenied(
    "viberacing_admin",
    `SELECT viberacing_api.start_pairing(
      '00000000-0000-4000-8000-000000009041',
      pg_catalog.decode(pg_catalog.repeat('97', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('98', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex'),
      '00000000-0000-4000-8000-000000009042',
      pg_catalog.decode(pg_catalog.repeat('9a', 32), 'hex'),
      'denied-device',
      '0.0.0-test',
      'test-os',
      'test-arch',
      pg_catalog.statement_timestamp() + INTERVAL '5 minutes'
    );`,
    "admin pairing start",
  );

  console.log(
    "Database integration passed (13 schema tables, 3 pairing races, 4 relation-denial and 5 cross-capability checks).",
  );
} finally {
  if (started) {
    const cleanup = docker([...composePrefix, "down", "--volumes", "--remove-orphans"], {
      stdio: "inherit",
    });
    if (cleanup.status !== 0) {
      process.exitCode = cleanup.status ?? 1;
    }
  }
}
