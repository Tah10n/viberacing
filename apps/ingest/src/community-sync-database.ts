import { randomUUID } from "node:crypto";

import { validateUsageSyncV1, type UsageSyncV1 } from "@viberacing/contracts";

import {
  createIngestDatabasePool,
  type IngestDatabaseClient,
  type IngestDatabaseOriginNonce,
  type IngestDatabasePool,
  type IngestDatabasePoolSignalSink,
  type IngestDatabaseUsageSubmission,
} from "./database-pool.js";
import { resolveIngestDatabaseConfig } from "./database-config.js";
import type {
  DeviceVerificationMaterial,
  OriginNonceConsumption,
} from "./community-sync-verifier.js";
import { codexAccountingRevision, codexProvider } from "./community-sync-verifier.js";
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
  "bodyDigestHex",
  "accountingRevision",
  "deviceId",
  "deviceKeyId",
  "idempotencyKey",
  "nonceDigestHex",
  "payload",
  "provider",
  "requestTarget",
  "signatureBase64Url",
]);
const usagePayloadKeys = new Set([
  "agentVersion",
  "clientVersion",
  "dailyEntries",
  "observedAt",
  "schemaVersion",
  "sourceId",
  "syncId",
]);
const usageDailyEntryKeys = new Set(["dailyTokenTotal", "reportedDate"]);
const deviceRowKeys = new Set([
  "accounting_revision",
  "device_key_id",
  "provider",
  "public_key",
  "source_id",
]);
const originNonceKeys = new Set(["expiresAtMilliseconds", "keyId", "nonceDigestHex"]);
const originNonceRowKeys = new Set(["consumed"]);
const submissionRowKeys = new Set(["accepted_entries", "outcome"]);
const runtimeBoundaryColumns = ["role_ok", "login_scope_ok", "search_path_ok"] as const;
const runtimeBoundaryColumnSet = new Set<string>(runtimeBoundaryColumns);
const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const snapshotUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sourceIdPattern = /^src_[A-Za-z0-9_-]{22}$/;
const digestHexPattern = /^[0-9a-f]{64}$/;

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
}

export interface CommunitySyncDatabase {
  consumeOriginNonce(input: unknown): Promise<boolean>;
  readDeviceVerificationMaterial(deviceId: string): Promise<DeviceVerificationMaterial | null>;
  submit(verifiedSubmission: unknown): Promise<CommunitySyncSubmissionResult>;
}

export interface ConfiguredCommunitySyncDatabase extends CommunitySyncDatabase {
  close(): Promise<void>;
}

export type SnapshotIdFactory = () => string;

interface ValidatedSubmission {
  readonly accountingRevision: typeof codexAccountingRevision;
  readonly bodyDigest: Buffer;
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly nonceDigest: Buffer;
  readonly payload: UsageSyncV1;
  readonly provider: typeof codexProvider;
  readonly requestTarget: typeof usageSyncRequestTarget;
  readonly signature: Buffer;
}

function readOriginNonceConsumption(value: unknown): IngestDatabaseOriginNonce {
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, originNonceKeys)) {
      fail("input_invalid");
    }
    const expiresAtMilliseconds = ownDataValue(value, "expiresAtMilliseconds", "input_invalid");
    const keyId = ownDataValue(value, "keyId", "input_invalid");
    const nonceDigest = decodeHex(ownDataValue(value, "nonceDigestHex", "input_invalid"));
    const expiresAt =
      typeof expiresAtMilliseconds === "number" ? new Date(expiresAtMilliseconds) : undefined;
    if (
      typeof expiresAtMilliseconds !== "number" ||
      !Number.isSafeInteger(expiresAtMilliseconds) ||
      expiresAtMilliseconds < 0 ||
      expiresAt === undefined ||
      !Number.isFinite(expiresAt.valueOf()) ||
      typeof keyId !== "string" ||
      !originKeyIdPattern.test(keyId) ||
      nonceDigest === undefined
    ) {
      fail("input_invalid");
    }
    return Object.freeze({
      expiresAt: expiresAt.toISOString(),
      nonceDigest,
      originKeyId: keyId,
    });
  } catch (error) {
    if (error instanceof CommunitySyncDatabaseError) {
      throw error;
    }
    fail("input_invalid");
  }
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
      reportedDate: ownDataValue(entry, "reportedDate", "input_invalid"),
    };
  });
  const candidate = {
    agentVersion: ownDataValue(value, "agentVersion", "input_invalid"),
    clientVersion: ownDataValue(value, "clientVersion", "input_invalid"),
    dailyEntries,
    observedAt: ownDataValue(value, "observedAt", "input_invalid"),
    schemaVersion: ownDataValue(value, "schemaVersion", "input_invalid"),
    sourceId: ownDataValue(value, "sourceId", "input_invalid"),
    syncId: ownDataValue(value, "syncId", "input_invalid"),
  };
  const validation = validateUsageSyncV1(candidate);
  if (!validation.ok) {
    fail("input_invalid");
  }
  return Object.freeze({
    agentVersion: validation.value.agentVersion,
    clientVersion: validation.value.clientVersion,
    dailyEntries: Object.freeze(
      validation.value.dailyEntries.map((entry) =>
        Object.freeze({
          dailyTokenTotal: entry.dailyTokenTotal,
          reportedDate: entry.reportedDate,
        }),
      ),
    ),
    observedAt: validation.value.observedAt,
    schemaVersion: 1,
    sourceId: validation.value.sourceId,
    syncId: validation.value.syncId,
  });
}

