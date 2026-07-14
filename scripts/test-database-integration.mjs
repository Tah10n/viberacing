import { spawnSync } from "node:child_process";
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

function psql(sql) {
  return docker(
    [
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
    ],
    { input: sql, timeout: 30_000 },
  );
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
  ];
  for (const { sql, label } of databaseInputs) {
    requireSuccess(psql(sql), label);
  }

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

  console.log(
    "Database integration passed (13 schema tables, 4 relation-denial and 4 cross-capability checks).",
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
