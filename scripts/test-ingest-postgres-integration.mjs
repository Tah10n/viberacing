import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, createHmac, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { validateManifest } from "./check-database.mjs";

// cspell:ignore usename

const root = resolve(import.meta.dirname, "..");
const projectName = `vr-ingest-it-${process.pid}`;
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
const ingestLogin = "viberacing_ingest_login";
const ingestPassword = "synthetic-ingest-integration-password";
const profileId = "00000000-0000-4000-8000-000000026101";
const deviceKeyId = "00000000-0000-4000-8000-000000026201";
const sourceId = `src_${"S".repeat(22)}`;
const deviceId = `dev_${"D".repeat(22)}`;
const admissionDeviceKeyId = "00000000-0000-4000-8000-000000026202";
const admissionSourceId = `src_${"N".repeat(22)}`;
const admissionDeviceId = `dev_${"N".repeat(22)}`;
const acceptedSyncId = `syn_${"A".repeat(22)}`;
const revokedSyncId = `syn_${"R".repeat(22)}`;
const admissionSyncIds = Object.freeze(
  Array.from({ length: 4 }, (_, index) => `syn_${String(index + 1).repeat(22)}`),
);
const rejectedAdmissionSyncId = `syn_${"5".repeat(22)}`;
const originKeyId = "edge_integration";
const originSecret = Buffer.alloc(32, 0x33);
const requestIdPattern = /^req_[A-Za-z0-9_-]{22}$/;
const maximumResponseBytes = 2_048;
const maximumBlockerOutputBytes = 64 * 1024;
const databaseBlockerTimeoutMs = 10_000;
const blockedOriginObservationTimeoutMs = 2_000;
const admissionRejectionTimeoutMs = 1_500;
const databaseBlockerReadyMarker = "viberacing_ingest_admission_blocker_ready";
const privateValueMarkers = Object.freeze([
  profileId,
  deviceKeyId,
  sourceId,
  deviceId,
  admissionDeviceKeyId,
  admissionSourceId,
  admissionDeviceId,
  acceptedSyncId,
  revokedSyncId,
  ...admissionSyncIds,
  rejectedAdmissionSyncId,
  originKeyId,
  originSecret.toString("base64url"),
  ingestLogin,
  ingestPassword,
  "ingest-local-e2e",
]);

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

async function stopDatabaseOriginReplayBlocker(blocker) {
  if (!blocker.hasExited()) {
    blocker.child.stdin.end("ROLLBACK;\n");
  }
  let result;
  try {
    result = await waitWithDeadline(
      blocker.closed,
      databaseBlockerTimeoutMs,
      "PostgreSQL origin-replay blocker did not stop within its fixed deadline.",
    );
  } catch (error) {
    if (!blocker.hasExited()) {
      blocker.child.kill("SIGKILL");
      await waitWithDeadline(
        blocker.closed,
        databaseBlockerTimeoutMs,
        "PostgreSQL origin-replay blocker did not close after forced termination.",
      );
    }
    throw error;
  }
  if (blocker.hasPrivateOutput()) {
    throw new Error("PostgreSQL origin-replay blocker output exposed a private integration value.");
  }
  if (blocker.hasOutputOverflow()) {
    throw new Error("PostgreSQL origin-replay blocker exceeded its bounded output budget.");
  }
  if (result.code !== 0 || result.signal !== null) {
    throw new Error("PostgreSQL origin-replay blocker did not close cleanly.");
  }
}

