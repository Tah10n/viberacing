import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes, sign, X509Certificate } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

import { validateManifest } from "./check-database.mjs";

// cspell:ignore localdomain regnamespace usename WINDIR

const root = resolve(import.meta.dirname, "..");
const migrateRoot = resolve(root, "apps", "migrate");
const migrateEntryPoint = resolve(migrateRoot, "dist", "main.js");
const migrateRequire = createRequire(resolve(migrateRoot, "package.json"));
const projectName = `vr-migrate-it-${process.pid}`;
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
const databaseTlsHost = "localhost.localdomain";
const databaseTlsCertificatePath = "/tmp/viberacing-migrate-it-server.crt";
const databaseTlsKeyPath = "/tmp/viberacing-migrate-it-server.key";
const migrationLogin = "viberacing_migration_login";
const migrationPassword = "synthetic-migration-integration-password";
const wideMigrationLogin = "viberacing_migration_wide_login";
const wideMigrationPassword = "synthetic-wide-migration-integration-password";
const extraRole = "viberacing_migration_extra";
const migrationApplicationName = "viberacing-migration-runner";
const catalogLockKey = 824_762_001;
const holderReadyMarker = "viberacing_migration_holder_ready";
const maximumChildOutputBytes = 8 * 1024;
const maximumHolderOutputBytes = 16 * 1024;
const holderDeadlineMs = 10_000;
const blockedObservationDeadlineMs = 10_000;
const controllerDeadlineMs = 150_000;

function derLength(length) {
  assert.equal(Number.isSafeInteger(length), true);
  assert.ok(length >= 0);
  if (length < 0x80) {
    return Buffer.from([length]);
  }
  const bytes = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag, ...parts) {
  const content = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLength(content.byteLength), content]);
}

function derSequence(...parts) {
  return der(0x30, ...parts);
}

function derObjectIdentifier(components) {
  assert.equal(Array.isArray(components), true);
  assert.equal(Object.getPrototypeOf(components), Array.prototype);
  assert.ok(components.length >= 2);
  assert.ok(components[0] >= 0 && components[0] <= 2);
  assert.ok(components[1] >= 0 && (components[0] === 2 || components[1] <= 39));
  const encoded = [components[0] * 40 + components[1]];
  for (const component of components.slice(2)) {
    assert.equal(Number.isSafeInteger(component), true);
    assert.ok(component >= 0);
    const base128 = [component & 0x7f];
    let remaining = Math.floor(component / 128);
    while (remaining > 0) {
      base128.unshift(0x80 | (remaining & 0x7f));
      remaining = Math.floor(remaining / 128);
    }
    encoded.push(...base128);
  }
  return der(0x06, Buffer.from(encoded));
}

function derInteger(bytes) {
  let value = bytes;
  while (value.byteLength > 1 && value[0] === 0) {
    value = value.subarray(1);
  }
  if ((value[0] & 0x80) !== 0) {
    value = Buffer.concat([Buffer.from([0]), value]);
  }
  return der(0x02, value);
}

function derBoolean(value) {
  return der(0x01, Buffer.from([value ? 0xff : 0]));
}

function derBitString(value, unusedBits = 0) {
  return der(0x03, Buffer.from([unusedBits]), value);
}

