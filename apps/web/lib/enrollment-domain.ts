import "server-only";

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

const base64Url32Pattern = /^[A-Za-z0-9_-]{43}$/;
const handlePattern = /^[a-z0-9][a-z0-9_-]{1,22}[a-z0-9]$/;
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const invitePattern = new RegExp(
  `^vri_(${uuidV4Pattern.source.slice(1, -1)})_([A-Za-z0-9_-]{43})$`,
);
const joinKeys = new Set([
  "handle",
  "inviteCode",
  "locale",
  "motionPreference",
  "streakVisible",
  "theme",
]);
const pendingKeys = new Set([
  "codeVerifier",
  "expiresAt",
  "handle",
  "inviteDigest",
  "inviteId",
  "locale",
  "motionPreference",
  "state",
  "streakVisible",
  "theme",
  "version",
]);
const sessionKeys = new Set([
  "expiresAt",
  "handle",
  "locale",
  "passkeyRegistered",
  "profileId",
  "sessionId",
  "sessionVerifier",
  "version",
]);
const challengeKeys = new Set(["challenge", "challengeId", "expiresAt", "version"]);
const revokeChallengeKeys = new Set([
  "challenge",
  "challengeId",
  "expiresAt",
  "targetPasskeyId",
  "version",
]);

export interface JoinRequest {
  readonly handle: string;
  readonly inviteDigest: string;
  readonly inviteId: string;
  readonly locale: "en" | "ru";
  readonly motionPreference: "off" | "on" | "system";
  readonly streakVisible: boolean;
  readonly theme: "classic-grand-prix" | "cyber-rally" | "neon-night";
}

export interface PendingEnrollment extends JoinRequest {
  readonly codeVerifier: string;
  readonly expiresAt: number;
  readonly state: string;
  readonly version: 1;
}

export interface EnrollmentSession {
  readonly expiresAt: number;
  readonly handle: string;
  readonly locale: "en" | "ru";
  readonly passkeyRegistered: boolean;
  readonly profileId: string;
  readonly sessionId: string;
  readonly sessionVerifier: string;
  readonly version: 1;
}

export interface PasskeyRegistrationChallenge {
  readonly challenge: string;
  readonly challengeId: string;
  readonly expiresAt: number;
  readonly version: 1;
}

export interface PasskeyRevokeChallenge extends PasskeyRegistrationChallenge {
  readonly targetPasskeyId: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactKeys(value: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function canonicalBase64Url32(value: unknown): value is string {
  if (typeof value !== "string" || !base64Url32Pattern.test(value)) {
    return false;
  }
  const decoded = Buffer.from(value, "base64url");
  try {
    return decoded.length === 32 && decoded.toString("base64url") === value;
  } finally {
    decoded.fill(0);
  }
}

function futureExpiry(value: unknown, nowSeconds: number, maximumSeconds: number): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) > nowSeconds &&
    Number(value) <= nowSeconds + maximumSeconds
  );
}

function joinFields(
  value: Record<string, unknown>,
): value is Record<string, unknown> & JoinRequest {
  return (
    typeof value.handle === "string" &&
    handlePattern.test(value.handle) &&
    typeof value.inviteId === "string" &&
    uuidV4Pattern.test(value.inviteId) &&
    canonicalBase64Url32(value.inviteDigest) &&
    (value.locale === "en" || value.locale === "ru") &&
    (value.motionPreference === "off" ||
      value.motionPreference === "on" ||
      value.motionPreference === "system") &&
    typeof value.streakVisible === "boolean" &&
    (value.theme === "classic-grand-prix" ||
      value.theme === "cyber-rally" ||
      value.theme === "neon-night")
  );
}

