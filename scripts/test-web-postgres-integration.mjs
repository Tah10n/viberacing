import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, sign, X509Certificate } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { validateManifest } from "./check-database.mjs";
import {
  assertPublicSnapshotPlanEvidence,
  parseAutoExplainPlans,
} from "./web-query-plan-evidence.mjs";

// cspell:ignore localdomain usename WINDIR

const root = resolve(import.meta.dirname, "..");
const webRoot = resolve(root, "apps", "web");
const webRequire = createRequire(resolve(webRoot, "package.json"));
const nextBin = webRequire.resolve("next/dist/bin/next");
const standaloneServerPath = resolve(webRoot, ".next", "standalone", "apps", "web", "server.js");
const projectName = `vr-web-it-${process.pid}`;
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
const databaseTlsCertificatePath = "/tmp/viberacing-web-it-server.crt";
const databaseTlsKeyPath = "/tmp/viberacing-web-it-server.key";
const webLogin = "viberacing_web_login";
const webPassword = "synthetic-web-integration-password";
const wideWebLogin = "viberacing_web_wide_login";
const wideWebPassword = "synthetic-wide-web-integration-password";
const extraRole = "viberacing_web_extra";
const requestIdPattern = /^req_[A-Za-z0-9_-]{22}$/;
const maximumResponseBytes = 1024 * 1024;
const maximumServerOutputBytes = 512 * 1024;
const maximumBlockerOutputBytes = 64 * 1024;
const maximumDatabaseLogBytes = 2 * 1024 * 1024;
const serverStartupTimeoutMs = 60_000;
const serverRequestTimeoutMs = 30_000;
const serverCloseTimeoutMs = 15_000;
const databaseBlockerTimeoutMs = 10_000;
const blockedQueryObservationTimeoutMs = 2_000;
const admissionRejectionTimeoutMs = 1_500;
const snapshotBuildCommandTimeoutMs = 300_000;
const snapshotCatalogBudgetMs = 300_000;
const databaseBlockerReadyMarker = "viberacing_web_admission_blocker_ready";

const fixture = Object.freeze({
  hiddenProfileId: "00000000-0000-4000-8000-000000010001",
  outsideTop32Handle: "racer09999",
  participantCount: 10_000,
  profileCount: 10_001,
});
const privateValueMarkers = Object.freeze([
  fixture.hiddenProfileId,
  webLogin,
  webPassword,
  wideWebLogin,
  wideWebPassword,
  extraRole,
  "900000000000010001",
  `syn_${"S".repeat(22)}`,
]);

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
  const directory = mkdtempSync(join(tmpdir(), "viberacing-web-it-"));
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
exec /usr/local/bin/docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=${databaseTlsCertificatePath} -c ssl_key_file=${databaseTlsKeyPath} -c shared_preload_libraries=auto_explain
`,
      { mode: 0o700 },
    );
    return Object.freeze({ certificatePath, directory, keyPath, launcherPath });
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

function psql(sql, label, timeout = 30_000) {
  const result = docker(psqlArguments(), { input: sql, timeout });
  requireSuccess(result, label);
}

function psqlScalar(sql, label) {
  const result = docker([...psqlArguments(), "--tuples-only", "--no-align", "--command", sql], {
    timeout: 10_000,
  });
  requireSuccess(result, label);
  return result.stdout.trim();
}

function assertAutoExplainEvidence() {
  const result = docker(["logs", containerName], {
    maxBuffer: maximumDatabaseLogBytes,
    timeout: 10_000,
  });
  requireSuccess(result, "synthetic PostgreSQL plan-log read");
  const output = `${result.stdout}${result.stderr}`;
  const plans = parseAutoExplainPlans(output, {
    maximumBytes: maximumDatabaseLogBytes,
    privateMarkers: privateValueMarkers,
  });
  assert.deepEqual(assertPublicSnapshotPlanEvidence(plans), { evidencedPlanCount: 6 });
}

async function stopDatabaseReadBlocker(blocker) {
  if (!blocker.hasExited()) {
    blocker.child.stdin.end("ROLLBACK;\n");
  }
  let result;
  try {
    result = await waitWithDeadline(
      blocker.closed,
      databaseBlockerTimeoutMs,
      "PostgreSQL read blocker did not stop within its fixed deadline.",
    );
  } catch (error) {
    if (!blocker.hasExited()) {
      blocker.child.kill("SIGKILL");
      await waitWithDeadline(
        blocker.closed,
        databaseBlockerTimeoutMs,
        "PostgreSQL read blocker did not close after forced termination.",
      );
    }
    throw error;
  }
  if (blocker.hasPrivateOutput()) {
    throw new Error("PostgreSQL read blocker output exposed a private integration value.");
  }
  if (blocker.hasOutputOverflow()) {
    throw new Error("PostgreSQL read blocker exceeded its bounded output budget.");
  }
  if (result.code !== 0 || result.signal !== null) {
    throw new Error("PostgreSQL read blocker did not close cleanly.");
  }
}

async function startDatabaseReadBlocker() {
  let exited = false;
  let outputBytes = 0;
  let outputOverflow = false;
  let privateOutput = false;
  let outputTail = "";
  let readySettled = false;
  let resolveReady;
  let rejectReady;
  const maximumMarkerLength = Math.max(
    databaseBlockerReadyMarker.length,
    ...privateValueMarkers.map((marker) => marker.length),
  );
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
    outputTail = text.slice(-(maximumMarkerLength - 1));
    if (privateValueMarkers.some((marker) => text.includes(marker))) {
      privateOutput = true;
      child.kill("SIGKILL");
    } else if (outputBytes > maximumBlockerOutputBytes) {
      outputOverflow = true;
      child.kill("SIGKILL");
    } else if (!readySettled && text.includes(databaseBlockerReadyMarker)) {
      readySettled = true;
      resolveReady();
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
        rejectReady(new Error("PostgreSQL read blocker could not start."));
      }
      rejectClose(new Error("PostgreSQL read blocker could not start."));
    });
    child.once("close", (code, signal) => {
      exited = true;
      if (!readySettled) {
        readySettled = true;
        rejectReady(new Error("PostgreSQL read blocker exited before acquiring its lock."));
      }
      resolveClose(Object.freeze({ code, signal }));
    });
  });
  void ready.catch(() => undefined);
  void closed.catch(() => undefined);
  const blocker = Object.freeze({
    child,
    closed,
    hasExited: () => exited,
    hasOutputOverflow: () => outputOverflow,
    hasPrivateOutput: () => privateOutput,
  });

  try {
    child.stdin.write(`BEGIN;
