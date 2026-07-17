import "server-only";

import { Buffer } from "node:buffer";

import { resolvePairingDatabaseConfig } from "./pairing-database-config";
import {
  createPairingDatabasePool,
  type PairingDatabaseClient,
  type PairingDatabasePool,
  type PairingDatabasePoolSignalSink,
} from "./pairing-database-pool";
import {
  pairingChallengeBytes,
  pairingIdPattern,
  pairingPublicKeyBytes,
} from "./pairing-possession-verifier";
import { pairingPollVerifierDigestBytes } from "./pairing-poll-verifier";
import { pairingUserCodeVerifierDigestBytes } from "./pairing-user-code-verifier";

const attemptKeys = new Set([
  "architecture",
  "clientIdentityDigest",
  "connectorVersion",
  "deviceKeyId",
  "deviceLabel",
  "expiresAt",
  "osFamily",
  "pairingChallenge",
  "pairingId",
  "pollVerifierDigest",
  "publicKey",
  "rateBucketLimit",
  "rateGlobalLimit",
  "rateWindowSeconds",
  "userCodeDigest",
]);
const admissionRowKeys = new Set(["admitted"]);
const resultRowKeys = new Set(["started"]);
const runtimeBoundaryColumns = [
  "role_ok",
  "login_scope_ok",
  "search_path_ok",
  "read_write_ok",
] as const;
const runtimeBoundaryColumnSet = new Set<string>(runtimeBoundaryColumns);
const semanticVersionPattern =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const unsafeLabelPattern = /[\p{Cc}\p{Cf}\p{Cs}]/u;
const osFamilies = new Set(["linux", "macos", "windows"]);
const architectures = new Set(["aarch64", "x86_64"]);
const maximumDeviceLabelCodeUnits = 128;

export type PairingStartDatabaseErrorCode =
  | "connection_release_failed"
  | "connection_unavailable"
  | "input_invalid"
  | "pool_close_failed"
  | "query_failed"
  | "result_invalid"
  | "runtime_boundary_mismatch";

export type PairingStartDatabasePoolSignalSink = PairingDatabasePoolSignalSink;

export class PairingStartDatabaseError extends Error {
  readonly code: PairingStartDatabaseErrorCode;

  constructor(code: PairingStartDatabaseErrorCode) {
    super("Pairing start is unavailable.");
    this.name = "PairingStartDatabaseError";
    this.code = code;
  }
}

export interface PairingStartDatabaseAttempt {
  readonly architecture: string;
  readonly clientIdentityDigest: Uint8Array;
  readonly connectorVersion: string;
  readonly deviceKeyId: string;
  readonly deviceLabel: string;
  readonly expiresAt: string;
  readonly osFamily: string;
  readonly pairingChallenge: Uint8Array;
  readonly pairingId: string;
  readonly pollVerifierDigest: Uint8Array;
  readonly publicKey: Uint8Array;
  readonly rateBucketLimit: number;
  readonly rateGlobalLimit: number;
  readonly rateWindowSeconds: number;
  readonly userCodeDigest: Uint8Array;
}

export type PairingStartDatabaseResult = "created" | "rate_limited";

export interface PairingStartDatabase {
  start(attempt: unknown): Promise<PairingStartDatabaseResult>;
}

export interface ConfiguredPairingStartDatabase extends PairingStartDatabase {
  close(): Promise<void>;
}

interface ValidatedAttempt extends Omit<
  PairingStartDatabaseAttempt,
  | "clientIdentityDigest"
  | "pairingChallenge"
  | "pollVerifierDigest"
  | "publicKey"
  | "userCodeDigest"
> {
  readonly clientIdentityDigest: Buffer;
  readonly pairingChallenge: Buffer;
  readonly pollVerifierDigest: Buffer;
  readonly publicKey: Buffer;
  readonly userCodeDigest: Buffer;
}

function fail(code: PairingStartDatabaseErrorCode): never {
  throw new PairingStartDatabaseError(code);
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

function ownDataValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor && descriptor.enumerable
    ? (descriptor.value as unknown)
    : undefined;
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

function validLabel(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumDeviceLabelCodeUnits ||
    value !== value.trim() ||
    value !== value.normalize("NFC") ||
    unsafeLabelPattern.test(value)
  ) {
    return false;
  }
  const codePoints = Array.from(value).length;
  return codePoints >= 1 && codePoints <= 64;
}

function validVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 5 &&
    value.length <= 64 &&
    semanticVersionPattern.test(value)
  );
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !isoTimestampPattern.test(value)) {
    return false;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function nonzero(value: Buffer): boolean {
  let combined = 0;
  for (const byte of value) {
    combined |= byte;
  }
  return combined !== 0;
}

function clearAttempt(attempt: ValidatedAttempt | undefined): void {
  attempt?.clientIdentityDigest.fill(0);
  attempt?.pairingChallenge.fill(0);
  attempt?.pollVerifierDigest.fill(0);
  attempt?.publicKey.fill(0);
  attempt?.userCodeDigest.fill(0);
}

function readAttempt(value: unknown): ValidatedAttempt {
  let clientIdentityDigest: Buffer | undefined;
  let pairingChallenge: Buffer | undefined;
  let pollVerifierDigest: Buffer | undefined;
  let publicKey: Buffer | undefined;
  let userCodeDigest: Buffer | undefined;
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, attemptKeys)) {
      fail("input_invalid");
    }
    const architecture = ownDataValue(value, "architecture");
    clientIdentityDigest = copyExactBytes(ownDataValue(value, "clientIdentityDigest"), 32);
    const connectorVersion = ownDataValue(value, "connectorVersion");
    const deviceKeyId = ownDataValue(value, "deviceKeyId");
    const deviceLabel = ownDataValue(value, "deviceLabel");
    const expiresAt = ownDataValue(value, "expiresAt");
    const osFamily = ownDataValue(value, "osFamily");
    pairingChallenge = copyExactBytes(
      ownDataValue(value, "pairingChallenge"),
      pairingChallengeBytes,
    );
    const pairingId = ownDataValue(value, "pairingId");
    pollVerifierDigest = copyExactBytes(
      ownDataValue(value, "pollVerifierDigest"),
      pairingPollVerifierDigestBytes,
    );
    publicKey = copyExactBytes(ownDataValue(value, "publicKey"), pairingPublicKeyBytes);
    const rateBucketLimit = ownDataValue(value, "rateBucketLimit");
    const rateGlobalLimit = ownDataValue(value, "rateGlobalLimit");
    const rateWindowSeconds = ownDataValue(value, "rateWindowSeconds");
    userCodeDigest = copyExactBytes(
      ownDataValue(value, "userCodeDigest"),
      pairingUserCodeVerifierDigestBytes,
    );
    if (
      typeof architecture !== "string" ||
      !architectures.has(architecture) ||
      clientIdentityDigest === undefined ||
      !validVersion(connectorVersion) ||
      typeof deviceKeyId !== "string" ||
      !pairingIdPattern.test(deviceKeyId) ||
      !validLabel(deviceLabel) ||
      !validTimestamp(expiresAt) ||
      typeof osFamily !== "string" ||
      !osFamilies.has(osFamily) ||
      pairingChallenge === undefined ||
      typeof pairingId !== "string" ||
      !pairingIdPattern.test(pairingId) ||
      pollVerifierDigest === undefined ||
      publicKey === undefined ||
      !nonzero(publicKey) ||
      !Number.isSafeInteger(rateBucketLimit) ||
      typeof rateBucketLimit !== "number" ||
      rateBucketLimit < 1 ||
      !Number.isSafeInteger(rateGlobalLimit) ||
      typeof rateGlobalLimit !== "number" ||
      rateGlobalLimit < rateBucketLimit ||
      rateGlobalLimit > 1_000_000 ||
      !Number.isSafeInteger(rateWindowSeconds) ||
      typeof rateWindowSeconds !== "number" ||
      rateWindowSeconds < 1 ||
      rateWindowSeconds > 3_600 ||
      userCodeDigest === undefined
    ) {
      fail("input_invalid");
    }
    return Object.freeze({
      architecture,
      clientIdentityDigest,
      connectorVersion,
      deviceKeyId,
      deviceLabel,
      expiresAt,
      osFamily,
      pairingChallenge,
      pairingId,
      pollVerifierDigest,
      publicKey,
      rateBucketLimit,
      rateGlobalLimit,
      rateWindowSeconds,
      userCodeDigest,
    });
  } catch (error) {
    clientIdentityDigest?.fill(0);
    pairingChallenge?.fill(0);
    pollVerifierDigest?.fill(0);
    publicKey?.fill(0);
    userCodeDigest?.fill(0);
    if (error instanceof PairingStartDatabaseError) {
      throw error;
    }
    fail("input_invalid");
  }
}

