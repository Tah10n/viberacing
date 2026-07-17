import "server-only";

import { Buffer } from "node:buffer";

import {
  createPairingStartAdmission,
  type PairingStartAdmission,
  type PairingStartAdmissionLease,
} from "./pairing-start-admission";
import {
  createConfiguredPairingStartDatabase,
  type ConfiguredPairingStartDatabase,
  type PairingStartDatabase,
  type PairingStartDatabaseAttempt,
  type PairingStartDatabasePoolSignalSink,
} from "./pairing-start-database";
import { createPairingStartMaterial, type PairingStartMaterial } from "./pairing-start-material";
import { createPairingStartTiming, type PairingStartTiming } from "./pairing-start-timing";
import {
  derivePairingClientIdentity,
  resolvePairingRatePolicy,
  type PairingRateLimits,
  type PairingRatePolicy,
} from "./pairing-rate-policy";
import { pairingPublicKeyBytes } from "./pairing-possession-verifier";
import {
  createConfiguredPairingPollVerifier,
  pairingPollVerifierDigestBytes,
  type PairingPollVerifier,
  type PairingPollVerifierCandidates,
} from "./pairing-poll-verifier";
import {
  createConfiguredPairingUserCodeVerifier,
  pairingUserCodeVerifierDigestBytes,
  type PairingUserCodeVerifier,
  type PairingUserCodeVerifierCandidates,
} from "./pairing-user-code-verifier";
import { createPublicRequestId } from "./public-http-problem";

const requestKeys = new Set([
  "architecture",
  "clientIdBase64Url",
  "connectorVersion",
  "deviceLabel",
  "devicePublicKeyBase64Url",
  "osFamily",
]);
const dependencyKeys = new Set([
  "admission",
  "database",
  "pollVerifier",
  "ratePolicy",
  "timing",
  "userCodeVerifier",
]);
const pollCandidateKeys = new Set(["clear", "digests", "secondaryActive", "tokenAccepted"]);
const codeCandidateKeys = new Set(["clear", "codeAccepted", "digests", "secondaryActive"]);
const requestIdPattern = /^req_[A-Za-z0-9_-]{22}$/;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;
const semanticVersionPattern =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const unsafeLabelPattern = /[\p{Cc}\p{Cf}\p{Cs}]/u;
const osFamilies = new Set(["linux", "macos", "windows"]);
const architectures = new Set(["aarch64", "x86_64"]);
const maximumDeviceLabelCodeUnits = 128;

export type PairingStartApplicationErrorCode = "dependency_invalid" | "request_id_unavailable";

export class PairingStartApplicationError extends Error {
  readonly code: PairingStartApplicationErrorCode;

  constructor(code: PairingStartApplicationErrorCode) {
    super("Pairing start application is unavailable.");
    this.name = "PairingStartApplicationError";
    this.code = code;
  }
}

export type PairingStartDecision =
  | Readonly<{
      expiresAt: string;
      outcome: "created";
      pairingChallengeBase64Url: string;
      pairingId: string;
      pollToken: string;
      requestId: string;
      userCode: string;
    }>
  | Readonly<{
      outcome: "not_created";
      requestId: string;
    }>
  | Readonly<{
      outcome: "rate_limited";
      requestId: string;
    }>;

export interface PairingStartApplication {
  execute(request: unknown): Promise<PairingStartDecision>;
}

export interface ConfiguredPairingStartApplication extends PairingStartApplication {
  close(): Promise<void>;
}

export interface PairingStartApplicationDependencies {
  readonly admission: PairingStartAdmission;
  readonly database: PairingStartDatabase;
  readonly pollVerifier: PairingPollVerifier;
  readonly ratePolicy: PairingRatePolicy;
  readonly timing: PairingStartTiming;
  readonly userCodeVerifier: PairingUserCodeVerifier;
}

interface NormalizedDependencies {
  readonly deriveCode: PairingUserCodeVerifier["derive"];
  readonly derivePoll: PairingPollVerifier["derive"];
  readonly limits: PairingRatePolicy["limits"];
  readonly settle: PairingStartTiming["settle"];
  readonly startDatabase: PairingStartDatabase["start"];
  readonly startTiming: PairingStartTiming["start"];
  readonly tryAcquire: PairingStartAdmission["tryAcquire"];
}