SET LOCAL ROLE viberacing_owner;
LOCK TABLE viberacing_private.leaderboard_snapshot_pages IN ACCESS EXCLUSIVE MODE;
\\echo ${databaseBlockerReadyMarker}
`);
    await waitWithDeadline(
      ready,
      databaseBlockerTimeoutMs,
      "PostgreSQL read blocker did not acquire its lock in time.",
    );
    if (privateOutput || outputOverflow || exited) {
      throw new Error("PostgreSQL read blocker failed before admission evidence began.");
    }
    return blocker;
  } catch (error) {
    await stopDatabaseReadBlocker(blocker).catch(() => undefined);
    throw error;
  }
}

function readBlockedSnapshotQueryCount(label) {
  const value = psqlScalar(
    `SELECT pg_catalog.count(*)::text
FROM pg_catalog.pg_stat_activity AS activity
WHERE activity.datname = '${databaseName}'
  AND activity.usename = '${webLogin}'
  AND activity.state = 'active'
  AND activity.wait_event_type = 'Lock'
  AND pg_catalog.strpos(
    activity.query,
    'viberacing_api.read_current_leaderboard_page('
  ) > 0;`,
    label,
  );
  assert.match(value, /^[0-4]$/);
  return Number(value);
}

function assertWebTlsConnection(label) {
  const observation = JSON.parse(
    psqlScalar(
      `SELECT pg_catalog.jsonb_build_object(
  'connectionCount', pg_catalog.count(*),
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
  AND activity.usename = '${webLogin}'
  AND activity.application_name = 'viberacing-web-public-snapshot';`,
      label,
    ),
  );
  assert.equal(Number.isSafeInteger(observation.connectionCount), true);
  assert.ok(observation.connectionCount >= 1 && observation.connectionCount <= 12);
  assert.equal(observation.allTls, true);
}

async function waitForBlockedSnapshotQueries() {
  const deadline = Date.now() + blockedQueryObservationTimeoutMs;
  let lastCount = 0;
  while (Date.now() < deadline) {
    lastCount = readBlockedSnapshotQueryCount("blocked Web snapshot-query observation");
    if (lastCount === 4) {
      return;
    }
    await sleep(25);
  }
  throw new Error(`expected four blocked Web snapshot queries, observed ${lastCount}`);
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

function nextProcessEnvironment() {
  const environment = {
    CI: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_ENV: "production",
    VIBERACING_PUBLIC_SNAPSHOTS_ENABLED: "true",
  };
  for (const key of ["SystemRoot", "TEMP", "TMP", "WINDIR"]) {
    const value = process.env[key];
    if (value !== undefined) {
      environment[key] = value;
    }
  }
  return environment;
}

function buildWebApplication() {
  const localEnvironmentFiles = readdirSync(webRoot).filter((name) => /^\.env(?:\.|$)/.test(name));
  assert.deepEqual(
    localEnvironmentFiles,
    [],
    "the production Web integration must not load a local environment file",
  );
  const result = run(process.execPath, [nextBin, "build"], {
    cwd: webRoot,
    env: nextProcessEnvironment(),
    timeout: 300_000,
  });
  requireSuccess(result, "Web production build");
  const serverStats = lstatSync(standaloneServerPath);
  assert.equal(
    serverStats.isFile(),
    true,
    "the standalone Next entry point must be a regular file",
  );
  assert.equal(
    serverStats.isSymbolicLink(),
    false,
    "the standalone Next entry point must not be a symbolic link",
  );
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

async function findAvailableListenerPort() {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.unref();
    server.once("error", rejectPromise);
    server.listen({ exclusive: true, host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => rejectPromise(new Error("listener port allocation failed")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          rejectPromise(error);
        } else {
          resolvePromise(port);
        }
      });
    });
  });
}

function readPrivateStateFingerprint(label) {
  const canonicalState = psqlScalar(
    `CREATE TEMP TABLE web_integration_fingerprints (
  table_name text PRIMARY KEY,
  table_state jsonb NOT NULL
);

DO $fingerprint$
DECLARE
  private_table record;
  table_state jsonb;
BEGIN
  FOR private_table IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'viberacing_private'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  LOOP
    EXECUTE pg_catalog.format(
      'SELECT pg_catalog.jsonb_build_object(
        ''count'', pg_catalog.count(*),
        ''hashMax'', coalesce(pg_catalog.max(pg_catalog.hashtextextended(pg_catalog.to_jsonb(candidate)::text, 0)), 0),
        ''hashMin'', coalesce(pg_catalog.min(pg_catalog.hashtextextended(pg_catalog.to_jsonb(candidate)::text, 0)), 0),
        ''hashSum'', coalesce(pg_catalog.sum(pg_catalog.hashtextextended(pg_catalog.to_jsonb(candidate)::text, 0)::numeric), 0),
        ''hashXor'', coalesce(pg_catalog.bit_xor(pg_catalog.hashtextextended(pg_catalog.to_jsonb(candidate)::text, 0)), 0)
      ) FROM %I.%I AS candidate',
      'viberacing_private',
      private_table.table_name
    )
    INTO table_state;

    INSERT INTO web_integration_fingerprints (table_name, table_state)
    VALUES (private_table.table_name, table_state);
  END LOOP;
END
$fingerprint$;