export function parseJoinRequest(body: string): JoinRequest | undefined {
  if (body.length === 0 || body.length > 1024) {
    return undefined;
  }
  const parameters = new URLSearchParams(body);
  const keys = [...parameters.keys()];
  if (
    keys.length !== joinKeys.size ||
    new Set(keys).size !== keys.length ||
    keys.some((key) => !joinKeys.has(key))
  ) {
    return undefined;
  }
  const handle = parameters.get("handle");
  const inviteCode = parameters.get("inviteCode");
  const locale = parameters.get("locale");
  const motionPreference = parameters.get("motionPreference");
  const streakVisible = parameters.get("streakVisible");
  const theme = parameters.get("theme");
  const inviteMatch = inviteCode?.match(invitePattern);
  if (
    handle === null ||
    !handlePattern.test(handle) ||
    inviteMatch === undefined ||
    inviteMatch === null ||
    (locale !== "en" && locale !== "ru") ||
    (motionPreference !== "off" && motionPreference !== "on" && motionPreference !== "system") ||
    (streakVisible !== "true" && streakVisible !== "false") ||
    (theme !== "classic-grand-prix" && theme !== "cyber-rally" && theme !== "neon-night")
  ) {
    return undefined;
  }
  const inviteId = inviteMatch[1];
  const encodedSecret = inviteMatch[2];
  if (inviteId === undefined || encodedSecret === undefined) {
    return undefined;
  }
  const secret = Buffer.from(encodedSecret, "base64url");
  try {
    if (secret.length !== 32 || secret.toString("base64url") !== encodedSecret) {
      return undefined;
    }
    return Object.freeze({
      handle,
      inviteDigest: createHash("sha256").update(secret).digest("base64url"),
      inviteId,
      locale,
      motionPreference,
      streakVisible: streakVisible === "true",
      theme,
    });
  } finally {
    secret.fill(0);
  }
}

export function readPendingEnrollment(
  value: unknown,
  nowSeconds: number,
): PendingEnrollment | undefined {
  if (
    !isPlainObject(value) ||
    !exactKeys(value, pendingKeys) ||
    value.version !== 1 ||
    !joinFields(value) ||
    !canonicalBase64Url32(value.codeVerifier) ||
    !canonicalBase64Url32(value.state) ||
    !futureExpiry(value.expiresAt, nowSeconds, 600)
  ) {
    return undefined;
  }
  return Object.freeze(value as unknown as PendingEnrollment);
}

export function readEnrollmentSession(
  value: unknown,
  nowSeconds: number,
): EnrollmentSession | undefined {
  if (
    !isPlainObject(value) ||
    !exactKeys(value, sessionKeys) ||
    value.version !== 1 ||
    typeof value.handle !== "string" ||
    !handlePattern.test(value.handle) ||
    (value.locale !== "en" && value.locale !== "ru") ||
    typeof value.passkeyRegistered !== "boolean" ||
    typeof value.profileId !== "string" ||
    !uuidV4Pattern.test(value.profileId) ||
    typeof value.sessionId !== "string" ||
    !uuidV4Pattern.test(value.sessionId) ||
    !canonicalBase64Url32(value.sessionVerifier) ||
    !futureExpiry(value.expiresAt, nowSeconds, 31 * 24 * 60 * 60)
  ) {
    return undefined;
  }
  return Object.freeze(value as unknown as EnrollmentSession);
}

export function readPasskeyChallenge(
  value: unknown,
  nowSeconds: number,
): PasskeyRegistrationChallenge | undefined {
  if (
    !isPlainObject(value) ||
    !exactKeys(value, challengeKeys) ||
    value.version !== 1 ||
    !canonicalBase64Url32(value.challenge) ||
    typeof value.challengeId !== "string" ||
    !uuidV4Pattern.test(value.challengeId) ||
    !futureExpiry(value.expiresAt, nowSeconds, 300)
  ) {
    return undefined;
  }
  return Object.freeze(value as unknown as PasskeyRegistrationChallenge);
}

export function readPasskeyRevokeChallenge(
  value: unknown,
  nowSeconds: number,
): PasskeyRevokeChallenge | undefined {
  if (
    !isPlainObject(value) ||
    !exactKeys(value, revokeChallengeKeys) ||
    value.version !== 1 ||
    !canonicalBase64Url32(value.challenge) ||
    typeof value.challengeId !== "string" ||
    !uuidV4Pattern.test(value.challengeId) ||
    typeof value.targetPasskeyId !== "string" ||
    !uuidV4Pattern.test(value.targetPasskeyId) ||
    !futureExpiry(value.expiresAt, nowSeconds, 300)
  ) {
    return undefined;
  }
  return Object.freeze(value as unknown as PasskeyRevokeChallenge);
}

export const enrollmentPatterns = Object.freeze({ handle: handlePattern, uuidV4: uuidV4Pattern });
