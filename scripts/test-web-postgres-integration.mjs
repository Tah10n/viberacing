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

// cspell:ignore localdomain usename WINDIR

const root = resolve(import.meta.dirname, "..");
const webRoot = resolve(root, "apps", "web");
const nextEnvironmentPath = resolve(webRoot, "next-env.d.ts");
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
const maximumResponseBytes = 16 * 1024;
const maximumServerOutputBytes = 512 * 1024;
const maximumBlockerOutputBytes = 64 * 1024;
const serverStartupTimeoutMs = 60_000;
const serverRequestTimeoutMs = 30_000;
const serverCloseTimeoutMs = 15_000;
const databaseBlockerTimeoutMs = 10_000;
const blockedQueryObservationTimeoutMs = 2_000;
const admissionRejectionTimeoutMs = 1_500;
const databaseBlockerReadyMarker = "viberacing_web_admission_blocker_ready";
const productionNextEnvironmentReference = 'import "./.next/types/routes.d.ts";';

const fixture = Object.freeze({
  alphaProfileId: "00000000-0000-4000-8000-000000032101",
  alphaSourceId: `src_${"W".repeat(22)}`,
  betaProfileId: "00000000-0000-4000-8000-000000032102",
  betaSourceId: `src_${"X".repeat(22)}`,
  hiddenProfileId: "00000000-0000-4000-8000-000000032103",
});
const privateValueMarkers = Object.freeze([
  ...Object.values(fixture),
  webLogin,
  webPassword,
  wideWebLogin,
  wideWebPassword,
  extraRole,
  "web_hidden",
  "900000000000032101",
  "900000000000032102",
  "900000000000032103",
  `syn_${"W".repeat(22)}`,
  `syn_${"X".repeat(22)}`,
  `dev_${"W".repeat(22)}`,
  `dev_${"X".repeat(22)}`,
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
exec /usr/local/bin/docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=${databaseTlsCertificatePath} -c ssl_key_file=${databaseTlsKeyPath}
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
LOCK TABLE viberacing_private.season_entries IN ACCESS EXCLUSIVE MODE;
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

function readBlockedScoreQueryCount(label) {
  const value = psqlScalar(
    `SELECT pg_catalog.count(*)::text
FROM pg_catalog.pg_stat_activity AS activity
WHERE activity.datname = '${databaseName}'
  AND activity.usename = '${webLogin}'
  AND activity.state = 'active'
  AND activity.wait_event_type = 'Lock'
  AND pg_catalog.strpos(
    activity.query,
    'viberacing_api.list_public_community_scores('
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
  AND activity.application_name = 'viberacing-web-public-score';`,
      label,
    ),
  );
  assert.equal(Number.isSafeInteger(observation.connectionCount), true);
  assert.ok(observation.connectionCount >= 1 && observation.connectionCount <= 12);
  assert.equal(observation.allTls, true);
}

async function waitForBlockedScoreQueries() {
  const deadline = Date.now() + blockedQueryObservationTimeoutMs;
  let lastCount = 0;
  while (Date.now() < deadline) {
    lastCount = readBlockedScoreQueryCount("blocked Web score-query observation");
    if (lastCount === 4) {
      return;
    }
    await sleep(25);
  }
  throw new Error(`expected four blocked Web score queries, observed ${lastCount}`);
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
    VIBERACING_PUBLIC_RANKING_ENABLED: "true",
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
      'SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(candidate) ORDER BY pg_catalog.to_jsonb(candidate)::text), ''[]''::jsonb) FROM %I.%I AS candidate',
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
    throw new Error(`${path} returned no readable body.`);
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

async function getJson(baseUrl, path, seasonStart, timeoutMs = serverRequestTimeoutMs) {
  const response = await fetch(`${baseUrl}${path}?seasonStart=${seasonStart}`, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const bodyBytes = await readBoundedResponseBytes(response, path);
  assert.ok(bodyBytes.byteLength > 0, `${path} must return a body`);
  let body;
  try {
    body = JSON.parse(bodyBytes.toString("utf8"));
  } catch {
    throw new Error(`${path} returned malformed JSON.`);
  } finally {
    bodyBytes.fill(0);
  }
  return Object.freeze({ body, headers: response.headers, status: response.status });
}

function assertCommonResponseHeaders(result) {
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.match(result.headers.get("x-request-id") ?? "", requestIdPattern);
  assert.match(result.headers.get("vary") ?? "", /(?:^|,\s*)Accept(?:,|$)/i);
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
    "accepted_snapshot_id",
    "accepted_sync_id",
    "github_user_id",
    "profile_id",
    "source_id",
  ]) {
    assert.equal(
      serialized.includes(marker),
      false,
      `response must omit private marker: ${marker}`,
    );
  }
}

function assertUnavailable(result, validateProblemDetailsV1) {
  assert.equal(result.status, 503);
  assert.equal(result.headers.get("content-type"), "application/problem+json; charset=utf-8");
  assertCommonResponseHeaders(result);
  const requestId = result.headers.get("x-request-id");
  assert.deepEqual(result.body, {
    schemaVersion: 1,
    requestId,
    errorCode: "temporarily_unavailable",
    title: "Temporarily unavailable",
    status: 503,
    retryable: true,
  });
  assert.equal(validateProblemDetailsV1(result.body).ok, true);
  assertNoPrivateResponseValues(result.body);
}

function assertSuccess(result, expected, validate) {
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("content-type"), "application/json; charset=utf-8");
  assertCommonResponseHeaders(result);
  assert.deepEqual(result.body, expected);
  assert.equal(validate(result.body).ok, true);
  assertNoPrivateResponseValues(result.body);
}

