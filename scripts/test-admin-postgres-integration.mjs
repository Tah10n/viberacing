import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, sign, X509Certificate } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { validateManifest } from "./check-database.mjs";

// cspell:ignore localdomain usename WINDIR

const root = resolve(import.meta.dirname, "..");
const adminRoot = resolve(root, "apps", "admin");
const adminEntryPoint = resolve(adminRoot, "dist", "index.js");
const adminRequire = createRequire(resolve(adminRoot, "package.json"));
const projectName = `vr-admin-it-${process.pid}`;
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
const databaseTlsCertificatePath = "/tmp/viberacing-admin-it-server.crt";
const databaseTlsKeyPath = "/tmp/viberacing-admin-it-server.key";
const adminLogin = "viberacing_admin_login";
const adminPassword = "synthetic-admin-integration-password";
const wideAdminLogin = "viberacing_admin_wide_login";
const wideAdminPassword = "synthetic-wide-admin-integration-password";
const extraRole = "viberacing_admin_extra";
const internalChildArgument = "--integration-child";
const childModeKey = "VIBERACING_ADMIN_INTEGRATION_CHILD_MODE";
const childNowKey = "VIBERACING_ADMIN_INTEGRATION_NOW_MS";
const childSuccessOutput = "Vibe Racing Admin integration command completed.\n";
const childFailureOutput = "Vibe Racing Admin integration command failed.\n";
const expectedRejectedChildStatus = 2;
const maximumChildOutputBytes = 8 * 1024;
const inviteLifetimeMs = 7 * 24 * 60 * 60 * 1_000;
const fixture = Object.freeze({
  actorReference: `adm_${Buffer.alloc(16, 0x31).toString("base64url")}`,
  auditEventId: "00000000-0000-4000-8000-000000066102",
  inviteId: "00000000-0000-4000-8000-000000066101",
  requestId: `req_${Buffer.alloc(16, 0x21).toString("base64url")}`,
  secret: Buffer.alloc(32, 0x41).toString("base64url"),
  verifierDigestHex: createHash("sha256").update(Buffer.alloc(32, 0x41)).digest("hex"),
});

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
  const directory = mkdtempSync(join(tmpdir(), "viberacing-admin-it-"));
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

function buildAdminWorkspace() {
  const tsc = adminRequire.resolve("typescript/bin/tsc");
  const result = run(process.execPath, [tsc, "--project", "tsconfig.build.json"], {
    cwd: adminRoot,
  });
  requireSuccess(result, "Admin production build");
  const entryPoint = lstatSync(adminEntryPoint);
  assert.equal(entryPoint.isFile(), true, "built Admin entry point must be a regular file");
  assert.equal(entryPoint.isSymbolicLink(), false, "built Admin entry point must not be a link");
}

