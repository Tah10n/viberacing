import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

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

let started = false;
try {
  const start = docker([...composePrefix, "up", "--detach", "--wait", "postgres-test"], {
    stdio: "inherit",
  });
  started = true;
  requireSuccess(start, "isolated PostgreSQL start");

  for (const [path, label] of [
    ["database/roles/bootstrap.sql", "database role bootstrap"],
    ["database/migrations/0001_identity_foundation.sql", "identity migration"],
    ["database/tests/identity_invariants.sql", "identity and role invariants"],
  ]) {
    requireSuccess(psql(readFileSync(resolve(root, path), "utf8")), label);
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

  console.log("Database integration passed (12 schema tables, 4 runtime deny matrices).");
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
