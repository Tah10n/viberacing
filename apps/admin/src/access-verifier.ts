import { timingSafeEqual } from "node:crypto";

import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload } from "jose";

import { isAdminActorReference } from "./actor-reference.js";
import {
  hashAdminAccessSubject,
  isResolvedAdminAccessConfig,
  type AdminAccessConfig,
} from "./access-config.js";

const keyIdPattern = /^[a-f0-9]{64}$/;
const subjectPattern = /^[A-Za-z0-9._-]{1,128}$/;
const maximumAssertionLength = 8_192;
const maximumTokenLifetimeSeconds = 3_600;

export const adminAccessClockSkewSeconds = 30;
export const adminAccessMaximumTokenLifetimeSeconds = maximumTokenLifetimeSeconds;

export type AdminAccessVerificationErrorCode =
  "access_rejected" | "argument_invalid" | "clock_invalid" | "dependency_invalid";

export class AdminAccessVerificationError extends Error {
  readonly code: AdminAccessVerificationErrorCode;

  constructor(code: AdminAccessVerificationErrorCode) {
    super("Admin Access verification failed.");
    this.name = "AdminAccessVerificationError";
    this.code = code;
  }
}

export interface AdminAccessIdentity {
  readonly accessExpiresAtMs: number;
  readonly accessVerifiedAtMs: number;
  readonly actorReference: string;
  readonly purpose: "invite_issue";
  readonly version: 1;
}

export interface AdminAccessVerifier {
  readonly verify: (...arguments_: readonly unknown[]) => Promise<AdminAccessIdentity>;
}

export interface AdminAccessVerifierRuntime {
  readonly clock: () => number;
}

const systemRuntime: AdminAccessVerifierRuntime = Object.freeze({ clock: Date.now });
const runtimeKeys = ["clock"] as const;

function fail(code: AdminAccessVerificationErrorCode): never {
  throw new AdminAccessVerificationError(code);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).toSorted();
  const sortedExpected = [...expected].toSorted();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function ownDataValue(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    return undefined;
  }
  return descriptor.value;
}

function readRuntime(value: unknown): AdminAccessVerifierRuntime {
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, runtimeKeys)) {
      fail("dependency_invalid");
    }
    const clock = ownDataValue(value, "clock");
    if (typeof clock !== "function") {
      fail("dependency_invalid");
    }
    return Object.freeze({ clock: clock as AdminAccessVerifierRuntime["clock"] });
  } catch (error) {
    if (error instanceof AdminAccessVerificationError) {
      throw error;
    }
    fail("dependency_invalid");
  }
}

function readClock(runtime: AdminAccessVerifierRuntime): number {
  try {
    const now = runtime.clock();
    if (!Number.isSafeInteger(now) || now < 0 || now > Date.parse("9999-12-31T23:59:59.000Z")) {
      fail("clock_invalid");
    }
    return now;
  } catch (error) {
    if (error instanceof AdminAccessVerificationError) {
      throw error;
    }
    fail("clock_invalid");
  }
}

function readAssertion(arguments_: readonly unknown[]): string {
  if (arguments_.length !== 1) {
    fail("argument_invalid");
  }
  const assertion = arguments_[0];
  if (
    typeof assertion !== "string" ||
    assertion.length === 0 ||
    assertion.length > maximumAssertionLength ||
    assertion !== assertion.trim() ||
    assertion.split(".").length !== 3
  ) {
    fail("access_rejected");
  }
  return assertion;
}