SELECT pg_catalog.jsonb_object_agg(table_name, table_state ORDER BY table_name)::text
FROM web_integration_fingerprints;`,
    label,
  );
  assert.notEqual(canonicalState, "", `${label} must return canonical private state`);
  return createHash("sha256").update(canonicalState, "utf8").digest("hex");
}

function webEnvironment(databasePort, login, password, port, tlsCertificatePath) {
  const environment = {
    ...nextProcessEnvironment(),
    HOSTNAME: "127.0.0.1",
    NODE_EXTRA_CA_CERTS: tlsCertificatePath,
    PORT: String(port),
    VIBERACING_WEB_DATABASE_HOST: databaseTlsHost,
    VIBERACING_WEB_DATABASE_NAME: databaseName,
    VIBERACING_WEB_DATABASE_PASSWORD: password,
    VIBERACING_WEB_DATABASE_PORT: String(databasePort),
    VIBERACING_WEB_DATABASE_TLS_MODE: "verify-full",
    VIBERACING_WEB_DATABASE_USER: login,
  };
  return Object.freeze(environment);
}

function canConnect(port) {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const settle = (connected) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolvePromise(connected);
    };
    socket.setTimeout(250);
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
    socket.once("timeout", () => settle(false));
  });
}

function startProductionNextServer({ databasePort, login, password, port, tlsCertificatePath }) {
  let exited = false;
  let outputBytes = 0;
  let outputOverflow = false;
  let privateOutput = false;
  let outputTail = "";
  const protectedOutputMarkers = [...privateValueMarkers, tlsCertificatePath];
  const maximumPrivateMarkerLength = Math.max(
    ...protectedOutputMarkers.map((marker) => marker.length),
  );
  const child = spawn(process.execPath, [standaloneServerPath], {
    cwd: webRoot,
    env: webEnvironment(databasePort, login, password, port, tlsCertificatePath),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const observeOutput = (chunk) => {
    outputBytes += chunk.byteLength;
    const text = `${outputTail}${chunk.toString("utf8")}`;
    outputTail = text.slice(-(maximumPrivateMarkerLength - 1));
    if (protectedOutputMarkers.some((marker) => text.includes(marker))) {
      privateOutput = true;
      child.kill("SIGKILL");
    } else if (outputBytes > maximumServerOutputBytes) {
      outputOverflow = true;
      child.kill("SIGKILL");
    }
  };
  child.stdout.on("data", observeOutput);
  child.stderr.on("data", observeOutput);
  child.once("exit", () => {
    exited = true;
  });
  const closed = new Promise((resolveClose, rejectClose) => {
    child.once("error", () => {
      exited = true;
      rejectClose(new Error("Next production server could not start."));
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
    hasPrivateOutput: () => privateOutput,
    port,
  });
}

async function waitForProductionNextServer(server) {
  const deadline = Date.now() + serverStartupTimeoutMs;
  while (Date.now() < deadline) {
    if (server.hasPrivateOutput()) {
      throw new Error("Next production server output exposed a private integration value.");
    }
    if (server.hasOutputOverflow()) {
      throw new Error("Next production server exceeded its bounded output budget.");
    }
    if (server.hasExited()) {
      throw new Error("Next production server exited before binding its loopback listener.");
    }
    if (await canConnect(server.port)) {
      return;
    }
    await sleep(250);
  }
  throw new Error("Next production server did not bind its loopback listener in time.");
}

async function stopProductionNextServer(server) {
  if (!server.hasExited()) {
    server.child.kill();
  }
  try {
    await waitWithDeadline(
      server.closed,
      serverCloseTimeoutMs,
      "Next production server did not stop within its fixed deadline.",
    );
  } catch (error) {
    if (!server.hasExited()) {
      server.child.kill("SIGKILL");
      await waitWithDeadline(
        server.closed,
        serverCloseTimeoutMs,
        "Next production server did not close after forced termination.",
      );
    } else {
      throw error;
    }
  }
  if (server.hasPrivateOutput()) {
    throw new Error("Next production server output exposed a private integration value.");
  }
  if (server.hasOutputOverflow()) {
    throw new Error("Next production server exceeded its bounded output budget.");
  }
  const deadline = Date.now() + serverCloseTimeoutMs;
  while (Date.now() < deadline) {
    if (!(await canConnect(server.port))) {
      return;
    }
    await sleep(250);
  }
  throw new Error("Next production server retained its loopback listener after shutdown.");
}

async function startConfiguredProductionNextServer(
  databasePort,
  login,
  password,
  tlsCertificatePath,
) {
  const port = await findAvailableListenerPort();
  const server = startProductionNextServer({
    databasePort,
    login,
    password,
    port,
    tlsCertificatePath,
  });
  try {
    await waitForProductionNextServer(server);
    return server;
  } catch (error) {
    await stopProductionNextServer(server).catch(() => undefined);
    throw error;
  }
}

async function readBoundedResponseBytes(response, path) {
  if (response.body === null) {
    return Buffer.alloc(0);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        const bodyBytes = Buffer.concat(chunks, byteLength);
        for (const chunk of chunks) {
          chunk.fill(0);
        }
        return bodyBytes;
      }
      if (byteLength + value.byteLength > maximumResponseBytes) {
        try {
          await reader.cancel("response budget exceeded");
        } catch {
          // The bounded failure below remains authoritative even if cancellation races shutdown.
        }
        throw new Error(`${path} exceeded the bounded response budget.`);
      }
      byteLength += value.byteLength;
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    for (const chunk of chunks) {
      chunk.fill(0);
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function requestBounded(
  baseUrl,
  path,
  { accept = "application/json", ifNoneMatch, timeoutMs = serverRequestTimeoutMs } = {},
) {
  const headers = { accept };
  if (ifNoneMatch !== undefined) {
    headers["if-none-match"] = ifNoneMatch;
  }
  const response = await fetch(`${baseUrl}${path}`, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const bodyBytes = await readBoundedResponseBytes(response, path);
  let body;
  let bodyText = "";
  try {
    bodyText = bodyBytes.toString("utf8");
    const contentType = response.headers.get("content-type") ?? "";
    if (
      bodyText.length > 0 &&
      /(?:application\/json|application\/problem\+json)/i.test(contentType)
    ) {
      body = JSON.parse(bodyText);
    }
  } finally {
    bodyBytes.fill(0);
  }
  return Object.freeze({ body, bodyText, headers: response.headers, status: response.status });
}

function assertSecurityResponseHeaders(result) {
  assert.match(result.headers.get("x-request-id") ?? "", requestIdPattern);
  assert.equal(result.headers.get("access-control-allow-origin"), null);
  assert.equal(result.headers.get("set-cookie"), null);
  assert.equal(result.headers.get("x-powered-by"), null);
  assert.equal(result.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(result.headers.get("referrer-policy"), "no-referrer");
  assert.equal(result.headers.get("x-content-type-options"), "nosniff");
}

function assertNoPrivateResponseValues(body) {
  const serialized = JSON.stringify(body);
  for (const marker of [
    ...privateValueMarkers,
    "accepted_observation_id",
    "accepted_sync_id",
    "agent_account_id",
    "account_fingerprint_digest",
    "device_id",
    "github_user_id",
    "profile_id",
    "private_label",
  ]) {
    assert.equal(
      serialized.includes(marker),
      false,
      `response must omit private marker: ${marker}`,
    );
  }
}

function assertProblem(result, expectedStatus, expectedCode, validateProblemDetailsV1) {
  assert.equal(result.status, expectedStatus);
  assert.equal(result.headers.get("content-type"), "application/problem+json; charset=utf-8");
  assert.equal(result.headers.get("cache-control"), "no-store");
  assertSecurityResponseHeaders(result);
  const requestId = result.headers.get("x-request-id");
  assert.equal(result.body?.schemaVersion, 1);
  assert.equal(result.body?.requestId, requestId);
  assert.equal(result.body?.errorCode, expectedCode);
  assert.equal(result.body?.status, expectedStatus);
  assert.equal(typeof result.body?.title, "string");
  assert.equal(typeof result.body?.retryable, "boolean");
  assert.equal(validateProblemDetailsV1(result.body).ok, true);
  assertNoPrivateResponseValues(result.body);
}

function assertSnapshotSuccess(result, validate, expectedCacheControl, expectedFreshness) {
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(result.headers.get("cache-control"), expectedCacheControl);
  assert.match(result.headers.get("etag") ?? "", /^"[a-f0-9]{64}"$/);
  assert.match(result.headers.get("vary") ?? "", /(?:^|,\s*)Accept(?:,|$)/i);
  const freshness = result.headers.get("x-viberacing-snapshot-freshness");
  if (Array.isArray(expectedFreshness)) {
    assert.equal(expectedFreshness.includes(freshness), true);
  } else {
    assert.equal(freshness, expectedFreshness);
  }
  assertSecurityResponseHeaders(result);
  assert.equal(validate(result.body).ok, true);
  assertNoPrivateResponseValues(result.body);
}

function utcDateDifference(laterDate, earlierDate) {
  const later = Date.parse(`${laterDate}T00:00:00.000Z`);
  const earlier = Date.parse(`${earlierDate}T00:00:00.000Z`);
  assert.equal(Number.isFinite(later), true);
  assert.equal(Number.isFinite(earlier), true);
  const difference = (later - earlier) / 86_400_000;
  assert.equal(Number.isSafeInteger(difference), true);
  return difference;
}

function readSyntheticCalendar() {
  const calendar = JSON.parse(
    psqlScalar(
      `WITH current_season AS (
  SELECT (
    (pg_catalog.statement_timestamp() AT TIME ZONE 'UTC')::date
    - (
      extract(
        isodow FROM (pg_catalog.statement_timestamp() AT TIME ZONE 'UTC')::date
      )::integer - 1
    )
  ) AS season_start
)
SELECT pg_catalog.jsonb_build_object(
  'currentSeasonStart', current_season.season_start::text,
  'currentUsageDayOffset', (
    (pg_catalog.statement_timestamp() AT TIME ZONE 'UTC')::date
      - current_season.season_start
  ),
  'historicalSeasonStart', (current_season.season_start - 14)::text
)::text
FROM current_season;`,
      "synthetic snapshot calendar discovery",
    ),
  );
  assert.match(calendar.currentSeasonStart, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(calendar.historicalSeasonStart, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(Number.isSafeInteger(calendar.currentUsageDayOffset), true);
  assert.ok(calendar.currentUsageDayOffset >= 0 && calendar.currentUsageDayOffset <= 6);
  assert.equal(new Date(`${calendar.currentSeasonStart}T00:00:00.000Z`).getUTCDay(), 1);
  assert.equal(new Date(`${calendar.historicalSeasonStart}T00:00:00.000Z`).getUTCDay(), 1);
  assert.equal(utcDateDifference(calendar.currentSeasonStart, calendar.historicalSeasonStart), 14);
  return Object.freeze(calendar);
}

function prepareSyntheticSnapshotScale(calendar) {
  psql(
    `BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.agent_accounting_revisions (
  provider_code,
  accounting_revision,
  reader_contract_version,
  scope_kind,
  utc_date_semantics,
  maximum_backfill_days,
  minimum_connector_version,
  enabled_for_new_accounts
)
VALUES (
  'claude_code',
  1,
  'synthetic_scale_fixture_v1',
  'agent_account',
  'provider_utc_date',
  35,
  '0.0.0',
  false
);
\\echo fixture_accounting_revision_ready

