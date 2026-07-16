import "server-only";

import { Buffer } from "node:buffer";
import crypto from "node:crypto";

import {
  createPairingActivationAdmission,
  type PairingActivationAdmission,
  type PairingActivationAdmissionLease,
} from "./pairing-activation-admission";
import {
  createConfiguredPairingActivationDatabase,
  type ConfiguredPairingActivationDatabase,
  type PairingActivationDatabase,
  type PairingActivationDatabaseAttempt,
  type PairingActivationDatabasePoolSignalSink,
} from "./pairing-activation-database";
import {
  createPairingActivationTiming,
  type PairingActivationTiming,
} from "./pairing-activation-timing";
import { createPublicRequestId } from "./public-http-problem";
import { pairingSignatureBytes } from "./pairing-possession-verifier";
import {
  createConfiguredPairingPollVerifier,
  pairingPollVerifierDigestBytes,
  type PairingPollVerifier,
  type PairingPollVerifierCandidates,
} from "./pairing-poll-verifier";

const requestKeys = new Set(["pollToken", "possessionSignature"]);
const dependencyKeys = new Set(["admission", "database", "pollVerifier", "timing"]);
const candidateKeys = new Set(["clear", "digests", "secondaryActive", "tokenAccepted"]);
const requestIdPattern = /^req_[A-Za-z0-9_-]{22}$/;
const deviceIdPattern = /^dev_[A-Za-z0-9_-]{22}$/;
const auditEventIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;
const identifierEntropyBytes = 16;
const dummySignatureBase64Url = Buffer.alloc(pairingSignatureBytes).toString("base64url");

export type PairingActivationApplicationErrorCode = "dependency_invalid" | "request_id_unavailable";

export class PairingActivationApplicationError extends Error {
  readonly code: PairingActivationApplicationErrorCode;

  constructor(code: PairingActivationApplicationErrorCode) {
    super("Pairing activation application is unavailable.");
    this.name = "PairingActivationApplicationError";
    this.code = code;
  }
}

export type PairingActivationDecision =
  | Readonly<{
      deviceId: string;
      outcome: "activated";
      requestId: string;
    }>
  | Readonly<{
      outcome: "not_activated";
      requestId: string;
    }>;

export interface PairingActivationApplication {
  execute(request: unknown): Promise<PairingActivationDecision>;
}

export interface ConfiguredPairingActivationApplication extends PairingActivationApplication {
  close(): Promise<void>;
}

export interface PairingActivationApplicationDependencies {
  readonly admission: PairingActivationAdmission;
  readonly database: PairingActivationDatabase;
  readonly pollVerifier: PairingPollVerifier;
  readonly timing: PairingActivationTiming;
}

interface NormalizedDependencies {
  readonly activate: PairingActivationDatabase["activate"];
  readonly derive: PairingPollVerifier["derive"];
  readonly settle: PairingActivationTiming["settle"];
  readonly start: PairingActivationTiming["start"];
  readonly tryAcquire: PairingActivationAdmission["tryAcquire"];
}

interface NormalizedRequest {
  readonly pollToken: unknown;
  readonly shapeAccepted: boolean;
  readonly signature: string;
  readonly signatureAccepted: boolean;
}

interface NormalizedCandidates {
  readonly clear: () => void;
  readonly digests: PairingPollVerifierCandidates["digests"];
  readonly secondaryActive: boolean;
  readonly tokenAccepted: boolean;
}

