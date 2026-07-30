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
// This harness emits local synthetic evidence only.

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
const agentAccountId = `acc_${"A".repeat(22)}`;
const installationId = `ins_${"A".repeat(22)}`;
const deviceKeyId = `key_${"A".repeat(22)}`;
const deviceId = `dev_${"A".repeat(22)}`;
const admissionInstallationId = `ins_${"B".repeat(22)}`;
const admissionDeviceKeyId = `key_${"B".repeat(22)}`;
const admissionDeviceId = `dev_${"B".repeat(22)}`;
const readerVersion = "codex_app_server_0_144_5_v1";
const acceptedSyncId = `syn_${"A".repeat(22)}`;
const sameValueSyncId = `syn_${"S".repeat(22)}`;
const higherSyncId = `syn_${"H".repeat(22)}`;
const lowerSyncId = `syn_${"L".repeat(22)}`;
const mixedLowerSyncId = `syn_${"M".repeat(22)}`;
const sameNonceSyncId = `syn_${"N".repeat(22)}`;
const accountRaceSyncId = `syn_${"C".repeat(22)}`;
const revokedSyncId = `syn_${"R".repeat(22)}`;
const admissionSyncId = `syn_${"1".repeat(22)}`;
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
const maximumBlockerOutputBytes = 64 * 1024;
const maximumSignalClientOutputBytes = 8 * 1024;
const databaseBlockerTimeoutMs = 10_000;
const blockedSubmitObservationTimeoutMs = 10_000;
const admissionRejectionTimeoutMs = 1_500;
const emittedProcessStartTimeoutMs = 10_000;
const emittedProcessCloseTimeoutMs = 5_000;
const emittedProcessProbeTimeoutMs = 250;
const signalProcessCloseTimeoutMs = 10_000;
const signalProcessPollIntervalMs = 100;
const signalProcessStartTimeoutMs = 120_000;
const databaseBlockerReadyMarker = "viberacing_ingest_atomic_submit_blocker_ready";
const removedRequestTargets = Object.freeze(["/v1/community/sync", "/v1/community/usage"]);
const privateValueMarkers = Object.freeze([
  profileId,
  agentAccountId,
  installationId,
  deviceKeyId,
  deviceId,
  admissionInstallationId,
  admissionDeviceKeyId,
  admissionDeviceId,
  readerVersion,
  acceptedSyncId,
  sameValueSyncId,
  higherSyncId,
  lowerSyncId,
  mixedLowerSyncId,
  sameNonceSyncId,
  accountRaceSyncId,
  revokedSyncId,
  admissionSyncId,
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
  return manifest.migrations.map((entry) => ({
    label: `migration ${entry.revision}`,
    sql: filesByPath.get(entry.path),
  }));
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitWithDeadline(promise, milliseconds, message) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, rejectPromise) => {
        timeout = setTimeout(() => rejectPromise(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForHealthyContainer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const inspection = docker(
      ["inspect", "--format", "{{json .State.Health.Status}}", containerName],
      { timeout: 10_000 },
    );
    if (inspection.status === 0 && inspection.stdout.trim() === '"healthy"') {
      return;
    }
    await sleep(100);
  }
  throw new Error("isolated PostgreSQL did not become healthy");
}

function readPublishedPostgresPort() {
  const result = docker(["port", containerName, "5432/tcp"], { timeout: 10_000 });
  requireSuccess(result, "published PostgreSQL port read");
  const match = /^127\.0\.0\.1:(\d+)$/.exec(result.stdout.trim());
  assert.ok(match);
  const port = Number(match[1]);
  assert.equal(Number.isSafeInteger(port) && port > 0 && port <= 65_535, true);
  return port;
}

async function findAvailableListenerPort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.unref();
    server.once("error", rejectPort);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        rejectPort(new Error("listener allocation failed"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          rejectPort(error);
        } else {
          resolvePort(port);
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
  assert.equal(value.requestTarget, "/v1/usage");
  assert.equal(value.mediaType, "application/json");
  assert.equal(value.originProof.algorithm, "HMAC-SHA-256");
  assert.equal(value.deviceSignature.algorithm, "Ed25519");
  return value;
}

function canonicalMessage(fieldOrder, values) {
  return Buffer.from(
    fieldOrder
      .map((field) => {
        const value = values[field];
        assert.equal(typeof value, "string");
        assert.equal(value.includes("\n"), false);
        return value;
      })
      .join("\n"),
    "utf8",
  );
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

function utcDateDaysBefore(baseTimestamp, days) {
  const value = new Date(baseTimestamp);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function utcMonday(dateString) {
  const value = new Date(`${dateString}T00:00:00.000Z`);
  const offset = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - offset);
  return value.toISOString().slice(0, 10);
}

function createPayload(
  syncId,
  observedAt,
  dailyTokenTotal,
  {
    dailyEntries,
    payloadAgentAccountId = agentAccountId,
    selectedReaderVersion = readerVersion,
    usageDate = observedAt.slice(0, 10),
  } = {},
) {
  return {
    schemaVersion: 1,
    agentAccountId: payloadAgentAccountId,
    syncId,
    observedAt,
    clientVersion: "1.2.3",
    readerVersion: selectedReaderVersion,
    dailyEntries: dailyEntries ?? [{ usageDate, dailyTokenTotal: String(dailyTokenTotal) }],
  };
}

function buildSignedRequest({
  bodyBytes,
  deviceNonceBytes,
  deviceTimestamp,
  headerIdempotencyKey,
  invalidDeviceSignature = false,
  keyPair,
  originNonceBytes,
  originTimestamp,
  payload,
  policy,
  requestDeviceId = deviceId,
}) {
  const body =
    bodyBytes === undefined ? Buffer.from(JSON.stringify(payload), "utf8") : Buffer.from(bodyBytes);
  const bodyDigestBase64Url = createHash("sha256").update(body).digest("base64url");
  const deviceNonce = Buffer.from(deviceNonceBytes).toString("base64url");
  const originNonce = Buffer.from(originNonceBytes).toString("base64url");
  const resolvedDeviceTimestamp = deviceTimestamp ?? payload.observedAt;
  const resolvedIdempotencyKey = headerIdempotencyKey ?? payload.syncId;
  const deviceMessage = canonicalMessage(policy.deviceSignature.canonicalFields, {
    messagePrefix: policy.deviceSignature.messagePrefix,
    method: policy.method,
    requestTarget: policy.requestTarget,
    bodyDigestBase64Url,
    deviceId: requestDeviceId,
    nonce: deviceNonce,
    timestamp: resolvedDeviceTimestamp,
    idempotencyKey: resolvedIdempotencyKey,
  });
  const signatureBytes = sign(null, deviceMessage, keyPair.privateKey);
  if (invalidDeviceSignature) {
    signatureBytes[0] ^= 0xff;
  }
  const originMessage = canonicalMessage(policy.originProof.canonicalFields, {
    messagePrefix: policy.originProof.messagePrefix,
    keyId: originKeyId,
    method: policy.method,
    requestTarget: policy.requestTarget,
    bodyDigestBase64Url,
    timestamp: originTimestamp,
    nonce: originNonce,
  });
  const headers = new Headers({
    accept: policy.mediaType,
    [policy.deviceSignature.headers.deviceId]: requestDeviceId,
    [policy.deviceSignature.headers.idempotencyKey]: resolvedIdempotencyKey,
    [policy.deviceSignature.headers.nonce]: deviceNonce,
    [policy.deviceSignature.headers.signature]: signatureBytes.toString("base64url"),
    [policy.deviceSignature.headers.timestamp]: resolvedDeviceTimestamp,
    [policy.originProof.headers.keyId]: originKeyId,
    [policy.originProof.headers.nonce]: originNonce,
    [policy.originProof.headers.proof]: createHmac("sha256", originSecret)
      .update(originMessage)
      .digest("base64url"),
    [policy.originProof.headers.timestamp]: originTimestamp,
    "content-type": policy.mediaType,
  });
  return Object.freeze({ body, headers });
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

async function sendSignedRequest(
  baseUrl,
  policy,
  request,
  {
    body = request.body,
    contentEncoding,
    contentType = policy.mediaType,
    method = policy.method,
    requestTarget = policy.requestTarget,
    timeoutMilliseconds = 30_000,
  } = {},
) {
  const headers = new Headers(request.headers);
  headers.set("content-type", contentType);
  if (contentEncoding === undefined) {
    headers.delete("content-encoding");
  } else {
    headers.set("content-encoding", contentEncoding);
  }
  const response = await fetch(`${baseUrl}${requestTarget}`, {
    ...(method === "GET" || method === "HEAD" ? {} : { body }),
    headers,
    method,
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMilliseconds),
  });
  const responseText = await response.text();
  assert.ok(Buffer.byteLength(responseText, "utf8") <= maximumResponseBytes);
  assert.notEqual(responseText.length, 0);
  const responseBody = JSON.parse(responseText);
  assert.match(responseBody.requestId, requestIdPattern);
  assertResponseHeaders(response, responseBody, response.status !== 200);
  return Object.freeze({ body: responseBody, status: response.status });
}

function assertSuccess(result, expected) {
  assert.equal(result.status, 200);
  const keys = Object.keys(result.body).sort();
  assert.deepEqual(
    keys.filter((key) => !["nextAllowedSyncAt", "recoveryAction"].includes(key)),
    ["acceptedEntries", "outcome", "requestId", "schemaVersion", "syncId"],
  );
  assert.equal(
    keys.every((key) =>
      [
        "acceptedEntries",
        "nextAllowedSyncAt",
        "outcome",
        "recoveryAction",
        "requestId",
        "schemaVersion",
        "syncId",
      ].includes(key),
    ),
    true,
  );
  assert.equal(result.body.schemaVersion, 1);
  assert.equal(result.body.syncId, expected.syncId);
  assert.equal(result.body.outcome, expected.outcome);
  assert.equal(result.body.acceptedEntries, expected.acceptedEntries);
  if (Object.hasOwn(expected, "recoveryAction")) {
    assert.equal(result.body.recoveryAction, expected.recoveryAction);
  } else {
    assert.equal(Object.hasOwn(result.body, "recoveryAction"), false);
  }
}

function assertProblem(result, status, errorCode, retryable = false) {
  assert.equal(result.status, status);
  assert.deepEqual(Object.keys(result.body).sort(), [
    "errorCode",
    "requestId",
    "retryable",
    "schemaVersion",
    "status",
    "title",
  ]);
  assert.equal(result.body.schemaVersion, 1);
  assert.equal(result.body.status, status);
  assert.equal(result.body.errorCode, errorCode);
  assert.equal(result.body.retryable, retryable);
  assert.equal(typeof result.body.title, "string");
  assert.ok(result.body.title.length > 0);
}

function assertTemporarilyUnavailable(result) {
  assertProblem(result, 503, "temporarily_unavailable", true);
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

function seedDatabase(primaryPublicKey, admissionPublicKey) {
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
UPDATE viberacing_private.agent_providers
SET state = 'supported'
WHERE provider_code = 'codex';

UPDATE viberacing_private.agent_accounting_revisions
SET enabled_for_new_accounts = true
WHERE provider_code = 'codex'
  AND accounting_revision = 1;

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
  SELECT DISTINCT
    usage_date::date - (extract(isodow FROM usage_date)::integer - 1) AS season_start
  FROM pg_catalog.generate_series(
    (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date - 35,
    (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date,
    interval '1 day'
  ) AS generated(usage_date)
) AS required_season;

INSERT INTO viberacing_private.profiles (
  profile_id,
  github_user_id,
  handle,
  locale,
  hidden_at
)
VALUES (
  '${profileId}',
  900000000000026101,
  'ingest-local-e2e',
  'en',
  pg_catalog.transaction_timestamp()
);

UPDATE viberacing_private.profiles
SET state = 'active'
WHERE profile_id = '${profileId}';

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
  '${agentAccountId}',
  '${profileId}',
  'codex',
  1,
  'agent_account',
  'stable_opaque',
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  'Synthetic Ingest account',
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
    '${installationId}',
    '${profileId}',
    pg_catalog.decode('${primaryPublicKey.toString("hex")}', 'hex'),
    'Synthetic primary installation',
    '1.2.3',
    'windows',
    'x86_64',
    'active',
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp()
  ),
  (
    '${admissionInstallationId}',
    '${profileId}',
    pg_catalog.decode('${admissionPublicKey.toString("hex")}', 'hex'),
    'Synthetic admission installation',
    '1.2.3',
    'linux',
    'aarch64',
    'active',
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp()
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
    '${deviceKeyId}',
    '${deviceId}',
    '${profileId}',
    '${installationId}',
    '${agentAccountId}',
    pg_catalog.decode('${primaryPublicKey.toString("hex")}', 'hex')
  ),
  (
    '${admissionDeviceKeyId}',
    '${admissionDeviceId}',
    '${profileId}',
    '${admissionInstallationId}',
    '${agentAccountId}',
    pg_catalog.decode('${admissionPublicKey.toString("hex")}', 'hex')
  );
COMMIT;`,
    "least-privileged Ingest login and synthetic account/device setup",
  );
}

function readUsagePersistenceState(label) {
  return JSON.parse(
    psqlScalar(
      `SET ROLE viberacing_owner;
SELECT pg_catalog.jsonb_build_object(
  'accountDayTotals', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.agent_account_day_totals
  ),
  'deviceNonces', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.device_nonces
  ),
  'idempotencyRecords', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.usage_idempotency_records
  ),
  'observations', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.usage_observations
  ),
  'originNonces', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.origin_nonces
  ),
  'rankingEvents', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.ranking_events
  ),
  'refreshOutbox', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.ranking_refresh_outbox
  )
)::text;`,
      label,
    ),
  );
}

function assertZeroUsagePersistence(label) {
  assert.deepEqual(readUsagePersistenceState(label), {
    accountDayTotals: 0,
    deviceNonces: 0,
    idempotencyRecords: 0,
    observations: 0,
    originNonces: 0,
    rankingEvents: 0,
    refreshOutbox: 0,
  });
}

function startDatabaseSubmitBlocker() {
  let exited = false;
  let outputBytes = 0;
  let output = "";
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
  const observe = (chunk) => {
    outputBytes += chunk.byteLength;
    output += chunk.toString("utf8");
    if (outputBytes > maximumBlockerOutputBytes) {
      child.kill("SIGKILL");
    } else if (!readySettled && output.includes(databaseBlockerReadyMarker)) {
      readySettled = true;
      resolveReady();
    }
  };
  child.stdout.on("data", observe);
  child.stderr.on("data", observe);
  child.stdin.on("error", () => undefined);
  const closed = new Promise((resolveClose, rejectClose) => {
    child.once("error", () => {
      exited = true;
      if (!readySettled) {
        readySettled = true;
        rejectReady(new Error("PostgreSQL atomic-submit blocker could not start."));
      }
      rejectClose(new Error("PostgreSQL atomic-submit blocker could not start."));
    });
    child.once("close", (code, signal) => {
      exited = true;
      if (!readySettled) {
        readySettled = true;
        rejectReady(new Error("PostgreSQL atomic-submit blocker exited before its lock."));
      }
      resolveClose(Object.freeze({ code, signal }));
    });
  });
  void ready.catch(() => undefined);
  void closed.catch(() => undefined);
  child.stdin.write(`BEGIN;