interface NormalizedRequest {
  readonly accepted: boolean;
  readonly architecture: string;
  readonly clientIdentityDigest: Buffer;
  readonly connectorVersion: string;
  readonly deviceLabel: string;
  readonly osFamily: string;
  readonly publicKey: Buffer;
}

interface NormalizedPollCandidates {
  readonly clear: () => void;
  readonly digests: PairingPollVerifierCandidates["digests"];
  readonly tokenAccepted: boolean;
}

interface NormalizedCodeCandidates {
  readonly clear: () => void;
  readonly codeAccepted: boolean;
  readonly digests: PairingUserCodeVerifierCandidates["digests"];
}

function fail(code: PairingStartApplicationErrorCode): never {
  throw new PairingStartApplicationError(code);
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

function readDependencies(value: unknown): NormalizedDependencies {
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, dependencyKeys)) {
      fail("dependency_invalid");
    }
    const admission = ownDataValue(value, "admission");
    const database = ownDataValue(value, "database");
    const pollVerifier = ownDataValue(value, "pollVerifier");
    const ratePolicy = ownDataValue(value, "ratePolicy");
    const timing = ownDataValue(value, "timing");
    const userCodeVerifier = ownDataValue(value, "userCodeVerifier");
    if (
      admission === null ||
      typeof admission !== "object" ||
      database === null ||
      typeof database !== "object" ||
      pollVerifier === null ||
      typeof pollVerifier !== "object" ||
      ratePolicy === null ||
      typeof ratePolicy !== "object" ||
      timing === null ||
      typeof timing !== "object" ||
      userCodeVerifier === null ||
      typeof userCodeVerifier !== "object"
    ) {
      fail("dependency_invalid");
    }
    const tryAcquire = ownDataValue(admission, "tryAcquire");
    const startDatabase = ownDataValue(database, "start");
    const derivePoll = ownDataValue(pollVerifier, "derive");
    const limits = ownDataValue(ratePolicy, "limits");
    const settle = ownDataValue(timing, "settle");
    const startTiming = ownDataValue(timing, "start");
    const deriveCode = ownDataValue(userCodeVerifier, "derive");
    if (
      typeof tryAcquire !== "function" ||
      typeof startDatabase !== "function" ||
      typeof derivePoll !== "function" ||
      typeof limits !== "function" ||
      typeof settle !== "function" ||
      typeof startTiming !== "function" ||
      typeof deriveCode !== "function"
    ) {
      fail("dependency_invalid");
    }
    return Object.freeze({
      deriveCode: (deriveCode as PairingUserCodeVerifier["derive"]).bind(userCodeVerifier),
      derivePoll: (derivePoll as PairingPollVerifier["derive"]).bind(pollVerifier),
      limits: (limits as PairingRatePolicy["limits"]).bind(ratePolicy),
      settle: (settle as PairingStartTiming["settle"]).bind(timing),
      startDatabase: (startDatabase as PairingStartDatabase["start"]).bind(database),
      startTiming: (startTiming as PairingStartTiming["start"]).bind(timing),
      tryAcquire: (tryAcquire as PairingStartAdmission["tryAcquire"]).bind(admission),
    });
  } catch (error) {
    if (error instanceof PairingStartApplicationError) {
      throw error;
    }
    fail("dependency_invalid");
  }
}