function fail(code: PairingActivationApplicationErrorCode): never {
  throw new PairingActivationApplicationError(code);
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
    const timing = ownDataValue(value, "timing");
    if (
      admission === null ||
      typeof admission !== "object" ||
      database === null ||
      typeof database !== "object" ||
      pollVerifier === null ||
      typeof pollVerifier !== "object" ||
      timing === null ||
      typeof timing !== "object"
    ) {
      fail("dependency_invalid");
    }
    const tryAcquire = ownDataValue(admission, "tryAcquire");
    const activate = ownDataValue(database, "activate");
    const derive = ownDataValue(pollVerifier, "derive");
    const settle = ownDataValue(timing, "settle");
    const start = ownDataValue(timing, "start");
    if (
      typeof tryAcquire !== "function" ||
      typeof activate !== "function" ||
      typeof derive !== "function" ||
      typeof settle !== "function" ||
      typeof start !== "function"
    ) {
      fail("dependency_invalid");
    }
    const typedTryAcquire = tryAcquire as PairingActivationAdmission["tryAcquire"];
    const typedActivate = activate as PairingActivationDatabase["activate"];
    const typedDerive = derive as PairingPollVerifier["derive"];
    const typedSettle = settle as PairingActivationTiming["settle"];
    const typedStart = start as PairingActivationTiming["start"];
    return Object.freeze({
      activate: typedActivate.bind(database),
      derive: typedDerive.bind(pollVerifier),
      settle: typedSettle.bind(timing),
      start: typedStart.bind(timing),
      tryAcquire: typedTryAcquire.bind(admission),
    });
  } catch (error) {
    if (error instanceof PairingActivationApplicationError) {
      throw error;
    }
    fail("dependency_invalid");
  }
}

function normalizeSignature(value: unknown): { accepted: boolean; value: string } {
  try {
    if (
      typeof value !== "string" ||
      value.length !== Math.ceil((pairingSignatureBytes * 8) / 6) ||
      !base64UrlPattern.test(value)
    ) {
      return { accepted: false, value: dummySignatureBase64Url };
    }
    const decoded = Buffer.from(value, "base64url");
    try {
      return decoded.length === pairingSignatureBytes && decoded.toString("base64url") === value
        ? { accepted: true, value }
        : { accepted: false, value: dummySignatureBase64Url };
    } finally {
      decoded.fill(0);
    }
  } catch {
    return { accepted: false, value: dummySignatureBase64Url };
  }
}

function readRequest(value: unknown): NormalizedRequest {
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, requestKeys)) {
      return {
        pollToken: undefined,
        shapeAccepted: false,
        signature: dummySignatureBase64Url,
        signatureAccepted: false,
      };
    }
    const signature = normalizeSignature(ownDataValue(value, "possessionSignature"));
    return {
      pollToken: ownDataValue(value, "pollToken"),
      shapeAccepted: true,
      signature: signature.value,
      signatureAccepted: signature.accepted,
    };
  } catch {
    return {
      pollToken: undefined,
      shapeAccepted: false,
      signature: dummySignatureBase64Url,
      signatureAccepted: false,
    };
  }
}

function validDigestTuple(value: unknown): value is PairingPollVerifierCandidates["digests"] {
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
        candidate.byteLength === pairingPollVerifierDigestBytes
      );
    });
  } catch {
    return false;
  }
}

function readCandidates(value: unknown): NormalizedCandidates | undefined {
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, candidateKeys)) {
      return undefined;
    }
    const clear = ownDataValue(value, "clear");
    const digests = ownDataValue(value, "digests");
    const secondaryActive = ownDataValue(value, "secondaryActive");
    const tokenAccepted = ownDataValue(value, "tokenAccepted");
    if (
      typeof clear !== "function" ||
      !validDigestTuple(digests) ||
      typeof secondaryActive !== "boolean" ||
      typeof tokenAccepted !== "boolean"
    ) {
      return undefined;
    }
    return Object.freeze({
      clear: clear.bind(value) as () => void,
      digests,
      secondaryActive,
      tokenAccepted,
    });
  } catch {
    return undefined;
  }
}

function createDeviceId(): string {
  let entropy: unknown;
  try {
    entropy = crypto.randomBytes(identifierEntropyBytes);
    if (
      !(Buffer.isBuffer(entropy) || entropy instanceof Uint8Array) ||
      entropy.byteLength !== identifierEntropyBytes
    ) {
      throw new Error("invalid entropy");
    }
    const deviceId = `dev_${Buffer.from(entropy).toString("base64url")}`;
    if (!deviceIdPattern.test(deviceId)) {
      throw new Error("invalid identifier");
    }
    return deviceId;
  } finally {
    if (Buffer.isBuffer(entropy) || entropy instanceof Uint8Array) {
      entropy.fill(0);
    }
  }
}