SET LOCAL ROLE viberacing_owner;
LOCK TABLE viberacing_private.origin_nonces IN ACCESS EXCLUSIVE MODE;
\\echo ${databaseBlockerReadyMarker}
`);
  return Object.freeze({
    child,
    closed,
    exited: () => exited,
    output: () => output,
    outputBytes: () => outputBytes,
    ready,
  });
}

async function waitForSubmitBlocker(blocker) {
  await waitWithDeadline(
    blocker.ready,
    databaseBlockerTimeoutMs,
    "PostgreSQL atomic-submit blocker did not acquire its lock in time.",
  );
  assert.equal(blocker.exited(), false);
  assert.ok(blocker.outputBytes() <= maximumBlockerOutputBytes);
  assert.equal(
    privateValueMarkers.some((marker) => blocker.output().includes(marker)),
    false,
  );
}

async function stopDatabaseSubmitBlocker(blocker) {
  if (!blocker.exited()) {
    blocker.child.stdin.end("ROLLBACK;\n");
  }
  const result = await waitWithDeadline(
    blocker.closed,
    databaseBlockerTimeoutMs,
    "PostgreSQL atomic-submit blocker did not close in time.",
  );
  assert.deepEqual(result, { code: 0, signal: null });
  assert.ok(blocker.outputBytes() <= maximumBlockerOutputBytes);
  assert.equal(
    privateValueMarkers.some((marker) => blocker.output().includes(marker)),
    false,
  );
}

function readBlockedSubmitCount(label) {
  const value = psqlScalar(
    `SELECT pg_catalog.count(*)::text