async function startDatabaseOriginReplayBlocker() {
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
        rejectReady(new Error("PostgreSQL origin-replay blocker could not start."));
      }
      rejectClose(new Error("PostgreSQL origin-replay blocker could not start."));
    });
    child.once("close", (code, signal) => {
      exited = true;
      if (!readySettled) {
        readySettled = true;
        rejectReady(
          new Error("PostgreSQL origin-replay blocker exited before acquiring its lock."),
        );
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
LOCK TABLE viberacing_private.origin_nonces IN ACCESS EXCLUSIVE MODE;
\\echo ${databaseBlockerReadyMarker}
`);
    await waitWithDeadline(
      ready,
      databaseBlockerTimeoutMs,
      "PostgreSQL origin-replay blocker did not acquire its lock in time.",
    );
    if (privateOutput || outputOverflow || exited) {
      throw new Error("PostgreSQL origin-replay blocker failed before admission evidence began.");
    }
    return blocker;
  } catch (error) {
    await stopDatabaseOriginReplayBlocker(blocker).catch(() => undefined);
    throw error;
  }
}

function readBlockedOriginConsumeCount(label) {
  const value = psqlScalar(
    `SELECT pg_catalog.count(*)::text
FROM pg_catalog.pg_stat_activity AS activity
WHERE activity.datname = '${databaseName}'
  AND activity.usename = '${ingestLogin}'
  AND activity.state = 'active'
  AND activity.wait_event_type = 'Lock'
  AND pg_catalog.strpos(
    activity.query,
    'viberacing_api.consume_origin_nonce('
  ) > 0;`,
    label,
  );
  assert.match(value, /^[0-4]$/);
  return Number(value);
}

async function waitForBlockedOriginConsumes() {
  const deadline = Date.now() + blockedOriginObservationTimeoutMs;
  let lastCount = 0;
  while (Date.now() < deadline) {
    lastCount = readBlockedOriginConsumeCount("blocked Ingest origin-consume observation");
    if (lastCount === 4) {
      return;
    }
    await sleep(25);
  }
  throw new Error(`expected four blocked Ingest origin-consume queries, observed ${lastCount}`);
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

function readAuthenticationPolicy() {
  const value = JSON.parse(
    readFileSync(resolve(root, "contracts", "v1", "connector-sync-authentication.json"), "utf8"),
  );
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.method, "POST");
  assert.equal(value.requestTarget, "/v1/community/sync");
  assert.equal(value.mediaType, "application/json");
  assert.equal(value.canonicalMessageEncoding, "UTF-8");
  assert.equal(value.canonicalMessageSeparator, "LF");
  assert.equal(value.canonicalMessageTrailingSeparator, false);
  assert.equal(value.originProof.algorithm, "HMAC-SHA-256");
  assert.equal(value.deviceSignature.algorithm, "Ed25519");
  return value;
}

function canonicalMessage(fieldOrder, values) {
  assert.ok(Array.isArray(fieldOrder));
  const fields = fieldOrder.map((field) => {
    assert.equal(typeof field, "string");
    const value = values[field];
    assert.equal(typeof value, "string");
    assert.ok(!value.includes("\n"));
    return value;
  });
  return Buffer.from(fields.join("\n"), "utf8");
}

function readDevicePublicKey(keyPair) {
  const exported = keyPair.publicKey.export({ format: "jwk" });
  assert.equal(exported.kty, "OKP");
  assert.equal(exported.crv, "Ed25519");
  assert.equal(typeof exported.x, "string");
  const publicKey = Buffer.from(exported.x, "base64url");
  assert.equal(publicKey.byteLength, 32);
  return publicKey;
}

function createPayload(
  syncId,
  observedAt,
  tokens,
  { codexReportedDate = observedAt.slice(0, 10), payloadSourceId = sourceId } = {},
) {
  return {
    schemaVersion: 1,
    sourceId: payloadSourceId,
    syncId,
    observedAt,
    connectorVersion: "1.2.3",
    codexVersion: "0.144.5",
    dailyEntries: [{ codexReportedDate, tokens }],
  };
}

function buildSignedRequest({
  deviceNonceBytes,
  keyPair,
  originNonceBytes,
  originTimestamp,
  payload,
  policy,
  requestDeviceId = deviceId,
}) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const bodyDigestBase64Url = createHash("sha256").update(body).digest("base64url");
  const deviceNonce = Buffer.from(deviceNonceBytes).toString("base64url");
  const originNonce = Buffer.from(originNonceBytes).toString("base64url");
  const deviceMessage = canonicalMessage(policy.deviceSignature.canonicalFields, {
    messagePrefix: policy.deviceSignature.messagePrefix,
    method: policy.method,
    requestTarget: policy.requestTarget,
    bodyDigestBase64Url,
    deviceId: requestDeviceId,
    nonce: deviceNonce,
    timestamp: payload.observedAt,
    idempotencyKey: payload.syncId,
  });
  const deviceSignature = sign(null, deviceMessage, keyPair.privateKey).toString("base64url");
  const originMessage = canonicalMessage(policy.originProof.canonicalFields, {
    messagePrefix: policy.originProof.messagePrefix,
    keyId: originKeyId,
    method: policy.method,
    requestTarget: policy.requestTarget,
    bodyDigestBase64Url,
    timestamp: originTimestamp,
    nonce: originNonce,
  });
  const originProof = createHmac("sha256", originSecret).update(originMessage).digest("base64url");
  const headers = new Headers({
    accept: policy.mediaType,
    [policy.deviceSignature.headers.deviceId]: requestDeviceId,
    [policy.deviceSignature.headers.idempotencyKey]: payload.syncId,
    [policy.deviceSignature.headers.nonce]: deviceNonce,
    [policy.deviceSignature.headers.signature]: deviceSignature,
    [policy.deviceSignature.headers.timestamp]: payload.observedAt,
    [policy.originProof.headers.keyId]: originKeyId,
    [policy.originProof.headers.nonce]: originNonce,
    [policy.originProof.headers.proof]: originProof,
    [policy.originProof.headers.timestamp]: originTimestamp,
    "content-type": policy.mediaType,
  });
  return { body, headers };
}

function assertResponseHeaders(response, body, problem) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("vary") ?? "", /(?:^|,\s*)Accept(?:,|$)/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-request-id"), body.requestId);
  assert.equal(response.headers.has("access-control-allow-origin"), false);
  assert.equal(response.headers.has("set-cookie"), false);
  assert.match(
    response.headers.get("content-type") ?? "",
    problem ? /^application\/problem\+json\b/i : /^application\/json\b/i,
  );
}

async function postSignedRequest(baseUrl, policy, request, timeoutMilliseconds = 30_000) {
  const response = await fetch(`${baseUrl}${policy.requestTarget}`, {
    body: request.body,
    headers: request.headers,
    method: policy.method,
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMilliseconds),
  });
  const responseText = await response.text();
  assert.ok(Buffer.byteLength(responseText, "utf8") <= maximumResponseBytes);
  if (responseText.length === 0) {
    throw new Error(
      `Ingest returned an empty HTTP ${response.status} response (${response.headers.get("content-type") ?? "no-content-type"}, ${response.headers.get("content-length") ?? "no-content-length"}, request-id-${response.headers.has("x-request-id") ? "present" : "absent"})`,
    );
  }
  let body;
  try {
    body = JSON.parse(responseText);
  } catch {
    throw new Error(
      `Ingest returned non-JSON HTTP ${response.status} ${response.headers.get("content-type") ?? "without-content-type"}`,
    );
  }
  assert.match(body.requestId, requestIdPattern);
  assertResponseHeaders(response, body, response.status !== 200);
  return { body, status: response.status };
}

function assertSuccess(result, expected) {
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.body).sort(), [
    "acceptedEntries",
    "outcome",
    "requestId",
    "schemaVersion",
    "syncId",
  ]);
  assert.equal(result.body.schemaVersion, 1);
  assert.equal(result.body.syncId, expected.syncId);
  assert.equal(result.body.outcome, expected.outcome);
  assert.equal(result.body.acceptedEntries, expected.acceptedEntries);
}

function assertUnauthorized(result) {
  assert.equal(result.status, 401);
  assert.deepEqual(Object.keys(result.body).sort(), [
    "errorCode",
    "requestId",
    "retryable",
    "schemaVersion",
    "status",
    "title",
  ]);
  assert.deepEqual(
    {
      errorCode: result.body.errorCode,
      retryable: result.body.retryable,
      schemaVersion: result.body.schemaVersion,
      status: result.body.status,
      title: result.body.title,
    },
    {
      errorCode: "unauthorized",
      retryable: false,
      schemaVersion: 1,
      status: 401,
      title: "Unauthorized",
    },
  );
}

function assertTemporarilyUnavailable(result) {
  assert.equal(result.status, 503);
  assert.deepEqual(Object.keys(result.body).sort(), [
    "errorCode",
    "requestId",
    "retryable",
    "schemaVersion",
    "status",
    "title",
  ]);
  assert.deepEqual(
    {
      errorCode: result.body.errorCode,
      retryable: result.body.retryable,
      schemaVersion: result.body.schemaVersion,
      status: result.body.status,
      title: result.body.title,
    },
    {
      errorCode: "temporarily_unavailable",
      retryable: true,
      schemaVersion: 1,
      status: 503,
      title: "Temporarily unavailable",
    },
  );
}

function utcDateDaysBefore(baseTimestamp, days) {
  const value = new Date(baseTimestamp);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

async function exerciseNoQueueAdmission(baseUrl, policy, keyPair) {
  const blocker = await startDatabaseOriginReplayBlocker();
  const inFlightRequests = [];
  let blockerStopped = false;
  try {
    const observedAt = new Date().toISOString();
    for (let index = 0; index < admissionSyncIds.length; index += 1) {
      const request = buildSignedRequest({
        deviceNonceBytes: Buffer.alloc(16, 0x31 + index),
        keyPair,
        originNonceBytes: Buffer.alloc(16, 0x41 + index),
        originTimestamp: observedAt,
        payload: createPayload(admissionSyncIds[index], observedAt, 200 + index, {
          codexReportedDate: utcDateDaysBefore(observedAt, 4 - index),
          payloadSourceId: admissionSourceId,
        }),
        policy,
        requestDeviceId: admissionDeviceId,
      });
      const pending = postSignedRequest(baseUrl, policy, request, databaseBlockerTimeoutMs);
      void pending.catch(() => undefined);
      inFlightRequests.push(pending);
    }
    await waitForBlockedOriginConsumes();

    const rejectedRequest = buildSignedRequest({
      deviceNonceBytes: Buffer.alloc(16, 0x35),
      keyPair,
      originNonceBytes: Buffer.alloc(16, 0x45),
      originTimestamp: observedAt,
      payload: createPayload(rejectedAdmissionSyncId, observedAt, 204, {
        codexReportedDate: utcDateDaysBefore(observedAt, 5),
        payloadSourceId: admissionSourceId,
      }),
      policy,
      requestDeviceId: admissionDeviceId,
    });
    const rejectedResult = await waitWithDeadline(
      postSignedRequest(baseUrl, policy, rejectedRequest, admissionRejectionTimeoutMs),
      admissionRejectionTimeoutMs,
      "the fifth Ingest request did not receive a no-queue decision within the fixed deadline",
    );
    assertTemporarilyUnavailable(rejectedResult);
    assert.equal(
      readBlockedOriginConsumeCount("post-rejection blocked Ingest origin-consume observation"),
      4,
      "the rejected fifth request must not add a fifth origin-consume query",
    );

    await stopDatabaseOriginReplayBlocker(blocker);
    blockerStopped = true;
    const settledRequests = await Promise.all(inFlightRequests);
    for (let index = 0; index < settledRequests.length; index += 1) {
      assertSuccess(settledRequests[index], {
        acceptedEntries: 1,
        outcome: "accepted",
        syncId: admissionSyncIds[index],
      });
    }
    return [...settledRequests, rejectedResult];
  } finally {
    if (!blockerStopped) {
      await stopDatabaseOriginReplayBlocker(blocker).catch(() => undefined);
    }
    await Promise.allSettled(inFlightRequests);
  }
}

async function startHost(startConfiguredIngestHost, databasePort) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const listenerPort = await findAvailableListenerPort();
    const environment = Object.freeze({
      NODE_ENV: "test",
      VIBERACING_INGEST_ENABLED: "true",
      VIBERACING_INGEST_DATABASE_HOST: "127.0.0.1",
      VIBERACING_INGEST_DATABASE_NAME: databaseName,
      VIBERACING_INGEST_DATABASE_PASSWORD: ingestPassword,
      VIBERACING_INGEST_DATABASE_PORT: String(databasePort),
      VIBERACING_INGEST_DATABASE_TLS_MODE: "disable",
      VIBERACING_INGEST_DATABASE_USER: ingestLogin,
      VIBERACING_INGEST_LISTENER_HOST: "127.0.0.1",
      VIBERACING_INGEST_LISTENER_PORT: String(listenerPort),
      VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_BASE64URL: originSecret.toString("base64url"),
      VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_ID: originKeyId,
      VIBERACING_INGEST_TLS_TERMINATION: "loopback-cleartext",
    });
    try {
      const controller = await startConfiguredIngestHost(environment);
      return { baseUrl: `http://127.0.0.1:${listenerPort}`, controller };
    } catch (error) {
      if (error?.code !== "listen_failed" || attempt === 2) {
        throw error;
      }
    }
  }
  throw new Error("Ingest host listener allocation failed");
}

