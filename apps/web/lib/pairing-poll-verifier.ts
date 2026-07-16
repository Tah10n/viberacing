import "server-only";

import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";

const environmentKeys = {
  primary: "VIBERACING_WEB_PAIRING_POLL_PRIMARY_KEY_BASE64URL",
  secondary: "VIBERACING_WEB_PAIRING_POLL_SECONDARY_KEY_BASE64URL",
} as const;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;
const dummyVerifierPrefix = "viberacing-pairing-poll-verifier-dummy-v1";

export const pairingPollTokenBytes = 32;
export const pairingPollVerifierDigestBytes = 32;
export const pairingPollVerifierKeyBytes = 32;
export const pairingPollVerifierPrefix = "viberacing-pairing-poll-verifier-v1";

export type PairingPollVerifierConfigurationErrorCode =
  | "closed"
  | "derivation_failed"
  | "duplicate_key_material"
  | "environment_unreadable"
  | "primary_key_invalid"
  | "secondary_key_invalid";

export class PairingPollVerifierConfigurationError extends Error {
  readonly code: PairingPollVerifierConfigurationErrorCode;

  constructor(code: PairingPollVerifierConfigurationErrorCode) {
    super("Pairing poll verifier configuration is invalid.");
    this.name = "PairingPollVerifierConfigurationError";
    this.code = code;
  }
}

export interface PairingPollVerifierCandidates {
  readonly digests: readonly [Buffer, Buffer];
  readonly secondaryActive: boolean;
  readonly tokenAccepted: boolean;
  clear(): void;
}

export interface PairingPollVerifier {
  close(): void;
  derive(token: unknown): PairingPollVerifierCandidates;
}

type Environment = Readonly<Record<string, unknown>>;

interface PairingPollVerifierKeys {
  readonly primary: Buffer;
  readonly secondary?: Buffer;
}

function fail(code: PairingPollVerifierConfigurationErrorCode): never {
  throw new PairingPollVerifierConfigurationError(code);
}

function decodeCanonicalBase64Url(value: unknown, expectedBytes: number): Buffer | undefined {
  const expectedCharacters = Math.ceil((expectedBytes * 8) / 6);
  if (
    typeof value !== "string" ||
    value.length !== expectedCharacters ||
    !base64UrlPattern.test(value)
  ) {
    return undefined;
  }
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === expectedBytes && decoded.toString("base64url") === value
    ? decoded
    : undefined;
}

function clear(value: Buffer | undefined): void {
  value?.fill(0);
}

function readKeys(environment: Environment): PairingPollVerifierKeys {
  let primary: Buffer | undefined;
  let secondary: Buffer | undefined;
  try {
    primary = decodeCanonicalBase64Url(
      environment[environmentKeys.primary],
      pairingPollVerifierKeyBytes,
    );
    if (primary === undefined) {
      fail("primary_key_invalid");
    }

    const secondaryValue = environment[environmentKeys.secondary];
    if (secondaryValue === undefined) {
      return { primary };
    }
    secondary = decodeCanonicalBase64Url(secondaryValue, pairingPollVerifierKeyBytes);
    if (secondary === undefined) {
      fail("secondary_key_invalid");
    }
    if (timingSafeEqual(primary, secondary)) {
      fail("duplicate_key_material");
    }
    return { primary, secondary };
  } catch (error) {
    clear(primary);
    clear(secondary);
    if (error instanceof PairingPollVerifierConfigurationError) {
      throw error;
    }
    fail("environment_unreadable");
  }
}

function deriveDigest(key: Buffer, prefix: string, token: Buffer): Buffer {
  const hmac = createHmac("sha256", key);
  hmac.update(prefix, "utf8");
  hmac.update("\n", "utf8");
  hmac.update(token);
  return hmac.digest();
}

function createCandidates(
  keys: PairingPollVerifierKeys,
  tokenInput: unknown,
): PairingPollVerifierCandidates {
  const decodedToken = decodeCanonicalBase64Url(tokenInput, pairingPollTokenBytes);
  const token = decodedToken ?? Buffer.alloc(pairingPollTokenBytes);
  let primaryDigest: Buffer | undefined;
  let secondaryDigest: Buffer | undefined;
  try {
    primaryDigest = deriveDigest(keys.primary, pairingPollVerifierPrefix, token);
    secondaryDigest = keys.secondary
      ? deriveDigest(keys.secondary, pairingPollVerifierPrefix, token)
      : deriveDigest(keys.primary, dummyVerifierPrefix, token);
    const digests: [Buffer, Buffer] = [primaryDigest, secondaryDigest];
    Object.freeze(digests);
    let cleared = false;
    return Object.freeze({
      clear(): void {
        if (!cleared) {
          cleared = true;
          primaryDigest?.fill(0);
          secondaryDigest?.fill(0);
        }
      },
      digests,
      secondaryActive: keys.secondary !== undefined,
      tokenAccepted: decodedToken !== undefined,
    });
  } catch {
    clear(primaryDigest);
    clear(secondaryDigest);
    fail("derivation_failed");
  } finally {
    token.fill(0);
  }
}

export function createConfiguredPairingPollVerifier(
  environment: Environment = process.env,
): PairingPollVerifier {
  const keys = readKeys(environment);
  let closed = false;
  return Object.freeze({
    close(): void {
      if (!closed) {
        closed = true;
        clear(keys.primary);
        clear(keys.secondary);
      }
    },
    derive(token: unknown): PairingPollVerifierCandidates {
      if (closed) {
        fail("closed");
      }
      return createCandidates(keys, token);
    },
  });
}
