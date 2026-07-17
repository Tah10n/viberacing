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
  pairingSignatureBytes,
  verifyPairingPossession,
} from "./pairing-possession-verifier";
import { pairingPollVerifierDigestBytes } from "./pairing-poll-verifier";

const attemptKeys = new Set([
  "allowActivation",
  "auditEventId",
  "clientIdentityDigest",
  "deviceId",
  "pollVerifierDigests",
  "rateBucketLimit",
  "rateGlobalLimit",
  "rateWindowSeconds",
  "requestId",
  "secondaryCandidateActive",
  "signatureBase64Url",
]);
const materialRowKeys = new Set([
  "candidate_index",
  "pairing_challenge",
  "pairing_id",
  "public_key",
]);
const admissionRowKeys = new Set(["admitted"]);
const activationRowKeys = new Set(["activated"]);
const statusRowKeys = new Set(["candidate_index", "device_id", "pairing_state", "source_id"]);
const runtimeBoundaryColumns = [
  "role_ok",
  "login_scope_ok",
  "search_path_ok",
  "read_write_ok",
] as const;
const runtimeBoundaryColumnSet = new Set<string>(runtimeBoundaryColumns);
const auditEventIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const deviceIdPattern = /^dev_[A-Za-z0-9_-]{22}$/;
const requestIdPattern = /^req_[A-Za-z0-9_-]{22}$/;
const sourceIdPattern = /^src_[A-Za-z0-9_-]{22}$/;
const signaturePattern = /^[A-Za-z0-9_-]+$/;
const dummyPairingId = "00000000-0000-4000-8000-000000000000";

export type PairingActivationDatabaseErrorCode =
  | "connection_release_failed"
  | "connection_unavailable"
  | "input_invalid"
  | "pool_close_failed"
  | "query_failed"
  | "result_invalid"
  | "runtime_boundary_mismatch";

export type PairingActivationDatabasePoolSignalSink = PairingDatabasePoolSignalSink;

export class PairingActivationDatabaseError extends Error {
  readonly code: PairingActivationDatabaseErrorCode;

  constructor(code: PairingActivationDatabaseErrorCode) {
    super("Pairing activation is unavailable.");
    this.name = "PairingActivationDatabaseError";
    this.code = code;
  }
}

export interface PairingActivationDatabaseAttempt {
  readonly allowActivation: boolean;
  readonly auditEventId: string;
  readonly clientIdentityDigest: Uint8Array;
  readonly deviceId: string;
  readonly pollVerifierDigests: readonly [Uint8Array, Uint8Array];
  readonly rateBucketLimit: number;
  readonly rateGlobalLimit: number;
  readonly rateWindowSeconds: number;
  readonly requestId: string;
  readonly secondaryCandidateActive: boolean;
  readonly signatureBase64Url: string;
}

export interface PairingActivationDatabase {
  activate(attempt: unknown): Promise<PairingActivationDatabaseResult>;
}

export type PairingActivationDatabaseResult =
  | Readonly<{
      deviceId: string;
      outcome: "activated";
      sourceId: string;
    }>
  | Readonly<{ outcome: "pending" | "rate_limited" }>;

export interface ConfiguredPairingActivationDatabase extends PairingActivationDatabase {
  close(): Promise<void>;
}

interface ValidatedAttempt extends Omit<
  PairingActivationDatabaseAttempt,
  "clientIdentityDigest" | "pollVerifierDigests"
> {
  readonly clientIdentityDigest: Buffer;
  readonly pollVerifierDigests: readonly [Buffer, Buffer];
}

interface PairingVerificationMaterial {
  readonly candidateIndex: 1 | 2;
  readonly pairingChallenge: Buffer;
  readonly pairingId: string;
  readonly publicKey: Buffer;
}

interface PairingStatus {
  readonly candidateIndex: 1 | 2;
  readonly deviceId?: string;
  readonly pairingState: "activated" | "approved" | "cancelled" | "pending";
  readonly sourceId?: string;
}

function fail(code: PairingActivationDatabaseErrorCode): never {
  throw new PairingActivationDatabaseError(code);
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

function validCanonicalSignature(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length !== Math.ceil((pairingSignatureBytes * 8) / 6) ||
    !signaturePattern.test(value)
  ) {
    return false;
  }
  const decoded = Buffer.from(value, "base64url");
  try {
    return decoded.length === pairingSignatureBytes && decoded.toString("base64url") === value;
  } finally {
    decoded.fill(0);
  }
}

