import "server-only";

import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";

const environmentKeys = {
  primary: "VIBERACING_WEB_PAIRING_CODE_PRIMARY_KEY_BASE64URL",
  secondary: "VIBERACING_WEB_PAIRING_CODE_SECONDARY_KEY_BASE64URL",
} as const;
const pollEnvironmentKeys = [
  "VIBERACING_WEB_PAIRING_POLL_PRIMARY_KEY_BASE64URL",
  "VIBERACING_WEB_PAIRING_POLL_SECONDARY_KEY_BASE64URL",
] as const;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;
const inactiveVerifierPrefix = "viberacing-pairing-user-code-verifier-inactive-v1";
const invalidVerifierPrefix = "viberacing-pairing-user-code-verifier-invalid-v1";

export const pairingUserCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const pairingUserCodeLength = 14;
export const pairingUserCodePattern = /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/;
export const pairingUserCodeVerifierDigestBytes = 32;
export const pairingUserCodeVerifierKeyBytes = 32;
export const pairingUserCodeVerifierPrefix = "viberacing-pairing-user-code-verifier-v1";

export type PairingUserCodeVerifierConfigurationErrorCode =
  | "closed"
  | "cross_purpose_key_material"
  | "derivation_failed"
  | "duplicate_key_material"
  | "environment_unreadable"
  | "primary_key_invalid"
  | "secondary_key_invalid";

export class PairingUserCodeVerifierConfigurationError extends Error {
  readonly code: PairingUserCodeVerifierConfigurationErrorCode;

  constructor(code: PairingUserCodeVerifierConfigurationErrorCode) {
    super("Pairing user-code verifier configuration is invalid.");
    this.name = "PairingUserCodeVerifierConfigurationError";
    this.code = code;
  }
}

export interface PairingUserCodeVerifierCandidates {
  readonly codeAccepted: boolean;
  readonly digests: readonly [Buffer, Buffer];
  readonly secondaryActive: boolean;
  clear(): void;
}

export interface PairingUserCodeVerifier {
  close(): void;
  derive(code: unknown): PairingUserCodeVerifierCandidates;
}

type Environment = Readonly<Record<string, unknown>>;

interface PairingUserCodeVerifierKeys {
  readonly primary: Buffer;
  readonly secondary?: Buffer;
}

function fail(code: PairingUserCodeVerifierConfigurationErrorCode): never {
  throw new PairingUserCodeVerifierConfigurationError(code);
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

function conflictsWithPollKey(key: Buffer, environment: Environment): boolean {
  const decodedPollKeys: Buffer[] = [];
  try {
    for (const name of pollEnvironmentKeys) {
      const decoded = decodeCanonicalBase64Url(environment[name], pairingUserCodeVerifierKeyBytes);
      if (decoded !== undefined) {
        decodedPollKeys.push(decoded);
      }
    }
    return decodedPollKeys.some((candidate) => timingSafeEqual(key, candidate));
  } finally {
    for (const candidate of decodedPollKeys) {
      candidate.fill(0);
    }
  }
}

function readKeys(environment: Environment): PairingUserCodeVerifierKeys {
  let primary: Buffer | undefined;
  let secondary: Buffer | undefined;
  try {
    primary = decodeCanonicalBase64Url(
      environment[environmentKeys.primary],
      pairingUserCodeVerifierKeyBytes,
    );
    if (primary === undefined) {
      fail("primary_key_invalid");
    }
    if (conflictsWithPollKey(primary, environment)) {
      fail("cross_purpose_key_material");
    }

    const secondaryValue = environment[environmentKeys.secondary];
    if (secondaryValue === undefined) {
      return { primary };
    }
    secondary = decodeCanonicalBase64Url(secondaryValue, pairingUserCodeVerifierKeyBytes);
    if (secondary === undefined) {
      fail("secondary_key_invalid");
    }
    if (timingSafeEqual(primary, secondary)) {
      fail("duplicate_key_material");
    }
    if (conflictsWithPollKey(secondary, environment)) {
      fail("cross_purpose_key_material");
    }
    return { primary, secondary };
  } catch (error) {
    clear(primary);
    clear(secondary);
    if (error instanceof PairingUserCodeVerifierConfigurationError) {
      throw error;
    }
    fail("environment_unreadable");
  }
}

function deriveDigest(key: Buffer, prefix: string, code: string): Buffer {
  const hmac = createHmac("sha256", key);
  hmac.update(prefix, "utf8");
  hmac.update("\n", "utf8");
  hmac.update(code, "ascii");
  return hmac.digest();
}

function createCandidates(
  keys: PairingUserCodeVerifierKeys,
  codeInput: unknown,
): PairingUserCodeVerifierCandidates {
  const codeAccepted =
    typeof codeInput === "string" &&
    codeInput.length === pairingUserCodeLength &&
    pairingUserCodePattern.test(codeInput);
  const code = codeAccepted ? codeInput : "0000-0000-0000";
  const activePrefix = codeAccepted ? pairingUserCodeVerifierPrefix : invalidVerifierPrefix;
  let primaryDigest: Buffer | undefined;
  let secondaryDigest: Buffer | undefined;
  try {
    primaryDigest = deriveDigest(keys.primary, activePrefix, code);
    secondaryDigest = keys.secondary
      ? deriveDigest(keys.secondary, activePrefix, code)
      : deriveDigest(keys.primary, inactiveVerifierPrefix, code);
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
      codeAccepted,
      digests,
      secondaryActive: keys.secondary !== undefined,
    });
  } catch {
    clear(primaryDigest);
    clear(secondaryDigest);
    fail("derivation_failed");
  }
}

export function createConfiguredPairingUserCodeVerifier(
  environment: Environment = process.env,
): PairingUserCodeVerifier {
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
    derive(code: unknown): PairingUserCodeVerifierCandidates {
      if (closed) {
        fail("closed");
      }
      return createCandidates(keys, code);
    },
  });
}
