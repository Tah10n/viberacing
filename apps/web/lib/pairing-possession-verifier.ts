import "server-only";

import { Buffer } from "node:buffer";
import { createHash, timingSafeEqual } from "node:crypto";

import { verifyAsync as verifyEd25519Strict } from "@noble/ed25519";
import type { ConnectorDiscoveryManifestV1, ConnectorPairingStartV1 } from "@viberacing/contracts";

export const pairingPublicKeyBytes = 32;
export const pairingChallengeBytes = 32;
export const pairingSignatureBytes = 64;
export const pairingStartNonceBytes = 16;
export const pairingStartMaximumAgeMilliseconds = 60_000;
export const pairingStartMaximumFutureSkewMilliseconds = 5_000;
export const pairingStartPossessionMessagePrefix = "viberacing-pairing-start-possession-v1";
export const pairingPollPossessionMessagePrefix = "viberacing-pairing-poll-possession-v1";
export const pairingIdPattern = /^pair_[A-Za-z0-9_-]{22}$/;

const lowerHexDigestPattern = /^[a-f0-9]{64}$/;
const timestampPattern = /^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const maximumManifestBytes = 16 * 1024;

export interface VerifiedPairingStart {
  readonly installationPublicKey: Buffer;
  readonly manifestDigest: Buffer;
  readonly manifestDigestHex: string;
  readonly startProofDigest: Buffer;
  clear(): void;
}

export interface PairingPollPossessionMaterial {
  readonly installationPublicKey: Uint8Array;
  readonly pairingChallenge: Uint8Array;
  readonly pairingId: string;
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
  if (decoded.length !== expectedBytes || decoded.toString("base64url") !== value) {
    decoded.fill(0);
    return undefined;
  }
  return decoded;
}

function hasNonzeroByte(value: Uint8Array): boolean {
  let combined = 0;
  for (const byte of value) {
    combined |= byte;
  }
  return combined !== 0;
}

function canonicalManifestBytes(manifest: ConnectorDiscoveryManifestV1): Buffer | undefined {
  try {
    const bytes = Buffer.from(JSON.stringify(manifest), "utf8");
    if (bytes.length === 0 || bytes.length > maximumManifestBytes) {
      bytes.fill(0);
      return undefined;
    }
    return bytes;
  } catch {
    return undefined;
  }
}