function copyDigestTuple(value: unknown): readonly [Buffer, Buffer] | undefined {
  let first: Buffer | undefined;
  let second: Buffer | undefined;
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length !== 2
    ) {
      return undefined;
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== 3 ||
      !keys.includes("0") ||
      !keys.includes("1") ||
      !keys.includes("length")
    ) {
      return undefined;
    }
    first = copyExactBytes(ownDataValue(value, "0"), pairingPollVerifierDigestBytes);
    second = copyExactBytes(ownDataValue(value, "1"), pairingPollVerifierDigestBytes);
    if (first === undefined || second === undefined) {
      first?.fill(0);
      second?.fill(0);
      return undefined;
    }
    const result: [Buffer, Buffer] = [first, second];
    return Object.freeze(result);
  } catch {
    first?.fill(0);
    second?.fill(0);
    return undefined;
  }
}

function readAttempt(value: unknown): ValidatedAttempt {
  let clientIdentityDigest: Buffer | undefined;
  let digests: readonly [Buffer, Buffer] | undefined;
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, attemptKeys)) {
      fail("input_invalid");
    }
    const allowActivation = ownDataValue(value, "allowActivation");
    const auditEventId = ownDataValue(value, "auditEventId");
    clientIdentityDigest = copyExactBytes(ownDataValue(value, "clientIdentityDigest"), 32);
    const deviceId = ownDataValue(value, "deviceId");
    digests = copyDigestTuple(ownDataValue(value, "pollVerifierDigests"));
    const rateBucketLimit = ownDataValue(value, "rateBucketLimit");
    const rateGlobalLimit = ownDataValue(value, "rateGlobalLimit");
    const rateWindowSeconds = ownDataValue(value, "rateWindowSeconds");
    const requestId = ownDataValue(value, "requestId");
    const secondaryCandidateActive = ownDataValue(value, "secondaryCandidateActive");
    const signatureBase64Url = ownDataValue(value, "signatureBase64Url");
    if (
      typeof allowActivation !== "boolean" ||
      typeof auditEventId !== "string" ||
      !auditEventIdPattern.test(auditEventId) ||
      clientIdentityDigest === undefined ||
      typeof deviceId !== "string" ||
      !deviceIdPattern.test(deviceId) ||
      digests === undefined ||
      typeof rateBucketLimit !== "number" ||
      !Number.isSafeInteger(rateBucketLimit) ||
      rateBucketLimit < 1 ||
      typeof rateGlobalLimit !== "number" ||
      !Number.isSafeInteger(rateGlobalLimit) ||
      rateGlobalLimit < rateBucketLimit ||
      rateGlobalLimit > 1_000_000 ||
      typeof rateWindowSeconds !== "number" ||
      !Number.isSafeInteger(rateWindowSeconds) ||
      rateWindowSeconds < 1 ||
      rateWindowSeconds > 3_600 ||
      typeof requestId !== "string" ||
      !requestIdPattern.test(requestId) ||
      typeof secondaryCandidateActive !== "boolean" ||
      !validCanonicalSignature(signatureBase64Url)
    ) {
      fail("input_invalid");
    }
    return Object.freeze({
      allowActivation,
      auditEventId,
      clientIdentityDigest,
      deviceId,
      pollVerifierDigests: digests,
      rateBucketLimit,
      rateGlobalLimit,
      rateWindowSeconds,
      requestId,
      secondaryCandidateActive,
      signatureBase64Url,
    });
  } catch (error) {
    clientIdentityDigest?.fill(0);
    if (error instanceof PairingActivationDatabaseError) {
      digests?.[0].fill(0);
      digests?.[1].fill(0);
      throw error;
    }
    digests?.[0].fill(0);
    digests?.[1].fill(0);
    fail("input_invalid");
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
    if (error instanceof PairingActivationDatabaseError) {
      throw error;
    }
    fail("result_invalid");
  }
}