INSERT INTO viberacing_private.profiles (
  profile_id,
  github_user_id,
  handle,
  locale,
  theme,
  motion_preference,
  public_visibility,
  provider_breakdown_visible,
  state,
  created_at,
  updated_at,
  hidden_at
)
SELECT
  (
    '00000000-0000-4000-8000-'
      || pg_catalog.lpad(profile_number::text, 12, '0')
  )::uuid,
  900000000000000000::bigint + profile_number,
  'racer' || pg_catalog.lpad(profile_number::text, 5, '0'),
  CASE WHEN profile_number % 5 = 0 THEN 'ru' ELSE 'en' END,
  CASE
    WHEN profile_number % 3 = 0 THEN 'neon'
    WHEN profile_number % 3 = 1 THEN 'classic'
    ELSE 'mono'
  END,
  CASE WHEN profile_number % 7 = 0 THEN 'reduce' ELSE 'system' END,
  'hidden',
  false,
  'enrolling',
  '${calendar.historicalSeasonStart}'::date::timestamp AT TIME ZONE 'UTC',
  '${calendar.historicalSeasonStart}'::date::timestamp AT TIME ZONE 'UTC',
  '${calendar.historicalSeasonStart}'::date::timestamp AT TIME ZONE 'UTC'
FROM pg_catalog.generate_series(1, ${fixture.profileCount}) AS profile_number;

UPDATE viberacing_private.profiles AS profile
SET state = 'active',
    public_visibility = CASE
      WHEN profile.handle = 'racer10001' THEN 'hidden'
      ELSE 'public'
    END,
    updated_at = profile.created_at + interval '1 second';
\\echo fixture_profiles_ready