function exactTimestampMilliseconds(value: string): number | undefined {
  if (!timestampPattern.test(value)) {
    return undefined;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
    ? milliseconds
    : undefined;
}

function startMessage(
  manifestDigestHex: string,
  clientRateIdentifier: string,
  signedAt: string,
  nonce: string,
): Buffer | undefined {
  if (!lowerHexDigestPattern.test(manifestDigestHex)) {
    return undefined;
  }
  return Buffer.from(
    [
      pairingStartPossessionMessagePrefix,
      manifestDigestHex,
      clientRateIdentifier,
      signedAt,
      nonce,
    ].join("\n"),
    "utf8",
  );
}

/**
 * Verifies one canonical discovery manifest and its fresh installation-key proof.
 *
 * The caller must first validate the complete request against ConnectorPairingStartV1. The digest
 * is calculated over the exact property order retained by JSON.parse, matching the connector's
 * canonical serializer. Reordered or mutated manifests therefore fail closed.
 */
export async function verifyPairingStartPossession(
  request: ConnectorPairingStartV1,
  nowMilliseconds = Date.now(),
): Promise<VerifiedPairingStart | undefined> {
  let manifestBytes: Buffer | undefined;
  let manifestDigest: Buffer | undefined;
  let publicKey: Buffer | undefined;
  let nonce: Buffer | undefined;
  let signature: Buffer | undefined;
  let message: Buffer | undefined;
  let proofDigest: Buffer | undefined;
  try {
    const signedAtMilliseconds = exactTimestampMilliseconds(
      request.installationPossessionProof.signedAt,
    );
    if (
      !Number.isSafeInteger(nowMilliseconds) ||
      signedAtMilliseconds === undefined ||
      signedAtMilliseconds < nowMilliseconds - pairingStartMaximumAgeMilliseconds ||
      signedAtMilliseconds > nowMilliseconds + pairingStartMaximumFutureSkewMilliseconds
    ) {
      return undefined;
    }
    manifestBytes = canonicalManifestBytes(request.discoveryManifest);
    publicKey = decodeCanonicalBase64Url(
      request.discoveryManifest.installationPublicKey,
      pairingPublicKeyBytes,
    );
    nonce = decodeCanonicalBase64Url(
      request.installationPossessionProof.nonce,
      pairingStartNonceBytes,
    );
    signature = decodeCanonicalBase64Url(
      request.installationPossessionProof.signature,
      pairingSignatureBytes,
    );
    if (
      manifestBytes === undefined ||
      publicKey === undefined ||
      nonce === undefined ||
      signature === undefined ||
      !hasNonzeroByte(publicKey) ||
      !hasNonzeroByte(nonce) ||
      !hasNonzeroByte(signature)
    ) {
      return undefined;
    }
    manifestDigest = createHash("sha256").update(manifestBytes).digest();
    const digestHex = manifestDigest.toString("hex");
    message = startMessage(
      digestHex,
      request.clientRateIdentifier,
      request.installationPossessionProof.signedAt,
      request.installationPossessionProof.nonce,
    );
    if (
      message === undefined ||
      !(await verifyEd25519Strict(signature, message, publicKey, { zip215: false }))
    ) {
      return undefined;
    }
    proofDigest = createHash("sha256").update(message).digest();
    const retainedKey = Buffer.from(publicKey);
    const retainedManifestDigest = Buffer.from(manifestDigest);
    const retainedProofDigest = Buffer.from(proofDigest);
    let cleared = false;
    return Object.freeze({
      clear(): void {
        if (!cleared) {
          cleared = true;
          retainedKey.fill(0);
          retainedManifestDigest.fill(0);
          retainedProofDigest.fill(0);
        }
      },
      installationPublicKey: retainedKey,
      manifestDigest: retainedManifestDigest,
      manifestDigestHex: digestHex,
      startProofDigest: retainedProofDigest,
    });
  } catch {
    return undefined;
  } finally {
    manifestBytes?.fill(0);
    manifestDigest?.fill(0);
    publicKey?.fill(0);
    nonce?.fill(0);
    signature?.fill(0);
    message?.fill(0);
    proofDigest?.fill(0);
  }
}

function exactPollMaterial(
  value: PairingPollPossessionMaterial,
): { challenge: Buffer; key: Buffer; pairingId: string } | undefined {
  let challenge: Buffer | undefined;
  let key: Buffer | undefined;
  try {
    if (
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).length !== 3 ||
      !pairingIdPattern.test(value.pairingId) ||
      !(value.pairingChallenge instanceof Uint8Array) ||
      value.pairingChallenge.byteLength !== pairingChallengeBytes ||
      !(value.installationPublicKey instanceof Uint8Array) ||
      value.installationPublicKey.byteLength !== pairingPublicKeyBytes
    ) {
      return undefined;
    }
    challenge = Buffer.from(value.pairingChallenge);
    key = Buffer.from(value.installationPublicKey);
    if (!hasNonzeroByte(challenge) || !hasNonzeroByte(key)) {
      return undefined;
    }
    return { challenge, key, pairingId: value.pairingId };
  } catch {
    challenge?.fill(0);
    key?.fill(0);
    return undefined;
  }
}

/** Verifies the exact approved-batch poll proof before activation. */
export async function verifyPairingPollPossession(
  materialInput: PairingPollPossessionMaterial,
  signatureInput: unknown,
): Promise<boolean> {
  const signature = decodeCanonicalBase64Url(signatureInput, pairingSignatureBytes);
  let material: ReturnType<typeof exactPollMaterial>;
  let message: Buffer | undefined;
  try {
    material = exactPollMaterial(materialInput);
    if (signature === undefined || material === undefined || !hasNonzeroByte(signature)) {
      return false;
    }
    message = Buffer.from(
      [
        pairingPollPossessionMessagePrefix,
        material.pairingId,
        material.challenge.toString("base64url"),
        material.key.toString("base64url"),
      ].join("\n"),
      "utf8",
    );
    return await verifyEd25519Strict(signature, message, material.key, { zip215: false });
  } catch {
    return false;
  } finally {
    material?.challenge.fill(0);
    material?.key.fill(0);
    signature?.fill(0);
    message?.fill(0);
  }
}

export function sameDigest(left: Uint8Array, right: Uint8Array): boolean {
  const leftCopy = Buffer.from(left);
  const rightCopy = Buffer.from(right);
  try {
    return leftCopy.length === rightCopy.length && timingSafeEqual(leftCopy, rightCopy);
  } finally {
    leftCopy.fill(0);
    rightCopy.fill(0);
  }
}