function seedSyntheticState(seasonStart) {
  psql(
    `BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (
  profile_id,
  github_user_id,
  handle,
  state,
  streak_visible,
  hidden_at,
  deletion_requested_at
)
VALUES
  (
    '${fixture.alphaProfileId}',
    900000000000032101,
    'web_alpha',
    'active',
    true,
    NULL,
    NULL
  ),
  (
    '${fixture.betaProfileId}',
    900000000000032102,
    'web_beta',
    'active',
    false,
    NULL,
    NULL
  ),
  (
    '${fixture.hiddenProfileId}',
    900000000000032103,
    'web_hidden',
    'hidden',
    true,
    pg_catalog.statement_timestamp(),
    NULL
  );

INSERT INTO viberacing_private.profile_car_recipes (
  profile_id,
  schema_version,
  chassis,
  nose,
  cockpit,
  wing,
  wheels,
  palette,
  trail,
  seed
)
VALUES
  (
    '${fixture.alphaProfileId}',
    1,
    'formula',
    'wedge',
    'canopy',
    'high',
    'slick',
    'magenta',
    'spark',
    321
  ),
  (
    '${fixture.hiddenProfileId}',
    1,
    'roadster',
    'classic',
    'open',
    'low',
    'street',
    'sunburst',
    'grid',
    323
  );

INSERT INTO viberacing_private.seasons (
  season_start,
  season_end,
  score_version,
  grace_ends_at
)
VALUES (
  DATE '${seasonStart}',
  DATE '${seasonStart}' + 6,
  'community_v1',
  viberacing_private.community_season_grace_ends_at(DATE '${seasonStart}')
);

INSERT INTO viberacing_private.season_entries (
  season_start,
  profile_id,
  weekly_score,
  active_days,
  contributing_source_count,
  rank_position,
  display_order,
  computed_at
)
VALUES
  (
    DATE '${seasonStart}',
    '${fixture.hiddenProfileId}',
    900,
    7,
    3,
    1,
    1,
    pg_catalog.statement_timestamp()
  ),
  (
    DATE '${seasonStart}',
    '${fixture.alphaProfileId}',
    700,
    6,
    2,
    2,
    2,
    pg_catalog.statement_timestamp()
  ),
  (
    DATE '${seasonStart}',
    '${fixture.betaProfileId}',
    500,
    5,
    1,
    3,
    3,
    pg_catalog.statement_timestamp()
  );

INSERT INTO viberacing_private.codex_sources (source_id, profile_id, state)
VALUES
  ('${fixture.alphaSourceId}', '${fixture.alphaProfileId}', 'active'),
  ('${fixture.betaSourceId}', '${fixture.betaProfileId}', 'active');

INSERT INTO viberacing_private.source_day_values (
  source_id,
  codex_reported_date,
  tokens,
  accepted_snapshot_id,
  accepted_sync_id,
  accepted_device_id,
  first_accepted_at,
  last_accepted_at
)
VALUES
  (
    '${fixture.alphaSourceId}',
    DATE '${seasonStart}',
    1000,
    NULL,
    'syn_' || pg_catalog.repeat('W', 22),
    'dev_' || pg_catalog.repeat('W', 22),
    ((pg_catalog.statement_timestamp() AT TIME ZONE 'UTC')::date::timestamp AT TIME ZONE 'UTC'),
    ((pg_catalog.statement_timestamp() AT TIME ZONE 'UTC')::date::timestamp AT TIME ZONE 'UTC')
  ),
  (
    '${fixture.betaSourceId}',
    DATE '${seasonStart}',
    900,
    NULL,
    'syn_' || pg_catalog.repeat('X', 22),
    'dev_' || pg_catalog.repeat('X', 22),
    ((pg_catalog.statement_timestamp() AT TIME ZONE 'UTC')::date::timestamp AT TIME ZONE 'UTC'),
    ((pg_catalog.statement_timestamp() AT TIME ZONE 'UTC')::date::timestamp AT TIME ZONE 'UTC')
  );

INSERT INTO viberacing_private.season_daily_scores (
  season_start,
  profile_id,
  score_date,
  daily_score
)
SELECT
  DATE '${seasonStart}',
  profile_score.profile_id,
  DATE '${seasonStart}' + day_record.day_offset,
  CASE
    WHEN day_record.day_offset < profile_score.positive_day_count THEN 100
    ELSE 0
  END::smallint
FROM (
  VALUES
    ('${fixture.alphaProfileId}'::uuid, 7),
    ('${fixture.betaProfileId}'::uuid, 5)
) AS profile_score(profile_id, positive_day_count)
CROSS JOIN pg_catalog.generate_series(0, 6) AS day_record(day_offset);

COMMIT;`,
    "synthetic Web public-ranking fixture",
  );
}