function readAdmissionResult(value: unknown): boolean {
  try {
    if (!validSingleRowArray(value)) {
      fail("result_invalid");
    }
    const row = ownDataValue(value, "0");
    if (!isPlainRecord(row) || !hasExactKeys(row, admissionRowKeys)) {
      fail("result_invalid");
    }
    const admitted = ownDataValue(row, "admitted");
    if (typeof admitted !== "boolean") {
      fail("result_invalid");
    }
    return admitted;
  } catch (error) {
    if (error instanceof PairingStartDatabaseError) {
      throw error;
    }
    return fail("result_invalid");
  }
}

function validSingleRowArray(value: unknown): value is unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length !== 1
  ) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  return keys.length === 2 && keys.includes("0") && keys.includes("length");
}

function validRuntimeBoundary(value: unknown): boolean {
  try {
    if (!validSingleRowArray(value)) {
      return false;
    }
    const row = ownDataValue(value, "0");
    if (!isPlainRecord(row) || !hasExactKeys(row, runtimeBoundaryColumnSet)) {
      return false;
    }
    return runtimeBoundaryColumns.every((column) => ownDataValue(row, column) === true);
  } catch {
    return false;
  }
}

function validStartResult(value: unknown): boolean {
  try {
    if (!validSingleRowArray(value)) {
      return false;
    }
    const row = ownDataValue(value, "0");
    return (
      isPlainRecord(row) &&
      hasExactKeys(row, resultRowKeys) &&
      ownDataValue(row, "started") === true
    );
  } catch {
    return false;
  }
}

function releaseClient(client: PairingDatabaseClient, destroy: boolean): void {
  try {
    client.release(destroy);
  } catch {
    fail("connection_release_failed");
  }
}

export function createPairingStartDatabase(pool: PairingDatabasePool): PairingStartDatabase {
  return Object.freeze({
    async start(attemptInput: unknown): Promise<PairingStartDatabaseResult> {
      const attempt = readAttempt(attemptInput);
      let client: PairingDatabaseClient;
      try {
        client = await pool.connect();
      } catch {
        clearAttempt(attempt);
        fail("connection_unavailable");
      }

      let destroyClient = true;
      let pendingError: PairingStartDatabaseErrorCode | undefined;
      let result: PairingStartDatabaseResult = "rate_limited";
      try {
        if (!validRuntimeBoundary(await client.verifyRuntimeBoundary())) {
          fail("runtime_boundary_mismatch");
        }
        if (typeof client.admitPairingTransportRequest !== "function") {
          fail("runtime_boundary_mismatch");
        }
        const admitted = readAdmissionResult(
          await client.admitPairingTransportRequest({
            bucketLimit: attempt.rateBucketLimit,
            clientIdentityDigest: attempt.clientIdentityDigest,
            globalLimit: attempt.rateGlobalLimit,
            operation: "start",
            windowSeconds: attempt.rateWindowSeconds,
          }),
        );
        if (!admitted) {
          destroyClient = false;
          result = "rate_limited";
        } else {
          if (
            !validStartResult(
              await client.startPairing({
                architecture: attempt.architecture,
                connectorVersion: attempt.connectorVersion,
                deviceKeyId: attempt.deviceKeyId,
                deviceLabel: attempt.deviceLabel,
                expiresAt: attempt.expiresAt,
                osFamily: attempt.osFamily,
                pairingChallenge: attempt.pairingChallenge,
                pairingId: attempt.pairingId,
                pollVerifierDigest: attempt.pollVerifierDigest,
                publicKey: attempt.publicKey,
                userCodeDigest: attempt.userCodeDigest,
              }),
            )
          ) {
            fail("result_invalid");
          }
          result = "created";
          destroyClient = false;
        }
      } catch (error) {
        pendingError = error instanceof PairingStartDatabaseError ? error.code : "query_failed";
      } finally {
        clearAttempt(attempt);
      }

      releaseClient(client, destroyClient);
      if (pendingError !== undefined) {
        fail(pendingError);
      }
      return result;
    },
  });
}

export function createCloseablePairingStartDatabase(
  pool: PairingDatabasePool,
): ConfiguredPairingStartDatabase {
  const database = createPairingStartDatabase(pool);
  return Object.freeze({
    async close(): Promise<void> {
      try {
        await pool.close();
      } catch {
        fail("pool_close_failed");
      }
    },
    start: database.start.bind(database),
  });
}

export function createConfiguredPairingStartDatabase(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  signalSink?: PairingDatabasePoolSignalSink,
): ConfiguredPairingStartDatabase {
  const pool = createPairingDatabasePool(resolvePairingDatabaseConfig(environment), signalSink);
  return createCloseablePairingStartDatabase(pool);
}
