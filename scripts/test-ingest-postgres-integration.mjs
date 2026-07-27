import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, createHmac, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { createConnection, createServer } from "node:net";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

import { validateManifest } from "./check-database.mjs";
import { createPortableNodeRuntime, removePortableNodeRuntime } from "./portable-node-runtime.mjs";

// cspell:ignore pinojs usename

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
const usageSyncId = `syn_${"U".repeat(22)}`;
const revokedSyncId = `syn_${"R".repeat(22)}`;
const admissionSyncIds = Object.freeze(
  Array.from({ length: 4 }, (_, index) => `syn_${String(index + 1).repeat(22)}`),
);
const rejectedAdmissionSyncId = `syn_${"5".repeat(22)}`;
const emittedProcessSyncId = `syn_${"P".repeat(22)}`;
const signalProcessSyncId = `syn_${"Q".repeat(22)}`;
const originKeyId = "edge_integration";
const originSecret = Buffer.alloc(32, 0x33);
const signalProcessArgument = "--signal-process";
const signalProcessContainerName = `${projectName}-ingest-signal`;
const signalProcessClientContainerName = `${projectName}-ingest-signal-client`;
const signalProcessListenerPort = 8788;
const signalProcessContainerImage = (() => {
  const compose = parse(readFileSync(resolve(root, "compose.yaml"), "utf8"));
  const image = compose?.services?.["node-process-signal-test"]?.image;
  assert.equal(typeof image, "string");
  assert.match(image, /^node:24\.18\.0-bookworm-slim@sha256:[a-f0-9]{64}$/);
  return image;
})();
const signalProcessRuntimeInventory = Object.freeze([
  "@fastify/ajv-compiler@4.0.5",
  "@fastify/error@4.2.0",
  "@fastify/fast-json-stringify-compiler@5.1.0",
  "@fastify/forwarded@3.0.1",
  "@fastify/merge-json-schemas@0.2.1",
  "@fastify/proxy-addr@5.1.0",
  "@noble/ed25519@3.1.0",
  "@pinojs/redact@0.4.0",
  "abstract-logging@2.0.1",
  "ajv-formats@3.0.1",
  "ajv@8.20.0",
  "atomic-sleep@1.0.0",
  "avvio@9.2.0",
  "cookie@1.1.1",
  "dequal@2.0.3",
  "fast-decode-uri-component@1.0.1",
  "fast-deep-equal@3.1.3",
  "fast-json-stringify@7.0.1",
  "fast-querystring@1.1.2",
  "fast-uri@3.1.4",
  "fast-uri@4.1.1",
  "fastify@5.10.0",
  "fastq@1.20.1",
  "find-my-way@9.7.0",
  "ipaddr.js@2.4.0",
  "json-schema-ref-resolver@3.0.0",
  "json-schema-traverse@1.0.0",
  "light-my-request@6.6.0",
  "on-exit-leak-free@2.1.2",
  "pg-cloudflare@1.4.0",
  "pg-connection-string@2.14.0",
  "pg-int8@1.0.1",
  "pg-pool@3.14.0",
  "pg-protocol@1.15.0",
  "pg-types@2.2.0",
  "pg@8.22.0",
  "pgpass@1.0.5",
  "pino-abstract-transport@3.0.0",
  "pino-std-serializers@7.1.0",
  "pino@10.3.1",
  "postgres-array@2.0.0",
  "postgres-bytea@1.0.1",
  "postgres-date@1.0.7",
  "postgres-interval@1.2.0",
  "process-warning@4.0.1",
  "process-warning@5.0.0",
  "quick-format-unescaped@4.0.4",
  "real-require@0.2.0",
  "real-require@1.0.0",
  "require-from-string@2.0.2",
  "ret@0.5.0",
  "reusify@1.1.0",
  "rfdc@1.4.1",
  "safe-regex2@5.1.1",
  "safe-stable-stringify@2.5.0",
  "secure-json-parse@4.1.0",
  "semver@7.8.5",
  "set-cookie-parser@2.7.2",
  "sonic-boom@4.2.1",
  "split2@4.2.0",
  "thread-stream@4.2.0",
  "toad-cache@3.7.4",
  "xtend@4.0.2",
]);
const requestIdPattern = /^req_[A-Za-z0-9_-]{22}$/;
const maximumResponseBytes = 2_048;
const removedSyncRequestTarget = "/v1/community/sync";
const maximumBlockerOutputBytes = 64 * 1024;
const maximumSignalClientOutputBytes = 8 * 1024;
const databaseBlockerTimeoutMs = 10_000;
const blockedOriginObservationTimeoutMs = 2_000;
const signalBlockedOriginObservationTimeoutMs = 10_000;
const admissionRejectionTimeoutMs = 1_500;
const emittedProcessStartTimeoutMs = 10_000;
const emittedProcessCloseTimeoutMs = 5_000;
const emittedProcessProbeTimeoutMs = 250;
const signalProcessCloseTimeoutMs = 10_000;
const signalProcessPollIntervalMs = 100;
const signalProcessStartTimeoutMs = 30_000;
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
  usageSyncId,
  revokedSyncId,
  ...admissionSyncIds,
  rejectedAdmissionSyncId,
  emittedProcessSyncId,
  signalProcessSyncId,
  originKeyId,
  originSecret.toString("base64url"),
  ingestLogin,
  ingestPassword,
  "ingest-local-e2e",
]);