function utcDateDifference(laterDate, earlierDate) {
  const later = Date.parse(`${laterDate}T00:00:00.000Z`);
  const earlier = Date.parse(`${earlierDate}T00:00:00.000Z`);
  assert.equal(Number.isSafeInteger(later), true, `invalid later UTC date: ${laterDate}`);
  assert.equal(Number.isSafeInteger(earlier), true, `invalid earlier UTC date: ${earlierDate}`);
  const difference = (later - earlier) / 86_400_000;
  assert.equal(Number.isSafeInteger(difference), true, "UTC date difference must be integral");
  return difference;
}

function expectedPages(seasonStart, observedDate, acceptedDate) {
  const seasonEnd = new Date(Date.parse(`${seasonStart}T00:00:00.000Z`) + 6 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const observedSeasonDay = utcDateDifference(observedDate, seasonStart);
  const freshnessDays = Math.min(
    65_535,
    Math.max(0, utcDateDifference(observedDate, acceptedDate)),
  );
  assert.ok(observedSeasonDay >= 0, "the observed date must not precede the seeded season");
  const streakDays = observedDate <= seasonEnd ? Math.min(7, observedSeasonDay + 1) : 7;
  const scoreParticipants = [
    {
      seasonStart,
      seasonEnd,
      scoreVersion: "community_v1",
      seasonFinalized: false,
      handle: "web_alpha",
      weeklyScore: 700,
      activeDays: 6,
      sourceCount: 2,
      rankPosition: 1,
      displayPosition: 1,
    },
    {
      seasonStart,
      seasonEnd,
      scoreVersion: "community_v1",
      seasonFinalized: false,
      handle: "web_beta",
      weeklyScore: 500,
      activeDays: 5,
      sourceCount: 1,
      rankPosition: 2,
      displayPosition: 2,
    },
  ];
  const alphaRecipe = {
    schemaVersion: 1,
    chassis: "formula",
    nose: "wedge",
    cockpit: "canopy",
    wing: "high",
    wheels: "slick",
    palette: "magenta",
    trail: "spark",
    seed: 321,
  };
  return Object.freeze({
    race: {
      schemaVersion: 1,
      trustTier: "community",
      selfReported: true,
      participants: [
        { ...scoreParticipants[0], carRecipe: alphaRecipe },
        { ...scoreParticipants[1] },
      ],
    },
    score: {
      schemaVersion: 1,
      trustTier: "community",
      selfReported: true,
      participants: scoreParticipants,
    },
    status: {
      schemaVersion: 1,
      trustTier: "community",
      selfReported: true,
      participants: [
        {
          ...scoreParticipants[0],
          carRecipe: alphaRecipe,
          freshnessDays,
          streakDays,
        },
        { ...scoreParticipants[1], freshnessDays },
      ],
    },
  });
}

function readCurrentUtcDate(label) {
  const date = psqlScalar(
    "SELECT (pg_catalog.statement_timestamp() AT TIME ZONE 'UTC')::date::text;",
    label,
  );
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  return date;
}

function readFixtureAcceptedDate() {
  const acceptedDate = psqlScalar(
    `SELECT CASE
  WHEN pg_catalog.count(*) = 2
    AND pg_catalog.count(
      DISTINCT (source_value.last_accepted_at AT TIME ZONE 'UTC')::date
    ) = 1
  THEN pg_catalog.min(
    (source_value.last_accepted_at AT TIME ZONE 'UTC')::date
  )::text
  ELSE ''
END
FROM viberacing_private.source_day_values AS source_value
WHERE source_value.source_id IN ('${fixture.alphaSourceId}', '${fixture.betaSourceId}');`,
    "synthetic Web accepted-date observation",
  );
  assert.match(acceptedDate, /^\d{4}-\d{2}-\d{2}$/);
  return acceptedDate;
}

async function exerciseUnavailableRoutes(
  databasePort,
  seasonStart,
  validateProblemDetailsV1,
  tlsCertificatePath,
) {
  const server = await startConfiguredProductionNextServer(
    databasePort,
    wideWebLogin,
    wideWebPassword,
    tlsCertificatePath,
  );
  const baseUrl = `http://127.0.0.1:${server.port}`;
  try {
    for (const path of [
      "/v1/community/scores",
      "/v1/community/race",
      "/v1/community/race/status",
    ]) {
      assertUnavailable(await getJson(baseUrl, path, seasonStart), validateProblemDetailsV1);
    }
  } finally {
    await stopProductionNextServer(server);
  }
}

async function exerciseNoQueueAdmission(baseUrl, seasonStart, expectedScore, contracts) {
  const blocker = await startDatabaseReadBlocker();
  const inFlightRequests = [];
  let blockerStopped = false;
  try {
    for (let index = 0; index < 4; index += 1) {
      const request = getJson(baseUrl, "/v1/community/scores", seasonStart);
      void request.catch(() => undefined);
      inFlightRequests.push(request);
    }
    await waitForBlockedScoreQueries();

    assertUnavailable(
      await getJson(baseUrl, "/v1/community/scores", seasonStart, admissionRejectionTimeoutMs),
      contracts.validateProblemDetailsV1,
    );
    assert.equal(
      readBlockedScoreQueryCount("post-rejection blocked Web score-query observation"),
      4,
      "the rejected fifth request must not add a fifth public-score query",
    );

    await stopDatabaseReadBlocker(blocker);
    blockerStopped = true;
    const settledRequests = await Promise.all(inFlightRequests);
    for (const result of settledRequests) {
      assertSuccess(result, expectedScore, contracts.validateCommunityScorePageV1);
    }
  } finally {
    if (!blockerStopped) {
      await stopDatabaseReadBlocker(blocker).catch(() => undefined);
    }
    await Promise.allSettled(inFlightRequests);
  }
}

async function exerciseSuccessfulRoutes(
  databasePort,
  seasonStart,
  acceptedDate,
  contracts,
  tlsCertificatePath,
) {
  const server = await startConfiguredProductionNextServer(
    databasePort,
    webLogin,
    webPassword,
    tlsCertificatePath,
  );
  const baseUrl = `http://127.0.0.1:${server.port}`;
  try {
    const stableExpected = expectedPages(seasonStart, acceptedDate, acceptedDate);
    assertSuccess(
      await getJson(baseUrl, "/v1/community/scores", seasonStart),
      stableExpected.score,
      contracts.validateCommunityScorePageV1,
    );
    assertWebTlsConnection("production Web TLS connection observation");
    assertSuccess(
      await getJson(baseUrl, "/v1/community/race", seasonStart),
      stableExpected.race,
      contracts.validateCommunityRacePageV1,
    );
    let statusValidated = false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const beforeDate = readCurrentUtcDate(`pre-status UTC date attempt ${attempt}`);
      const result = await getJson(baseUrl, "/v1/community/race/status", seasonStart);
      const afterDate = readCurrentUtcDate(`post-status UTC date attempt ${attempt}`);
      if (beforeDate === afterDate) {
        assertSuccess(
          result,
          expectedPages(seasonStart, beforeDate, acceptedDate).status,
          contracts.validateCommunityRaceStatusPageV1,
        );
        statusValidated = true;
        break;
      }
    }
    if (!statusValidated) {
      throw new Error("UTC date did not remain stable around the bounded status request.");
    }
    await exerciseNoQueueAdmission(baseUrl, seasonStart, stableExpected.score, contracts);
  } finally {
    await stopProductionNextServer(server);
  }
}

