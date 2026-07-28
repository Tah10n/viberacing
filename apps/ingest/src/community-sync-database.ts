import { randomBytes } from "node:crypto";

import { validateUsageSyncV1, type UsageSyncV1 } from "@viberacing/contracts";

import {
  createIngestDatabasePool,
  type IngestDatabaseClient,
  type IngestDatabasePool,
  type IngestDatabasePoolSignalSink,
  type IngestDatabaseUsageSubmission,
} from "./database-pool.js";
import { resolveIngestDatabaseConfig } from "./database-config.js";
import type { DeviceVerificationMaterial } from "./community-sync-verifier.js";
import {
  decodeCanonicalBase64Url,
  deviceIdPattern,
  devicePublicKeyBytes,
  deviceSignatureBytes,
  idempotencyKeyPattern,
  originKeyIdPattern,
  usageSyncRequestTarget,
} from "./protocol.js";

const verifiedSubmissionKeys = new Set([
  "accountingRevision",
  "agentAccountId",
  "bodyDigestHex",
  "deviceNonceDigestHex",
  "deviceId",
  "deviceKeyId",
  "idempotencyKey",
  "originExpiresAtMilliseconds",
  "originKeyId",
  "originNonceDigestHex",
  "payload",
  "provider",
  "readerVersion",
  "requestTarget",
  "signatureBase64Url",
  "scopeKind",
]);
const usagePayloadKeys = new Set([
  "agentAccountId",
  "clientVersion",
  "dailyEntries",
  "observedAt",
  "readerVersion",
  "schemaVersion",
  "syncId",
]);
const usageDailyEntryKeys = new Set(["dailyTokenTotal", "usageDate"]);
const deviceRowKeys = new Set([
  "accounting_revision",
  "agent_account_id",
  "device_id",
  "device_key_id",
  "identity_assurance",
  "installation_id",
  "maximum_backfill_days",
  "provider_code",
  "public_key",
  "reader_version",
  "scope_kind",
]);
const submissionRowKeys = new Set(["accepted_entries", "outcome", "recovery_action"]);
const runtimeBoundaryColumns = ["role_ok", "login_scope_ok", "search_path_ok"] as const;
const runtimeBoundaryColumnSet = new Set<string>(runtimeBoundaryColumns);
const digestHexPattern = /^[0-9a-f]{64}$/;
const agentAccountIdPattern = /^acc_[A-Za-z0-9_-]{22}$/;
const deviceKeyIdPattern = /^key_[A-Za-z0-9_-]{22}$/;
const installationIdPattern = /^ins_[A-Za-z0-9_-]{22}$/;
const providerPattern = /^[a-z][a-z0-9_]{1,23}$/;
const readerVersionPattern = /^[a-z][a-z0-9_]{2,63}$/;
const generatedIdPatterns = Object.freeze({
  evt: /^evt_[A-Za-z0-9_-]{22}$/,
  obs: /^obs_[A-Za-z0-9_-]{22}$/,
});

export type CommunitySyncDatabaseErrorCode =
  | "connection_release_failed"
  | "connection_unavailable"
  | "identifier_unavailable"
  | "input_invalid"
  | "pool_close_failed"
  | "query_failed"
  | "result_invalid"
  | "runtime_boundary_mismatch";

export class CommunitySyncDatabaseError extends Error {
  readonly code: CommunitySyncDatabaseErrorCode;

  constructor(code: CommunitySyncDatabaseErrorCode) {
    super("Community sync database operation failed.");
    this.name = "CommunitySyncDatabaseError";
    this.code = code;
  }
}

export interface CommunitySyncSubmissionResult {
  readonly acceptedEntries: number;
  readonly outcome: "accepted" | "duplicate" | "quarantined";
  readonly recoveryAction?:
    "update_connector" | "reconnect_account" | "contact_support" | "retry_later";
}

export interface CommunitySyncDatabase {
  readDeviceVerificationMaterial(deviceId: string): Promise<DeviceVerificationMaterial | null>;
  submit(verifiedSubmission: unknown): Promise<CommunitySyncSubmissionResult>;
}

export interface ConfiguredCommunitySyncDatabase extends CommunitySyncDatabase {
  close(): Promise<void>;
}

export type PublicIdPrefix = keyof typeof generatedIdPatterns;
export type PublicIdFactory = (prefix: PublicIdPrefix) => string;