WITH account_kinds AS (
  SELECT *
  FROM (
    VALUES
      ('c'::text, 'codex'::text, 'Codex Personal'::text),
      ('d'::text, 'codex'::text, 'Codex Work'::text),
      ('l'::text, 'claude_code'::text, 'Claude Code Work'::text)
  ) AS value(account_prefix, provider_code, private_label)
)
INSERT INTO viberacing_private.agent_accounts (
  agent_account_id,
  profile_id,
  provider_code,
  accounting_revision,
  scope_kind,
  fingerprint_kind,
  account_fingerprint_digest,
  private_label,
  identity_assurance,
  state,
  created_at,
  state_changed_at
)
SELECT
  'acc_' || account.account_prefix
    || pg_catalog.lpad(profile_number::text, 21, '0'),
  (
    '00000000-0000-4000-8000-'
      || pg_catalog.lpad(profile_number::text, 12, '0')
  )::uuid,
  account.provider_code,
  1,
  'agent_account',
  'unavailable',
  NULL,
  account.private_label || ' ' || profile_number::text,
  'community_local',
  'active',
  '${calendar.historicalSeasonStart}'::date::timestamp AT TIME ZONE 'UTC',
  '${calendar.historicalSeasonStart}'::date::timestamp AT TIME ZONE 'UTC'
FROM pg_catalog.generate_series(1, ${fixture.profileCount}) AS profile_number
CROSS JOIN account_kinds AS account;
\\echo fixture_accounts_ready

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
VALUES
  (
    '${calendar.historicalSeasonStart}',
    'community',
    '${calendar.historicalSeasonStart}'::date + 6,
    'provider_reported_tokens_v1',
    'agent_account_cumulative_utc_v1',
    'grace',
    '${calendar.historicalSeasonStart}'::date::timestamp AT TIME ZONE 'UTC',
    (
      ('${calendar.historicalSeasonStart}'::date + 7)::timestamp AT TIME ZONE 'UTC'
    ) + interval '48 hours'
  ),
  (
    '${calendar.currentSeasonStart}',
    'community',
    '${calendar.currentSeasonStart}'::date + 6,
    'provider_reported_tokens_v1',
    'agent_account_cumulative_utc_v1',
    'open',
    '${calendar.currentSeasonStart}'::date::timestamp AT TIME ZONE 'UTC',
    (
      ('${calendar.currentSeasonStart}'::date + 7)::timestamp AT TIME ZONE 'UTC'
    ) + interval '48 hours'
  );
\\echo fixture_seasons_ready

WITH account_values AS (
  SELECT
    account.agent_account_id,
    substring(profile.handle FROM 6)::integer AS profile_number,
    CASE substring(account.agent_account_id FROM 5 FOR 1)
      WHEN 'c' THEN 5
      WHEN 'd' THEN 3
      ELSE 2
    END AS account_weight
  FROM viberacing_private.agent_accounts AS account
  JOIN viberacing_private.profiles AS profile
    ON profile.profile_id = account.profile_id
),
usage_values AS (
  SELECT
    account.agent_account_id,
    '${calendar.currentSeasonStart}'::date + day_offset AS usage_date,
    (
      CASE
        WHEN account.profile_number IN (1, 2) THEN 10000
        ELSE 10002 - account.profile_number
      END
      * account.account_weight
    )::numeric(30, 0) AS cumulative_token_total
  FROM account_values AS account
  CROSS JOIN pg_catalog.generate_series(
    0,
    ${calendar.currentUsageDayOffset}
  ) AS day_offset
  UNION ALL
  SELECT
    account.agent_account_id,
    '${calendar.historicalSeasonStart}'::date + day_offset AS usage_date,
    (
      CASE
        WHEN account.profile_number IN (1, 2) THEN 100
        ELSE 10002 - account.profile_number
      END
      * account.account_weight
    )::numeric(30, 0) AS cumulative_token_total
  FROM account_values AS account
  CROSS JOIN pg_catalog.generate_series(0, 6) AS day_offset
)
INSERT INTO viberacing_private.agent_account_day_totals (
  agent_account_id,
  usage_date,
  cumulative_token_total,
  accepted_observation_id,
  accepted_sync_id,
  accepted_device_id,
  first_accepted_at,
  last_accepted_at,
  provenance_redacted_at
)
SELECT
  usage.agent_account_id,
  usage.usage_date,
  usage.cumulative_token_total,
  NULL,
  'syn_${"S".repeat(22)}',
  NULL,
  usage.usage_date::timestamp AT TIME ZONE 'UTC',
  usage.usage_date::timestamp AT TIME ZONE 'UTC',
  usage.usage_date::timestamp AT TIME ZONE 'UTC'
FROM usage_values AS usage;
\\echo fixture_day_totals_ready

INSERT INTO viberacing_private.ranking_refresh_outbox (
  season_start,
  trust_tier,
  dirty_since,
  last_observation_id,
  attempt_count,
  next_attempt_at,
  state
)
VALUES
  (
    '${calendar.historicalSeasonStart}',
    'community',
    pg_catalog.clock_timestamp(),
    NULL,
    0,
    pg_catalog.clock_timestamp(),
    'pending'
  ),
  (
    '${calendar.currentSeasonStart}',
    'community',
    pg_catalog.clock_timestamp(),
    NULL,
    0,
    pg_catalog.clock_timestamp(),
    'pending'
  );
\\echo fixture_outbox_ready

COMMIT;`,
    "10k multi-account multi-provider snapshot fixture",
    120_000,
  );
}

function buildSyntheticSnapshots(calendar, contracts) {
  psql("SELECT pg_catalog.pg_stat_reset();", "snapshot-build statistics reset");
  const startedAt = Date.now();
  psql(
    `BEGIN;
SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.refresh_next_dirty_community_season();
COMMIT;`,
    "historical snapshot refresh through Jobs capability",
    snapshotBuildCommandTimeoutMs,
  );
  psql(
    `BEGIN;
SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.refresh_next_dirty_community_season();
COMMIT;`,
    "current 10k snapshot refresh through Jobs capability",
    snapshotBuildCommandTimeoutMs,
  );
  psql(
    `BEGIN;
SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.finalize_next_due_community_season();
COMMIT;`,
    "historical snapshot finalization through Jobs capability",
    snapshotBuildCommandTimeoutMs,
  );
  const elapsedMilliseconds = Date.now() - startedAt;
  assert.ok(
    elapsedMilliseconds > 0 && elapsedMilliseconds <= snapshotCatalogBudgetMs,
    `snapshot refresh exceeded the fixed ${snapshotCatalogBudgetMs}-millisecond scale budget (${elapsedMilliseconds}ms)`,
  );

  const tempBytes = psqlScalar(
    `SELECT pg_catalog.pg_stat_force_next_flush();
