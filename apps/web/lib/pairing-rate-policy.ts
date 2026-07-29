import "server-only";

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

const startIdentifierPattern = /^[A-Za-z0-9_-]{22}$/;
const pollTokenPattern = /^[A-Za-z0-9_-]{43}$/;
const decimalIntegerPattern = /^(?:0|[1-9][0-9]*)$/;
const startDigestPrefix = Buffer.from("viberacing-pairing-start-rate-v1\n", "utf8");
const pollDigestPrefix = Buffer.from("viberacing-pairing-poll-rate-v1\n", "utf8");
const maximumGlobalLimit = 1_000_000;
const maximumWindowSeconds = 3_600;

export const pairingStartRateIdentifierBytes = 16;
export const pairingPollTokenBytes = 32;

export type PairingRateOperation = "poll" | "start";

export interface PairingRateLimits {
  readonly bucketLimit: number;
  readonly globalLimit: number;
  readonly windowSeconds: number;
}

export interface PairingRatePolicy {
  limits(operation: PairingRateOperation): PairingRateLimits;
}

export interface PairingRateIdentity {
  readonly accepted: boolean;
  readonly digest: Buffer;
}

export type PairingRatePolicyConfigurationErrorCode = "environment_unreadable" | "rate_invalid";

export class PairingRatePolicyConfigurationError extends Error {
  readonly code: PairingRatePolicyConfigurationErrorCode;

  constructor(code: PairingRatePolicyConfigurationErrorCode) {
    super("Pairing rate policy configuration is invalid.");
    this.name = "PairingRatePolicyConfigurationError";
    this.code = code;
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

function fail(code: PairingRatePolicyConfigurationErrorCode): never {
  throw new PairingRatePolicyConfigurationError(code);
}

function readInteger(
  environment: Environment,
  name: string,
  minimum: number,
  maximum: number,
): number {
  let value: string | undefined;
  try {
    value = Reflect.get(environment, name);
  } catch {
    fail("environment_unreadable");
  }
  if (
    value === undefined ||
    value.length === 0 ||
    value.length > 7 ||
    !decimalIntegerPattern.test(value)
  ) {
    fail("rate_invalid");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail("rate_invalid");
  }
  return parsed;
}

function readLimits(environment: Environment, operation: "POLL" | "START"): PairingRateLimits {
  const globalLimit = readInteger(
    environment,
    `VIBERACING_WEB_PAIRING_${operation}_GLOBAL_LIMIT`,
    1,
    maximumGlobalLimit,
  );
  const bucketLimit = readInteger(
    environment,
    `VIBERACING_WEB_PAIRING_${operation}_BUCKET_LIMIT`,
    1,
    globalLimit,
  );
  const windowSeconds = readInteger(
    environment,
    `VIBERACING_WEB_PAIRING_${operation}_WINDOW_SECONDS`,
    1,
    maximumWindowSeconds,
  );
  return Object.freeze({ bucketLimit, globalLimit, windowSeconds });
}

function deriveIdentity(
  value: unknown,
  pattern: RegExp,
  byteLength: number,
  digestPrefix: Buffer,
): PairingRateIdentity {
  let decoded = Buffer.alloc(byteLength);
  let accepted = false;
  try {
    if (typeof value === "string" && pattern.test(value)) {
      const candidate = Buffer.from(value, "base64url");
      if (candidate.length === byteLength && candidate.toString("base64url") === value) {
        decoded.fill(0);
        decoded = candidate;
        accepted = true;
      } else {
        candidate.fill(0);
      }
    }
    const digest = createHash("sha256").update(digestPrefix).update(decoded).digest();
    return Object.freeze({ accepted, digest });
  } catch {
    const digest = createHash("sha256")
      .update(digestPrefix)
      .update(Buffer.alloc(byteLength))
      .digest();
    return Object.freeze({ accepted: false, digest });
  } finally {
    decoded.fill(0);
  }
}

export function resolvePairingRatePolicy(
  environment: Environment = process.env,
): PairingRatePolicy {
  const poll = readLimits(environment, "POLL");
  const start = readLimits(environment, "START");
  return Object.freeze({
    limits(operation: PairingRateOperation): PairingRateLimits {
      return operation === "poll" ? poll : start;
    },
  });
}

export function derivePairingStartRateIdentity(value: unknown): PairingRateIdentity {
  return deriveIdentity(
    value,
    startIdentifierPattern,
    pairingStartRateIdentifierBytes,
    startDigestPrefix,
  );
}

export function derivePairingPollRateIdentity(value: unknown): PairingRateIdentity {
  return deriveIdentity(value, pollTokenPattern, pairingPollTokenBytes, pollDigestPrefix);
}