function loadReviewedMigrations() {
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

function readPrivateStateFingerprint(label, excludeAdminTargets = false) {
  const targetFilter = excludeAdminTargets
    ? "AND table_name NOT IN ('audit_events', 'invites')"
    : "";
  const canonicalState = psqlScalar(
    `CREATE TEMP TABLE admin_integration_fingerprints (
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
      ${targetFilter}
    ORDER BY table_name
  LOOP
    EXECUTE pg_catalog.format(
      'SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(candidate) ORDER BY pg_catalog.to_jsonb(candidate)::text), ''[]''::jsonb) FROM %I.%I AS candidate',
      'viberacing_private',
      private_table.table_name
    )
    INTO table_state;

    INSERT INTO admin_integration_fingerprints (table_name, table_state)
    VALUES (private_table.table_name, table_state);
  END LOOP;
END
$fingerprint$;

SELECT pg_catalog.jsonb_object_agg(table_name, table_state ORDER BY table_name)::text
FROM admin_integration_fingerprints;`,
    label,
  );
  assert.notEqual(canonicalState, "", `${label} must return canonical private state`);
  return createHash("sha256").update(canonicalState, "utf8").digest("hex");
}

function readAdminTargetState() {
  return JSON.parse(
    psqlScalar(
      `SELECT pg_catalog.jsonb_build_object(
  'invites', COALESCE(
    (
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'createdAtMs', (pg_catalog.date_part('epoch', invite.created_at) * 1000)::bigint,
          'expiresAtMs', (pg_catalog.date_part('epoch', invite.expires_at) * 1000)::bigint,
          'inviteId', invite.invite_id::text,
          'redeemedAtMs', CASE
            WHEN invite.redeemed_at IS NULL THEN NULL
            ELSE (pg_catalog.date_part('epoch', invite.redeemed_at) * 1000)::bigint
          END,
          'redeemedProfileId', invite.redeemed_profile_id::text,
          'state', invite.state,
          'verifierDigestHex', pg_catalog.encode(invite.verifier_digest, 'hex')
        )
        ORDER BY invite.invite_id
      )
      FROM viberacing_private.invites AS invite
    ),
    '[]'::jsonb
  ),
  'auditEvents', COALESCE(
    (
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'actorKind', audit.actor_kind,
          'auditEventId', audit.audit_event_id::text,
          'eventType', audit.event_type,
          'occurredAtMs', (pg_catalog.date_part('epoch', audit.occurred_at) * 1000)::bigint,
          'profileId', audit.profile_id::text,
          'reasonCode', audit.reason_code,
          'requestId', audit.request_id
        )
        ORDER BY audit.audit_event_id
      )
      FROM viberacing_private.audit_events AS audit
    ),
    '[]'::jsonb
  )
)::text;`,
      "exact Admin target state",
    ),
  );
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

function adminChildEnvironment(databasePort, login, password, certificatePath, mode, nowMs) {
  return Object.freeze({
    ...baseChildEnvironment(),
    NODE_EXTRA_CA_CERTS: certificatePath,
    VIBERACING_ADMIN_DATABASE_HOST: databaseTlsHost,
    VIBERACING_ADMIN_DATABASE_NAME: databaseName,
    VIBERACING_ADMIN_DATABASE_PASSWORD: password,
    VIBERACING_ADMIN_DATABASE_PORT: String(databasePort),
    VIBERACING_ADMIN_DATABASE_TLS_MODE: "verify-full",
    VIBERACING_ADMIN_DATABASE_USER: login,
    [childModeKey]: mode,
    [childNowKey]: String(nowMs),
  });
}

function childPrivateMarkers(certificatePath, nowMs) {
  return [
    adminLogin,
    adminPassword,
    wideAdminLogin,
    wideAdminPassword,
    extraRole,
    certificatePath,
    String(nowMs),
    fixture.actorReference,
    fixture.auditEventId,
    fixture.inviteId,
    fixture.requestId,
    fixture.secret,
    fixture.verifierDigestHex,
  ];
}

function runAdminChild(databasePort, login, password, certificatePath, mode, nowMs) {
  const result = spawnSync(process.execPath, [import.meta.filename, internalChildArgument], {
    cwd: root,
    encoding: "utf8",
    env: adminChildEnvironment(databasePort, login, password, certificatePath, mode, nowMs),
    maxBuffer: maximumChildOutputBytes,
    timeout: 20_000,
    windowsHide: true,
  });
  if (result.error) {
    throw new Error("Admin integration child could not complete");
  }
  assert.equal(result.signal, null, "Admin integration child must not be signal-terminated");
  const combinedOutput = `${result.stdout}${result.stderr}`;
  assert.ok(
    Buffer.byteLength(combinedOutput, "utf8") <= maximumChildOutputBytes,
    "Admin integration child output must remain bounded",
  );
  for (const marker of childPrivateMarkers(certificatePath, nowMs)) {
    assert.equal(
      combinedOutput.includes(marker),
      false,
      "Admin integration child output exposed a protected value",
    );
  }
  return result;
}

function assertRejectedChild(result) {
  assert.equal(result.status, expectedRejectedChildStatus);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, childFailureOutput);
}

function assertSuccessfulChild(result) {
  assert.equal(result.status, 0);
  assert.equal(result.stdout, childSuccessOutput);
  assert.equal(result.stderr, "");
}

function assertExactAdminState(state, nowMs) {
  assert.deepEqual(Object.keys(state).sort(), ["auditEvents", "invites"]);
  assert.equal(state.invites.length, 1);
  const invite = state.invites[0];
  assert.deepEqual(Object.keys(invite).sort(), [
    "createdAtMs",
    "expiresAtMs",
    "inviteId",
    "redeemedAtMs",
    "redeemedProfileId",
    "state",
    "verifierDigestHex",
  ]);
  assert.equal(invite.inviteId, fixture.inviteId);
  assert.equal(invite.verifierDigestHex, fixture.verifierDigestHex);
  assert.equal(invite.state, "active");
  assert.equal(invite.redeemedAtMs, null);
  assert.equal(invite.redeemedProfileId, null);
  assert.equal(invite.expiresAtMs, nowMs + inviteLifetimeMs);
  assert.ok(invite.createdAtMs >= nowMs - 5_000);
  assert.ok(invite.createdAtMs <= nowMs + 20_000);
  assert.ok(invite.expiresAtMs - invite.createdAtMs >= inviteLifetimeMs - 20_000);
  assert.ok(invite.expiresAtMs - invite.createdAtMs <= inviteLifetimeMs + 5_000);

  assert.equal(state.auditEvents.length, 1);
  const audit = state.auditEvents[0];
  assert.deepEqual(Object.keys(audit).sort(), [
    "actorKind",
    "auditEventId",
    "eventType",
    "occurredAtMs",
    "profileId",
    "reasonCode",
    "requestId",
  ]);
  assert.deepEqual(audit, {
    actorKind: "admin",
    auditEventId: fixture.auditEventId,
    eventType: "invite.issued",
    occurredAtMs: invite.createdAtMs,
    profileId: null,
    reasonCode: "BETA_ADMISSION",
    requestId: fixture.requestId,
  });
}

function assertNoAdminConnections() {
  assert.equal(
    psqlScalar(
      `SELECT pg_catalog.count(*)::text
FROM pg_catalog.pg_stat_activity AS activity
WHERE activity.datname = '${databaseName}'
  AND activity.usename IN ('${adminLogin}', '${wideAdminLogin}');`,
      "Admin connection cleanup",
    ),
    "0",
  );
}

function readChildInputs() {
  const mode = process.env[childModeKey];
  const nowValue = process.env[childNowKey];
  if ((mode !== "narrow" && mode !== "widened") || !/^[0-9]{13}$/.test(nowValue ?? "")) {
    throw new Error("invalid integration child input");
  }
  const nowMs = Number(nowValue);
  if (!Number.isSafeInteger(nowMs) || Math.abs(Date.now() - nowMs) > 60_000) {
    throw new Error("invalid integration child clock");
  }
  return Object.freeze({ mode, nowMs });
}

function assertExternalAuditEvent(event, phase, nowMs) {
  assert.equal(Object.getPrototypeOf(event), null);
  assert.equal(Object.isFrozen(event), true);
  assert.deepEqual(Reflect.ownKeys(event).sort(), [
    "action",
    "actorReference",
    "auditEventId",
    "inviteExpiresAt",
    "occurredAt",
    "phase",
    "reasonCode",
    "requestId",
    "version",
  ]);
  assert.deepEqual(
    { ...event },
    {
      action: "invite.issue",
      actorReference: fixture.actorReference,
      auditEventId: fixture.auditEventId,
      inviteExpiresAt: new Date(nowMs + inviteLifetimeMs).toISOString(),
      occurredAt: new Date(nowMs).toISOString(),
      phase,
      reasonCode: "BETA_ADMISSION",
      requestId: fixture.requestId,
      version: 1,
    },
  );
}

async function runChild() {
  const { mode, nowMs } = readChildInputs();
  const admin = await import(pathToFileURL(adminEntryPoint).href);
  const auditEvents = [];
  const entropyBuffers = [];
  const entropySizes = [];
  const uuidQueue = [fixture.inviteId, fixture.auditEventId];
  const poolSignals = [];
  let authorizationCalls = 0;
  let clockCalls = 0;
  let storeErrorCode;
  let storeCalls = 0;

  const config = admin.resolveAdminDatabaseConfig(process.env);
  const pool = admin.createAdminDatabasePool(config, (signal) => {
    poolSignals.push(signal);
  });
  const store = admin.createAdminInviteStore(pool);
  const issuer = admin.createAdminInviteIssuer(
    {
      async appendAudit(event) {
        auditEvents.push(event);
        return Object.freeze({
          accepted: true,
          phase: event.phase,
          requestId: event.requestId,
          version: 1,
        });
      },
      async authorize() {
        authorizationCalls += 1;
        return Object.freeze({
          accessVerifiedAtMs: nowMs - 1_000,
          actorReference: fixture.actorReference,
          decision: "allow",
          passkeyVerifiedAtMs: nowMs,
          purpose: "invite_issue",
          validUntilMs: nowMs + 5 * 60 * 1_000,
          version: 1,
        });
      },
      async issueInvite(input) {
        storeCalls += 1;
        try {
          await store.issueInvite(input);
        } catch (error) {
          if (error instanceof admin.AdminInviteStoreError) {
            storeErrorCode = error.code;
          }
          throw error;
        }
      },
    },
    {
      clock() {
        clockCalls += 1;
        return nowMs;
      },
      randomBytes(size) {
        entropySizes.push(size);
        assert.ok(size === 16 || size === 32);
        const value = Buffer.alloc(size, size === 16 ? 0x21 : 0x41);
        entropyBuffers.push(value);
        return value;
      },
      randomUuid() {
        const value = uuidQueue.shift();
        assert.notEqual(value, undefined);
        return value;
      },
    },
  );

  let credential;
  let rejectedError;
  try {
    try {
      credential = await issuer.issueBetaInvite();
    } catch (error) {
      rejectedError = error;
    }
  } finally {
    await pool.close();
  }

  assert.equal(authorizationCalls, 1);
  assert.equal(clockCalls, 2);
  assert.equal(storeCalls, 1);
  assert.deepEqual(entropySizes, [16, 32]);
  assert.equal(uuidQueue.length, 0);
  assert.deepEqual(poolSignals, []);
  for (const value of entropyBuffers) {
    assert.equal(
      value.every((byte) => byte === 0),
      true,
    );
  }
  assertExternalAuditEvent(auditEvents[0], "authorized", nowMs);

  if (mode === "widened") {
    assert.equal(credential, undefined);
    assert.ok(rejectedError instanceof admin.AdminInviteIssuanceError);
    assert.equal(rejectedError.code, "storage_rejected");
    assert.equal(storeErrorCode, "runtime_boundary_mismatch");
    assert.equal(auditEvents.length, 1);
    return "expected_rejection";
  }

  assert.equal(rejectedError, undefined);
  assert.equal(storeErrorCode, undefined);
  assert.equal(credential, `vri_${fixture.inviteId}_${fixture.secret}`);
  assert.equal(auditEvents.length, 2);
  assertExternalAuditEvent(auditEvents[1], "committed", nowMs);
  return "success";
}

async function main() {
  if (process.argv.length !== 2) {
    throw new Error("Admin PostgreSQL integration accepts no arguments");
  }
  buildAdminWorkspace();
  const migrations = loadReviewedMigrations();
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
    for (const migration of migrations) {
      psql(migration.sql, migration.label);
    }

    psql(
      `BEGIN;
CREATE ROLE ${extraRole} NOLOGIN;
CREATE ROLE ${adminLogin}
  WITH LOGIN PASSWORD '${adminPassword}'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT viberacing_admin TO ${adminLogin} WITH INHERIT FALSE, SET TRUE;
GRANT CONNECT ON DATABASE ${databaseName} TO ${adminLogin};
ALTER ROLE ${adminLogin} IN DATABASE ${databaseName}
  SET search_path TO pg_catalog, pg_temp;

CREATE ROLE ${wideAdminLogin}
  WITH LOGIN PASSWORD '${wideAdminPassword}'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT viberacing_admin TO ${wideAdminLogin} WITH INHERIT FALSE, SET TRUE;
GRANT ${extraRole} TO ${wideAdminLogin} WITH INHERIT FALSE, SET TRUE;
GRANT CONNECT ON DATABASE ${databaseName} TO ${wideAdminLogin};
ALTER ROLE ${wideAdminLogin} IN DATABASE ${databaseName}
  SET search_path TO pg_catalog, pg_temp;
COMMIT;`,
      "narrow and deliberately widened synthetic Admin logins",
    );

    const initialState = readPrivateStateFingerprint("initial Admin private-state fingerprint");
    const initialNonTargetState = readPrivateStateFingerprint(
      "initial Admin non-target private-state fingerprint",
      true,
    );

    const wideNowMs = Math.trunc(Date.now() / 1_000) * 1_000;
    const rejectedChild = runAdminChild(
      databasePort,
      wideAdminLogin,
      wideAdminPassword,
      tlsMaterial.certificatePath,
      "widened",
      wideNowMs,
    );
    assertRejectedChild(rejectedChild);
    assert.equal(
      readPrivateStateFingerprint("post-rejection Admin private-state fingerprint"),
      initialState,
      "the widened Admin login must fail before mutating any private table",
    );

    const narrowNowMs = Math.trunc(Date.now() / 1_000) * 1_000;
    const successfulChild = runAdminChild(
      databasePort,
      adminLogin,
      adminPassword,
      tlsMaterial.certificatePath,
      "narrow",
      narrowNowMs,
    );
    assertSuccessfulChild(successfulChild);
    assert.equal(
      readPrivateStateFingerprint("post-success Admin non-target private-state fingerprint", true),
      initialNonTargetState,
      "the narrow Admin login must not mutate a non-target private table",
    );
    assertExactAdminState(readAdminTargetState(), narrowNowMs);
    assertNoAdminConnections();

    console.log(
      `Admin PostgreSQL integration passed (widened-login denial, verified TLS, exact ${migrations.length}-migration schema, one invite, one database audit row, and closed connections).`,
    );
  } catch (error) {
    primaryFailure = error;
  } finally {
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

if (process.argv.length === 3 && process.argv[2] === internalChildArgument) {
  try {
    const outcome = await runChild();
    if (outcome === "success") {
      process.stdout.write(childSuccessOutput);
    } else {
      process.stderr.write(childFailureOutput);
      process.exitCode = expectedRejectedChildStatus;
    }
  } catch {
    process.stderr.write(childFailureOutput);
    process.exitCode = 1;
  }
} else {
  await main();
}
