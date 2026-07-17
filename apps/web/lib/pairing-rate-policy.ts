import "server-only";

import { Buffer } from "node:buffer";
import crypto from "node:crypto";

const clientIdPattern = /^[A-Za-z0-9_-]{22}$/;
const decimalIntegerPattern = /^(?:0|[1-9][0-9]*)$/;
const rateDigestPrefix = Buffer.from("viberacing-pairing-client-rate-v1\n", "utf8");
const maximumGlobalLimit = 1_000_000;
const maximumWindowSeconds = 3_600;

export const pairingClientIdBytes = 16;
export const pairingClientIdHeader = "x-viberacing-client-id";

export type PairingRateOperation = "poll" | "start";

export interface PairingRateLimits {
  readonly bucketLimit: number;
  readonly globalLimit: number;
  readonly windowSeconds: number;
}

export interface PairingRatePolicy {
  limits(operation: PairingRateOperation): PairingRateLimits;
}

export interface PairingClientIdentity {
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
    value = environment[name];
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

export function resolvePairingRatePolicy(
  environment: Environment = process.env,
): PairingRatePolicy {
  const poll = readLimits(environment, "POLL");
  const start = readLimits(environment, "START");
  return Object.freeze({
    limits(operation: string): PairingRateLimits {
      if (operation === "poll") {
        return poll;
      }
      if (operation === "start") {
        return start;
      }
      return fail("rate_invalid");
    },
  });
}

export function derivePairingClientIdentity(value: unknown): PairingClientIdentity {
  let decoded = Buffer.alloc(pairingClientIdBytes);
  let accepted = false;
  try {
    if (typeof value === "string" && clientIdPattern.test(value)) {
      const candidate = Buffer.from(value, "base64url");
      if (candidate.length === pairingClientIdBytes && candidate.toString("base64url") === value) {
        decoded.fill(0);
        decoded = candidate;
        accepted = true;
      } else {
        candidate.fill(0);
      }
    }
    const digest = crypto.createHash("sha256").update(rateDigestPrefix).update(decoded).digest();
    return Object.freeze({ accepted, digest });
  } catch {
    const digest = crypto
      .createHash("sha256")
      .update(rateDigestPrefix)
      .update(Buffer.alloc(pairingClientIdBytes))
      .digest();
    return Object.freeze({ accepted: false, digest });
  } finally {
    decoded.fill(0);
  }
}