function readIntegrationMode() {
  if (process.argv.length === 2) {
    return "full";
  }
  if (process.argv.length === 3 && process.argv[2] === signalProcessArgument) {
    return "signal_process";
  }
  throw new Error("Ingest PostgreSQL integration arguments failed closed.");
}

const integrationMode = readIntegrationMode();

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

async function waitForOneBlockedOriginConsume(client) {
  const deadline = Date.now() + signalBlockedOriginObservationTimeoutMs;
  let lastCount = 0;
  while (Date.now() < deadline) {
    if (client.hasExited()) {
      const result = await readSignalProcessClientResult(client);
      throw new Error(
        `Ingest signal client exited with HTTP ${result.status} before the controlled database wait.`,
      );
    }
    const state = readSignalProcessContainerState();
    if (!state.Running || readSignalProcessContainerOutput() !== "") {
      throw new Error("Ingest signal host failed before the controlled database wait.");
    }
    lastCount = readBlockedOriginConsumeCount("signal-blocked Ingest origin-consume observation");
    if (lastCount === 1) {
      return;
    }
    assert.equal(lastCount, 0, "the signal integration must admit only one database call");
    await sleep(signalProcessPollIntervalMs);
  }
  throw new Error(`expected one blocked Ingest origin-consume query, observed ${lastCount}`);
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
    readFileSync(
      resolve(root, "contracts", "v1", "connector-usage-sync-authentication.json"),
      "utf8",
    ),
  );
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.protocolId, "viberacing-usage-sync-auth-v1");
  assert.equal(value.method, "POST");
  assert.equal(value.requestTarget, "/v1/community/usage");
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
  dailyTokenTotal,
  { payloadSourceId = sourceId, reportedDate = observedAt.slice(0, 10) } = {},
) {
  return {
    schemaVersion: 1,
    sourceId: payloadSourceId,
    syncId,
    observedAt,
    clientVersion: "1.2.3",
    agentVersion: "0.144.5",
    dailyEntries: [{ reportedDate, dailyTokenTotal }],
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

function assertNotFound(result) {
  assert.equal(result.status, 404);
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
      errorCode: "not_found",
      retryable: false,
      schemaVersion: 1,
      status: 404,
      title: "Not found",
    },
  );
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
          reportedDate: utcDateDaysBefore(observedAt, 4 - index),
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
        reportedDate: utcDateDaysBefore(observedAt, 5),
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

async function exerciseEmittedIngestProcess(databasePort, policy, keyPair) {
  const listenerPort = await findAvailableListenerPort();
  const processState = startEmittedIngestProcess(databasePort, listenerPort);
  let processStopped = false;
  try {
    await waitForEmittedIngestListener(processState, listenerPort);
    const observedAt = new Date().toISOString();
    const request = buildSignedRequest({
      deviceNonceBytes: Buffer.alloc(16, 0x36),
      keyPair,
      originNonceBytes: Buffer.alloc(16, 0x46),
      originTimestamp: observedAt,
      payload: createPayload(emittedProcessSyncId, observedAt, 300, {
        payloadSourceId: admissionSourceId,
      }),
      policy,
      requestDeviceId: admissionDeviceId,
    });
    const result = await postSignedRequest(`http://127.0.0.1:${listenerPort}`, policy, request);
    assertSuccess(result, {
      acceptedEntries: 1,
      outcome: "accepted",
      syncId: emittedProcessSyncId,
    });
    assert.equal(
      processState.hasExited(),
      false,
      "the emitted Ingest host must remain active through its accepted request",
    );
    assert.equal(
      processState.outputObserved(),
      false,
      "the emitted Ingest host must remain silent through its accepted request",
    );

    const stopResult = await stopEmittedIngestProcess(processState);
    processStopped = true;
    assert.equal(
      stopResult.terminationRequested,
      true,
      "the synthetic harness must terminate only its emitted Ingest child",
    );
    assert.equal(
      processState.outputObserved(),
      false,
      "the emitted Ingest host must remain silent through stdio close",
    );
    assert.deepEqual(
      stopResult.closeResult,
      { code: null, signal: "SIGKILL" },
      "the synthetic harness must end the persistent child after the accepted request",
    );
    return result;
  } finally {
    if (!processStopped) {
      await stopEmittedIngestProcess(processState).catch(() => undefined);
    }
  }
}

function ingestEnvironment(databasePort, listenerPort) {
  return Object.freeze({
    NODE_ENV: "test",
    VIBERACING_INGEST_ENABLED: "true",
    VIBERACING_USAGE_SYNC_ENABLED: "true",
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
}

function startEmittedIngestProcess(databasePort, listenerPort) {
  let exitObserved = false;
  let stdoutObserved = false;
  let stderrObserved = false;
  const child = spawn(process.execPath, [resolve(root, "apps", "ingest-host", "dist", "main.js")], {
    cwd: root,
    env: ingestEnvironment(databasePort, listenerPort),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const terminateOnOutput = (stream) => {
    if (stream === "stdout") {
      stdoutObserved = true;
    } else {
      stderrObserved = true;
    }
    child.kill("SIGKILL");
  };
  child.stdout.on("data", () => {
    terminateOnOutput("stdout");
  });
  child.stderr.on("data", () => {
    terminateOnOutput("stderr");
  });
  child.once("exit", () => {
    exitObserved = true;
  });
  const closed = new Promise((resolveClose, rejectClose) => {
    child.once("error", () => {
      exitObserved = true;
      rejectClose(new Error("Emitted Ingest host process could not start."));
    });
    child.once("close", (code, signal) => {
      exitObserved = true;
      resolveClose(Object.freeze({ code, signal }));
    });
  });
  void closed.catch(() => undefined);
  return Object.freeze({
    child,
    closed,
    hasExited: () => exitObserved,
    outputObserved: () => stdoutObserved || stderrObserved,
  });
}

async function probeLoopbackListener(listenerPort) {
  return new Promise((resolveProbe) => {
    const socket = createConnection({ host: "127.0.0.1", port: listenerPort });
    let settled = false;
    const finish = (connected) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolveProbe(connected);
    };
    socket.once("connect", () => {
      finish(true);
    });
    socket.once("error", () => {
      finish(false);
    });
    socket.setTimeout(emittedProcessProbeTimeoutMs, () => {
      finish(false);
    });
  });
}

async function waitForEmittedIngestListener(processState, listenerPort) {
  const deadline = Date.now() + emittedProcessStartTimeoutMs;
  while (Date.now() < deadline) {
    if (processState.outputObserved()) {
      throw new Error("Emitted Ingest host process produced unexpected output.");
    }
    if (processState.hasExited()) {
      throw new Error("Emitted Ingest host process exited before opening its listener.");
    }
    if (await probeLoopbackListener(listenerPort)) {
      return;
    }
    await sleep(25);
  }
  throw new Error("Emitted Ingest host process did not open its listener in time.");
}

async function stopEmittedIngestProcess(processState) {
  let terminationRequested = false;
  if (!processState.hasExited()) {
    terminationRequested = processState.child.kill("SIGKILL");
  }
  const closeResult = await waitWithDeadline(
    processState.closed,
    emittedProcessCloseTimeoutMs,
    "Emitted Ingest host process did not close within its fixed test deadline.",
  );
  return Object.freeze({ closeResult, terminationRequested });
}

const signalProcessProbeSource = `
import { createConnection } from "node:net";
const socket = createConnection({ host: "127.0.0.1", port: ${signalProcessListenerPort} });
let settled = false;
const finish = (code) => {
  if (settled) return;
  settled = true;
  socket.destroy();
  process.exitCode = code;
};
socket.once("connect", () => finish(0));
socket.once("error", () => finish(1));
socket.setTimeout(${emittedProcessProbeTimeoutMs}, () => finish(1));
`.trim();

const signalProcessClientSource = `
const fail = (clientError) => {
  const error = new Error("signal client failed");
  error.clientError = clientError;
  throw error;
};
try {
  const chunks = [];
  let inputBytes = 0;
  for await (const chunk of process.stdin) {
    inputBytes += chunk.byteLength;
    if (inputBytes > 16 * 1024) fail("input_invalid");
    chunks.push(chunk);
  }
  const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const body = Buffer.from(request.bodyBase64Url, "base64url");
  if (
    body.length < 1 ||
    body.length > 8_192 ||
    body.toString("base64url") !== request.bodyBase64Url
  ) {
    fail("input_invalid");
  }
  let response;
  try {
    response = await fetch(request.url, {
      body,
      headers: request.headers,
      method: request.method,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const causeCode = error?.cause?.code;
    if (causeCode === "UND_ERR_SOCKET" || causeCode === "ECONNRESET") {
      fail("fetch_socket_closed");
    }
    if (causeCode === "ECONNREFUSED") {
      fail("fetch_refused");
    }
    fail("fetch_failed");
  }
  const responseText = await response.text();
  let responseBody;
  try {
    responseBody = JSON.parse(responseText);
  } catch {
    fail("response_invalid");
  }
  process.stdout.write(JSON.stringify({
    body: responseBody,
    headers: Object.fromEntries(response.headers.entries()),
    status: response.status,
  }));
} catch (error) {
  const admitted = new Set([
    "fetch_failed",
    "fetch_refused",
    "fetch_socket_closed",
    "input_invalid",
    "response_invalid",
  ]);
  const clientError = admitted.has(error?.clientError) ? error.clientError : "client_failed";
  process.stdout.write(JSON.stringify({ clientError }));
  process.exitCode = 1;
}
`.trim();

function createPortableIngestSignalRuntime() {
  return createPortableNodeRuntime({
    entryWorkspaceDirectory: resolve(root, "apps", "ingest-host"),
    expectedExternalInventory: signalProcessRuntimeInventory,
    expectedWorkspaceInventory: [
      "@viberacing/contracts@0.0.0",
      "@viberacing/ingest-host@0.0.0",
      "@viberacing/ingest@0.0.0",
    ],
    maximumFileCount: 2_300,
    minimumFileCount: 2_100,
    root,
    runtimePrefix: "ingest-signal-runtime-",
    workspaceDirectories: [
      resolve(root, "apps", "ingest-host"),
      resolve(root, "apps", "ingest"),
      resolve(root, "packages", "contracts"),
    ],
  });
}

function signalProcessContainerExists(name) {
  const result = docker(["inspect", name], { timeout: 10_000 });
  if (result.status === 0) {
    return true;
  }
  if (
    result.status === 1 &&
    result.stdout.trim() === "[]" &&
    result.stderr.trim().toLowerCase() === `error: no such object: ${name}`
  ) {
    return false;
  }
  throw new Error("Ingest signal container existence check failed.");
}

function removeSignalProcessContainer(name) {
  if (!signalProcessContainerExists(name)) {
    return;
  }
  requireSuccess(
    docker(["rm", "--force", name], { timeout: 15_000 }),
    "Ingest signal container removal",
  );
}

function createSignalProcessContainer(runtimeDirectory) {
  const environmentArguments = Object.entries(ingestEnvironment(5432, signalProcessListenerPort))
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, value]) => ["--env", `${key}=${value}`]);
  const bindSource = runtimeDirectory.replaceAll("\\", "/");
  const result = docker(
    [
      "create",
      "--name",
      signalProcessContainerName,
      "--network",
      `container:${containerName}`,
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--pids-limit",
      "64",
      "--memory",
      "256m",
      "--cpus",
      "1",
      "--user",
      "node",
      "--workdir",
      "/runtime",
      "--mount",
      `type=bind,source=${bindSource},target=/runtime,readonly`,
      ...environmentArguments,
      signalProcessContainerImage,
      "node",
      "/runtime/dist/main.js",
    ],
    { timeout: 30_000 },
  );
  requireSuccess(result, "Ingest signal container creation");
  assert.match(result.stdout.trim(), /^[a-f0-9]{64}$/);

  const imageInspection = docker(
    ["image", "inspect", "--format", "{{json .Config.Env}}", signalProcessContainerImage],
    { timeout: 10_000 },
  );
  requireSuccess(imageInspection, "Ingest signal runtime image inspection");
  const imageEnvironment = JSON.parse(imageInspection.stdout.trim());
  assert.equal(Array.isArray(imageEnvironment), true);
  assert.equal(
    imageEnvironment.includes("NODE_VERSION=24.18.0"),
    true,
    "the pinned Linux signal runtime must match the repository Node version",
  );
}

function readSignalProcessContainerState() {
  const result = docker(["inspect", "--format", "{{json .State}}", signalProcessContainerName], {
    timeout: 10_000,
  });
  requireSuccess(result, "Ingest signal container state read");
  return JSON.parse(result.stdout.trim());
}

function readSignalProcessContainerOutput() {
  const result = docker(["logs", signalProcessContainerName], { timeout: 10_000 });
  requireSuccess(result, "Ingest signal container output read");
  return `${result.stdout}${result.stderr}`;
}

function probeSignalProcessListener() {
  const result = docker(
    [
      "exec",
      signalProcessContainerName,
      "node",
      "--input-type=module",
      "--eval",
      signalProcessProbeSource,
    ],
    { timeout: 2_000 },
  );
  if (result.status === 0) {
    assert.equal(`${result.stdout}${result.stderr}`, "");
    return true;
  }
  if (result.status === 1 && `${result.stdout}${result.stderr}` === "") {
    return false;
  }
  throw new Error("Ingest signal listener probe failed closed.");
}

async function waitForSignalProcessListener() {
  const deadline = Date.now() + signalProcessStartTimeoutMs;
  while (Date.now() < deadline) {
    const state = readSignalProcessContainerState();
    if (!state.Running) {
      throw new Error("Ingest signal container exited before opening its listener.");
    }
    if (readSignalProcessContainerOutput() !== "") {
      throw new Error("Ingest signal container produced output before its listener was ready.");
    }
    if (probeSignalProcessListener()) {
      return;
    }
    await sleep(signalProcessPollIntervalMs);
  }
  throw new Error("Ingest signal container did not open its listener in time.");
}

function startSignalProcessClient(policy, request) {
  let exited = false;
  let outputBytes = 0;
  let outputOverflow = false;
  let stdout = "";
  let stderr = "";
  const child = spawn(
    "docker",
    [
      "run",
      "--rm",
      "--name",
      signalProcessClientContainerName,
      "--network",
      `container:${containerName}`,
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--pids-limit",
      "32",
      "--memory",
      "128m",
      "--cpus",
      "1",
      "--user",
      "node",
      "--interactive",
      signalProcessContainerImage,
      "node",
      "--input-type=module",
      "--eval",
      signalProcessClientSource,
    ],
    {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const observe = (stream, chunk) => {
    outputBytes += chunk.byteLength;
    if (stream === "stdout") {
      stdout += chunk.toString("utf8");
    } else {
      stderr += chunk.toString("utf8");
    }
    if (outputBytes > maximumSignalClientOutputBytes) {
      outputOverflow = true;
      child.kill("SIGKILL");
    }
  };
  child.stdout.on("data", (chunk) => observe("stdout", chunk));
  child.stderr.on("data", (chunk) => observe("stderr", chunk));
  child.stdin.on("error", () => undefined);
  const closed = new Promise((resolveClose, rejectClose) => {
    child.once("error", () => {
      exited = true;
      rejectClose(new Error("Ingest signal client container could not start."));
    });
    child.once("close", (code, signal) => {
      exited = true;
      resolveClose(Object.freeze({ code, signal }));
    });
  });
  void closed.catch(() => undefined);
  child.stdin.end(
    JSON.stringify({
      bodyBase64Url: request.body.toString("base64url"),
      headers: Object.fromEntries(request.headers.entries()),
      method: policy.method,
      url: `http://127.0.0.1:${signalProcessListenerPort}${policy.requestTarget}`,
    }),
  );
  return Object.freeze({
    closed,
    hasExited: () => exited,
    outputOverflow: () => outputOverflow,
    stderr: () => stderr,
    stdout: () => stdout,
  });
}

async function readSignalProcessClientResult(client) {
  const closeResult = await waitWithDeadline(
    client.closed,
    signalProcessCloseTimeoutMs,
    "Ingest signal client did not close within its fixed deadline.",
  );
  assert.equal(client.outputOverflow(), false, "Ingest signal client output must stay bounded");
  assert.equal(client.stderr(), "", "Ingest signal client must emit no diagnostic output");
  assert.ok(Buffer.byteLength(client.stdout(), "utf8") <= maximumSignalClientOutputBytes);

  const serialized = JSON.parse(client.stdout());
  if (closeResult.code === 1 && closeResult.signal === null) {
    assert.deepEqual(Object.keys(serialized), ["clientError"]);
    assert.match(
      serialized.clientError,
      /^(?:client_failed|fetch_failed|fetch_refused|fetch_socket_closed|input_invalid|response_invalid)$/,
    );
    throw new Error(`Ingest signal client failed closed (${serialized.clientError}).`);
  }
  assert.deepEqual(closeResult, { code: 0, signal: null });
  assert.deepEqual(Object.keys(serialized).sort(), ["body", "headers", "status"]);
  assert.equal(
    serialized.headers !== null &&
      typeof serialized.headers === "object" &&
      !Array.isArray(serialized.headers),
    true,
  );
  const response = Object.freeze({ headers: new Headers(serialized.headers) });
  assertResponseHeaders(response, serialized.body, serialized.status !== 200);
  return Object.freeze({ body: serialized.body, status: serialized.status });
}

async function waitForSignalProcessContainerExit() {
  const deadline = Date.now() + signalProcessCloseTimeoutMs;
  while (Date.now() < deadline) {
    const state = readSignalProcessContainerState();
    if (!state.Running) {
      return state;
    }
    await sleep(signalProcessPollIntervalMs);
  }
  throw new Error("Ingest signal container did not exit within its fixed deadline.");
}

async function exerciseEmittedIngestSignalProcess(policy, keyPair) {
  const runtime = createPortableIngestSignalRuntime();
  let blocker;
  let blockerStopped = false;
  let client;
  try {
    blocker = await startDatabaseOriginReplayBlocker();
    createSignalProcessContainer(runtime.runtimeDirectory);
    requireSuccess(
      docker(["start", signalProcessContainerName], { timeout: 15_000 }),
      "Ingest signal container start",
    );
    await waitForSignalProcessListener();

    const observedAt = new Date().toISOString();
    const request = buildSignedRequest({
      deviceNonceBytes: Buffer.alloc(16, 0x37),
      keyPair,
      originNonceBytes: Buffer.alloc(16, 0x47),
      originTimestamp: observedAt,
      payload: createPayload(signalProcessSyncId, observedAt, 401, {
        payloadSourceId: admissionSourceId,
      }),
      policy,
      requestDeviceId: admissionDeviceId,
    });
    client = startSignalProcessClient(policy, request);
    await waitForOneBlockedOriginConsume(client);

    requireSuccess(
      docker(["kill", "--signal", "SIGTERM", signalProcessContainerName], {
        timeout: 10_000,
      }),
      "Ingest signal delivery",
    );
    const signalledState = readSignalProcessContainerState();
    assert.equal(
      signalledState.Running,
      true,
      "the OS-signalled Ingest host must wait for its active request",
    );
    assert.equal(
      readSignalProcessContainerOutput(),
      "",
      "the OS-signalled Ingest host must remain silent while draining",
    );

    await stopDatabaseOriginReplayBlocker(blocker);
    blockerStopped = true;
    let clientResult;
    try {
      clientResult = await readSignalProcessClientResult(client);
    } catch (error) {
      const failedState = await waitForSignalProcessContainerExit();
      const persistedCount = psqlScalar(
        `SET ROLE viberacing_owner;
SELECT pg_catalog.count(*)::integer
FROM viberacing_private.usage_snapshots
WHERE device_key_id = '${admissionDeviceKeyId}'
  AND sync_id = '${signalProcessSyncId}';`,
        "failed emitted Ingest signal persistence classification",
      );
      throw new Error(
        `${error.message} Host exit ${String(failedState.ExitCode)}; persisted snapshots ${persistedCount}.`,
      );
    }
    assertSuccess(clientResult, {
      acceptedEntries: 1,
      outcome: "accepted",
      syncId: signalProcessSyncId,
    });

    const state = await waitForSignalProcessContainerExit();
    assert.equal(state.Status, "exited");
    assert.equal(state.ExitCode, 0, "the OS-signalled Ingest host must exit successfully");
    assert.equal(state.OOMKilled, false);
    assert.equal(state.Error, "");
    assert.equal(
      readSignalProcessContainerOutput(),
      "",
      "the OS-signalled Ingest host must remain silent through graceful exit",
    );
    assert.equal(
      psqlScalar(
        `SELECT pg_catalog.count(*)::integer
FROM pg_catalog.pg_stat_activity
WHERE application_name = 'viberacing-ingest-community-sync'
  AND usename = '${ingestLogin}';`,
        "emitted Ingest signal released-session verification",
      ),
      "0",
      "graceful exit must release every exact Ingest database session",
    );

    const storedState = JSON.parse(
      psqlScalar(
        `SET ROLE viberacing_owner;
SELECT pg_catalog.jsonb_build_object(
  'deviceNonceCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.device_nonces
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
    WHERE device_key_id = '${admissionDeviceKeyId}'
      AND sync_id = '${signalProcessSyncId}'
  ),
  'snapshotEntryCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.usage_snapshot_entries AS entry_record
    JOIN viberacing_private.usage_snapshots AS snapshot_record
      ON snapshot_record.usage_snapshot_id = entry_record.usage_snapshot_id
    WHERE snapshot_record.device_key_id = '${admissionDeviceKeyId}'
      AND snapshot_record.sync_id = '${signalProcessSyncId}'
  ),
  'sourceDayCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.source_day_values
    WHERE source_id = '${admissionSourceId}'
  ),
  'sourceTokens', (
    SELECT tokens
    FROM viberacing_private.source_day_values
    WHERE source_id = '${admissionSourceId}'
  )
)::text;`,
        "emitted Ingest signal stored-state verification",
      ),
    );
    assert.deepEqual(storedState, {
      deviceNonceCount: 1,
      originCount: 1,
      snapshotCount: 1,
      snapshotEntryCount: 1,
      sourceDayCount: 1,
      sourceTokens: 401,
    });
  } finally {
    try {
      if (blocker !== undefined && !blockerStopped) {
        await stopDatabaseOriginReplayBlocker(blocker).catch(() => undefined);
      }
    } finally {
      try {
        removeSignalProcessContainer(signalProcessClientContainerName);
      } finally {
        try {
          removeSignalProcessContainer(signalProcessContainerName);
        } finally {
          try {
            if (client !== undefined) {
              await waitWithDeadline(
                client.closed,
                signalProcessCloseTimeoutMs,
                "Ingest signal client did not settle during cleanup.",
              ).catch(() => undefined);
            }
          } finally {
            removePortableNodeRuntime(runtime);
          }
        }
      }
    }
  }
}

async function startHost(startConfiguredIngestHost, databasePort) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const listenerPort = await findAvailableListenerPort();
    const environment = ingestEnvironment(databasePort, listenerPort);
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

    if (integrationMode === "signal_process") {
      await exerciseEmittedIngestSignalProcess(policy, admissionKeyPair);
      console.log(
        "Emitted Ingest signal PostgreSQL integration passed (OS SIGTERM, active signed-request settlement, silent graceful exit, released session, and exact stored state).",
      );
    } else {
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
      const removedPathResult = await postSignedRequest(
        host.baseUrl,
        { ...policy, requestTarget: removedSyncRequestTarget },
        acceptedRequest,
      );
      assertNotFound(removedPathResult);
      const acceptedResult = await postSignedRequest(host.baseUrl, policy, acceptedRequest);
      assertSuccess(acceptedResult, {
        acceptedEntries: 1,
        outcome: "accepted",
        syncId: acceptedSyncId,
      });

      const usageObservedAt = acceptedObservedAt;
      const usageRequest = buildSignedRequest({
        deviceNonceBytes: Buffer.alloc(16, 0x13),
        keyPair,
        originNonceBytes: Buffer.alloc(16, 0x24),
        originTimestamp: usageObservedAt,
        payload: createPayload(usageSyncId, usageObservedAt, 321),
        policy,
      });
      const usageResult = await postSignedRequest(host.baseUrl, policy, usageRequest);
      assertSuccess(usageResult, {
        acceptedEntries: 1,
        outcome: "accepted",
        syncId: usageSyncId,
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

      const admissionResults = await exerciseNoQueueAdmission(
        host.baseUrl,
        policy,
        admissionKeyPair,
      );

      await controller.close();
      controller = undefined;

      const emittedProcessResult = await exerciseEmittedIngestProcess(
        databasePort,
        policy,
        admissionKeyPair,
      );

      const requestIds = new Set([
        removedPathResult.body.requestId,
        acceptedResult.body.requestId,
        usageResult.body.requestId,
        duplicateResult.body.requestId,
        replayResult.body.requestId,
        revokedResult.body.requestId,
        ...admissionResults.map((result) => result.body.requestId),
        emittedProcessResult.body.requestId,
      ]);
      assert.equal(requestIds.size, 12);

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
    WHERE sync_id = '${acceptedSyncId}'
  ),
  'usageSnapshotProvider', (
    SELECT source_record.provider
    FROM viberacing_private.usage_snapshots AS snapshot_record
    JOIN viberacing_private.codex_sources AS source_record
      ON source_record.source_id = snapshot_record.source_id
    WHERE snapshot_record.sync_id = '${usageSyncId}'
  ),
  'usageSnapshotAccountingRevision', (
    SELECT source_record.accounting_revision
    FROM viberacing_private.usage_snapshots AS snapshot_record
    JOIN viberacing_private.codex_sources AS source_record
      ON source_record.source_id = snapshot_record.source_id
    WHERE snapshot_record.sync_id = '${usageSyncId}'
  ),
  'usageSnapshotVersions', (
    SELECT pg_catalog.jsonb_build_array(connector_version, codex_version)
    FROM viberacing_private.usage_snapshots
    WHERE sync_id = '${usageSyncId}'
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
  ),
  'emittedProcessSyncCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.usage_snapshots
    WHERE sync_id = '${emittedProcessSyncId}'
  )
)::text;`,
          "Ingest stored-state verification",
        ),
      );
      assert.deepEqual(storedState, {
        admissionDeviceNonceCount: 5,
        admissionDeviceState: "active",
        admissionSnapshotCount: 5,
        admissionSnapshotEntryCount: 5,
        admissionSourceDayCount: 5,
        admissionSourceTokens: [200, 201, 202, 203, 300],
        deviceNonceCount: 2,
        deviceState: "revoked",
        emittedProcessSyncCount: 1,
        originCount: 9,
        rejectedAdmissionSyncCount: 0,
        snapshotCount: 2,
        snapshotEntryCount: 2,
        snapshotOutcome: "accepted",
        sourceDayCount: 1,
        sourceTokens: 321,
        unexpectedSyncCount: 0,
        usageSnapshotAccountingRevision: "codex_daily_usage_buckets_v1",
        usageSnapshotProvider: "codex",
        usageSnapshotVersions: ["1.2.3", "0.144.5"],
      });

      console.log(
        "Ingest PostgreSQL integration passed (Usage Sync acceptance, removed-path rejection, duplicate, replay denial, revocation denial, four-slot no-queue admission, emitted-process acceptance, and exact stored state).",
      );
    }
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