function createAuditEventId(): string {
  const auditEventId = crypto.randomUUID();
  if (!auditEventIdPattern.test(auditEventId)) {
    throw new Error("invalid identifier");
  }
  return auditEventId;
}

function createRequestId(): string {
  try {
    const requestId = createPublicRequestId().value;
    if (!requestIdPattern.test(requestId)) {
      fail("request_id_unavailable");
    }
    return requestId;
  } catch (error) {
    if (error instanceof PairingActivationApplicationError) {
      throw error;
    }
    fail("request_id_unavailable");
  }
}

function failureDecision(requestId: string): PairingActivationDecision {
  return Object.freeze({ outcome: "not_activated" as const, requestId });
}

function successDecision(requestId: string, deviceId: string): PairingActivationDecision {
  return Object.freeze({ deviceId, outcome: "activated" as const, requestId });
}

function readLease(value: unknown): PairingActivationAdmissionLease | undefined {
  try {
    if (!isPlainRecord(value)) {
      return undefined;
    }
    const release = ownDataValue(value, "release");
    if (typeof release !== "function") {
      return undefined;
    }
    const typedRelease = release as PairingActivationAdmissionLease["release"];
    return Object.freeze({ release: typedRelease.bind(value) });
  } catch {
    return undefined;
  }
}

function releaseLease(lease: PairingActivationAdmissionLease | undefined): boolean {
  try {
    lease?.release();
    return lease !== undefined;
  } catch {
    return false;
  }
}

export function createPairingActivationApplication(
  dependencies: unknown,
): PairingActivationApplication {
  const resolved = readDependencies(dependencies);
  return Object.freeze({
    async execute(requestInput: unknown): Promise<PairingActivationDecision> {
      const requestId = createRequestId();
      let lease: PairingActivationAdmissionLease | undefined;
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
        startedAt = resolved.start();
      } catch {
        releaseLease(lease);
        return failureDecision(requestId);
      }

      const request = readRequest(requestInput);
      let candidates: NormalizedCandidates | undefined;
      let activated = false;
      let deviceId: string | undefined;
      let settled = false;
      try {
        deviceId = createDeviceId();
        const auditEventId = createAuditEventId();
        candidates = readCandidates(resolved.derive(request.pollToken));
        if (candidates !== undefined) {
          const allowActivation =
            request.shapeAccepted && request.signatureAccepted && candidates.tokenAccepted;
          const attempt: PairingActivationDatabaseAttempt = {
            allowActivation,
            auditEventId,
            deviceId,
            pollVerifierDigests: candidates.digests,
            requestId,
            secondaryCandidateActive: candidates.secondaryActive,
            signatureBase64Url: request.signature,
          };
          const databaseActivated = await resolved.activate(attempt);
          activated = allowActivation && databaseActivated;
        }
      } catch {
        activated = false;
      } finally {
        try {
          candidates?.clear();
        } catch {
          activated = false;
        }
        try {
          await resolved.settle(startedAt);
          settled = true;
        } catch {
          activated = false;
        }
        if (!releaseLease(lease)) {
          activated = false;
        }
      }

      return activated && settled && deviceId !== undefined
        ? successDecision(requestId, deviceId)
        : failureDecision(requestId);
    },
  });
}

export async function createConfiguredPairingActivationApplication(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  signalSink?: PairingActivationDatabasePoolSignalSink,
): Promise<ConfiguredPairingActivationApplication> {
  const pollVerifier = createConfiguredPairingPollVerifier(environment);
  let database: ConfiguredPairingActivationDatabase | undefined;
  try {
    database = createConfiguredPairingActivationDatabase(environment, signalSink);
    const application = createPairingActivationApplication({
      admission: createPairingActivationAdmission(),
      database,
      pollVerifier,
      timing: createPairingActivationTiming(),
    });
    let closed = false;
    return Object.freeze({
      async close(): Promise<void> {
        if (!closed) {
          closed = true;
          pollVerifier.close();
          await database?.close();
        }
      },
      execute: application.execute.bind(application),
    });
  } catch (error) {
    pollVerifier.close();
    await database?.close().catch(() => undefined);
    throw error;
  }
}