FROM pg_catalog.pg_stat_activity AS activity
WHERE activity.datname = '${databaseName}'
  AND activity.usename = '${ingestLogin}'
  AND activity.state = 'active'
  AND activity.wait_event_type = 'Lock'
  AND pg_catalog.strpos(
    activity.query,
    'viberacing_api.submit_usage_sync('
  ) > 0;`,
    label,
  );
  assert.match(value, /^[0-4]$/);
  return Number(value);
}

async function waitForBlockedSubmit(expectedCount, onPoll) {
  const deadline = Date.now() + blockedSubmitObservationTimeoutMs;
  let count = 0;
  while (Date.now() < deadline) {
    onPoll?.();
    count = readBlockedSubmitCount("blocked Ingest atomic-submit observation");
    if (count === expectedCount) {
      return;
    }
    assert.ok(count < expectedCount);
    await sleep(25);
  }
  throw new Error(`expected ${expectedCount} blocked atomic submit(s), observed ${count}`);
}

async function startHost(startConfiguredIngestHost, databasePort) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const listenerPort = await findAvailableListenerPort();
    try {
      const controller = await startConfiguredIngestHost(
        ingestEnvironment(databasePort, listenerPort),
      );
      return Object.freeze({
        baseUrl: `http://127.0.0.1:${listenerPort}`,
        controller,
      });
    } catch (error) {
      if (error?.code !== "listen_failed" || attempt === 2) {
        throw error;
      }
    }
  }
  throw new Error("Ingest host listener allocation failed");
}