function readPairingStatus(
  value: unknown,
  secondaryCandidateActive: boolean,
): PairingStatus | undefined {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      fail("result_invalid");
    }
    const keys = Reflect.ownKeys(value);
    if (
      value.length > 1 ||
      keys.length !== value.length + 1 ||
      !keys.includes("length") ||
      (value.length === 1 && !keys.includes("0"))
    ) {
      fail("result_invalid");
    }
    if (value.length === 0) {
      return undefined;
    }
    const row = ownDataValue(value, "0");
    if (!isPlainRecord(row) || !hasExactKeys(row, statusRowKeys)) {
      fail("result_invalid");
    }
    const candidateIndex = ownDataValue(row, "candidate_index");
    const deviceId = ownDataValue(row, "device_id");
    const pairingState = ownDataValue(row, "pairing_state");
    const sourceId = ownDataValue(row, "source_id");
    if (
      (candidateIndex !== 1 && candidateIndex !== 2) ||
      (candidateIndex === 2 && !secondaryCandidateActive) ||
      (pairingState !== "activated" &&
        pairingState !== "approved" &&
        pairingState !== "cancelled" &&
        pairingState !== "pending")
    ) {
      fail("result_invalid");
    }
    if (pairingState === "activated") {
      if (
        typeof deviceId !== "string" ||
        !deviceIdPattern.test(deviceId) ||
        typeof sourceId !== "string" ||
        !sourceIdPattern.test(sourceId)
      ) {
        fail("result_invalid");
      }
      return Object.freeze({ candidateIndex, deviceId, pairingState, sourceId });
    }
    if (deviceId !== null || sourceId !== null) {
      fail("result_invalid");
    }
    return Object.freeze({ candidateIndex, pairingState });
  } catch (error) {
    if (error instanceof PairingActivationDatabaseError) {
      throw error;
    }
    fail("result_invalid");
  }
}

function readVerificationMaterial(
  value: unknown,
  secondaryCandidateActive: boolean,
): PairingVerificationMaterial | undefined {
  let pairingChallenge: Buffer | undefined;
  let publicKey: Buffer | undefined;
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      fail("result_invalid");
    }
    const keys = Reflect.ownKeys(value);
    if (
      value.length > 1 ||
      keys.length !== value.length + 1 ||
      !keys.includes("length") ||
      (value.length === 1 && !keys.includes("0"))
    ) {
      fail("result_invalid");
    }
    if (value.length === 0) {
      return undefined;
    }
    const row = ownDataValue(value, "0");
    if (!isPlainRecord(row) || !hasExactKeys(row, materialRowKeys)) {
      fail("result_invalid");
    }
    const candidateIndex = ownDataValue(row, "candidate_index");
    const pairingId = ownDataValue(row, "pairing_id");
    pairingChallenge = copyExactBytes(
      ownDataValue(row, "pairing_challenge"),
      pairingChallengeBytes,
    );
    publicKey = copyExactBytes(ownDataValue(row, "public_key"), pairingPublicKeyBytes);
    if (
      (candidateIndex !== 1 && candidateIndex !== 2) ||
      (candidateIndex === 2 && !secondaryCandidateActive) ||
      typeof pairingId !== "string" ||
      !pairingIdPattern.test(pairingId) ||
      pairingChallenge === undefined ||
      publicKey === undefined
    ) {
      fail("result_invalid");
    }
    return Object.freeze({ candidateIndex, pairingChallenge, pairingId, publicKey });
  } catch (error) {
    pairingChallenge?.fill(0);
    publicKey?.fill(0);
    if (error instanceof PairingActivationDatabaseError) {
      throw error;
    }
    fail("result_invalid");
  }
}