async function main() {
  buildWorkspace("packages/contracts", "contract production build");
  buildWorkspace("apps/ingest", "Ingest production build");
  buildWorkspace("apps/ingest-host", "Ingest host production build");

  const policy = readAuthenticationPolicy();
  const keyPair = generateKeyPairSync("ed25519");
  const publicKey = readDevicePublicKey(keyPair);
  const admissionKeyPair = generateKeyPairSync("ed25519");
  const admissionPublicKey = readDevicePublicKey(admissionKeyPair);
  let containerStarted = false;
  let controller;
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
CREATE ROLE ${ingestLogin}
  WITH LOGIN PASSWORD '${ingestPassword}'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT viberacing_ingest TO ${ingestLogin} WITH INHERIT FALSE, SET TRUE;
GRANT CONNECT ON DATABASE ${databaseName} TO ${ingestLogin};
ALTER ROLE ${ingestLogin} IN DATABASE ${databaseName}
  SET search_path TO pg_catalog, pg_temp;

SET LOCAL ROLE viberacing_owner;
INSERT INTO viberacing_private.profiles (
  profile_id,
  github_user_id,
  handle,
  state
)
VALUES (
  '${profileId}',
  900000000000026101,
  'ingest-local-e2e',
  'active'
);

INSERT INTO viberacing_private.codex_sources (source_id, profile_id, state)
VALUES
  ('${sourceId}', '${profileId}', 'active'),
  ('${admissionSourceId}', '${profileId}', 'active');

INSERT INTO viberacing_private.device_keys (
  device_key_id,
  device_id,
  source_id,
  public_key,
  label,
  connector_version,
  os_family,
  architecture,
  state,
  activated_at
)
VALUES
  (
    '${deviceKeyId}',
    '${deviceId}',
    '${sourceId}',
    pg_catalog.decode('${publicKey.toString("hex")}', 'hex'),
    'Synthetic integration device',
    '1.2.3',
    'linux',
    'x86_64',
    'active',
    pg_catalog.statement_timestamp()
  ),
  (
    '${admissionDeviceKeyId}',
    '${admissionDeviceId}',
    '${admissionSourceId}',
    pg_catalog.decode('${admissionPublicKey.toString("hex")}', 'hex'),
    'Synthetic admission device',
    '1.2.3',
    'linux',
    'x86_64',
    'active',
    pg_catalog.statement_timestamp()
  );
COMMIT;`,
      "least-privileged Ingest login and synthetic device setup",
    );

    const hostModuleUrl = pathToFileURL(
      resolve(root, "apps", "ingest-host", "dist", "host.js"),
    ).href;
    const { startConfiguredIngestHost } = await import(hostModuleUrl);
    const host = await startHost(startConfiguredIngestHost, databasePort);
    controller = host.controller;

    const acceptedObservedAt = new Date().toISOString();
    const acceptedPayload = createPayload(acceptedSyncId, acceptedObservedAt, 123);
    const acceptedRequest = buildSignedRequest({
      deviceNonceBytes: Buffer.alloc(16, 0x11),
      keyPair,
      originNonceBytes: Buffer.alloc(16, 0x21),
      originTimestamp: acceptedObservedAt,
      payload: acceptedPayload,
      policy,
    });
    const acceptedResult = await postSignedRequest(host.baseUrl, policy, acceptedRequest);
    assertSuccess(acceptedResult, {
      acceptedEntries: 1,
      outcome: "accepted",
      syncId: acceptedSyncId,
    });

    const duplicateRequest = buildSignedRequest({
      deviceNonceBytes: Buffer.alloc(16, 0x11),
      keyPair,
      originNonceBytes: Buffer.alloc(16, 0x22),
      originTimestamp: acceptedObservedAt,
      payload: acceptedPayload,
      policy,
    });
    assert.deepEqual(duplicateRequest.body, acceptedRequest.body);
    assert.equal(
      duplicateRequest.headers.get(policy.deviceSignature.headers.signature),
      acceptedRequest.headers.get(policy.deviceSignature.headers.signature),
    );
    const duplicateResult = await postSignedRequest(host.baseUrl, policy, duplicateRequest);
    assertSuccess(duplicateResult, {
      acceptedEntries: 0,
      outcome: "duplicate",
      syncId: acceptedSyncId,
    });

    const replayResult = await postSignedRequest(host.baseUrl, policy, duplicateRequest);
    assertUnauthorized(replayResult);

    psql(
      `BEGIN;
SET LOCAL ROLE viberacing_owner;
UPDATE viberacing_private.device_keys
SET
  state = 'revoked',
  revoked_at = pg_catalog.statement_timestamp()
WHERE device_key_id = '${deviceKeyId}'
  AND state = 'active';
COMMIT;`,
      "synthetic device revocation",
    );

    const revokedObservedAt = new Date().toISOString();
    const revokedRequest = buildSignedRequest({
      deviceNonceBytes: Buffer.alloc(16, 0x12),
      keyPair,
      originNonceBytes: Buffer.alloc(16, 0x23),
      originTimestamp: revokedObservedAt,
      payload: createPayload(revokedSyncId, revokedObservedAt, 456),
      policy,
    });
    const revokedResult = await postSignedRequest(host.baseUrl, policy, revokedRequest);
    assertUnauthorized(revokedResult);

    const admissionResults = await exerciseNoQueueAdmission(host.baseUrl, policy, admissionKeyPair);

    const requestIds = new Set([
      acceptedResult.body.requestId,
      duplicateResult.body.requestId,
      replayResult.body.requestId,
      revokedResult.body.requestId,
      ...admissionResults.map((result) => result.body.requestId),
    ]);
    assert.equal(requestIds.size, 9);

    await controller.close();
    controller = undefined;

    const storedState = JSON.parse(
      psqlScalar(
        `SET ROLE viberacing_owner;
SELECT pg_catalog.jsonb_build_object(
  'deviceNonceCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.device_nonces
    WHERE device_key_id = '${deviceKeyId}'
  ),
  'admissionDeviceNonceCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.device_nonces
    WHERE device_key_id = '${admissionDeviceKeyId}'
  ),
  'deviceState', (
    SELECT state
    FROM viberacing_private.device_keys
    WHERE device_key_id = '${deviceKeyId}'
  ),
  'admissionDeviceState', (
    SELECT state
    FROM viberacing_private.device_keys
    WHERE device_key_id = '${admissionDeviceKeyId}'
  ),
  'originCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.origin_nonces
    WHERE origin_key_id = '${originKeyId}'
  ),
  'snapshotCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.usage_snapshots
    WHERE device_key_id = '${deviceKeyId}'
  ),
  'admissionSnapshotCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.usage_snapshots
    WHERE device_key_id = '${admissionDeviceKeyId}'
  ),
  'snapshotEntryCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.usage_snapshot_entries AS entry_record
    JOIN viberacing_private.usage_snapshots AS snapshot_record
      ON snapshot_record.usage_snapshot_id = entry_record.usage_snapshot_id
    WHERE snapshot_record.device_key_id = '${deviceKeyId}'
  ),
  'admissionSnapshotEntryCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.usage_snapshot_entries AS entry_record
    JOIN viberacing_private.usage_snapshots AS snapshot_record
      ON snapshot_record.usage_snapshot_id = entry_record.usage_snapshot_id
    WHERE snapshot_record.device_key_id = '${admissionDeviceKeyId}'
  ),
  'snapshotOutcome', (
    SELECT outcome
    FROM viberacing_private.usage_snapshots
    WHERE device_key_id = '${deviceKeyId}'
  ),
  'sourceDayCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.source_day_values
    WHERE source_id = '${sourceId}'
  ),
  'admissionSourceDayCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.source_day_values
    WHERE source_id = '${admissionSourceId}'
  ),
  'sourceTokens', (
    SELECT tokens
    FROM viberacing_private.source_day_values
    WHERE source_id = '${sourceId}'
  ),
  'admissionSourceTokens', (
    SELECT pg_catalog.jsonb_agg(source_value.tokens ORDER BY source_value.codex_reported_date)
    FROM viberacing_private.source_day_values AS source_value
    WHERE source_value.source_id = '${admissionSourceId}'
  ),
  'unexpectedSyncCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.usage_snapshots
    WHERE sync_id = '${revokedSyncId}'
  ),
  'rejectedAdmissionSyncCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.usage_snapshots
    WHERE sync_id = '${rejectedAdmissionSyncId}'
  )
)::text;`,
        "Ingest stored-state verification",
      ),
    );
    assert.deepEqual(storedState, {
      admissionDeviceNonceCount: 4,
      admissionDeviceState: "active",
      admissionSnapshotCount: 4,
      admissionSnapshotEntryCount: 4,
      admissionSourceDayCount: 4,
      admissionSourceTokens: [200, 201, 202, 203],
      deviceNonceCount: 1,
      deviceState: "revoked",
      originCount: 7,
      rejectedAdmissionSyncCount: 0,
      snapshotCount: 1,
      snapshotEntryCount: 1,
      snapshotOutcome: "accepted",
      sourceDayCount: 1,
      sourceTokens: 123,
      unexpectedSyncCount: 0,
    });

    console.log(
      "Ingest PostgreSQL integration passed (accepted, duplicate, replay denial, revocation denial, four-slot no-queue admission, and exact stored state).",
    );
  } catch (error) {
    primaryFailure = error;
  } finally {
    if (controller !== undefined) {
      try {
        await controller.close();
      } catch (error) {
        cleanupFailure ??= error;
      }
    }
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
