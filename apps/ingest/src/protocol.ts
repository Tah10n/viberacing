import { createHash } from "node:crypto";

export const communitySyncMethod = "POST";
export const communitySyncRequestTarget = "/v1/community/sync";
export const communitySyncMediaType = "application/json";
export const maximumCommunitySyncBodyBytes = 8_192;
export const maximumCommunitySyncRawHeaderPairs = 64;
export const maximumCommunitySyncHeaderNameCharacters = 64;
export const maximumCommunitySyncHeaderValueCharacters = 256;
export const maximumCommunitySyncJsonDepth = 8;
export const maximumCommunitySyncJsonNodes = 128;
export const maximumCommunitySyncJsonObjectMembers = 64;
export const maximumCommunitySyncJsonArrayItems = 64;
export const maximumCommunitySyncJsonNumberCharacters = 64;
export const maximumCommunitySyncJsonStringCodeUnits = 256;

export const originProofMessagePrefix = "viberacing-origin-proof-v1";
export const originProofKeyBytes = 32;
export const originProofBytes = 32;
export const originProofNonceBytes = 16;
export const originProofMaximumAgeMilliseconds = 60_000;
export const originProofMaximumAgeBoundary = "exclusive";
export const originProofMaximumFutureSkewMilliseconds = 5_000;
export const originProofMaximumFutureSkewBoundary = "inclusive";

export const deviceSignatureMessagePrefix = "viberacing-device-request-v1";
export const devicePublicKeyBytes = 32;
export const deviceSignatureBytes = 64;
export const deviceNonceBytes = 16;

export const headerNames = Object.freeze({
  contentType: "content-type",
  deviceId: "x-viberacing-device-id",
  deviceNonce: "x-viberacing-device-nonce",
  deviceSignature: "x-viberacing-device-signature",
  deviceTimestamp: "x-viberacing-device-timestamp",
  idempotencyKey: "idempotency-key",
  originKeyId: "x-viberacing-origin-key-id",
  originNonce: "x-viberacing-origin-nonce",
  originProof: "x-viberacing-origin-proof",
  originTimestamp: "x-viberacing-origin-timestamp",
} as const);

export const requiredHeaderNames = Object.freeze(Object.values(headerNames));

export const deviceIdPattern = /^dev_[A-Za-z0-9_-]{22}$/;
export const idempotencyKeyPattern = /^syn_[A-Za-z0-9_-]{22}$/;
export const originKeyIdPattern = /^edge_[A-Za-z0-9_-]{1,22}$/;

const canonicalTimestampPattern =
  /^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const canonicalBase64UrlPattern = /^[A-Za-z0-9_-]+$/;

export function canonicalTimestampMilliseconds(value: string): number | undefined {
  if (!canonicalTimestampPattern.test(value)) {
    return undefined;
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return undefined;
  }
  return milliseconds;
}

export function decodeCanonicalBase64Url(value: string, expectedBytes: number): Buffer | undefined {
  const expectedLength = Math.ceil((expectedBytes * 8) / 6);
  if (value.length !== expectedLength || !canonicalBase64UrlPattern.test(value)) {
    return undefined;
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== expectedBytes || decoded.toString("base64url") !== value) {
    return undefined;
  }
  return decoded;
}

export function digestBody(body: Uint8Array): Readonly<{
  base64Url: string;
  hex: string;
}> {
  const digest = createHash("sha256").update(body).digest();
  return Object.freeze({
    base64Url: digest.toString("base64url"),
    hex: digest.toString("hex"),
  });
}

export function createOriginProofMessage(
  input: Readonly<{
    bodyDigestBase64Url: string;
    keyId: string;
    nonce: string;
    timestamp: string;
  }>,
): Buffer {
  return Buffer.from(
    [
      originProofMessagePrefix,
      input.keyId,
      communitySyncMethod,
      communitySyncRequestTarget,
      input.bodyDigestBase64Url,
      input.timestamp,
      input.nonce,
    ].join("\n"),
    "utf8",
  );
}

export function createDeviceSignatureMessage(
  input: Readonly<{
    bodyDigestBase64Url: string;
    deviceId: string;
    idempotencyKey: string;
    nonce: string;
    timestamp: string;
  }>,
): Buffer {
  return Buffer.from(
    [
      deviceSignatureMessagePrefix,
      communitySyncMethod,
      communitySyncRequestTarget,
      input.bodyDigestBase64Url,
      input.deviceId,
      input.nonce,
      input.timestamp,
      input.idempotencyKey,
    ].join("\n"),
    "utf8",
  );
}