SELECT temp_bytes::text
FROM pg_catalog.pg_stat_database
WHERE datname = pg_catalog.current_database();`,
    "snapshot-build temporary-I/O evidence",
  );
  assert.equal(tempBytes, "0", "the target snapshot fixture must not spill to temporary storage");

  const state = JSON.parse(
    psqlScalar(
      `WITH current_snapshot AS (
  SELECT published.snapshot_id
  FROM viberacing_private.leaderboard_published_snapshots AS published
  WHERE published.season_start = '${calendar.currentSeasonStart}'
    AND published.trust_tier = 'community'
),
historical_snapshot AS (
  SELECT published.snapshot_id
  FROM viberacing_private.leaderboard_published_snapshots AS published
  WHERE published.season_start = '${calendar.historicalSeasonStart}'
    AND published.trust_tier = 'community'
),
required_indexes(index_name) AS (
  VALUES
    ('agent_account_day_totals_date_account_idx'),
    ('agent_accounts_profile_provider_idx'),
    ('leaderboard_published_snapshots_pkey'),
    ('leaderboard_snapshot_pages_pkey'),
    ('leaderboard_snapshot_profiles_pkey'),
    ('leaderboard_snapshots_pkey'),
    ('profiles_public_handle_idx'),
    ('season_profile_totals_rank_idx')
)
SELECT pg_catalog.jsonb_build_object(
  'accountCount', (
    SELECT pg_catalog.count(*) FROM viberacing_private.agent_accounts
  ),
  'currentPageCount', (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.leaderboard_snapshot_pages AS page
    JOIN current_snapshot ON current_snapshot.snapshot_id = page.snapshot_id
    WHERE page.page_kind = 'leaderboard_page'
  ),
  'currentParticipantCount', (
    SELECT snapshot.participant_count
    FROM viberacing_private.leaderboard_snapshots AS snapshot
    JOIN current_snapshot ON current_snapshot.snapshot_id = snapshot.snapshot_id
  ),
  'dayCount', (
    SELECT pg_catalog.count(DISTINCT total.usage_date)
    FROM viberacing_private.agent_account_day_totals AS total
    WHERE total.usage_date BETWEEN
      '${calendar.historicalSeasonStart}'::date
      AND '${calendar.historicalSeasonStart}'::date + 6
  ),
  'equalTopRank', (
    SELECT pg_catalog.count(DISTINCT total.rank_position) = 1
      AND pg_catalog.min(total.rank_position) = 1
    FROM viberacing_private.season_profile_totals AS total
    JOIN viberacing_private.profiles AS profile
      ON profile.profile_id = total.profile_id
    WHERE total.season_start = '${calendar.currentSeasonStart}'
      AND total.trust_tier = 'community'
      AND profile.handle IN ('racer00001', 'racer00002')
  ),
  'historicalFinalized', (
    SELECT snapshot.finalized
    FROM viberacing_private.leaderboard_snapshots AS snapshot
    JOIN historical_snapshot ON historical_snapshot.snapshot_id = snapshot.snapshot_id
  ),
  'hiddenProfileSummaryCount', (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.leaderboard_snapshot_profiles AS profile
    JOIN current_snapshot ON current_snapshot.snapshot_id = profile.snapshot_id
    WHERE profile.handle = 'racer10001'
  ),
  'maximumPageBytes', (
    SELECT pg_catalog.max(pg_catalog.octet_length(page.canonical_payload))
    FROM viberacing_private.leaderboard_snapshot_pages AS page
    JOIN current_snapshot ON current_snapshot.snapshot_id = page.snapshot_id
    WHERE page.page_kind = 'leaderboard_page'
  ),
  'minimumAccountsPerProfile', (
    SELECT pg_catalog.min(account_count)
    FROM (
      SELECT pg_catalog.count(*) AS account_count
      FROM viberacing_private.agent_accounts
      GROUP BY profile_id
    ) AS counts
  ),
  'outsideTop32SummaryCount', (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.leaderboard_snapshot_profiles AS profile
    JOIN current_snapshot ON current_snapshot.snapshot_id = profile.snapshot_id
    WHERE profile.handle = '${fixture.outsideTop32Handle}'
  ),
  'providerCount', (
    SELECT pg_catalog.count(DISTINCT total.provider_code)
    FROM viberacing_private.season_profile_provider_totals AS total
    WHERE total.season_start = '${calendar.currentSeasonStart}'
      AND total.trust_tier = 'community'
  ),
  'requiredIndexCount', (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_indexes AS index_value
    JOIN required_indexes
      ON required_indexes.index_name = index_value.indexname
    WHERE index_value.schemaname = 'viberacing_private'
  ),
  'snapshotBytes', (
    SELECT
      coalesce((
        SELECT pg_catalog.sum(pg_catalog.octet_length(page.canonical_payload))
        FROM viberacing_private.leaderboard_snapshot_pages AS page
        JOIN current_snapshot ON current_snapshot.snapshot_id = page.snapshot_id
      ), 0)
      + coalesce((
        SELECT pg_catalog.sum(pg_catalog.octet_length(profile.canonical_payload))
        FROM viberacing_private.leaderboard_snapshot_profiles AS profile
        JOIN current_snapshot ON current_snapshot.snapshot_id = profile.snapshot_id
      ), 0)
  ),
  'top32Count', (
    SELECT page.participant_count
    FROM viberacing_private.leaderboard_snapshot_pages AS page
    JOIN current_snapshot ON current_snapshot.snapshot_id = page.snapshot_id
    WHERE page.page_kind = 'race_top32'
      AND page.page_number = 1
  )
)::text;`,
      "10k snapshot scale evidence",
    ),
  );
  assert.equal(state.accountCount, fixture.profileCount * 3);
  assert.equal(state.currentPageCount, 100);
  assert.equal(state.currentParticipantCount, fixture.participantCount);
  assert.equal(state.dayCount, 7);
  assert.equal(state.equalTopRank, true);
  assert.equal(state.historicalFinalized, true);
  assert.equal(state.hiddenProfileSummaryCount, 0);
  assert.equal(state.minimumAccountsPerProfile, 3);
  assert.equal(state.outsideTop32SummaryCount, 1);
  assert.equal(state.providerCount, 2);
  assert.equal(state.requiredIndexCount, 8);
  assert.equal(state.top32Count, 32);
  assert.ok(state.maximumPageBytes > 1_000 && state.maximumPageBytes <= 65_536);
  assert.ok(state.snapshotBytes > 1_000_000 && state.snapshotBytes <= 16 * 1024 * 1024);

  const currentContract = contracts.validateLeaderboardSnapshotV1(
    JSON.parse(
      psqlScalar(
        "SELECT canonical_payload FROM viberacing_api.read_current_leaderboard_page(1);",
        "current 10k snapshot contract evidence",
      ),
    ),
  );
  assert.equal(currentContract.ok, true, JSON.stringify(currentContract));
  const historicalContract = contracts.validateLeaderboardSnapshotV1(
    JSON.parse(
      psqlScalar(
        `SELECT canonical_payload