function startEmittedIngestProcess(databasePort, listenerPort) {
  let exited = false;
  let outputObserved = false;
  const child = spawn(process.execPath, [resolve(root, "apps", "ingest-host", "dist", "main.js")], {
    cwd: root,
    env: ingestEnvironment(databasePort, listenerPort),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const observeOutput = () => {
    outputObserved = true;
    if (!exited) {
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
      rejectClose(new Error("Emitted Ingest host process could not start."));
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
    exited: () => exited,
    outputObserved: () => outputObserved,
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
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(emittedProcessProbeTimeoutMs, () => finish(false));
  });
}

async function waitForEmittedIngestListener(processState, listenerPort) {
  const deadline = Date.now() + emittedProcessStartTimeoutMs;
  while (Date.now() < deadline) {
    assert.equal(processState.outputObserved(), false);
    assert.equal(processState.exited(), false);
    if (await probeLoopbackListener(listenerPort)) {
      return;
    }
    await sleep(25);
  }
  throw new Error("Emitted Ingest host did not open its listener in time.");
}

async function exerciseEmittedIngestProcess(databasePort, policy, keyPair) {
  const listenerPort = await findAvailableListenerPort();
  const processState = startEmittedIngestProcess(databasePort, listenerPort);
  let stopped = false;
  try {
    await waitForEmittedIngestListener(processState, listenerPort);
    const observedAt = new Date().toISOString();
    const request = buildSignedRequest({
      deviceNonceBytes: Buffer.alloc(16, 0x36),
      keyPair,
      originNonceBytes: Buffer.alloc(16, 0x46),
      originTimestamp: observedAt,
      payload: createPayload(emittedProcessSyncId, observedAt, 300),
      policy,
      requestDeviceId: admissionDeviceId,
    });
    const result = await sendSignedRequest(`http://127.0.0.1:${listenerPort}`, policy, request);
    assertSuccess(result, {
      acceptedEntries: 1,
      outcome: "accepted",
      syncId: emittedProcessSyncId,
    });
    assert.equal(processState.exited(), false);
    assert.equal(processState.outputObserved(), false);

    const terminationRequested = processState.child.kill("SIGKILL");
    const closeResult = await waitWithDeadline(
      processState.closed,
      emittedProcessCloseTimeoutMs,
      "Emitted Ingest host did not close in time.",
    );
    stopped = true;
    assert.equal(terminationRequested, true);
    assert.deepEqual(closeResult, { code: null, signal: "SIGKILL" });
    assert.equal(processState.outputObserved(), false);
    return result;
  } finally {
    if (!stopped && !processState.exited()) {
      processState.child.kill("SIGKILL");
      await waitWithDeadline(
        processState.closed,
        emittedProcessCloseTimeoutMs,
        "Emitted Ingest cleanup did not close in time.",
      ).catch(() => undefined);
    }
  }
}

async function exerciseNoQueueAdmission(baseUrl, policy, keyPair) {
  const blocker = startDatabaseSubmitBlocker();
  await waitForSubmitBlocker(blocker);
  let blockerStopped = false;
  let pending;
  try {
    const observedAt = new Date().toISOString();
    const request = buildSignedRequest({
      deviceNonceBytes: Buffer.alloc(16, 0x31),
      keyPair,
      originNonceBytes: Buffer.alloc(16, 0x41),
      originTimestamp: observedAt,
      payload: createPayload(admissionSyncId, observedAt, 200, {
        usageDate: utcDateDaysBefore(observedAt, 1),
      }),
      policy,
      requestDeviceId: admissionDeviceId,
    });
    pending = sendSignedRequest(baseUrl, policy, request, {
      timeoutMilliseconds: databaseBlockerTimeoutMs,
    });
    void pending.catch(() => undefined);
    await waitForBlockedSubmit(1);

    const rejectedRequest = buildSignedRequest({
      deviceNonceBytes: Buffer.alloc(16, 0x32),
      keyPair,
      originNonceBytes: Buffer.alloc(16, 0x42),
      originTimestamp: observedAt,
      payload: createPayload(rejectedAdmissionSyncId, observedAt, 204, {
        usageDate: utcDateDaysBefore(observedAt, 2),
      }),
      policy,
      requestDeviceId: admissionDeviceId,
    });
    const rejected = await waitWithDeadline(
      sendSignedRequest(baseUrl, policy, rejectedRequest, {
        timeoutMilliseconds: admissionRejectionTimeoutMs,
      }),
      admissionRejectionTimeoutMs,
      "same-device no-queue decision exceeded its fixed deadline",
    );
    assertTemporarilyUnavailable(rejected);
    assert.equal(readBlockedSubmitCount("same-device rejection database-call check"), 1);

    await stopDatabaseSubmitBlocker(blocker);
    blockerStopped = true;
    const accepted = await pending;
    assertSuccess(accepted, {
      acceptedEntries: 1,
      outcome: "accepted",
      syncId: admissionSyncId,
    });
    return [accepted, rejected];
  } finally {
    if (!blockerStopped) {
      await stopDatabaseSubmitBlocker(blocker).catch(() => undefined);
    }
    if (pending !== undefined) {
      await Promise.allSettled([pending]);
    }
  }
}

async function exerciseDatabaseStateRace({ baseUrl, keyPair, mutationSql, policy, syncId, total }) {
  const blocker = startDatabaseSubmitBlocker();
  await waitForSubmitBlocker(blocker);
  let blockerStopped = false;
  let pending;
  try {
    const observedAt = new Date().toISOString();
    const marker = syncId.charCodeAt(syncId.length - 1) & 0xff;
    const request = buildSignedRequest({
      deviceNonceBytes: Buffer.alloc(16, marker),
      keyPair,
      originNonceBytes: Buffer.alloc(16, marker ^ 0x55),
      originTimestamp: observedAt,
      payload: createPayload(syncId, observedAt, total),
      policy,
    });
    pending = sendSignedRequest(baseUrl, policy, request, {
      timeoutMilliseconds: databaseBlockerTimeoutMs,
    });
    void pending.catch(() => undefined);
    await waitForBlockedSubmit(1);
    psql(mutationSql, `${syncId} state-race mutation`);
    await stopDatabaseSubmitBlocker(blocker);
    blockerStopped = true;
    const result = await pending;
    assertTemporarilyUnavailable(result);
    assert.equal(
      psqlScalar(
        `SET ROLE viberacing_owner;
SELECT pg_catalog.count(*)::integer
FROM viberacing_private.usage_observations
WHERE sync_id = '${syncId}';`,
        `${syncId} rollback verification`,
      ),
      "0",
    );
    return result;
  } finally {
    if (!blockerStopped) {
      await stopDatabaseSubmitBlocker(blocker).catch(() => undefined);
    }
    if (pending !== undefined) {
      await Promise.allSettled([pending]);
    }
  }
}

async function exerciseInvalidRequests(baseUrl, policy, keyPair) {
  const observedAt = new Date().toISOString();
  const basePayload = createPayload(`syn_${"I".repeat(22)}`, observedAt, 10);
  const makeRequest = (payload, marker, options = {}) =>
    buildSignedRequest({
      deviceNonceBytes: Buffer.alloc(16, marker),
      keyPair,
      originNonceBytes: Buffer.alloc(16, marker ^ 0x7f),
      originTimestamp: options.originTimestamp ?? new Date().toISOString(),
      payload,
      policy,
      ...options,
    });
  const results = [];
  const record = (result, status, code, retryable = false) => {
    assertProblem(result, status, code, retryable);
    results.push(result);
  };

  const baseRequest = makeRequest(basePayload, 0x01);
  for (const requestTarget of removedRequestTargets) {
    record(
      await sendSignedRequest(baseUrl, policy, baseRequest, { requestTarget }),
      404,
      "not_found",
    );
  }
  record(
    await sendSignedRequest(baseUrl, policy, baseRequest, { method: "GET" }),
    405,
    "method_not_allowed",
  );
  record(
    await sendSignedRequest(baseUrl, policy, baseRequest, { contentType: "text/plain" }),
    400,
    "invalid_request",
  );
  record(
    await sendSignedRequest(baseUrl, policy, baseRequest, { contentEncoding: "gzip" }),
    400,
    "invalid_request",
  );

  const oversized = makeRequest(basePayload, 0x02, {
    bodyBytes: Buffer.alloc(policy.maximumBodyBytes + 1, 0x20),
  });
  record(await sendSignedRequest(baseUrl, policy, oversized), 400, "invalid_request");

  const malformed = makeRequest(basePayload, 0x03, {
    bodyBytes: Buffer.from('{"schemaVersion":', "utf8"),
  });
  record(await sendSignedRequest(baseUrl, policy, malformed), 422, "validation_failed");

  const duplicateBody = Buffer.from(
    JSON.stringify(basePayload).replace(/^\{/, '{"schemaVersion":1,'),
    "utf8",
  );
  const duplicateKey = makeRequest(basePayload, 0x04, { bodyBytes: duplicateBody });
  record(await sendSignedRequest(baseUrl, policy, duplicateKey), 422, "validation_failed");

  for (const [payload, marker] of [
    [{ ...basePayload, unknownField: true }, 0x05],
    [
      {
        ...basePayload,
        dailyEntries: [{ usageDate: observedAt.slice(0, 10), dailyTokenTotal: "01" }],
      },
      0x06,
    ],
    [{ ...basePayload, provider: "codex" }, 0x07],
    [{ ...basePayload, accountingRevision: 1 }, 0x08],
  ]) {
    record(
      await sendSignedRequest(baseUrl, policy, makeRequest(payload, marker)),
      422,
      "validation_failed",
    );
  }

  const unknownDevice = makeRequest(basePayload, 0x09, {
    requestDeviceId: `dev_${"Z".repeat(22)}`,
  });
  record(await sendSignedRequest(baseUrl, policy, unknownDevice), 401, "unauthorized");

  const invalidSignature = makeRequest(basePayload, 0x0a, {
    invalidDeviceSignature: true,
  });
  record(await sendSignedRequest(baseUrl, policy, invalidSignature), 401, "unauthorized");

  const wrongAccount = createPayload(`syn_${"W".repeat(22)}`, observedAt, 10, {
    payloadAgentAccountId: `acc_${"Z".repeat(22)}`,
  });
  record(
    await sendSignedRequest(baseUrl, policy, makeRequest(wrongAccount, 0x0b)),
    401,
    "unauthorized",
  );

  const wrongReader = createPayload(`syn_${"V".repeat(22)}`, observedAt, 10, {
    selectedReaderVersion: "codex_app_server_0_144_6_v1",
  });
  record(
    await sendSignedRequest(baseUrl, policy, makeRequest(wrongReader, 0x0c)),
    401,
    "unauthorized",
  );

  const staleObservedAt = new Date(Date.now() - 16 * 60_000).toISOString();
  const stalePayload = createPayload(`syn_${"T".repeat(22)}`, staleObservedAt, 10);
  record(
    await sendSignedRequest(
      baseUrl,
      policy,
      makeRequest(stalePayload, 0x0d, { originTimestamp: new Date().toISOString() }),
    ),
    503,
    "temporarily_unavailable",
    true,
  );

  const headerMismatch = makeRequest(basePayload, 0x0e, {
    headerIdempotencyKey: `syn_${"X".repeat(22)}`,
  });
  record(await sendSignedRequest(baseUrl, policy, headerMismatch), 401, "unauthorized");

  assertZeroUsagePersistence("zero-write invalid-request matrix");
  return results;
}

async function exerciseFullIntegration(databasePort, policy, keyPair, admissionKeyPair) {
  const hostModuleUrl = pathToFileURL(resolve(root, "apps", "ingest-host", "dist", "host.js")).href;
  const { startConfiguredIngestHost } = await import(hostModuleUrl);
  const host = await startHost(startConfiguredIngestHost, databasePort);
  let controllerOpen = true;
  const results = [];
  try {
    results.push(...(await exerciseInvalidRequests(host.baseUrl, policy, keyPair)));

    const observedAt = new Date().toISOString();
    const today = observedAt.slice(0, 10);
    const yesterday = utcDateDaysBefore(observedAt, 1);
    const twoDaysAgo = utcDateDaysBefore(observedAt, 2);
    const acceptedPayload = createPayload(acceptedSyncId, observedAt, 100, {
      dailyEntries: [
        { usageDate: today, dailyTokenTotal: "100" },
        { usageDate: yesterday, dailyTokenTotal: "50" },
      ],
    });
    const acceptedRequest = buildSignedRequest({
      deviceNonceBytes: Buffer.alloc(16, 0x51),
      keyPair,
      originNonceBytes: Buffer.alloc(16, 0x61),
      originTimestamp: observedAt,
      payload: acceptedPayload,
      policy,
    });
    const accepted = await sendSignedRequest(host.baseUrl, policy, acceptedRequest);
    assertSuccess(accepted, {
      acceptedEntries: 2,
      outcome: "accepted",
      syncId: acceptedSyncId,
    });
    results.push(accepted);

    const exactRetryRequest = buildSignedRequest({
      deviceNonceBytes: Buffer.alloc(16, 0x51),
      keyPair,
      originNonceBytes: Buffer.alloc(16, 0x62),
      originTimestamp: observedAt,
      payload: acceptedPayload,
      policy,
    });
    assert.deepEqual(exactRetryRequest.body, acceptedRequest.body);
    assert.equal(
      exactRetryRequest.headers.get(policy.deviceSignature.headers.signature),
      acceptedRequest.headers.get(policy.deviceSignature.headers.signature),
    );
    const exactRetry = await sendSignedRequest(host.baseUrl, policy, exactRetryRequest);
    assertSuccess(exactRetry, {
      acceptedEntries: 0,
      outcome: "duplicate",
      syncId: acceptedSyncId,
    });
    results.push(exactRetry);

    const beforeOriginReplay = readUsagePersistenceState("pre-origin-replay state");
    const originReplay = await sendSignedRequest(host.baseUrl, policy, exactRetryRequest);
    assertTemporarilyUnavailable(originReplay);
    assert.deepEqual(readUsagePersistenceState("post-origin-replay state"), beforeOriginReplay);
    results.push(originReplay);

    const sameNoncePayload = createPayload(sameNonceSyncId, observedAt, 101);
    const sameNonceRequest = buildSignedRequest({
      deviceNonceBytes: Buffer.alloc(16, 0x51),
      keyPair,
      originNonceBytes: Buffer.alloc(16, 0x63),
      originTimestamp: observedAt,
      payload: sameNoncePayload,
      policy,
    });
    const beforeSameNonce = readUsagePersistenceState("pre-device-nonce replay state");
    const sameNonceReplay = await sendSignedRequest(host.baseUrl, policy, sameNonceRequest);
    assertTemporarilyUnavailable(sameNonceReplay);
    assert.deepEqual(readUsagePersistenceState("post-device-nonce replay state"), beforeSameNonce);
    results.push(sameNonceReplay);

    const changedBodyPayload = createPayload(acceptedSyncId, observedAt, 101, {
      dailyEntries: [
        { usageDate: today, dailyTokenTotal: "101" },
        { usageDate: yesterday, dailyTokenTotal: "50" },
      ],
    });
    const changedBody = buildSignedRequest({
      deviceNonceBytes: Buffer.alloc(16, 0x52),
      keyPair,
      originNonceBytes: Buffer.alloc(16, 0x64),
      originTimestamp: observedAt,
      payload: changedBodyPayload,
      policy,
    });
    const beforeChangedBody = readUsagePersistenceState("pre-changed-body state");
    const changedBodyResult = await sendSignedRequest(host.baseUrl, policy, changedBody);
    assertTemporarilyUnavailable(changedBodyResult);
    assert.deepEqual(readUsagePersistenceState("post-changed-body state"), beforeChangedBody);
    results.push(changedBodyResult);

    const changedObservedAt = new Date(Date.parse(observedAt) + 1_000).toISOString();
    const changedObservedPayload = createPayload(acceptedSyncId, changedObservedAt, 100, {
      dailyEntries: [
        { usageDate: today, dailyTokenTotal: "100" },
        { usageDate: yesterday, dailyTokenTotal: "50" },
      ],
    });
    const changedObservedRequest = buildSignedRequest({
      deviceNonceBytes: Buffer.alloc(16, 0x53),
      keyPair,
      originNonceBytes: Buffer.alloc(16, 0x65),
      originTimestamp: new Date().toISOString(),
      payload: changedObservedPayload,
      policy,
    });
    const beforeChangedObserved = readUsagePersistenceState("pre-changed-observedAt state");
    const changedObservedResult = await sendSignedRequest(
      host.baseUrl,
      policy,
      changedObservedRequest,
    );
    assertTemporarilyUnavailable(changedObservedResult);
    assert.deepEqual(
      readUsagePersistenceState("post-changed-observedAt state"),
      beforeChangedObserved,
    );
    results.push(changedObservedResult);

    psql(
      `BEGIN;
SET LOCAL ROLE viberacing_owner;
DELETE FROM viberacing_private.origin_nonces
WHERE nonce_digest = pg_catalog.decode(
  '${createHash("sha256")
    .update("viberacing-origin-nonce-v1\0", "utf8")
    .update(originKeyId, "utf8")
    .update("\0", "utf8")
    .update(Buffer.alloc(16, 0x61))
    .digest("hex")}',
  'hex'
);
DELETE FROM viberacing_private.device_nonces
WHERE device_key_id = '${deviceKeyId}'
  AND nonce_digest = pg_catalog.decode(
    '${createHash("sha256").update(Buffer.alloc(16, 0x51)).digest("hex")}',
    'hex'
  );
COMMIT;`,
      "short replay-nonce cleanup simulation",
    );
    const longRetryRequest = buildSignedRequest({
      deviceNonceBytes: Buffer.alloc(16, 0x51),
      keyPair,
      originNonceBytes: Buffer.alloc(16, 0x69),
      originTimestamp: new Date().toISOString(),
      payload: acceptedPayload,
      policy,
    });
    const longRetry = await sendSignedRequest(host.baseUrl, policy, longRetryRequest);
    assertSuccess(longRetry, {
      acceptedEntries: 0,
      outcome: "duplicate",
      syncId: acceptedSyncId,
    });
    results.push(longRetry);

    const sameValueRequest = buildSignedRequest({
      deviceNonceBytes: Buffer.alloc(16, 0x55),
      keyPair,
      originNonceBytes: Buffer.alloc(16, 0x75),
      originTimestamp: new Date().toISOString(),
      payload: createPayload(sameValueSyncId, observedAt, 100, {
        dailyEntries: [
          { usageDate: today, dailyTokenTotal: "100" },
          { usageDate: yesterday, dailyTokenTotal: "50" },
        ],
      }),
      policy,
    });
    const sameValue = await sendSignedRequest(host.baseUrl, policy, sameValueRequest);
    assertSuccess(sameValue, {
      acceptedEntries: 0,
      outcome: "duplicate",
      syncId: sameValueSyncId,
    });
    results.push(sameValue);

    const higherRequest = buildSignedRequest({
      deviceNonceBytes: Buffer.alloc(16, 0x56),
      keyPair,
      originNonceBytes: Buffer.alloc(16, 0x76),
      originTimestamp: new Date().toISOString(),
      payload: createPayload(higherSyncId, observedAt, 150, {
        dailyEntries: [
          { usageDate: today, dailyTokenTotal: "150" },
          { usageDate: yesterday, dailyTokenTotal: "60" },
        ],
      }),
      policy,
    });
    const higher = await sendSignedRequest(host.baseUrl, policy, higherRequest);
    assertSuccess(higher, {
      acceptedEntries: 2,
      outcome: "accepted",
      syncId: higherSyncId,
    });
    results.push(higher);

    const lowerRequest = buildSignedRequest({
      deviceNonceBytes: Buffer.alloc(16, 0x57),
      keyPair,
      originNonceBytes: Buffer.alloc(16, 0x77),
      originTimestamp: new Date().toISOString(),
      payload: createPayload(lowerSyncId, observedAt, 149),
      policy,
    });
    const lower = await sendSignedRequest(host.baseUrl, policy, lowerRequest);
    assertSuccess(lower, {
      acceptedEntries: 0,
      outcome: "quarantined",
      recoveryAction: "contact_support",
      syncId: lowerSyncId,
    });
    results.push(lower);

    const mixedLowerRequest = buildSignedRequest({
      deviceNonceBytes: Buffer.alloc(16, 0x58),
      keyPair,
      originNonceBytes: Buffer.alloc(16, 0x78),
      originTimestamp: new Date().toISOString(),
      payload: createPayload(mixedLowerSyncId, observedAt, 140, {
        dailyEntries: [
          { usageDate: today, dailyTokenTotal: "140" },
          { usageDate: twoDaysAgo, dailyTokenTotal: "999" },
        ],
      }),
      policy,
    });
    const mixedLower = await sendSignedRequest(host.baseUrl, policy, mixedLowerRequest);
    assertSuccess(mixedLower, {
      acceptedEntries: 0,
      outcome: "quarantined",
      recoveryAction: "contact_support",
      syncId: mixedLowerSyncId,
    });
    results.push(mixedLower);
    assert.equal(
      psqlScalar(
        `SET ROLE viberacing_owner;
SELECT pg_catalog.jsonb_build_object(
  'today', (
    SELECT cumulative_token_total::text
    FROM viberacing_private.agent_account_day_totals
    WHERE agent_account_id = '${agentAccountId}'
      AND usage_date = '${today}'
  ),
  'unexpectedDay', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.agent_account_day_totals
    WHERE agent_account_id = '${agentAccountId}'
      AND usage_date = '${twoDaysAgo}'
  )
)::text;`,
        "quarantined batch non-mutation verification",
      ),
      '{"today": "150", "unexpectedDay": 0}',
    );

    const accountRace = await exerciseDatabaseStateRace({
      baseUrl: host.baseUrl,
      keyPair,
      mutationSql: `BEGIN;
SET LOCAL ROLE viberacing_owner;
UPDATE viberacing_private.agent_accounts
SET state = 'paused',
    state_changed_at = pg_catalog.statement_timestamp()
WHERE agent_account_id = '${agentAccountId}';
COMMIT;`,
      policy,
      syncId: accountRaceSyncId,
      total: 160,
    });
    results.push(accountRace);
    psql(
      `BEGIN;
SET LOCAL ROLE viberacing_owner;
UPDATE viberacing_private.agent_accounts
SET state = 'active',
    state_changed_at = pg_catalog.statement_timestamp()
WHERE agent_account_id = '${agentAccountId}';
COMMIT;`,
      "synthetic account-state restoration",
    );

    const revokedRace = await exerciseDatabaseStateRace({
      baseUrl: host.baseUrl,
      keyPair,
      mutationSql: `BEGIN;
SET LOCAL ROLE viberacing_owner;
UPDATE viberacing_private.device_keys
SET state = 'revoked',
    revoked_at = pg_catalog.statement_timestamp()
WHERE device_key_id = '${deviceKeyId}';
COMMIT;`,
      policy,
      syncId: revokedSyncId,
      total: 170,
    });
    results.push(revokedRace);

    results.push(...(await exerciseNoQueueAdmission(host.baseUrl, policy, admissionKeyPair)));

    await host.controller.close();
    controllerOpen = false;
    const emitted = await exerciseEmittedIngestProcess(databasePort, policy, admissionKeyPair);
    results.push(emitted);

    const expectedOutboxCount = new Set([utcMonday(today), utcMonday(yesterday)]).size;
    const storedState = JSON.parse(
      psqlScalar(
        `SET ROLE viberacing_owner;
SELECT pg_catalog.jsonb_build_object(
  'accountTotals', (
    SELECT pg_catalog.jsonb_object_agg(
      usage_date::text,
      cumulative_token_total::text
      ORDER BY usage_date
    )
    FROM viberacing_private.agent_account_day_totals
    WHERE agent_account_id = '${agentAccountId}'
  ),
  'admissionDeviceNonces', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.device_nonces
    WHERE device_key_id = '${admissionDeviceKeyId}'
  ),
  'admissionDeviceState', (
    SELECT state
    FROM viberacing_private.device_keys
    WHERE device_key_id = '${admissionDeviceKeyId}'
  ),
  'idempotencyRecords', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.usage_idempotency_records
  ),
  'observations', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.usage_observations
  ),
  'observationOutcomes', (
    SELECT pg_catalog.jsonb_object_agg(outcome, outcome_count)
    FROM (
      SELECT outcome, pg_catalog.count(*)::integer AS outcome_count
      FROM viberacing_private.usage_observations
      GROUP BY outcome
    ) AS outcome_counts
  ),
  'originNonces', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.origin_nonces
    WHERE origin_key_id = '${originKeyId}'
  ),
  'primaryDeviceNonces', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.device_nonces
    WHERE device_key_id = '${deviceKeyId}'
  ),
  'primaryDeviceState', (
    SELECT state
    FROM viberacing_private.device_keys
    WHERE device_key_id = '${deviceKeyId}'
  ),
  'rankingEvents', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.ranking_events
  ),
  'readerVersions', (
    SELECT pg_catalog.jsonb_agg(DISTINCT reader_version)
    FROM viberacing_private.usage_observations
  ),
  'refreshOutbox', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.ranking_refresh_outbox
  ),
  'unexpectedSyncs', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.usage_observations
    WHERE sync_id IN (
      '${sameNonceSyncId}',
      '${accountRaceSyncId}',
      '${revokedSyncId}',
      '${rejectedAdmissionSyncId}'
    )
  )
)::text;`,
        "final Ingest stored-state verification",
      ),
    );
    assert.deepEqual(storedState, {
      accountTotals: {
        [today]: "300",
        [yesterday]: "200",
      },
      admissionDeviceNonces: 2,
      admissionDeviceState: "active",
      idempotencyRecords: 7,
      observationOutcomes: {
        accepted: 4,
        duplicate: 1,
        quarantined: 2,
      },
      observations: 7,
      originNonces: 8,
      primaryDeviceNonces: 4,
      primaryDeviceState: "revoked",
      rankingEvents: 7,
      readerVersions: [readerVersion],
      refreshOutbox: expectedOutboxCount,
      unexpectedSyncs: 0,
    });

    const requestIds = new Set(results.map((result) => result.body.requestId));
    assert.equal(requestIds.size, results.length);
    for (const result of results) {
      const serialized = JSON.stringify(result.body);
      for (const marker of [
        agentAccountId,
        deviceId,
        deviceKeyId,
        admissionDeviceId,
        admissionDeviceKeyId,
        readerVersion,
        "codex",
      ]) {
        assert.equal(serialized.includes(marker), false);
      }
    }
    return results.length;
  } finally {
    if (controllerOpen) {
      await host.controller.close().catch(() => undefined);
    }
  }
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

function signalContainerExists(name) {
  const result = docker(["inspect", name], { timeout: 10_000 });
  if (result.status === 0) {
    return true;
  }
  if (result.status === 1) {
    return false;
  }
  throw new Error("Ingest signal container existence check failed.");
}

function removeSignalContainer(name) {
  if (!signalContainerExists(name)) {
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
  assert.equal(imageEnvironment.includes("NODE_VERSION=24.18.0"), true);
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
    { timeout: 10_000 },
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
    assert.equal(state.Running, true);
    assert.equal(readSignalProcessContainerOutput(), "");
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
    exited: () => exited,
    outputBytes: () => outputBytes,
    stderr: () => stderr,
    stdout: () => stdout,
  });
}

async function readSignalProcessClientResult(client) {
  const closeResult = await waitWithDeadline(
    client.closed,
    signalProcessCloseTimeoutMs,
    "Ingest signal client did not close in time.",
  );
  assert.ok(client.outputBytes() <= maximumSignalClientOutputBytes);
  assert.equal(client.stderr(), "");
  const serialized = JSON.parse(client.stdout());
  if (closeResult.code === 1 && closeResult.signal === null) {
    throw new Error(`Ingest signal client failed closed (${serialized.clientError}).`);
  }
  assert.deepEqual(closeResult, { code: 0, signal: null });
  assert.deepEqual(Object.keys(serialized).sort(), ["body", "headers", "status"]);
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
  throw new Error("Ingest signal container did not exit in time.");
}

async function exerciseSignalProcess(policy, keyPair) {
  const runtime = createPortableIngestSignalRuntime();
  let blocker;
  let blockerStopped = false;
  let client;
  try {
    blocker = startDatabaseSubmitBlocker();
    await waitForSubmitBlocker(blocker);
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
      payload: createPayload(signalProcessSyncId, observedAt, 401),
      policy,
      requestDeviceId: admissionDeviceId,
    });
    client = startSignalProcessClient(policy, request);
    await waitForBlockedSubmit(1, () => {
      assert.equal(client.exited(), false);
      const state = readSignalProcessContainerState();
      assert.equal(state.Running, true);
      assert.equal(readSignalProcessContainerOutput(), "");
    });

    requireSuccess(
      docker(["kill", "--signal", "SIGTERM", signalProcessContainerName], {
        timeout: 10_000,
      }),
      "Ingest signal delivery",
    );
    assert.equal(readSignalProcessContainerState().Running, true);
    assert.equal(readSignalProcessContainerOutput(), "");

    await stopDatabaseSubmitBlocker(blocker);
    blockerStopped = true;
    const clientResult = await readSignalProcessClientResult(client);
    assertSuccess(clientResult, {
      acceptedEntries: 1,
      outcome: "accepted",
      syncId: signalProcessSyncId,
    });

    const state = await waitForSignalProcessContainerExit();
    assert.equal(state.Status, "exited");
    assert.equal(state.ExitCode, 0);
    assert.equal(state.OOMKilled, false);
    assert.equal(state.Error, "");
    assert.equal(readSignalProcessContainerOutput(), "");
    assert.equal(
      psqlScalar(
        `SELECT pg_catalog.count(*)::integer
FROM pg_catalog.pg_stat_activity
WHERE application_name = 'viberacing-ingest-community-sync'
  AND usename = '${ingestLogin}';`,
        "signal-process released-session verification",
      ),
      "0",
    );
    const stored = JSON.parse(
      psqlScalar(
        `SET ROLE viberacing_owner;
SELECT pg_catalog.jsonb_build_object(
  'accountDays', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.agent_account_day_totals
    WHERE agent_account_id = '${agentAccountId}'
  ),
  'accountTokens', (
    SELECT cumulative_token_total::text
    FROM viberacing_private.agent_account_day_totals
    WHERE agent_account_id = '${agentAccountId}'
  ),
  'deviceNonces', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.device_nonces
    WHERE device_key_id = '${admissionDeviceKeyId}'
  ),
  'idempotencyRecords', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.usage_idempotency_records
    WHERE device_key_id = '${admissionDeviceKeyId}'
  ),
  'observations', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.usage_observations
    WHERE device_key_id = '${admissionDeviceKeyId}'
      AND sync_id = '${signalProcessSyncId}'
  ),
  'originNonces', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.origin_nonces
    WHERE origin_key_id = '${originKeyId}'
  ),
  'rankingEvents', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.ranking_events
  ),
  'refreshOutbox', (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.ranking_refresh_outbox
  )
)::text;`,
        "signal-process exact stored-state verification",
      ),
    );
    assert.deepEqual(stored, {
      accountDays: 1,
      accountTokens: "401",
      deviceNonces: 1,
      idempotencyRecords: 1,
      observations: 1,
      originNonces: 1,
      rankingEvents: 1,
      refreshOutbox: 1,
    });
  } finally {
    if (blocker !== undefined && !blockerStopped) {
      await stopDatabaseSubmitBlocker(blocker).catch(() => undefined);
    }
    removeSignalContainer(signalProcessClientContainerName);
    removeSignalContainer(signalProcessContainerName);
    if (client !== undefined) {
      await waitWithDeadline(
        client.closed,
        signalProcessCloseTimeoutMs,
        "Ingest signal client cleanup did not settle.",
      ).catch(() => undefined);
    }
    removePortableNodeRuntime(runtime);
  }
}

async function main() {
  buildWorkspace("packages/contracts", "contract production build");
  buildWorkspace("apps/ingest", "Ingest production build");
  buildWorkspace("apps/ingest-host", "Ingest host production build");

  const policy = readAuthenticationPolicy();
  const keyPair = generateKeyPairSync("ed25519");
  const admissionKeyPair = generateKeyPairSync("ed25519");
  const publicKey = readDevicePublicKey(keyPair);
  const admissionPublicKey = readDevicePublicKey(admissionKeyPair);
  let containerStarted = false;
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
    seedDatabase(publicKey, admissionPublicKey);

    if (integrationMode === "signal_process") {
      await exerciseSignalProcess(policy, admissionKeyPair);
      console.log(
        "Emitted Ingest signal PostgreSQL integration passed (pinned Linux runtime, real SIGTERM, active signed-request settlement, silent code-0 exit, released sessions, and exact atomic stored state).",
      );
    } else {
      const resultCount = await exerciseFullIntegration(
        databasePort,
        policy,
        keyPair,
        admissionKeyPair,
      );
      console.log(
        `Ingest PostgreSQL integration passed (${resultCount} generic HTTP decisions; removed aliases, zero-write rejection matrix, exact retry and replay safety, monotonic/quarantine semantics, account/device races, per-device no-queue admission, emitted process, and exact stored state).`,
      );
    }
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
  }

  if (primaryFailure !== undefined) {
    throw primaryFailure;
  }
  if (cleanupFailure !== undefined) {
    throw cleanupFailure;
  }
}

await main();