interface ValidatedSubmission {
  readonly agentAccountId: string;
  readonly bodyDigest: Buffer;
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly deviceNonceDigest: Buffer;
  readonly originExpiresAt: string;
  readonly originKeyId: string;
  readonly originNonceDigest: Buffer;
  readonly payload: UsageSyncV1;
  readonly readerVersion: string;
  readonly signature: Buffer;
}

function fail(code: CommunitySyncDatabaseErrorCode): never {
  throw new CommunitySyncDatabaseError(code);
}

function isPlainRecord(value: unknown): value is object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: object, expected: ReadonlySet<string>): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.size &&
    keys.every((key) => typeof key === "string" && expected.has(key))
  );
}

function ownDataValue(
  value: object,
  key: string,
  errorCode: "input_invalid" | "result_invalid",
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
    fail(errorCode);
  }
  return descriptor.value as unknown;
}

function readDenseArray(value: unknown, maximumLength: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail("input_invalid");
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > maximumLength
  ) {
    fail("input_invalid");
  }
  const length = lengthDescriptor.value as number;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || !keys.includes("length")) {
    fail("input_invalid");
  }
  const copy: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      fail("input_invalid");
    }
    copy.push(descriptor.value as unknown);
  }
  return copy;
}

function readUsagePayload(value: unknown): UsageSyncV1 {
  if (!isPlainRecord(value) || !hasExactKeys(value, usagePayloadKeys)) {
    fail("input_invalid");
  }
  const rawEntries = readDenseArray(ownDataValue(value, "dailyEntries", "input_invalid"), 31);
  const dailyEntries = rawEntries.map((entry) => {
    if (!isPlainRecord(entry) || !hasExactKeys(entry, usageDailyEntryKeys)) {
      fail("input_invalid");
    }
    return {
      dailyTokenTotal: ownDataValue(entry, "dailyTokenTotal", "input_invalid"),
      usageDate: ownDataValue(entry, "usageDate", "input_invalid"),
    };
  });
  const candidate = {
    agentAccountId: ownDataValue(value, "agentAccountId", "input_invalid"),
    clientVersion: ownDataValue(value, "clientVersion", "input_invalid"),
    dailyEntries,
    observedAt: ownDataValue(value, "observedAt", "input_invalid"),
    readerVersion: ownDataValue(value, "readerVersion", "input_invalid"),
    schemaVersion: ownDataValue(value, "schemaVersion", "input_invalid"),
    syncId: ownDataValue(value, "syncId", "input_invalid"),
  };
  const validation = validateUsageSyncV1(candidate);
  if (!validation.ok) {
    fail("input_invalid");
  }
  return Object.freeze({
    schemaVersion: 1,
    agentAccountId: validation.value.agentAccountId,
    syncId: validation.value.syncId,
    observedAt: validation.value.observedAt,
    clientVersion: validation.value.clientVersion,
    readerVersion: validation.value.readerVersion,
    dailyEntries: Object.freeze(
      validation.value.dailyEntries.map((entry) =>
        Object.freeze({
          usageDate: entry.usageDate,
          dailyTokenTotal: entry.dailyTokenTotal,
        }),
      ),
    ),
  });
}

function decodeHex(value: unknown): Buffer | undefined {
  return typeof value === "string" && digestHexPattern.test(value)
    ? Buffer.from(value, "hex")
    : undefined;
}

