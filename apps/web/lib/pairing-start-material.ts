import "server-only";

import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";

import { pairingChallengeBytes, pairingIdPattern } from "./pairing-possession-verifier";
import { pairingPollTokenBytes } from "./pairing-poll-verifier";
import { pairingUserCodeAlphabet, pairingUserCodePattern } from "./pairing-user-code-verifier";

const identifierBytes = 16;
const userCodeEntropyBytes = 8;
const entropyBytes =
  identifierBytes + pairingPollTokenBytes + pairingChallengeBytes + userCodeEntropyBytes;
const userCodeMask = (1n << 60n) - 1n;

export const pairingStartLifetimeMs = 9 * 60 * 1_000;

export interface PairingStartMaterial {
  readonly expiresAt: string;
  readonly pairingChallenge: Buffer;
  readonly pairingChallengeBase64Url: string;
  readonly pairingId: string;
  readonly pollToken: string;
  readonly userCode: string;
  clear(): void;
}

function encodeIdentifier(prefix: "pair_", bytes: Buffer): string {
  const value = `${prefix}${bytes.toString("base64url")}`;
  if (!pairingIdPattern.test(value)) {
    throw new Error("pairing material unavailable");
  }
  return value;
}

function encodeUserCode(bytes: Buffer): string {
  let value = bytes.readBigUInt64BE() & userCodeMask;
  const characters = Array.from({ length: 12 }, () => {
    const character = pairingUserCodeAlphabet[Number(value & 31n)];
    value >>= 5n;
    return character;
  }).reverse();
  const code = `${characters.slice(0, 4).join("")}-${characters.slice(4, 8).join("")}-${characters
    .slice(8)
    .join("")}`;
  if (!pairingUserCodePattern.test(code)) {
    throw new Error("pairing material unavailable");
  }
  return code;
}

export function createPairingStartMaterial(
  nowMilliseconds = Date.now(),
  generate = randomBytes,
): PairingStartMaterial {
  let entropy: Buffer | undefined;
  let challenge: Buffer | undefined;
  try {
    if (!Number.isSafeInteger(nowMilliseconds) || nowMilliseconds < 0) {
      throw new Error("pairing material unavailable");
    }
    entropy = generate(entropyBytes);
    if (!Buffer.isBuffer(entropy) || entropy.length !== entropyBytes) {
      throw new Error("pairing material unavailable");
    }
    let combined = 0;
    for (const byte of entropy) {
      combined |= byte;
    }
    if (combined === 0) {
      throw new Error("pairing material unavailable");
    }
    const identifier = entropy.subarray(0, identifierBytes);
    const pollStart = identifierBytes;
    const challengeStart = pollStart + pairingPollTokenBytes;
    const codeStart = challengeStart + pairingChallengeBytes;
    challenge = Buffer.from(entropy.subarray(challengeStart, codeStart));
    const expiresAt = new Date(nowMilliseconds + pairingStartLifetimeMs).toISOString();
    if (!/^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(expiresAt)) {
      throw new Error("pairing material unavailable");
    }
    const retainedChallenge = Buffer.from(challenge);
    let cleared = false;
    return Object.freeze({
      clear(): void {
        if (!cleared) {
          cleared = true;
          retainedChallenge.fill(0);
        }
      },
      expiresAt,
      pairingChallenge: retainedChallenge,
      pairingChallengeBase64Url: retainedChallenge.toString("base64url"),
      pairingId: encodeIdentifier("pair_", identifier),
      pollToken: entropy.subarray(pollStart, challengeStart).toString("base64url"),
      userCode: encodeUserCode(entropy.subarray(codeStart)),
    });
  } finally {
    entropy?.fill(0);
    challenge?.fill(0);
  }
}
