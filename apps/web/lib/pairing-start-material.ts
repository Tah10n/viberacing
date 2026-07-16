import "server-only";

import { Buffer } from "node:buffer";
import crypto from "node:crypto";

import { pairingChallengeBytes, pairingIdPattern } from "./pairing-possession-verifier";
import { pairingPollTokenBytes } from "./pairing-poll-verifier";
import { pairingUserCodeAlphabet, pairingUserCodePattern } from "./pairing-user-code-verifier";

const materialEntropyBytes = pairingPollTokenBytes + pairingChallengeBytes + 8;
const userCodeMask = (1n << 60n) - 1n;
const pairingLifetimeMs = 9 * 60 * 1_000;

export const pairingStartLifetimeMs = pairingLifetimeMs;

export type PairingStartMaterialErrorCode = "clock_unavailable" | "entropy_unavailable";

export class PairingStartMaterialError extends Error {
  readonly code: PairingStartMaterialErrorCode;

  constructor(code: PairingStartMaterialErrorCode) {
    super("Pairing start material is unavailable.");
    this.name = "PairingStartMaterialError";
    this.code = code;
  }
}

export interface PairingStartMaterial {
  readonly deviceKeyId: string;
  readonly expiresAt: string;
  readonly pairingChallenge: Buffer;
  readonly pairingChallengeBase64Url: string;
  readonly pairingId: string;
  readonly pollToken: string;
  readonly userCode: string;
  clear(): void;
}

function fail(code: PairingStartMaterialErrorCode): never {
  throw new PairingStartMaterialError(code);
}

function createUuid(): string {
  const value = crypto.randomUUID();
  if (!pairingIdPattern.test(value)) {
    fail("entropy_unavailable");
  }
  return value;
}

function encodeUserCode(entropy: Buffer): string {
  let value = entropy.readBigUInt64BE() & userCodeMask;
  const characters = Array.from({ length: 12 }, () => {
    const character = pairingUserCodeAlphabet[Number(value & 31n)];
    value >>= 5n;
    return character;
  }).reverse();
  const code = `${characters.slice(0, 4).join("")}-${characters.slice(4, 8).join("")}-${characters
    .slice(8)
    .join("")}`;
  if (!pairingUserCodePattern.test(code)) {
    fail("entropy_unavailable");
  }
  return code;
}

function createExpiry(): string {
  try {
    const now = Date.now();
    const expiryMilliseconds = now + pairingLifetimeMs;
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(expiryMilliseconds)) {
      fail("clock_unavailable");
    }
    const expiresAt = new Date(expiryMilliseconds).toISOString();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expiresAt)) {
      fail("clock_unavailable");
    }
    return expiresAt;
  } catch (error) {
    if (error instanceof PairingStartMaterialError) {
      throw error;
    }
    fail("clock_unavailable");
  }
}

export function createPairingStartMaterial(): PairingStartMaterial {
  let entropy: Buffer | undefined;
  let pairingChallenge: Buffer | undefined;
  try {
    const generated = crypto.randomBytes(materialEntropyBytes) as unknown;
    if (!Buffer.isBuffer(generated) || generated.length !== materialEntropyBytes) {
      fail("entropy_unavailable");
    }
    entropy = generated;
    const pollToken = entropy.subarray(0, pairingPollTokenBytes).toString("base64url");
    pairingChallenge = Buffer.from(
      entropy.subarray(pairingPollTokenBytes, pairingPollTokenBytes + pairingChallengeBytes),
    );
    const userCode = encodeUserCode(
      entropy.subarray(pairingPollTokenBytes + pairingChallengeBytes),
    );
    const pairingChallengeBase64Url = pairingChallenge.toString("base64url");
    const material = {
      clear(): void {
        pairingChallenge?.fill(0);
      },
      deviceKeyId: createUuid(),
      expiresAt: createExpiry(),
      pairingChallenge,
      pairingChallengeBase64Url,
      pairingId: createUuid(),
      pollToken,
      userCode,
    } satisfies PairingStartMaterial;
    return Object.freeze(material);
  } catch (error) {
    pairingChallenge?.fill(0);
    if (error instanceof PairingStartMaterialError) {
      throw error;
    }
    return fail("entropy_unavailable");
  } finally {
    entropy?.fill(0);
  }
}