function readVerifiedSubmission(value: unknown): ValidatedSubmission {
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, verifiedSubmissionKeys)) {
      fail("input_invalid");
    }
    const accountingRevision = ownDataValue(value, "accountingRevision", "input_invalid");
    const agentAccountId = ownDataValue(value, "agentAccountId", "input_invalid");
    const bodyDigest = decodeHex(ownDataValue(value, "bodyDigestHex", "input_invalid"));
    const deviceNonceDigest = decodeHex(
      ownDataValue(value, "deviceNonceDigestHex", "input_invalid"),
    );
    const deviceId = ownDataValue(value, "deviceId", "input_invalid");
    const deviceKeyId = ownDataValue(value, "deviceKeyId", "input_invalid");
    const idempotencyKey = ownDataValue(value, "idempotencyKey", "input_invalid");
    const originExpiresAtMilliseconds = ownDataValue(
      value,
      "originExpiresAtMilliseconds",
      "input_invalid",
    );
    const originKeyId = ownDataValue(value, "originKeyId", "input_invalid");
    const originNonceDigest = decodeHex(
      ownDataValue(value, "originNonceDigestHex", "input_invalid"),
    );
    const provider = ownDataValue(value, "provider", "input_invalid");
    const readerVersion = ownDataValue(value, "readerVersion", "input_invalid");
    const requestTarget = ownDataValue(value, "requestTarget", "input_invalid");
    const scopeKind = ownDataValue(value, "scopeKind", "input_invalid");
    const payload = readUsagePayload(ownDataValue(value, "payload", "input_invalid"));
    const signatureValue = ownDataValue(value, "signatureBase64Url", "input_invalid");
    const signature =
      typeof signatureValue === "string"
        ? decodeCanonicalBase64Url(signatureValue, deviceSignatureBytes)
        : undefined;
    const originExpiresAt =
      typeof originExpiresAtMilliseconds === "number"
        ? new Date(originExpiresAtMilliseconds)
        : undefined;
    if (
      typeof accountingRevision !== "number" ||
      !Number.isSafeInteger(accountingRevision) ||
      accountingRevision < 1 ||
      accountingRevision > 32_767 ||
      typeof agentAccountId !== "string" ||
      !agentAccountIdPattern.test(agentAccountId) ||
      agentAccountId !== payload.agentAccountId ||
      bodyDigest === undefined ||
      deviceNonceDigest === undefined ||
      typeof deviceId !== "string" ||
      !deviceIdPattern.test(deviceId) ||
      typeof deviceKeyId !== "string" ||
      !deviceKeyIdPattern.test(deviceKeyId) ||
      typeof idempotencyKey !== "string" ||
      !idempotencyKeyPattern.test(idempotencyKey) ||
      idempotencyKey !== payload.syncId ||
      originExpiresAt === undefined ||
      !Number.isSafeInteger(originExpiresAtMilliseconds) ||
      !Number.isFinite(originExpiresAt.valueOf()) ||
      typeof originKeyId !== "string" ||
      !originKeyIdPattern.test(originKeyId) ||
      originNonceDigest === undefined ||
      typeof provider !== "string" ||
      !providerPattern.test(provider) ||
      typeof readerVersion !== "string" ||
      !readerVersionPattern.test(readerVersion) ||
      readerVersion !== payload.readerVersion ||
      requestTarget !== usageSyncRequestTarget ||
      scopeKind !== "agent_account" ||
      signature === undefined
    ) {
      fail("input_invalid");
    }
    return Object.freeze({
      agentAccountId,
      bodyDigest,
      deviceId,
      deviceKeyId,
      deviceNonceDigest,
      originExpiresAt: originExpiresAt.toISOString(),
      originKeyId,
      originNonceDigest,
      payload,
      readerVersion,
      signature,
    });
  } catch (error) {
    if (error instanceof CommunitySyncDatabaseError) {
      throw error;
    }
    fail("input_invalid");
  }
}

function validArrayShape(value: unknown, expectedLength: number): value is unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length !== expectedLength
  ) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expectedLength + 1 &&
    keys.includes("length") &&
    Array.from({ length: expectedLength }, (_, index) => String(index)).every((key) =>
      keys.includes(key),
    )
  );
}

