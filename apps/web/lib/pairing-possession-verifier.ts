import "server-only";

import { Buffer } from "node:buffer";

import { verifyAsync as verifyEd25519Strict } from "@noble/ed25519";

/** Exact byte length of a pending device Ed25519 public key. */
export const pairingPublicKeyBytes = 32;

/** Exact byte length of a server-generated pairing challenge. */
export const pairingChallengeBytes = 32;

/** Exact byte length of an Ed25519 pairing-possession signature. */
export const pairingSignatureBytes = 64;

/** Version 1 pairing-possession domain separator. */
export const pairingPossessionMessagePrefix = "viberacing-pairing-possession-v1";

/** Canonical lower-case version-4 pairing identifier shape. */
export const pairingIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface ValidatedPairingVerificationMaterial {
  readonly challenge: Buffer;
  readonly pairingId: string;
  readonly publicKey: Buffer;
}

const materialKeys = new Set(["pairingChallenge", "pairingId", "publicKey"]);

function isPlainRecord(value: unknown): value is object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: object): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === materialKeys.size &&
    keys.every((key) => typeof key === "string" && materialKeys.has(key))
  );
}

function ownEnumerableDataValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
    return undefined;
  }
  return descriptor.value as unknown;
}

function isExactBytes(value: unknown, expectedLength: number): value is Uint8Array {
  if (!(value instanceof Uint8Array)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) {
    return false;
  }
  return value.buffer instanceof ArrayBuffer && value.byteLength === expectedLength;
}

function readVerificationMaterial(
  value: unknown,
): ValidatedPairingVerificationMaterial | undefined {
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value)) {
      return undefined;
    }
    const pairingId = ownEnumerableDataValue(value, "pairingId");
    const challengeInput = ownEnumerableDataValue(value, "pairingChallenge");
    const publicKeyInput = ownEnumerableDataValue(value, "publicKey");
    if (
      typeof pairingId !== "string" ||
      pairingId.length !== 36 ||
      !pairingIdPattern.test(pairingId) ||
      !isExactBytes(challengeInput, pairingChallengeBytes) ||
      !isExactBytes(publicKeyInput, pairingPublicKeyBytes)
    ) {
      return undefined;
    }
    return {
      challenge: Buffer.from(challengeInput),
      pairingId,
      publicKey: Buffer.from(publicKeyInput),
    };
  } catch {
    return undefined;
  }
}

function decodeCanonicalBase64Url(value: unknown, expectedBytes: number): Buffer | undefined {
  const expectedCharacters = Math.ceil((expectedBytes * 8) / 6);
  if (
    typeof value !== "string" ||
    value.length !== expectedCharacters ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    return undefined;
  }
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === expectedBytes && decoded.toString("base64url") === value
    ? decoded
    : undefined;
}

function createPairingPossessionMessage(material: ValidatedPairingVerificationMaterial): Buffer {
  return Buffer.from(
    [
      pairingPossessionMessagePrefix,
      material.pairingId,
      material.challenge.toString("base64url"),
      material.publicKey.toString("base64url"),
    ].join("\n"),
    "utf8",
  );
}

/**
 * Strictly verifies one exact version 1 proof against approved database material.
 *
 * The caller must first resolve the presented poll token to one approved, unexpired transaction
 * and supply only that transaction's immutable identifier, challenge, and pending public key. This
 * kernel copies every byte input before its asynchronous verification step and returns only a
 * generic boolean. It does not look up poll tokens, approve or activate pairings, issue device IDs,
 * perform rate limiting, or translate an HTTP request.
 */
export async function verifyPairingPossession(
  materialInput: unknown,
  signatureBase64Url: unknown,
): Promise<boolean> {
  const signature = decodeCanonicalBase64Url(signatureBase64Url, pairingSignatureBytes);
  if (signature === undefined) {
    return false;
  }
  let material: ValidatedPairingVerificationMaterial | undefined;
  let message: Buffer | undefined;
  try {
    material = readVerificationMaterial(materialInput);
    if (material === undefined) {
      return false;
    }
    message = createPairingPossessionMessage(material);
    return await verifyEd25519Strict(signature, message, material.publicKey, { zip215: false });
  } catch {
    return false;
  } finally {
    material?.challenge.fill(0);
    material?.publicKey.fill(0);
    signature.fill(0);
    message?.fill(0);
  }
}
