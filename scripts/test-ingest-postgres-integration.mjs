import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, createHmac, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { validateManifest } from "./check-database.mjs";

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
const acceptedSyncId = `syn_${"A".repeat(22)}`;
const revokedSyncId = `syn_${"R".repeat(22)}`;
const originKeyId = "edge_integration";
const originSecret = Buffer.alloc(32, 0x33);
const requestIdPattern = /^req_[A-Za-z0-9_-]{22}$/;
const maximumResponseBytes = 2_048;

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

function createPayload(syncId, observedAt, tokens) {
  return {
    schemaVersion: 1,
    sourceId,
    syncId,
    observedAt,
    connectorVersion: "1.2.3",
    codexVersion: "0.144.5",
    dailyEntries: [{ codexReportedDate: observedAt.slice(0, 10), tokens }],
  };
}

function buildSignedRequest({
  deviceNonceBytes,
  keyPair,
  originNonceBytes,
  originTimestamp,
  payload,
  policy,
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
    deviceId,
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
    [policy.deviceSignature.headers.deviceId]: deviceId,
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

async function postSignedRequest(baseUrl, policy, request) {
  const response = await fetch(`${baseUrl}${policy.requestTarget}`, {
    body: request.body,
    headers: request.headers,
    method: policy.method,
    redirect: "error",
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

async function startHost(startConfiguredIngestHost, databasePort) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const listenerPort = await findAvailableListenerPort();
    const environment = Object.freeze({
      NODE_ENV: "test",
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
VALUES ('${sourceId}', '${profileId}', 'active');

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
VALUES (
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

    const requestIds = new Set([
      acceptedResult.body.requestId,
      duplicateResult.body.requestId,
      replayResult.body.requestId,
      revokedResult.body.requestId,
    ]);
    assert.equal(requestIds.size, 4);

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
  'deviceState', (
    SELECT state
    FROM viberacing_private.device_keys
    WHERE device_key_id = '${deviceKeyId}'
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
  'snapshotEntryCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.usage_snapshot_entries AS entry_record
    JOIN viberacing_private.usage_snapshots AS snapshot_record
      ON snapshot_record.usage_snapshot_id = entry_record.usage_snapshot_id
    WHERE snapshot_record.device_key_id = '${deviceKeyId}'
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
  'sourceTokens', (
    SELECT tokens
    FROM viberacing_private.source_day_values
    WHERE source_id = '${sourceId}'
  ),
  'unexpectedSyncCount', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.usage_snapshots
    WHERE sync_id = '${revokedSyncId}'
  )
)::text;`,
        "Ingest stored-state verification",
      ),
    );
    assert.deepEqual(storedState, {
      deviceNonceCount: 1,
      deviceState: "revoked",
      originCount: 3,
      snapshotCount: 1,
      snapshotEntryCount: 1,
      snapshotOutcome: "accepted",
      sourceDayCount: 1,
      sourceTokens: 123,
      unexpectedSyncCount: 0,
    });

    console.log(
      "Ingest PostgreSQL integration passed (accepted, duplicate, replay denial, revocation denial, and exact stored state).",
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