async function main() {
  const nextEnvironmentStats = lstatSync(nextEnvironmentPath);
  assert.equal(nextEnvironmentStats.isFile(), true, "next-env.d.ts must remain a regular file");
  assert.equal(
    nextEnvironmentStats.isSymbolicLink(),
    false,
    "next-env.d.ts must not be a symbolic link",
  );
  const originalNextEnvironment = readFileSync(nextEnvironmentPath);
  const originalNextEnvironmentText = originalNextEnvironment.toString("utf8");
  assert.equal(
    originalNextEnvironmentText.split(productionNextEnvironmentReference).length - 1,
    1,
    "next-env.d.ts must contain the one canonical production route-type reference",
  );
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

    const calendar = JSON.parse(
      psqlScalar(
        `SELECT pg_catalog.jsonb_build_object(
  'seasonStart', (
    (pg_catalog.statement_timestamp() AT TIME ZONE 'UTC')::date
    - (
      pg_catalog.date_part(
        'isodow',
        pg_catalog.statement_timestamp() AT TIME ZONE 'UTC'
      )::integer - 1
    )
  )::text
)::text;`,
        "current Community season discovery",
      ),
    );
    assert.match(calendar.seasonStart, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(new Date(`${calendar.seasonStart}T00:00:00.000Z`).getUTCDay(), 1);

    seedSyntheticState(calendar.seasonStart);
    const acceptedDate = readFixtureAcceptedDate();
    const initialState = readPrivateStateFingerprint("initial Web private-state fingerprint");

    await exerciseUnavailableRoutes(
      databasePort,
      calendar.seasonStart,
      contracts.validateProblemDetailsV1,
      tlsMaterial.certificatePath,
    );
    assert.equal(
      readPrivateStateFingerprint("post-rejection Web private-state fingerprint"),
      initialState,
      "the widened login must fail closed before mutating any private table",
    );

    await exerciseSuccessfulRoutes(
      databasePort,
      calendar.seasonStart,
      acceptedDate,
      contracts,
      tlsMaterial.certificatePath,
    );
    assert.equal(
      readPrivateStateFingerprint("post-success Web private-state fingerprint"),
      initialState,
      "the successful public reads must not mutate any private table",
    );

    console.log(
      "Web PostgreSQL integration passed (two built production Next processes over synthetic verified TLS, three real HTTP routes, four-slot no-queue admission, least-privilege denial, exact contracts, and read-only stored state).",
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
    try {
      const currentNextEnvironment = readFileSync(nextEnvironmentPath);
      if (!currentNextEnvironment.equals(originalNextEnvironment)) {
        writeFileSync(nextEnvironmentPath, originalNextEnvironment);
        cleanupFailure ??= new Error(
          "Next production build changed the canonical next-env.d.ts file",
        );
      }
      assert.equal(
        readFileSync(nextEnvironmentPath).equals(originalNextEnvironment),
        true,
        "Next production type reference restoration failed",
      );
    } catch {
      cleanupFailure ??= new Error("Next production type reference cleanup failed");
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