function derUtcTime(date) {
  const iso = date.toISOString();
  const value = `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
  return der(0x17, Buffer.from(value, "ascii"));
}

function certificateExtension(objectIdentifier, value, critical = false) {
  return derSequence(
    derObjectIdentifier(objectIdentifier),
    ...(critical ? [derBoolean(true)] : []),
    der(0x04, value),
  );
}

function pem(label, value) {
  const lines = value.toString("base64").match(/.{1,64}/g);
  assert.notEqual(lines, null);
  return Buffer.from(`-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`);
}

function createSyntheticTlsMaterial() {
  const directory = mkdtempSync(join(tmpdir(), "viberacing-migrate-it-"));
  const certificatePath = join(directory, "server.crt");
  const keyPath = join(directory, "server.key");
  const launcherPath = join(directory, "start-postgres.sh");
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
  const privateKeyDer = privateKey.export({ format: "der", type: "pkcs8" });
  const serial = randomBytes(16);
  serial[0] &= 0x7f;
  serial[0] ||= 1;
  const signatureAlgorithm = derSequence(
    derObjectIdentifier([1, 2, 840, 113549, 1, 1, 11]),
    der(0x05),
  );
  const name = derSequence(
    der(
      0x31,
      derSequence(derObjectIdentifier([2, 5, 4, 3]), der(0x0c, Buffer.from(databaseTlsHost))),
    ),
  );
  const now = Date.now();
  const extensions = derSequence(
    certificateExtension([2, 5, 29, 19], derSequence(derBoolean(true)), true),
    certificateExtension([2, 5, 29, 15], derBitString(Buffer.from([0xa6]), 1), true),
    certificateExtension(
      [2, 5, 29, 17],
      derSequence(der(0x82, Buffer.from(databaseTlsHost, "ascii"))),
    ),
    certificateExtension(
      [2, 5, 29, 37],
      derSequence(derObjectIdentifier([1, 3, 6, 1, 5, 5, 7, 3, 1])),
    ),
  );
  const certificateBody = derSequence(
    der(0xa0, derInteger(Buffer.from([2]))),
    derInteger(serial),
    signatureAlgorithm,
    name,
    derSequence(derUtcTime(new Date(now - 300_000)), derUtcTime(new Date(now + 3_600_000))),
    name,
    publicKeyDer,
    der(0xa3, extensions),
  );
  const certificateDer = derSequence(
    certificateBody,
    signatureAlgorithm,
    derBitString(sign("sha256", certificateBody, privateKey)),
  );
  const certificatePem = pem("CERTIFICATE", certificateDer);
  const keyPem = pem("PRIVATE KEY", privateKeyDer);
  try {
    const certificate = new X509Certificate(certificatePem);
    assert.equal(certificate.ca, true);
    assert.equal(certificate.checkHost(databaseTlsHost), databaseTlsHost);
    assert.equal(certificate.verify(certificate.publicKey), true);
    writeFileSync(certificatePath, certificatePem, { mode: 0o600 });
    writeFileSync(keyPath, keyPem, { mode: 0o600 });
    writeFileSync(
      launcherPath,
      `#!/bin/sh
set -eu
cp /viberacing-tls/server.crt ${databaseTlsCertificatePath}
cp /viberacing-tls/server.key ${databaseTlsKeyPath}
chown postgres:postgres ${databaseTlsCertificatePath} ${databaseTlsKeyPath}
chmod 0644 ${databaseTlsCertificatePath}
chmod 0600 ${databaseTlsKeyPath}
exec /usr/local/bin/docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=${databaseTlsCertificatePath} -c ssl_key_file=${databaseTlsKeyPath}
`,
      { mode: 0o700 },
    );
    return Object.freeze({ certificatePath, directory });
  } catch (error) {
    rmSync(directory, { force: true, recursive: true });
    throw error;
  } finally {
    certificatePem.fill(0);
    certificateDer.fill(0);
    certificateBody.fill(0);
    keyPem.fill(0);
    privateKeyDer.fill(0);
    serial.fill(0);
  }
}

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
  const result = docker(psqlArguments(), { input: sql, timeout: 60_000 });
  requireSuccess(result, label);
}

function psqlScalar(sql, label) {
  const result = docker([...psqlArguments(), "--tuples-only", "--no-align", "--command", sql], {
    timeout: 15_000,
  });
  requireSuccess(result, label);
  return result.stdout.trim();
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitWithDeadline(promise, milliseconds, message) {
  let timeoutToken;
  const timeout = new Promise((_, reject) => {
    timeoutToken = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutToken);
  }
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

function assertSyntheticDatabaseTls() {
  assert.equal(psqlScalar("SHOW ssl;", "synthetic PostgreSQL TLS state"), "on");
  assert.equal(
    psqlScalar("SHOW ssl_cert_file;", "synthetic PostgreSQL TLS certificate state"),
    databaseTlsCertificatePath,
  );
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

function buildMigrationRunner() {
  const tsc = migrateRequire.resolve("typescript/bin/tsc");
  const result = run(process.execPath, [tsc, "--project", "tsconfig.build.json"], {
    cwd: migrateRoot,
  });
  requireSuccess(result, "migration runner production build");
  const entryPoint = lstatSync(migrateEntryPoint);
  assert.equal(entryPoint.isFile(), true, "built migration entry point must be a regular file");
  assert.equal(
    entryPoint.isSymbolicLink(),
    false,
    "built migration entry point must not be a symbolic link",
  );
}

function loadReviewedManifest() {
  const migrationDirectory = resolve(root, "database", "migrations");
  const manifestPath = resolve(migrationDirectory, "manifest.json");
  const directoryMetadata = lstatSync(migrationDirectory);
  assert.equal(directoryMetadata.isDirectory(), true, "migration catalog must be a directory");
  assert.equal(directoryMetadata.isSymbolicLink(), false, "migration catalog must not be a link");
  const manifestMetadata = lstatSync(manifestPath);
  assert.equal(manifestMetadata.isFile(), true, "migration manifest must be a regular file");
  assert.equal(manifestMetadata.isSymbolicLink(), false, "migration manifest must not be a link");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
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
  assert.equal(manifest.migrations.length, 42);
  return manifest;
}

function baseChildEnvironment() {
  const environment = { NODE_ENV: "production" };
  for (const key of ["SystemRoot", "TEMP", "TMP", "WINDIR"]) {
    const value = process.env[key];
    if (value !== undefined) {
      environment[key] = value;
    }
  }
  return environment;
}

function migrationEnvironment(databasePort, login, password, certificatePath) {
  return Object.freeze({
    ...baseChildEnvironment(),
    NODE_EXTRA_CA_CERTS: certificatePath,
    VIBERACING_MIGRATIONS_DATABASE_HOST: databaseTlsHost,
    VIBERACING_MIGRATIONS_DATABASE_NAME: databaseName,
    VIBERACING_MIGRATIONS_DATABASE_PASSWORD: password,
    VIBERACING_MIGRATIONS_DATABASE_PORT: String(databasePort),
    VIBERACING_MIGRATIONS_DATABASE_TLS_MODE: "verify-full",
    VIBERACING_MIGRATIONS_DATABASE_USER: login,
    VIBERACING_MIGRATIONS_ENABLED: "true",
  });
}

function startMigrationController(databasePort, login, password, certificatePath) {
  let exited = false;
  let outputOverflow = false;
  let stdout = "";
  let stderr = "";
  let outputBytes = 0;
  const child = spawn(process.execPath, [migrateEntryPoint], {
    cwd: root,
    env: migrationEnvironment(databasePort, login, password, certificatePath),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const observe = (stream) => (chunk) => {
    outputBytes += chunk.byteLength;
    if (outputBytes > maximumChildOutputBytes) {
      outputOverflow = true;
      child.kill("SIGKILL");
      return;
    }
    if (stream === "stdout") {
      stdout += chunk.toString("utf8");
    } else {
      stderr += chunk.toString("utf8");
    }
  };
  child.stdout.on("data", observe("stdout"));
  child.stderr.on("data", observe("stderr"));
  const closed = new Promise((resolveClose, rejectClose) => {
    child.once("error", () => {
      exited = true;
      rejectClose(new Error("emitted migration controller could not start"));
    });
    child.once("close", (code, signal) => {
      exited = true;
      resolveClose(Object.freeze({ code, signal }));
    });
  });
  void closed.catch(() => undefined);
  return Object.freeze({
    child,
    closed,
    hasExited: () => exited,
    hasOutputOverflow: () => outputOverflow,
    readStderr: () => stderr,
    readStdout: () => stdout,
  });
}

async function stopMigrationController(controller) {
  if (!controller.hasExited()) {
    controller.child.kill("SIGKILL");
  }
  await waitWithDeadline(
    controller.closed,
    10_000,
    "emitted migration controller did not stop after forced termination",
  );
}

async function readMigrationControllerResult(controller, label) {
  let result;
  try {
    result = await waitWithDeadline(
      controller.closed,
      controllerDeadlineMs,
      `${label} did not settle within its fixed deadline`,
    );
  } catch (error) {
    await stopMigrationController(controller).catch(() => undefined);
    throw error;
  }
  if (controller.hasOutputOverflow()) {
    throw new Error(`${label} exceeded its fixed output budget`);
  }
  return Object.freeze({
    ...result,
    stderr: controller.readStderr(),
    stdout: controller.readStdout(),
  });
}

function assertRejectedController(result) {
  assert.deepEqual(result, {
    code: 1,
    signal: null,
    stderr: "Vibe Racing migrations failed.\n",
    stdout: "",
  });
}

function assertSuccessfulController(result) {
  assert.deepEqual(result, {
    code: 0,
    signal: null,
    stderr: "",
    stdout: "Vibe Racing migrations completed.\n",
  });
}

function assertSuccessfulControllers(results) {
  try {
    for (const result of results) {
      assertSuccessfulController(result);
    }
  } catch {
    const state = psqlScalar(
      `SELECT pg_catalog.jsonb_build_object(
  'ledgerExists', pg_catalog.to_regclass('viberacing_private.schema_migrations') IS NOT NULL,
  'privateTableCount', (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'viberacing_private'
      AND relation.relkind = 'r'
  ),
  'deadlockCount', deadlocks
)::text
FROM pg_catalog.pg_stat_database
WHERE datname = '${databaseName}';`,
      "failed migration-controller closed diagnostic",
    );
    const statuses = results.map(({ code, signal, stderr, stdout }) => ({
      code,
      signal,
      stderrClass:
        stderr === ""
          ? "empty"
          : stderr === "Vibe Racing migrations failed.\n"
            ? "generic-failure"
            : "unexpected",
      stdoutClass:
        stdout === ""
          ? "empty"
          : stdout === "Vibe Racing migrations completed.\n"
            ? "generic-success"
            : "unexpected",
    }));
    throw new Error(
      `emitted migration controllers did not both succeed (${JSON.stringify({ state: JSON.parse(state), statuses })})`,
    );
  }
}

function startCatalogLockHolder() {
  let exited = false;
  let outputBytes = 0;
  let outputOverflow = false;
  let outputTail = "";
  let readySettled = false;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise;
    rejectReady = rejectPromise;
  });
  const child = spawn("docker", psqlArguments(), {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const observeOutput = (chunk) => {
    outputBytes += chunk.byteLength;
    const text = `${outputTail}${chunk.toString("utf8")}`;
    outputTail = text.slice(-(holderReadyMarker.length + 64));
    if (outputBytes > maximumHolderOutputBytes) {
      outputOverflow = true;
      child.kill("SIGKILL");
      return;
    }
    if (!readySettled) {
      const match = new RegExp(`${holderReadyMarker}:([1-9][0-9]*)`).exec(text);
      if (match !== null) {
        const holderPid = Number(match[1]);
        if (!Number.isSafeInteger(holderPid)) {
          child.kill("SIGKILL");
          return;
        }
        readySettled = true;
        resolveReady(holderPid);
      }
    }
  };
  child.stdout.on("data", observeOutput);
  child.stderr.on("data", observeOutput);
  child.stdin.on("error", () => undefined);
  const closed = new Promise((resolveClose, rejectClose) => {
    child.once("error", () => {
      exited = true;
      if (!readySettled) {
        readySettled = true;
        rejectReady(new Error("PostgreSQL migration lock holder could not start"));
      }
      rejectClose(new Error("PostgreSQL migration lock holder could not start"));
    });
    child.once("close", (code, signal) => {
      exited = true;
      if (!readySettled) {
        readySettled = true;
        rejectReady(new Error("PostgreSQL migration lock holder exited before readiness"));
      }
      resolveClose(Object.freeze({ code, signal }));
    });
  });
  void ready.catch(() => undefined);
  void closed.catch(() => undefined);
  const holder = Object.freeze({
    child,
    closed,
    hasExited: () => exited,
    hasOutputOverflow: () => outputOverflow,
    ready,
  });
  child.stdin.write(`\\o /dev/null
SELECT pg_catalog.pg_backend_pid() AS holder_pid \\gset
SELECT pg_catalog.pg_advisory_lock(${catalogLockKey});
\\o
\\echo ${holderReadyMarker}::holder_pid
`);
  return holder;
}

async function waitForCatalogLockHolder(holder) {
  const holderPid = await waitWithDeadline(
    holder.ready,
    holderDeadlineMs,
    "PostgreSQL migration lock holder did not become ready",
  );
  if (holder.hasExited() || holder.hasOutputOverflow()) {
    throw new Error("PostgreSQL migration lock holder failed before controller observation");
  }
  return holderPid;
}

async function stopCatalogLockHolder(holder, release = true) {
  if (!holder.hasExited()) {
    if (release) {
      holder.child.stdin.end(`\\o /dev/null
SELECT pg_catalog.pg_advisory_unlock(${catalogLockKey});
\\q
`);
    } else {
      holder.child.kill("SIGKILL");
    }
  }
  let result;
  try {
    result = await waitWithDeadline(
      holder.closed,
      holderDeadlineMs,
      "PostgreSQL migration lock holder did not stop",
    );
  } catch (error) {
    if (!holder.hasExited()) {
      holder.child.kill("SIGKILL");
      await waitWithDeadline(
        holder.closed,
        holderDeadlineMs,
        "PostgreSQL migration lock holder did not close after forced termination",
      ).catch(() => undefined);
    }
    throw error;
  }
  if (holder.hasOutputOverflow()) {
    throw new Error("PostgreSQL migration lock holder exceeded its fixed output budget");
  }
  if (release && (result.code !== 0 || result.signal !== null)) {
    throw new Error("PostgreSQL migration lock holder did not close cleanly");
  }
}

function bootstrapMigrationLogins() {
  psql(
    readFileSync(resolve(root, "database", "roles", "bootstrap.sql"), "utf8"),
    "database role bootstrap",
  );
  psql(
    `BEGIN;
CREATE ROLE ${extraRole} NOLOGIN;
CREATE ROLE ${migrationLogin}
  WITH LOGIN PASSWORD '${migrationPassword}'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT viberacing_owner TO ${migrationLogin} WITH INHERIT FALSE, SET TRUE;
GRANT CONNECT ON DATABASE ${databaseName} TO ${migrationLogin};
ALTER ROLE ${migrationLogin} IN DATABASE ${databaseName}
  SET search_path TO pg_catalog, pg_temp;

CREATE ROLE ${wideMigrationLogin}
  WITH LOGIN PASSWORD '${wideMigrationPassword}'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT viberacing_owner TO ${wideMigrationLogin} WITH INHERIT FALSE, SET TRUE;
GRANT ${extraRole} TO ${wideMigrationLogin} WITH INHERIT FALSE, SET TRUE;
GRANT CONNECT ON DATABASE ${databaseName} TO ${wideMigrationLogin};
ALTER ROLE ${wideMigrationLogin} IN DATABASE ${databaseName}
  SET search_path TO pg_catalog, pg_temp;
COMMIT;`,
    "narrow and deliberately widened synthetic migration logins",
  );
}

function assertApplicationSchemaAbsent(label) {
  const absent = psqlScalar(
    `SELECT (
  pg_catalog.to_regnamespace('viberacing_private') IS NULL
  AND pg_catalog.to_regnamespace('viberacing_api') IS NULL
  AND pg_catalog.to_regclass('viberacing_private.schema_migrations') IS NULL
)::text;`,
    label,
  );
  assert.equal(absent, "true");
}

function readBlockedControllerObservation(holderPid, label) {
  return JSON.parse(
    psqlScalar(
      `SELECT pg_catalog.jsonb_build_object(
  'blockedCount', pg_catalog.count(*),
  'allBlockedByHolder', COALESCE(
    pg_catalog.bool_and(${holderPid} = ANY(pg_catalog.pg_blocking_pids(activity.pid))),
    false
  ),
  'allTls', COALESCE(
    pg_catalog.bool_and(
      tls.ssl
      AND tls.version IN ('TLSv1.2', 'TLSv1.3')
      AND tls.cipher IS NOT NULL
    ),
    false
  )
)::text
FROM pg_catalog.pg_stat_activity AS activity
JOIN pg_catalog.pg_stat_ssl AS tls
  ON tls.pid = activity.pid
WHERE activity.datname = '${databaseName}'
  AND activity.usename = '${migrationLogin}'
  AND activity.application_name = '${migrationApplicationName}'
  AND activity.state = 'active'
  AND activity.wait_event_type = 'Lock'
  AND pg_catalog.strpos(activity.query, 'pg_advisory_lock') > 0;`,
      label,
    ),
  );
}

async function waitForBlockedControllers(holderPid) {
  const deadline = Date.now() + blockedObservationDeadlineMs;
  let observation = Object.freeze({
    allBlockedByHolder: false,
    allTls: false,
    blockedCount: 0,
  });
  while (Date.now() < deadline) {
    observation = readBlockedControllerObservation(
      holderPid,
      "blocked migration-controller observation",
    );
    if (
      observation.blockedCount === 2 &&
      observation.allBlockedByHolder === true &&
      observation.allTls === true
    ) {
      return;
    }
    await sleep(25);
  }
  throw new Error(
    `expected two TLS migration controllers behind one holder, observed ${JSON.stringify(observation)}`,
  );
}

function assertExactLedgerAndSchema(manifest) {
  const observedLedger = JSON.parse(
    psqlScalar(
      `SELECT COALESCE(
  pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('revision', revision, 'name', name)
    ORDER BY revision
  ),
  '[]'::jsonb
)::text
FROM viberacing_private.schema_migrations;`,
      "migration ledger state",
    ),
  );
  assert.deepEqual(
    observedLedger,
    manifest.migrations.map(({ name, revision }) => ({ name, revision })),
  );

  const schemaBoundary = JSON.parse(
    psqlScalar(
      `SELECT pg_catalog.jsonb_build_object(
  'privateTableCount', pg_catalog.count(*),
  'allForcedRls', COALESCE(
    pg_catalog.bool_and(relation.relrowsecurity AND relation.relforcerowsecurity),
    false
  ),
  'allOwnerOwned', COALESCE(
    pg_catalog.bool_and(owner_role.rolname = 'viberacing_owner'),
    false
  )
)::text
FROM pg_catalog.pg_class AS relation
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = relation.relnamespace
JOIN pg_catalog.pg_roles AS owner_role
  ON owner_role.oid = relation.relowner