function validActivationResult(value: unknown): boolean {
  try {
    if (!validSingleRowArray(value)) {
      return false;
    }
    const row = ownDataValue(value, "0");
    return (
      isPlainRecord(row) &&
      hasExactKeys(row, activationRowKeys) &&
      ownDataValue(row, "activated") === true
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

function clearAttempt(attempt: ValidatedAttempt): void {
  attempt.clientIdentityDigest.fill(0);
  attempt.pollVerifierDigests[0].fill(0);
  attempt.pollVerifierDigests[1].fill(0);
}

function clearMaterial(material: PairingVerificationMaterial | undefined): void {
  material?.pairingChallenge.fill(0);
  material?.publicKey.fill(0);
}

function activatedResult(
  status: PairingStatus | undefined,
): PairingActivationDatabaseResult | undefined {
  return status?.pairingState === "activated" &&
    status.deviceId !== undefined &&
    status.sourceId !== undefined
    ? Object.freeze({
        deviceId: status.deviceId,
        outcome: "activated" as const,
        sourceId: status.sourceId,
      })
    : undefined;
}

function pendingResult(): PairingActivationDatabaseResult {
  return Object.freeze({ outcome: "pending" as const });
}

function rateLimitedResult(): PairingActivationDatabaseResult {
  return Object.freeze({ outcome: "rate_limited" as const });
}

export function createPairingActivationDatabase(
  pool: PairingDatabasePool,
): PairingActivationDatabase {
  return Object.freeze({
    async activate(attemptInput: unknown): Promise<PairingActivationDatabaseResult> {
      const attempt = readAttempt(attemptInput);
      let client: PairingDatabaseClient;
      try {
        client = await pool.connect();
      } catch {
        clearAttempt(attempt);
        fail("connection_unavailable");
      }

      let destroyClient = true;
      let material: PairingVerificationMaterial | undefined;
      let pendingError: PairingActivationDatabaseErrorCode | undefined;
      let decision: PairingActivationDatabaseResult = pendingResult();
      const dummyChallenge = Buffer.alloc(pairingChallengeBytes);
      const dummyPublicKey = Buffer.alloc(pairingPublicKeyBytes);
      try {
        const runtimeBoundary = await client.verifyRuntimeBoundary();
        if (!validRuntimeBoundary(runtimeBoundary)) {
          fail("runtime_boundary_mismatch");
        }
        if (
          typeof client.admitPairingTransportRequest !== "function" ||
          typeof client.pollPairingStatus !== "function"
        ) {
          fail("runtime_boundary_mismatch");
        }
        const admitted = readAdmissionResult(
          await client.admitPairingTransportRequest({
            bucketLimit: attempt.rateBucketLimit,
            clientIdentityDigest: attempt.clientIdentityDigest,
            globalLimit: attempt.rateGlobalLimit,
            operation: "poll",
            windowSeconds: attempt.rateWindowSeconds,
          }),
        );
        if (!admitted) {
          decision = rateLimitedResult();
        } else {
          material = readVerificationMaterial(
            await client.readVerificationMaterial(attempt.pollVerifierDigests),
            attempt.secondaryCandidateActive,
          );
          const proofMaterial =
            material === undefined
              ? {
                  pairingChallenge: dummyChallenge,
                  pairingId: dummyPairingId,
                  publicKey: dummyPublicKey,
                }
              : {
                  pairingChallenge: material.pairingChallenge,
                  pairingId: material.pairingId,
                  publicKey: material.publicKey,
                };
          const proofValid = await verifyPairingPossession(
            proofMaterial,
            attempt.signatureBase64Url,
          );
          if (attempt.allowActivation && material !== undefined && proofValid) {
            const existingStatus = readPairingStatus(
              await client.pollPairingStatus(attempt.pollVerifierDigests),
              attempt.secondaryCandidateActive,
            );
            if (
              existingStatus !== undefined &&
              existingStatus.candidateIndex !== material.candidateIndex
            ) {
              fail("result_invalid");
            }
            const existingActivation = activatedResult(existingStatus);
            if (existingActivation !== undefined) {
              decision = existingActivation;
            } else if (existingStatus?.pairingState === "approved") {
              const digest =
                material.candidateIndex === 1
                  ? attempt.pollVerifierDigests[0]
                  : attempt.pollVerifierDigests[1];
              let activationError: unknown;
              try {
                const result = await client.activatePairing({
                  auditEventId: attempt.auditEventId,
                  deviceId: attempt.deviceId,
                  pairingId: material.pairingId,
                  pollVerifierDigest: digest,
                  requestId: attempt.requestId,
                });
                if (!validActivationResult(result)) {
                  fail("result_invalid");
                }
              } catch (error) {
                activationError = error;
              }
              const finalStatus = readPairingStatus(
                await client.pollPairingStatus(attempt.pollVerifierDigests),
                attempt.secondaryCandidateActive,
              );
              if (
                finalStatus !== undefined &&
                finalStatus.candidateIndex !== material.candidateIndex
              ) {
                fail("result_invalid");
              }
              const finalActivation = activatedResult(finalStatus);
              if (finalActivation === undefined) {
                if (activationError instanceof PairingActivationDatabaseError) {
                  throw activationError;
                }
                if (activationError !== undefined) {
                  fail("query_failed");
                }
                fail("result_invalid");
              }
              decision = finalActivation;
            }
          }
        }
        destroyClient = false;
      } catch (error) {
        pendingError =
          error instanceof PairingActivationDatabaseError ? error.code : "query_failed";
      } finally {
        clearAttempt(attempt);
        clearMaterial(material);
        dummyChallenge.fill(0);
        dummyPublicKey.fill(0);
      }

      releaseClient(client, destroyClient);
      if (pendingError !== undefined) {
        fail(pendingError);
      }
      return decision;
    },
  });
}

export function createCloseablePairingActivationDatabase(
  pool: PairingDatabasePool,
): ConfiguredPairingActivationDatabase {
  const database = createPairingActivationDatabase(pool);
  return Object.freeze({
    activate: database.activate.bind(database),
    async close(): Promise<void> {
      try {
        await pool.close();
      } catch {
        fail("pool_close_failed");
      }
    },
  });
}

export function createConfiguredPairingActivationDatabase(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  signalSink?: PairingDatabasePoolSignalSink,
): ConfiguredPairingActivationDatabase {
  const pool = createPairingDatabasePool(resolvePairingDatabaseConfig(environment), signalSink);
  return createCloseablePairingActivationDatabase(pool);
}