function decodeCanonicalPublicKey(value: unknown): Buffer | undefined {
  if (
    typeof value !== "string" ||
    value.length !== Math.ceil((pairingPublicKeyBytes * 8) / 6) ||
    !base64UrlPattern.test(value)
  ) {
    return undefined;
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== pairingPublicKeyBytes || decoded.toString("base64url") !== value) {
    decoded.fill(0);
    return undefined;
  }
  let combined = 0;
  for (const byte of decoded) {
    combined |= byte;
  }
  if (combined === 0) {
    decoded.fill(0);
    return undefined;
  }
  return decoded;
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

function readRequest(value: unknown): NormalizedRequest {
  let clientIdentity = derivePairingClientIdentity(undefined);
  let publicKey: Buffer | undefined;
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, requestKeys)) {
      return {
        accepted: false,
        architecture: "x86_64",
        clientIdentityDigest: clientIdentity.digest,
        connectorVersion: "0.0.0-invalid",
        deviceLabel: "Invalid device",
        osFamily: "linux",
        publicKey: Buffer.alloc(pairingPublicKeyBytes),
      };
    }
    const architecture = ownDataValue(value, "architecture");
    clientIdentity.digest.fill(0);
    clientIdentity = derivePairingClientIdentity(ownDataValue(value, "clientIdBase64Url"));
    const connectorVersion = ownDataValue(value, "connectorVersion");
    const deviceLabel = ownDataValue(value, "deviceLabel");
    const osFamily = ownDataValue(value, "osFamily");
    publicKey = decodeCanonicalPublicKey(ownDataValue(value, "devicePublicKeyBase64Url"));
    const accepted =
      typeof architecture === "string" &&
      architectures.has(architecture) &&
      clientIdentity.accepted &&
      validVersion(connectorVersion) &&
      validLabel(deviceLabel) &&
      typeof osFamily === "string" &&
      osFamilies.has(osFamily) &&
      publicKey !== undefined;
    return {
      accepted,
      architecture: accepted ? architecture : "x86_64",
      clientIdentityDigest: clientIdentity.digest,
      connectorVersion: accepted ? connectorVersion : "0.0.0-invalid",
      deviceLabel: accepted ? deviceLabel : "Invalid device",
      osFamily: accepted ? osFamily : "linux",
      publicKey: publicKey ?? Buffer.alloc(pairingPublicKeyBytes),
    };
  } catch {
    clientIdentity.digest.fill(0);
    clientIdentity = derivePairingClientIdentity(undefined);
    publicKey?.fill(0);
    return {
      accepted: false,
      architecture: "x86_64",
      clientIdentityDigest: clientIdentity.digest,
      connectorVersion: "0.0.0-invalid",
      deviceLabel: "Invalid device",
      osFamily: "linux",
      publicKey: Buffer.alloc(pairingPublicKeyBytes),
    };
  }
}

function readRateLimits(value: unknown): PairingRateLimits | undefined {
  try {
    if (!isPlainRecord(value)) {
      return undefined;
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== 3 ||
      !keys.includes("bucketLimit") ||
      !keys.includes("globalLimit") ||
      !keys.includes("windowSeconds")
    ) {
      return undefined;
    }
    const bucketLimit = ownDataValue(value, "bucketLimit");
    const globalLimit = ownDataValue(value, "globalLimit");
    const windowSeconds = ownDataValue(value, "windowSeconds");
    if (
      typeof bucketLimit !== "number" ||
      !Number.isSafeInteger(bucketLimit) ||
      bucketLimit < 1 ||
      typeof globalLimit !== "number" ||
      !Number.isSafeInteger(globalLimit) ||
      globalLimit < bucketLimit ||
      globalLimit > 1_000_000 ||
      typeof windowSeconds !== "number" ||
      !Number.isSafeInteger(windowSeconds) ||
      windowSeconds < 1 ||
      windowSeconds > 3_600
    ) {
      return undefined;
    }
    return Object.freeze({ bucketLimit, globalLimit, windowSeconds });
  } catch {
    return undefined;
  }
}

function validDigestTuple(value: unknown, digestBytes: number): value is readonly [Buffer, Buffer] {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length !== 2
    ) {
      return false;
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== 3 ||
      !keys.includes("0") ||
      !keys.includes("1") ||
      !keys.includes("length")
    ) {
      return false;
    }
    return ["0", "1"].every((key) => {
      const candidate = ownDataValue(value, key);
      if (!(candidate instanceof Uint8Array)) {
        return false;
      }
      const prototype: unknown = Object.getPrototypeOf(candidate);
      return (
        (prototype === Uint8Array.prototype || prototype === Buffer.prototype) &&
        candidate.buffer instanceof ArrayBuffer &&
        candidate.byteLength === digestBytes
      );
    });
  } catch {
    return false;
  }
}