WHERE namespace.nspname = 'viberacing_private'
  AND relation.relkind = 'r';`,
      "migration schema boundary",
    ),
  );
  assert.deepEqual(schemaBoundary, {
    allForcedRls: true,
    allOwnerOwned: true,
    privateTableCount: 28,
  });

  psql(
    readFileSync(resolve(root, "database", "tests", "identity_invariants.sql"), "utf8"),
    "post-migration database invariant oracle",
  );
}

function assertControllerCleanup() {
  assert.equal(
    psqlScalar(
      `SELECT pg_catalog.count(*)::text
FROM pg_catalog.pg_stat_activity AS activity
WHERE activity.datname = '${databaseName}'
  AND activity.usename IN ('${migrationLogin}', '${wideMigrationLogin}');`,
      "migration controller connection cleanup",
    ),
    "0",
  );
  assert.equal(
    psqlScalar(
      `SELECT pg_catalog.pg_try_advisory_lock(${catalogLockKey})::text;`,
      "migration session lock cleanup",
    ),
    "true",
  );
}

async function main() {
  buildMigrationRunner();
  const manifest = loadReviewedManifest();
  let containerStarted = false;
  let tlsMaterial;
  let lockHolder;
  let lockHolderReleased = false;
  const activeControllers = new Set();
  let primaryFailure;
  let cleanupFailure;

  try {
    tlsMaterial = createSyntheticTlsMaterial();
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
        "--volume",
        `${tlsMaterial.directory}:/viberacing-tls:ro`,
        "--entrypoint",
        "/bin/sh",
        "postgres-test",
        "/viberacing-tls/start-postgres.sh",
      ],
      { timeout: 120_000 },
    );
    if (start.status !== 0) {
      throw new Error("isolated PostgreSQL start failed");
    }
    containerStarted = true;
    await waitForHealthyContainer();
    const databasePort = readPublishedPostgresPort();
    assertSyntheticDatabaseTls();
    bootstrapMigrationLogins();
    assertApplicationSchemaAbsent("pre-controller application schema state");

    const rejectedController = startMigrationController(
      databasePort,
      wideMigrationLogin,
      wideMigrationPassword,
      tlsMaterial.certificatePath,
    );
    activeControllers.add(rejectedController);
    const rejectedResult = await readMigrationControllerResult(
      rejectedController,
      "widened migration controller",
    );
    activeControllers.delete(rejectedController);
    assertRejectedController(rejectedResult);
    assertApplicationSchemaAbsent("post-rejection application schema state");

    lockHolder = startCatalogLockHolder();
    const holderPid = await waitForCatalogLockHolder(lockHolder);
    const firstController = startMigrationController(
      databasePort,
      migrationLogin,
      migrationPassword,
      tlsMaterial.certificatePath,
    );
    const secondController = startMigrationController(
      databasePort,
      migrationLogin,
      migrationPassword,
      tlsMaterial.certificatePath,
    );
    activeControllers.add(firstController);
    activeControllers.add(secondController);
    await waitForBlockedControllers(holderPid);

    await stopCatalogLockHolder(lockHolder);
    lockHolderReleased = true;
    const [firstResult, secondResult] = await Promise.all([
      readMigrationControllerResult(firstController, "first migration controller"),
      readMigrationControllerResult(secondController, "second migration controller"),
    ]);
    activeControllers.delete(firstController);
    activeControllers.delete(secondController);
    assertSuccessfulControllers([firstResult, secondResult]);
    assertExactLedgerAndSchema(manifest);
    assertControllerCleanup();

    console.log(
      "Migration PostgreSQL integration passed (widened-login denial, two emitted controllers behind one holder, verified TLS, exact 42-row ledger, 28 forced-RLS tables, and released connections/lock).",
    );
  } catch (error) {
    primaryFailure = error;
  } finally {
    await Promise.all(
      [...activeControllers].map((controller) => stopMigrationController(controller)),
    ).catch(() => {
      cleanupFailure ??= new Error("emitted migration controller cleanup failed");
    });
    if (lockHolder !== undefined && !lockHolderReleased) {
      await stopCatalogLockHolder(lockHolder, false).catch(() => {
        cleanupFailure ??= new Error("PostgreSQL migration lock holder cleanup failed");
      });
    }
    if (containerStarted) {
      try {
        const remove = docker(["rm", "--force", "--volumes", containerName], {
          timeout: 30_000,
        });
        if (remove.status !== 0) {
          cleanupFailure ??= new Error("isolated PostgreSQL container cleanup failed");
        }
      } catch {
        cleanupFailure ??= new Error("isolated PostgreSQL container cleanup failed");
      }
    }
    try {
      const down = docker([...composePrefix, "down", "--volumes", "--remove-orphans"], {
        timeout: 30_000,
      });
      if (down.status !== 0) {
        cleanupFailure ??= new Error("isolated PostgreSQL network cleanup failed");
      }
    } catch {
      cleanupFailure ??= new Error("isolated PostgreSQL network cleanup failed");
    }
    if (tlsMaterial !== undefined) {
      try {
        rmSync(tlsMaterial.directory, { force: true, recursive: true });
      } catch {
        cleanupFailure ??= new Error("synthetic PostgreSQL TLS material cleanup failed");
      }
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