FROM viberacing_api.read_season_leaderboard_page(
  '${calendar.historicalSeasonStart}'::date,
  1
);`,
        "historical finalized snapshot contract evidence",
      ),
    ),
  );
  assert.equal(historicalContract.ok, true, JSON.stringify(historicalContract));
  const profileContract = contracts.validatePublicProfileSummaryV1(
    JSON.parse(
      psqlScalar(
        `SELECT canonical_payload
FROM viberacing_api.read_current_public_profile('${fixture.outsideTop32Handle}');`,
        "outside-top32 profile contract evidence",
      ),
    ),
  );
  assert.equal(profileContract.ok, true, JSON.stringify(profileContract));
  return Object.freeze({ elapsedMilliseconds, state: Object.freeze(state) });
}

function assertSnapshotEntityTag(result) {
  const digest = createHash("sha256").update(result.bodyText, "utf8").digest("hex");
  assert.equal(result.headers.get("etag"), `"${digest}"`);
}

async function exerciseNoSnapshot(databasePort, contracts, tlsCertificatePath) {
  const before = readPrivateStateFingerprint("pre-empty-snapshot request fingerprint");
  const server = await startConfiguredProductionNextServer(
    databasePort,
    webLogin,
    webPassword,
    tlsCertificatePath,
  );
  try {
    const result = await requestBounded(
      `http://127.0.0.1:${server.port}`,
      "/v1/leaderboards/current?trustTier=community&page=1",
    );
    assertProblem(result, 503, "temporarily_unavailable", contracts.validateProblemDetailsV1);
  } finally {
    await stopProductionNextServer(server);
  }
  assert.equal(
    readPrivateStateFingerprint("post-empty-snapshot request fingerprint"),
    before,
    "an unavailable public snapshot request must not create a season or mutate state",
  );
}

async function exerciseWidenedLoginDenial(databasePort, contracts, tlsCertificatePath) {
  const before = readPrivateStateFingerprint("pre-widened-login request fingerprint");
  const server = await startConfiguredProductionNextServer(
    databasePort,
    wideWebLogin,
    wideWebPassword,
    tlsCertificatePath,
  );
  try {
    const result = await requestBounded(
      `http://127.0.0.1:${server.port}`,
      "/v1/leaderboards/current?trustTier=community&page=1",
    );
    assertProblem(result, 503, "temporarily_unavailable", contracts.validateProblemDetailsV1);
  } finally {
    await stopProductionNextServer(server);
  }
  assert.equal(
    readPrivateStateFingerprint("post-widened-login request fingerprint"),
    before,
    "the deliberately widened Web login must fail before private-state mutation",
  );
}

async function exerciseSnapshotNoQueueAdmission(baseUrl, expected, contracts) {
  const blocker = await startDatabaseReadBlocker();
  const inFlightRequests = [];
  let blockerStopped = false;
  try {
    for (let index = 0; index < 4; index += 1) {
      const request = requestBounded(
        baseUrl,
        "/v1/leaderboards/current?trustTier=community&page=1",
      );
      void request.catch(() => undefined);
      inFlightRequests.push(request);
    }
    await waitForBlockedSnapshotQueries();

    assertProblem(
      await requestBounded(baseUrl, "/v1/leaderboards/current?trustTier=community&page=1", {
        timeoutMs: admissionRejectionTimeoutMs,
      }),
      503,
      "temporarily_unavailable",
      contracts.validateProblemDetailsV1,
    );
    assert.equal(
      readBlockedSnapshotQueryCount("post-rejection blocked Web snapshot-query observation"),
      4,
      "the rejected fifth request must not add a fifth snapshot query",
    );

    await stopDatabaseReadBlocker(blocker);
    blockerStopped = true;
    const settledRequests = await Promise.all(inFlightRequests);
    for (const result of settledRequests) {
      assertSnapshotSuccess(
        result,
        contracts.validateLeaderboardSnapshotV1,
        "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
        ["fresh", "stale-under-5m"],
      );
      assert.deepEqual(result.body, expected);
    }
  } finally {
    if (!blockerStopped) {
      await stopDatabaseReadBlocker(blocker).catch(() => undefined);
    }
    await Promise.allSettled(inFlightRequests);
  }
}