function readPollCandidates(value: unknown): NormalizedPollCandidates | undefined {
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, pollCandidateKeys)) {
      return undefined;
    }
    const clear = ownDataValue(value, "clear");
    const digests = ownDataValue(value, "digests");
    const secondaryActive = ownDataValue(value, "secondaryActive");
    const tokenAccepted = ownDataValue(value, "tokenAccepted");
    if (
      typeof clear !== "function" ||
      !validDigestTuple(digests, pairingPollVerifierDigestBytes) ||
      typeof secondaryActive !== "boolean" ||
      typeof tokenAccepted !== "boolean"
    ) {
      return undefined;
    }
    return Object.freeze({
      clear: clear.bind(value) as () => void,
      digests,
      tokenAccepted,
    });
  } catch {
    return undefined;
  }
}

function readCodeCandidates(value: unknown): NormalizedCodeCandidates | undefined {
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, codeCandidateKeys)) {
      return undefined;
    }
    const clear = ownDataValue(value, "clear");
    const codeAccepted = ownDataValue(value, "codeAccepted");
    const digests = ownDataValue(value, "digests");
    const secondaryActive = ownDataValue(value, "secondaryActive");
    if (
      typeof clear !== "function" ||
      typeof codeAccepted !== "boolean" ||
      !validDigestTuple(digests, pairingUserCodeVerifierDigestBytes) ||
      typeof secondaryActive !== "boolean"
    ) {
      return undefined;
    }
    return Object.freeze({
      clear: clear.bind(value) as () => void,
      codeAccepted,
      digests,
    });
  } catch {
    return undefined;
  }
}

function readLease(value: unknown): PairingStartAdmissionLease | undefined {
  try {
    if (!isPlainRecord(value)) {
      return undefined;
    }
    const release = ownDataValue(value, "release");
    return typeof release === "function"
      ? Object.freeze({ release: (release as PairingStartAdmissionLease["release"]).bind(value) })
      : undefined;
  } catch {
    return undefined;
  }
}

function releaseLease(lease: PairingStartAdmissionLease | undefined): boolean {
  try {
    lease?.release();
    return lease !== undefined;
  } catch {
    return false;
  }
}

function createRequestId(): string {
  try {
    const requestId = createPublicRequestId().value;
    if (!requestIdPattern.test(requestId)) {
      fail("request_id_unavailable");
    }
    return requestId;
  } catch (error) {
    if (error instanceof PairingStartApplicationError) {
      throw error;
    }
    fail("request_id_unavailable");
  }
}

function failureDecision(requestId: string): PairingStartDecision {
  return Object.freeze({ outcome: "not_created" as const, requestId });
}

function rateLimitedDecision(requestId: string): PairingStartDecision {
  return Object.freeze({ outcome: "rate_limited" as const, requestId });
}

function successDecision(requestId: string, material: PairingStartMaterial): PairingStartDecision {
  return Object.freeze({
    expiresAt: material.expiresAt,
    outcome: "created" as const,
    pairingChallengeBase64Url: material.pairingChallengeBase64Url,
    pairingId: material.pairingId,
    pollToken: material.pollToken,
    requestId,
    userCode: material.userCode,
  });
}