function decodeHex(value: unknown): Buffer | undefined {
  if (typeof value !== "string" || !digestHexPattern.test(value)) {
    return undefined;
  }
  return Buffer.from(value, "hex");
}

function readVerifiedSubmission(value: unknown): ValidatedSubmission {
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, verifiedSubmissionKeys)) {
      fail("input_invalid");
    }
    const accountingRevision = ownDataValue(value, "accountingRevision", "input_invalid");
    const bodyDigest = decodeHex(ownDataValue(value, "bodyDigestHex", "input_invalid"));
    const deviceId = ownDataValue(value, "deviceId", "input_invalid");
    const deviceKeyId = ownDataValue(value, "deviceKeyId", "input_invalid");
    const idempotencyKey = ownDataValue(value, "idempotencyKey", "input_invalid");
    const nonceDigest = decodeHex(ownDataValue(value, "nonceDigestHex", "input_invalid"));
    const provider = ownDataValue(value, "provider", "input_invalid");
    const requestTarget = ownDataValue(value, "requestTarget", "input_invalid");
    if (requestTarget !== usageSyncRequestTarget) {
      fail("input_invalid");
    }
    const payload = readUsagePayload(ownDataValue(value, "payload", "input_invalid"));
    const signatureValue = ownDataValue(value, "signatureBase64Url", "input_invalid");
    const signature =
      typeof signatureValue === "string"
        ? decodeCanonicalBase64Url(signatureValue, deviceSignatureBytes)
        : undefined;
    if (
      accountingRevision !== codexAccountingRevision ||
      bodyDigest === undefined ||
      typeof deviceId !== "string" ||
      !deviceIdPattern.test(deviceId) ||
      typeof deviceKeyId !== "string" ||
      !canonicalUuidPattern.test(deviceKeyId) ||
      typeof idempotencyKey !== "string" ||
      !idempotencyKeyPattern.test(idempotencyKey) ||
      idempotencyKey !== payload.syncId ||
      nonceDigest === undefined ||
      provider !== codexProvider ||
      signature === undefined
    ) {
      fail("input_invalid");
    }
    return Object.freeze({
      accountingRevision,
      bodyDigest,
      deviceId,
      deviceKeyId,
      nonceDigest,
      payload,
      provider,
      requestTarget,
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

function readDeviceResult(value: unknown): DeviceVerificationMaterial | null {
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
    const deviceKeyId = ownDataValue(row, "device_key_id", "result_invalid");
    const provider = ownDataValue(row, "provider", "result_invalid");
    const publicKey = copyExactBytes(
      ownDataValue(row, "public_key", "result_invalid"),
      devicePublicKeyBytes,
    );
    const sourceId = ownDataValue(row, "source_id", "result_invalid");
    if (
      accountingRevision !== codexAccountingRevision ||
      typeof deviceKeyId !== "string" ||
      !canonicalUuidPattern.test(deviceKeyId) ||
      provider !== codexProvider ||
      publicKey === undefined ||
      typeof sourceId !== "string" ||
      !sourceIdPattern.test(sourceId)
    ) {
      fail("result_invalid");
    }
    return Object.freeze({
      accountingRevision,
      deviceKeyId,
      provider,
      publicKey,
      sourceId,
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
  expectedEntries: number,
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
    if (
      typeof acceptedEntries !== "number" ||
      !Number.isSafeInteger(acceptedEntries) ||
      (outcome === "accepted" && acceptedEntries !== expectedEntries) ||
      ((outcome === "duplicate" || outcome === "quarantined") && acceptedEntries !== 0) ||
      (outcome !== "accepted" && outcome !== "duplicate" && outcome !== "quarantined")
    ) {
      fail("result_invalid");
    }
    return Object.freeze({ acceptedEntries, outcome });
  } catch (error) {
    if (error instanceof CommunitySyncDatabaseError) {
      throw error;
    }
    fail("result_invalid");
  }
}

function readOriginNonceResult(value: unknown): boolean {
  try {
    if (!validArrayShape(value, 1)) {
      fail("result_invalid");
    }
    const row = ownDataValue(value, "0", "result_invalid");
    if (!isPlainRecord(row) || !hasExactKeys(row, originNonceRowKeys)) {
      fail("result_invalid");
    }
    const consumed = ownDataValue(row, "consumed", "result_invalid");
    if (typeof consumed !== "boolean") {
      fail("result_invalid");
    }
    return consumed;
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

function createSnapshotId(factory: SnapshotIdFactory): string {
  let value: unknown;
  try {
    value = factory();
  } catch {
    fail("identifier_unavailable");
  }
  if (typeof value !== "string" || !snapshotUuidPattern.test(value)) {
    fail("identifier_unavailable");
  }
  return value;
}

function toDatabaseSubmission(
  submission: ValidatedSubmission,
  snapshotId: string,
): IngestDatabaseUsageSubmission {
  const payload = submission.payload;
  return Object.freeze({
    accountingRevision: submission.accountingRevision,
    agentVersion: payload.agentVersion,
    bodyDigest: Buffer.from(submission.bodyDigest),
    clientVersion: payload.clientVersion,
    dailyTokenTotals: Object.freeze(payload.dailyEntries.map((entry) => entry.dailyTokenTotal)),
    deviceId: submission.deviceId,
    deviceKeyId: submission.deviceKeyId,
    nonceDigest: Buffer.from(submission.nonceDigest),
    observedAt: payload.observedAt,
    provider: submission.provider,
    reportedDates: Object.freeze(payload.dailyEntries.map((entry) => entry.reportedDate)),
    signature: Buffer.from(submission.signature),
    snapshotId,
    sourceId: payload.sourceId,
    syncId: payload.syncId,
  });
}

export function createCommunitySyncDatabase(
  pool: IngestDatabasePool,
  snapshotIdFactory: SnapshotIdFactory = randomUUID,
): CommunitySyncDatabase {
  return Object.freeze({
    async consumeOriginNonce(value: unknown): Promise<boolean> {
      const input = readOriginNonceConsumption(value);
      return withClient(pool, async (client) =>
        readOriginNonceResult(await client.consumeOriginNonce(input)),
      );
    },
    async readDeviceVerificationMaterial(
      deviceId: string,
    ): Promise<DeviceVerificationMaterial | null> {
      if (typeof deviceId !== "string" || !deviceIdPattern.test(deviceId)) {
        fail("input_invalid");
      }
      return withClient(pool, async (client) =>
        readDeviceResult(await client.readDeviceVerificationMaterial(deviceId)),
      );
    },
    async submit(value: unknown): Promise<CommunitySyncSubmissionResult> {
      const submission = readVerifiedSubmission(value);
      const snapshotId = createSnapshotId(snapshotIdFactory);
      const databaseSubmission = toDatabaseSubmission(submission, snapshotId);
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
  snapshotIdFactory: SnapshotIdFactory = randomUUID,
): ConfiguredCommunitySyncDatabase {
  const database = createCommunitySyncDatabase(pool, snapshotIdFactory);
  return Object.freeze({
    async close(): Promise<void> {
      try {
        await pool.close();
      } catch {
        fail("pool_close_failed");
      }
    },
    consumeOriginNonce: (input: OriginNonceConsumption) => database.consumeOriginNonce(input),
    readDeviceVerificationMaterial: (deviceId: string) =>
      database.readDeviceVerificationMaterial(deviceId),
    submit: (submission: unknown) => database.submit(submission),
  });
}

export function createConfiguredCommunitySyncDatabase(
  environment?: Readonly<Record<string, string | undefined>>,
  signalSink?: IngestDatabasePoolSignalSink,
  snapshotIdFactory: SnapshotIdFactory = randomUUID,
): ConfiguredCommunitySyncDatabase {
  const config =
    environment === undefined
      ? resolveIngestDatabaseConfig()
      : resolveIngestDatabaseConfig(environment);
  const pool = createIngestDatabasePool(config, signalSink);
  return createCloseableCommunitySyncDatabase(pool, snapshotIdFactory);
}