async function exerciseSnapshotRoutes(databasePort, calendar, contracts, tlsCertificatePath) {
  const server = await startConfiguredProductionNextServer(
    databasePort,
    webLogin,
    webPassword,
    tlsCertificatePath,
  );
  const baseUrl = `http://127.0.0.1:${server.port}`;
  try {
    const currentPath = "/v1/leaderboards/current?trustTier=community&page=1";
    const current = await requestBounded(baseUrl, currentPath);
    assertSnapshotSuccess(
      current,
      contracts.validateLeaderboardSnapshotV1,
      "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      ["fresh", "stale-under-5m"],
    );
    assert.equal(current.body.participantCount, fixture.participantCount);
    assert.equal(current.body.page, 1);
    assert.equal(current.body.pageSize, 100);
    assert.equal(current.body.participants.length, 100);
    assert.equal(current.body.participants[0].rankPosition, 1);
    assert.equal(current.body.participants[1].rankPosition, 1);
    assert.equal(current.body.participants[2].rankPosition, 3);
    assertSnapshotEntityTag(current);
    assertWebTlsConnection("production Web snapshot TLS connection observation");

    const conditional = await requestBounded(baseUrl, currentPath, {
      ifNoneMatch: current.headers.get("etag"),
    });
    assert.equal(conditional.status, 304);
    assert.equal(conditional.bodyText, "");
    assert.equal(conditional.headers.get("etag"), current.headers.get("etag"));
    assert.equal(
      conditional.headers.get("cache-control"),
      "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
    );
    assertSecurityResponseHeaders(conditional);

    const lastPage = await requestBounded(
      baseUrl,
      "/v1/leaderboards/current?trustTier=community&page=100",
    );
    assertSnapshotSuccess(
      lastPage,
      contracts.validateLeaderboardSnapshotV1,
      "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      ["fresh", "stale-under-5m"],
    );
    assert.equal(lastPage.body.page, 100);
    assert.equal(lastPage.body.nextPage, null);
    assert.equal(lastPage.body.participants.length, 100);

    const historical = await requestBounded(
      baseUrl,
      `/v1/leaderboards/${calendar.historicalSeasonStart}?trustTier=community&page=1`,
    );
    assertSnapshotSuccess(
      historical,
      contracts.validateLeaderboardSnapshotV1,
      "public, max-age=3600, s-maxage=31536000, immutable",
      "finalized",
    );
    assert.equal(historical.body.seasonStart, calendar.historicalSeasonStart);
    assert.equal(historical.body.seasonState, "finalized");
    assertSnapshotEntityTag(historical);

    const outsideProfile = await requestBounded(
      baseUrl,
      `/v1/profiles/${fixture.outsideTop32Handle}?trustTier=community`,
    );
    assertSnapshotSuccess(
      outsideProfile,
      contracts.validatePublicProfileSummaryV1,
      "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      ["fresh", "stale-under-5m"],
    );
    assert.equal(outsideProfile.body.handle, fixture.outsideTop32Handle);
    assert.ok(outsideProfile.body.rankPosition > 32);
    assertSnapshotEntityTag(outsideProfile);

    assertProblem(
      await requestBounded(baseUrl, "/v1/profiles/racer10001?trustTier=community"),
      404,
      "not_found",
      contracts.validateProblemDetailsV1,
    );
    assertProblem(
      await requestBounded(baseUrl, "/v1/leaderboards/current?trustTier=community&page=101"),
      404,
      "not_found",
      contracts.validateProblemDetailsV1,
    );

    for (const legacyPath of [
      "/v1/community/scores",
      "/v1/community/race",
      "/v1/community/race/status",
      "/v1/community/tokens",
    ]) {
      const result = await requestBounded(baseUrl, legacyPath);
      assert.equal(result.status, 404, `${legacyPath} must be absent from the emitted server`);
      assert.equal(result.headers.get("set-cookie"), null);
      assert.equal(result.headers.get("access-control-allow-origin"), null);
    }

    await exerciseSnapshotNoQueueAdmission(baseUrl, current.body, contracts);
  } finally {
    await stopProductionNextServer(server);
  }
}

async function main() {
  buildWorkspace("packages/contracts", "contract production build");
  buildWebApplication();
  const contracts = await import(
    pathToFileURL(resolve(root, "packages", "contracts", "dist", "index.js")).href
  );

  let containerStarted = false;
  let tlsMaterial;
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
CREATE ROLE ${webLogin}
  WITH LOGIN PASSWORD '${webPassword}'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT viberacing_web TO ${webLogin} WITH INHERIT FALSE, SET TRUE;
GRANT CONNECT ON DATABASE ${databaseName} TO ${webLogin};
ALTER ROLE ${webLogin} IN DATABASE ${databaseName}
  SET search_path TO pg_catalog, pg_temp;
ALTER ROLE ${webLogin} IN DATABASE ${databaseName}
  SET auto_explain.log_min_duration TO '0';
ALTER ROLE ${webLogin} IN DATABASE ${databaseName}
  SET auto_explain.log_analyze TO 'on';
ALTER ROLE ${webLogin} IN DATABASE ${databaseName}
  SET auto_explain.log_timing TO 'off';
ALTER ROLE ${webLogin} IN DATABASE ${databaseName}
  SET auto_explain.log_buffers TO 'on';
ALTER ROLE ${webLogin} IN DATABASE ${databaseName}
  SET auto_explain.log_nested_statements TO 'on';
ALTER ROLE ${webLogin} IN DATABASE ${databaseName}
  SET auto_explain.log_format TO 'json';
ALTER ROLE ${webLogin} IN DATABASE ${databaseName}
  SET auto_explain.log_parameter_max_length TO '0';

CREATE ROLE ${wideWebLogin}
  WITH LOGIN PASSWORD '${wideWebPassword}'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT viberacing_web TO ${wideWebLogin} WITH INHERIT FALSE, SET TRUE;
GRANT ${extraRole} TO ${wideWebLogin};
GRANT CONNECT ON DATABASE ${databaseName} TO ${wideWebLogin};
ALTER ROLE ${wideWebLogin} IN DATABASE ${databaseName}
  SET search_path TO pg_catalog, pg_temp;
COMMIT;`,
      "narrow and deliberately widened synthetic Web logins",
    );

    await exerciseNoSnapshot(databasePort, contracts, tlsMaterial.certificatePath);
    const calendar = readSyntheticCalendar();
    prepareSyntheticSnapshotScale(calendar);
    const scaleEvidence = buildSyntheticSnapshots(calendar, contracts);
    const initialState = readPrivateStateFingerprint("initial Web private-state fingerprint");

    await exerciseWidenedLoginDenial(databasePort, contracts, tlsMaterial.certificatePath);

    await exerciseSnapshotRoutes(databasePort, calendar, contracts, tlsMaterial.certificatePath);
    assert.equal(
      readPrivateStateFingerprint("post-success Web private-state fingerprint"),
      initialState,
      "the successful public reads must not mutate any private table",
    );
    assertAutoExplainEvidence();

    console.log(
      `Web PostgreSQL integration passed (10,001 profiles, 30,003 AgentAccounts, two synthetic providers, one complete seven-day historical scale window with current usage bounded to elapsed UTC days, 100 materialized current pages, ${scaleEvidence.elapsedMilliseconds}ms bounded snapshot catalog, zero target-fixture temp bytes, three built production Next processes over synthetic verified TLS, three final HTTP routes, four removed legacy routes, six bounded query-plan oracles, ETag/304 and cache policy, four-slot no-queue admission, least-privilege denial, exact contracts, and read-only stored state).`,
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