export function createPairingStartApplication(dependencies: unknown): PairingStartApplication {
  const resolved = readDependencies(dependencies);
  return Object.freeze({
    async execute(requestInput: unknown): Promise<PairingStartDecision> {
      const requestId = createRequestId();
      let lease: PairingStartAdmissionLease | undefined;
      try {
        lease = readLease(resolved.tryAcquire());
      } catch {
        return failureDecision(requestId);
      }
      if (lease === undefined) {
        return failureDecision(requestId);
      }

      let startedAt: unknown;
      try {
        startedAt = resolved.startTiming();
        if (typeof startedAt !== "number" || !Number.isFinite(startedAt) || startedAt < 0) {
          throw new PairingStartApplicationError("dependency_invalid");
        }
      } catch {
        releaseLease(lease);
        return failureDecision(requestId);
      }

      const request = readRequest(requestInput);
      let material: PairingStartMaterial | undefined;
      let pollCandidates: NormalizedPollCandidates | undefined;
      let codeCandidates: NormalizedCodeCandidates | undefined;
      let created = false;
      let rateLimited = false;
      let settled = false;
      try {
        material = createPairingStartMaterial();
        pollCandidates = readPollCandidates(resolved.derivePoll(material.pollToken));
        codeCandidates = readCodeCandidates(resolved.deriveCode(material.userCode));
        const allowCreation =
          request.accepted &&
          pollCandidates?.tokenAccepted === true &&
          codeCandidates?.codeAccepted === true;
        if (allowCreation && pollCandidates !== undefined && codeCandidates !== undefined) {
          const rateLimits = readRateLimits(resolved.limits("start"));
          if (rateLimits === undefined) {
            throw new PairingStartApplicationError("dependency_invalid");
          }
          const attempt: PairingStartDatabaseAttempt = {
            architecture: request.architecture,
            clientIdentityDigest: request.clientIdentityDigest,
            connectorVersion: request.connectorVersion,
            deviceKeyId: material.deviceKeyId,
            deviceLabel: request.deviceLabel,
            expiresAt: material.expiresAt,
            osFamily: request.osFamily,
            pairingChallenge: material.pairingChallenge,
            pairingId: material.pairingId,
            pollVerifierDigest: pollCandidates.digests[0],
            publicKey: request.publicKey,
            rateBucketLimit: rateLimits.bucketLimit,
            rateGlobalLimit: rateLimits.globalLimit,
            rateWindowSeconds: rateLimits.windowSeconds,
            userCodeDigest: codeCandidates.digests[0],
          };
          const databaseResult: unknown = await resolved.startDatabase(attempt);
          created = databaseResult === "created";
          rateLimited = databaseResult === "rate_limited";
        }
      } catch {
        created = false;
      } finally {
        const cleanup = [
          (): void => pollCandidates?.clear(),
          (): void => codeCandidates?.clear(),
          (): void => material?.clear(),
          (): void => {
            request.clientIdentityDigest.fill(0);
            request.publicKey.fill(0);
          },
        ];
        for (const clear of cleanup) {
          try {
            clear();
          } catch {
            created = false;
            rateLimited = false;
          }
        }
        try {
          await resolved.settle(startedAt);
          settled = true;
        } catch {
          created = false;
          rateLimited = false;
        }
        if (!releaseLease(lease)) {
          created = false;
          rateLimited = false;
        }
      }

      if (created && settled && material !== undefined) {
        return successDecision(requestId, material);
      }
      return rateLimited && settled ? rateLimitedDecision(requestId) : failureDecision(requestId);
    },
  });
}

export async function createConfiguredPairingStartApplication(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  signalSink?: PairingStartDatabasePoolSignalSink,
): Promise<ConfiguredPairingStartApplication> {
  const pollVerifier = createConfiguredPairingPollVerifier(environment);
  let userCodeVerifier: PairingUserCodeVerifier | undefined;
  let database: ConfiguredPairingStartDatabase | undefined;
  try {
    userCodeVerifier = createConfiguredPairingUserCodeVerifier(environment);
    database = createConfiguredPairingStartDatabase(environment, signalSink);
    const application = createPairingStartApplication({
      admission: createPairingStartAdmission(),
      database,
      pollVerifier,
      ratePolicy: resolvePairingRatePolicy(environment),
      timing: createPairingStartTiming(),
      userCodeVerifier,
    });
    let closed = false;
    return Object.freeze({
      async close(): Promise<void> {
        if (!closed) {
          closed = true;
          pollVerifier.close();
          userCodeVerifier?.close();
          await database?.close();
        }
      },
      execute: application.execute.bind(application),
    });
  } catch (error) {
    pollVerifier.close();
    userCodeVerifier?.close();
    await database?.close().catch(() => undefined);
    throw error;
  }
}