function validNumericDate(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hasForbiddenServiceIdentity(payload: JWTPayload): boolean {
  return (
    Object.hasOwn(payload, "service_token_id") ||
    Object.hasOwn(payload, "common_name") ||
    ownDataValue(payload, "service_token_status") === true
  );
}

function findMember(config: AdminAccessConfig, subject: string): string {
  const subjectDigest = Buffer.from(hashAdminAccessSubject(config.issuer, subject), "base64url");
  let actorReference: string | undefined;
  try {
    for (const member of config.members) {
      const candidate = Buffer.from(member.subjectDigest, "base64url");
      try {
        if (timingSafeEqual(subjectDigest, candidate)) {
          actorReference = member.actorReference;
        }
      } finally {
        candidate.fill(0);
      }
    }
  } finally {
    subjectDigest.fill(0);
  }
  if (!isAdminActorReference(actorReference)) {
    fail("access_rejected");
  }
  return actorReference;
}

function validateVerifiedToken(
  config: AdminAccessConfig,
  result: Awaited<ReturnType<typeof jwtVerify>>,
  verifiedAtMs: number,
): AdminAccessIdentity {
  const { payload, protectedHeader } = result;
  if (
    !isPlainRecord(protectedHeader) ||
    !hasExactKeys(protectedHeader, ["alg", "kid", "typ"]) ||
    ownDataValue(protectedHeader, "alg") !== "RS256" ||
    ownDataValue(protectedHeader, "typ") !== "JWT"
  ) {
    fail("access_rejected");
  }
  const kid = ownDataValue(protectedHeader, "kid");
  const audience = ownDataValue(payload, "aud");
  const expiresAtSeconds = ownDataValue(payload, "exp");
  const issuedAtSeconds = ownDataValue(payload, "iat");
  const issuer = ownDataValue(payload, "iss");
  const subject = ownDataValue(payload, "sub");
  const tokenType = ownDataValue(payload, "type");
  if (
    typeof kid !== "string" ||
    !keyIdPattern.test(kid) ||
    !Array.isArray(audience) ||
    audience.length !== 1 ||
    audience[0] !== config.audience ||
    !validNumericDate(expiresAtSeconds) ||
    !validNumericDate(issuedAtSeconds) ||
    issuer !== config.issuer ||
    typeof subject !== "string" ||
    !subjectPattern.test(subject) ||
    tokenType !== "app" ||
    hasForbiddenServiceIdentity(payload) ||
    expiresAtSeconds <= issuedAtSeconds ||
    expiresAtSeconds - issuedAtSeconds > maximumTokenLifetimeSeconds
  ) {
    fail("access_rejected");
  }
  const expiresAtMs = expiresAtSeconds * 1_000;
  const issuedAtMs = issuedAtSeconds * 1_000;
  if (
    !Number.isSafeInteger(expiresAtMs) ||
    !Number.isSafeInteger(issuedAtMs) ||
    verifiedAtMs >= expiresAtMs ||
    issuedAtMs > verifiedAtMs + adminAccessClockSkewSeconds * 1_000
  ) {
    fail("access_rejected");
  }
  const actorReference = findMember(config, subject);
  const identity = Object.create(null) as AdminAccessIdentity;
  Object.defineProperties(identity, {
    accessExpiresAtMs: {
      configurable: false,
      enumerable: false,
      value: expiresAtMs,
      writable: false,
    },
    accessVerifiedAtMs: {
      configurable: false,
      enumerable: false,
      value: verifiedAtMs,
      writable: false,
    },
    actorReference: {
      configurable: false,
      enumerable: false,
      value: actorReference,
      writable: false,
    },
    purpose: {
      configurable: false,
      enumerable: false,
      value: "invite_issue",
      writable: false,
    },
    toJSON: {
      configurable: false,
      enumerable: false,
      value: () => ({ redacted: true }),
      writable: false,
    },
    version: { configurable: false, enumerable: false, value: 1, writable: false },
  });
  return Object.freeze(identity);
}

async function verifyAccessAssertion(
  config: AdminAccessConfig,
  keySet: ReturnType<typeof createLocalJWKSet>,
  runtime: AdminAccessVerifierRuntime,
  arguments_: readonly unknown[],
): Promise<AdminAccessIdentity> {
  const assertion = readAssertion(arguments_);
  const startedAtMs = readClock(runtime);
  let result: Awaited<ReturnType<typeof jwtVerify>>;
  try {
    result = await jwtVerify(assertion, keySet, {
      algorithms: ["RS256"],
      audience: config.audience,
      clockTolerance: adminAccessClockSkewSeconds,
      currentDate: new Date(startedAtMs),
      issuer: config.issuer,
      requiredClaims: ["aud", "exp", "iat", "iss", "sub", "type"],
      typ: "JWT",
    });
  } catch {
    fail("access_rejected");
  }
  const verifiedAtMs = readClock(runtime);
  if (verifiedAtMs < startedAtMs) {
    fail("clock_invalid");
  }
  return validateVerifiedToken(config, result, verifiedAtMs);
}

export function createAdminAccessVerifier(
  configValue: unknown,
  runtimeValue: unknown = systemRuntime,
): AdminAccessVerifier {
  if (!isResolvedAdminAccessConfig(configValue)) {
    fail("dependency_invalid");
  }
  const runtime = readRuntime(runtimeValue);
  let keySet: ReturnType<typeof createLocalJWKSet>;
  try {
    keySet = createLocalJWKSet(configValue.jwks as unknown as JSONWebKeySet);
  } catch {
    fail("dependency_invalid");
  }
  return Object.freeze({
    verify(...arguments_: readonly unknown[]): Promise<AdminAccessIdentity> {
      return verifyAccessAssertion(configValue, keySet, runtime, arguments_);
    },
  });
}