function copyExactBytes(value: unknown, expectedLength: number): Buffer | undefined {
  if (!(value instanceof Uint8Array)) {
    return undefined;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (
    (prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) ||
    !(value.buffer instanceof ArrayBuffer) ||
    value.byteLength !== expectedLength
  ) {
    return undefined;
  }
  return Buffer.from(value);
}

function readDeviceResult(
  value: unknown,
  expectedDeviceId: string,
): DeviceVerificationMaterial | null {
  try {
    if (validArrayShape(value, 0)) {
      return null;
    }
    if (!validArrayShape(value, 1)) {
      fail("result_invalid");
    }
    const row = ownDataValue(value, "0", "result_invalid");
    if (!isPlainRecord(row) || !hasExactKeys(row, deviceRowKeys)) {
      fail("result_invalid");
    }
    const accountingRevision = ownDataValue(row, "accounting_revision", "result_invalid");
    const agentAccountId = ownDataValue(row, "agent_account_id", "result_invalid");
    const deviceId = ownDataValue(row, "device_id", "result_invalid");
    const deviceKeyId = ownDataValue(row, "device_key_id", "result_invalid");
    const identityAssurance = ownDataValue(row, "identity_assurance", "result_invalid");
    const installationId = ownDataValue(row, "installation_id", "result_invalid");
    const maximumBackfillDays = ownDataValue(row, "maximum_backfill_days", "result_invalid");
    const provider = ownDataValue(row, "provider_code", "result_invalid");
    const publicKey = copyExactBytes(
      ownDataValue(row, "public_key", "result_invalid"),
      devicePublicKeyBytes,
    );
    const readerVersion = ownDataValue(row, "reader_version", "result_invalid");
    const scopeKind = ownDataValue(row, "scope_kind", "result_invalid");
    if (
      typeof accountingRevision !== "number" ||
      !Number.isSafeInteger(accountingRevision) ||
      accountingRevision < 1 ||
      accountingRevision > 32_767 ||
      typeof agentAccountId !== "string" ||
      !agentAccountIdPattern.test(agentAccountId) ||
      deviceId !== expectedDeviceId ||
      typeof deviceKeyId !== "string" ||
      !deviceKeyIdPattern.test(deviceKeyId) ||
      identityAssurance !== "community_local" ||
      typeof installationId !== "string" ||
      !installationIdPattern.test(installationId) ||
      typeof maximumBackfillDays !== "number" ||
      !Number.isSafeInteger(maximumBackfillDays) ||
      maximumBackfillDays < 1 ||
      maximumBackfillDays > 90 ||
      typeof provider !== "string" ||
      !providerPattern.test(provider) ||
      publicKey === undefined ||
      typeof readerVersion !== "string" ||
      !readerVersionPattern.test(readerVersion) ||
      scopeKind !== "agent_account"
    ) {
      fail("result_invalid");
    }
    return Object.freeze({
      accountingRevision,
      agentAccountId,
      deviceKeyId,
      identityAssurance,
      installationId,
      maximumBackfillDays,
      provider,
      publicKey,
      readerVersion,
      scopeKind,
    });
  } catch (error) {
    if (error instanceof CommunitySyncDatabaseError) {
      throw error;
    }
    fail("result_invalid");
  }
}

function readSubmissionResult(
  value: unknown,
  maximumAcceptedEntries: number,
): CommunitySyncSubmissionResult {
  try {
    if (!validArrayShape(value, 1)) {
      fail("result_invalid");
    }
    const row = ownDataValue(value, "0", "result_invalid");
    if (!isPlainRecord(row) || !hasExactKeys(row, submissionRowKeys)) {
      fail("result_invalid");
    }
    const acceptedEntries = ownDataValue(row, "accepted_entries", "result_invalid");
    const outcome = ownDataValue(row, "outcome", "result_invalid");
    const recoveryAction = ownDataValue(row, "recovery_action", "result_invalid");
    if (
      typeof acceptedEntries !== "number" ||
      !Number.isSafeInteger(acceptedEntries) ||
      (outcome === "accepted" &&
        (acceptedEntries < 1 || acceptedEntries > maximumAcceptedEntries)) ||
      ((outcome === "duplicate" || outcome === "quarantined") && acceptedEntries !== 0) ||
      (outcome !== "accepted" && outcome !== "duplicate" && outcome !== "quarantined") ||
      (outcome === "quarantined" ? recoveryAction !== "contact_support" : recoveryAction !== null)
    ) {
      fail("result_invalid");
    }
    return recoveryAction === null
      ? Object.freeze({ acceptedEntries, outcome })
      : Object.freeze({
          acceptedEntries,
          outcome,
          recoveryAction: "contact_support" as const,
        });
  } catch (error) {
    if (error instanceof CommunitySyncDatabaseError) {
      throw error;
    }
    fail("result_invalid");
  }
}

function validRuntimeBoundary(value: unknown): boolean {
  try {
    if (!validArrayShape(value, 1)) {
      return false;
    }
    const row = ownDataValue(value, "0", "result_invalid");
    if (!isPlainRecord(row) || !hasExactKeys(row, runtimeBoundaryColumnSet)) {
      return false;
    }
    return runtimeBoundaryColumns.every(
      (column) => ownDataValue(row, column, "result_invalid") === true,
    );
  } catch {
    return false;
  }
}

function releaseClient(client: IngestDatabaseClient, destroy: boolean): void {
  try {
    client.release(destroy);
  } catch {
    fail("connection_release_failed");
  }
}

async function withClient<Result>(
  pool: IngestDatabasePool,
  operation: (client: IngestDatabaseClient) => Promise<Result>,
): Promise<Result> {
  let client: IngestDatabaseClient;
  try {
    client = await pool.connect();
  } catch {
    fail("connection_unavailable");
  }

  let destroyClient = true;
  let outcome:
    | Readonly<{ code: CommunitySyncDatabaseErrorCode; ok: false }>
    | Readonly<{ ok: true; result: Result }>;
  try {
    const runtimeBoundary = await client.verifyRuntimeBoundary();
    if (!validRuntimeBoundary(runtimeBoundary)) {
      fail("runtime_boundary_mismatch");
    }
    const result = await operation(client);
    destroyClient = false;
    outcome = { ok: true, result };
  } catch (error) {
    outcome = {
      code: error instanceof CommunitySyncDatabaseError ? error.code : "query_failed",
      ok: false,
    };
  }

  releaseClient(client, destroyClient);
  if (!outcome.ok) {
    fail(outcome.code);
  }
  return outcome.result;
}

function defaultPublicIdFactory(prefix: PublicIdPrefix): string {
  return `${prefix}_${randomBytes(16).toString("base64url")}`;
}

function createPublicId(factory: PublicIdFactory, prefix: PublicIdPrefix): string {
  let value: unknown;
  try {
    value = factory(prefix);
  } catch {
    fail("identifier_unavailable");
  }
  if (typeof value !== "string" || !generatedIdPatterns[prefix].test(value)) {
    fail("identifier_unavailable");
  }
  return value;
}

function toDatabaseSubmission(
  submission: ValidatedSubmission,
  observationId: string,
  eventId: string,
): IngestDatabaseUsageSubmission {
  const payload = submission.payload;
  return Object.freeze({
    agentAccountId: submission.agentAccountId,
    bodyDigest: Buffer.from(submission.bodyDigest),
    clientVersion: payload.clientVersion,
    dailyTokenTotals: Object.freeze(payload.dailyEntries.map((entry) => entry.dailyTokenTotal)),
    deviceId: submission.deviceId,
    deviceKeyId: submission.deviceKeyId,
    deviceNonceDigest: Buffer.from(submission.deviceNonceDigest),
    eventId,
    observationId,
    observedAt: payload.observedAt,
    originExpiresAt: submission.originExpiresAt,
    originKeyId: submission.originKeyId,
    originNonceDigest: Buffer.from(submission.originNonceDigest),
    readerVersion: submission.readerVersion,
    signature: Buffer.from(submission.signature),
    syncId: payload.syncId,
    usageDates: Object.freeze(payload.dailyEntries.map((entry) => entry.usageDate)),
  });
}

export function createCommunitySyncDatabase(
  pool: IngestDatabasePool,
  publicIdFactory: PublicIdFactory = defaultPublicIdFactory,
): CommunitySyncDatabase {
  return Object.freeze({
    async readDeviceVerificationMaterial(
      deviceId: string,
    ): Promise<DeviceVerificationMaterial | null> {
      if (typeof deviceId !== "string" || !deviceIdPattern.test(deviceId)) {
        fail("input_invalid");
      }
      return withClient(pool, async (client) =>
        readDeviceResult(await client.readDeviceVerificationMaterial(deviceId), deviceId),
      );
    },
    async submit(value: unknown): Promise<CommunitySyncSubmissionResult> {
      const submission = readVerifiedSubmission(value);
      const observationId = createPublicId(publicIdFactory, "obs");
      const eventId = createPublicId(publicIdFactory, "evt");
      const databaseSubmission = toDatabaseSubmission(submission, observationId, eventId);
      return withClient(pool, async (client) =>
        readSubmissionResult(
          await client.submitUsageSync(databaseSubmission),
          submission.payload.dailyEntries.length,
        ),
      );
    },
  });
}

export function createCloseableCommunitySyncDatabase(
  pool: IngestDatabasePool,
  publicIdFactory: PublicIdFactory = defaultPublicIdFactory,
): ConfiguredCommunitySyncDatabase {
  const database = createCommunitySyncDatabase(pool, publicIdFactory);
  return Object.freeze({
    async close(): Promise<void> {
      try {
        await pool.close();
      } catch {
        fail("pool_close_failed");
      }
    },
    readDeviceVerificationMaterial: (deviceId: string) =>
      database.readDeviceVerificationMaterial(deviceId),
    submit: (submission: unknown) => database.submit(submission),
  });
}

export function createConfiguredCommunitySyncDatabase(
  environment?: Readonly<Record<string, string | undefined>>,
  signalSink?: IngestDatabasePoolSignalSink,
  publicIdFactory: PublicIdFactory = defaultPublicIdFactory,
): ConfiguredCommunitySyncDatabase {
  const config =
    environment === undefined
      ? resolveIngestDatabaseConfig()
      : resolveIngestDatabaseConfig(environment);
  const pool = createIngestDatabasePool(config, signalSink);
  return createCloseableCommunitySyncDatabase(pool, publicIdFactory);
}
