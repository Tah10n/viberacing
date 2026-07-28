import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { verifyAsync as verifyEd25519Strict } from "@noble/ed25519";
import { validateUsageSyncV1, type UsageSyncV1 } from "@viberacing/contracts";

import { parseBoundedCommunitySyncJson } from "./bounded-json.js";
import {
  canonicalTimestampMilliseconds,
  communitySyncMediaType,
  communitySyncMethod,
  type CommunitySyncRequestTarget,
  createDeviceSignatureMessage,
  createOriginProofMessage,
  decodeCanonicalBase64Url,
  deviceIdPattern,
  deviceNonceBytes,
  devicePublicKeyBytes,
  deviceSignatureBytes,
  digestBody,
  headerNames,
  idempotencyKeyPattern,
  maximumCommunitySyncBodyBytes,
  maximumCommunitySyncHeaderNameCharacters,
  maximumCommunitySyncHeaderValueCharacters,
  maximumCommunitySyncRawHeaderPairs,
  originKeyIdPattern,
  originProofBytes,
  originProofKeyBytes,
  originProofMaximumAgeMilliseconds,
  originProofMaximumFutureSkewMilliseconds,
  originProofNonceBytes,
  requiredHeaderNames,
  usageSyncRequestTarget,
} from "./protocol.js";

export type CommunitySyncVerificationErrorCode =
  | "dependency_unavailable"
  | "device_rejected"
  | "invalid_body"
  | "invalid_request"
  | "origin_rejected";

export class CommunitySyncVerificationError extends Error {
  readonly code: CommunitySyncVerificationErrorCode;

  constructor(code: CommunitySyncVerificationErrorCode) {
    super("Community sync request rejected.");
    this.name = "CommunitySyncVerificationError";
    this.code = code;
  }
}

export class CommunitySyncVerifierConfigurationError extends Error {
  constructor() {
    super("Community sync verifier configuration is invalid.");
    this.name = "CommunitySyncVerifierConfigurationError";
  }
}

export interface OriginProofMaterial {
  readonly expiresAtMilliseconds: number;
  readonly keyId: string;
  readonly nonceDigestHex: string;
}

export interface DeviceVerificationMaterial {
  readonly accountingRevision: number;
  readonly agentAccountId: string;
  readonly deviceKeyId: string;
  readonly identityAssurance: "community_local";
  readonly installationId: string;
  readonly maximumBackfillDays: number;
  readonly provider: string;
  readonly publicKey: Uint8Array;
  readonly readerVersion: string;
  readonly scopeKind: "agent_account";
}

export interface CommunitySyncVerifierOptions {
  readonly now: () => number;
  readonly originKeys: readonly Readonly<{
    keyId: string;
    secret: Uint8Array;
  }>[];
  readonly readDeviceVerificationMaterial: (
    deviceId: string,
  ) => DeviceVerificationMaterial | null | Promise<DeviceVerificationMaterial | null>;
}

export interface VerifiedCommunitySync {
  readonly accountingRevision: number;
  readonly agentAccountId: string;
  readonly bodyDigestHex: string;
  readonly deviceNonceDigestHex: string;
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly idempotencyKey: string;
  readonly originExpiresAtMilliseconds: number;
  readonly originKeyId: string;
  readonly originNonceDigestHex: string;
  readonly payload: UsageSyncV1;
  readonly provider: string;
  readonly readerVersion: string;
  readonly requestTarget: CommunitySyncRequestTarget;
  readonly signatureBase64Url: string;
  readonly scopeKind: "agent_account";
}

export interface CommunitySyncVerifier {
  verify(request: unknown): Promise<VerifiedCommunitySync>;
}

interface RawRequestEnvelope {
  readonly body: Buffer;
  readonly headers: Readonly<Record<RequiredHeaderName, string>>;
  readonly requestTarget: CommunitySyncRequestTarget;
}

interface ValidatedDeviceMaterial {
  readonly accountingRevision: number;
  readonly agentAccountId: string;
  readonly deviceKeyId: string;
  readonly identityAssurance: "community_local";
  readonly installationId: string;
  readonly maximumBackfillDays: number;
  readonly provider: string;
  readonly publicKey: Buffer;
  readonly readerVersion: string;
  readonly scopeKind: "agent_account";
}

interface ValidatedOptions {
  readonly now: CommunitySyncVerifierOptions["now"];
  readonly originKeys: ReadonlyMap<string, Buffer>;
  readonly readDeviceVerificationMaterial: CommunitySyncVerifierOptions["readDeviceVerificationMaterial"];
}

const requestKeys = new Set(["method", "rawBody", "rawHeaders", "requestTarget"]);
const optionKeys = new Set(["now", "originKeys", "readDeviceVerificationMaterial"]);
const originKeyKeys = new Set(["keyId", "secret"]);
const deviceMaterialKeys = new Set([
  "accountingRevision",
  "agentAccountId",
  "deviceKeyId",
  "identityAssurance",
  "installationId",
  "maximumBackfillDays",
  "provider",
  "publicKey",
  "readerVersion",
  "scopeKind",
]);
const requiredHeaderNameSet = new Set<string>(requiredHeaderNames);
const agentAccountIdPattern = /^acc_[A-Za-z0-9_-]{22}$/;
const deviceKeyIdPattern = /^key_[A-Za-z0-9_-]{22}$/;
const installationIdPattern = /^ins_[A-Za-z0-9_-]{22}$/;
const providerPattern = /^[a-z][a-z0-9_]{1,23}$/;
const readerVersionPattern = /^[a-z][a-z0-9_]{2,63}$/;
const headerNamePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const headerValuePattern = /^[\x20-\x7e]*$/;
const dummyOriginSecret = Buffer.alloc(originProofKeyBytes, 0xa5);
const dummyDevicePublicKey = Buffer.from(
  "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  "hex",
);
const invalidDeviceMaterial = Symbol("invalid-device-material");

type RequiredHeaderName = (typeof headerNames)[keyof typeof headerNames];

function fail(code: CommunitySyncVerificationErrorCode): never {
  throw new CommunitySyncVerificationError(code);
}

function configurationFail(): never {
  throw new CommunitySyncVerifierConfigurationError();
}

function isPlainRecord(value: unknown): value is object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: object, expected: ReadonlySet<string>): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.size &&
    keys.every((key) => typeof key === "string" && expected.has(key))
  );
}

function ownDataValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
    configurationFail();
  }
  return descriptor.value as unknown;
}

function ownRequestDataValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
    fail("invalid_request");
  }
  return descriptor.value as unknown;
}

function readDenseArray(value: unknown, maximumLength: number): unknown[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > maximumLength
  ) {
    return undefined;
  }
  const length = lengthDescriptor.value as number;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || !keys.includes("length")) {
    return undefined;
  }
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      return undefined;
    }
    result.push(descriptor.value as unknown);
  }
  return result;
}

function copyExactBytes(value: unknown, expectedLength: number): Buffer | undefined {
  if (!(value instanceof Uint8Array)) {
    return undefined;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) {
    return undefined;
  }
  if (!(value.buffer instanceof ArrayBuffer) || value.byteLength !== expectedLength) {
    return undefined;
  }
  return Buffer.from(value);
}

function readOptions(value: unknown): ValidatedOptions {
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, optionKeys)) {
      configurationFail();
    }
    const now = ownDataValue(value, "now");
    const originKeyValues = readDenseArray(ownDataValue(value, "originKeys"), 2);
    const readDeviceVerificationMaterial = ownDataValue(value, "readDeviceVerificationMaterial");
    if (
      typeof now !== "function" ||
      typeof readDeviceVerificationMaterial !== "function" ||
      originKeyValues === undefined ||
      originKeyValues.length < 1
    ) {
      configurationFail();
    }

    const originKeys = new Map<string, Buffer>();
    for (const candidate of originKeyValues) {
      if (!isPlainRecord(candidate) || !hasExactKeys(candidate, originKeyKeys)) {
        configurationFail();
      }
      const keyId = ownDataValue(candidate, "keyId");
      const secret = copyExactBytes(ownDataValue(candidate, "secret"), originProofKeyBytes);
      if (
        typeof keyId !== "string" ||
        !originKeyIdPattern.test(keyId) ||
        secret === undefined ||
        originKeys.has(keyId)
      ) {
        configurationFail();
      }
      originKeys.set(keyId, secret);
    }

    return {
      now: now as CommunitySyncVerifierOptions["now"],
      originKeys,
      readDeviceVerificationMaterial:
        readDeviceVerificationMaterial as CommunitySyncVerifierOptions["readDeviceVerificationMaterial"],
    };
  } catch (error) {
    if (error instanceof CommunitySyncVerifierConfigurationError) {
      throw error;
    }
    configurationFail();
  }
}

function readRawRequest(value: unknown): RawRequestEnvelope {
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, requestKeys)) {
      fail("invalid_request");
    }
    const requestTarget = ownRequestDataValue(value, "requestTarget");
    if (
      ownRequestDataValue(value, "method") !== communitySyncMethod ||
      requestTarget !== usageSyncRequestTarget
    ) {
      fail("invalid_request");
    }
    const bodyValue = ownRequestDataValue(value, "rawBody");
    const body = copyExactBytes(bodyValue, (bodyValue as Uint8Array | undefined)?.byteLength ?? -1);
    if (body === undefined || body.length < 1 || body.length > maximumCommunitySyncBodyBytes) {
      fail("invalid_request");
    }
    const rawHeaders = readDenseArray(
      ownRequestDataValue(value, "rawHeaders"),
      maximumCommunitySyncRawHeaderPairs * 2,
    );
    if (rawHeaders === undefined || rawHeaders.length % 2 !== 0) {
      fail("invalid_request");
    }

    const headers: Record<string, string> = Object.create(null) as Record<string, string>;
    for (let index = 0; index < rawHeaders.length; index += 2) {
      const rawName = rawHeaders[index];
      const rawValue = rawHeaders[index + 1];
      if (
        typeof rawName !== "string" ||
        rawName.length < 1 ||
        rawName.length > maximumCommunitySyncHeaderNameCharacters ||
        !headerNamePattern.test(rawName) ||
        typeof rawValue !== "string" ||
        rawValue.length > maximumCommunitySyncHeaderValueCharacters ||
        !headerValuePattern.test(rawValue)
      ) {
        fail("invalid_request");
      }
      const name = rawName.toLowerCase();
      if (!requiredHeaderNameSet.has(name)) {
        continue;
      }
      if (Object.hasOwn(headers, name)) {
        fail("invalid_request");
      }
      headers[name] = rawValue;
    }
    if (
      requiredHeaderNames.some((name) => !Object.hasOwn(headers, name)) ||
      headers[headerNames.contentType] !== communitySyncMediaType
    ) {
      fail("invalid_request");
    }
    return {
      body,
      headers: Object.freeze(headers),
      requestTarget,
    };
  } catch (error) {
    if (error instanceof CommunitySyncVerificationError) {
      throw error;
    }
    fail("invalid_request");
  }
}

function canonicalUsagePayload(value: UsageSyncV1): UsageSyncV1 {
  return Object.freeze({
    schemaVersion: 1,
    agentAccountId: value.agentAccountId,
    syncId: value.syncId,
    observedAt: value.observedAt,
    clientVersion: value.clientVersion,
    readerVersion: value.readerVersion,
    dailyEntries: Object.freeze(
      value.dailyEntries.map((entry) =>
        Object.freeze({
          usageDate: entry.usageDate,
          dailyTokenTotal: entry.dailyTokenTotal,
        }),
      ),
    ),
  });
}

function readDeviceMaterial(
  value: unknown,
): ValidatedDeviceMaterial | null | typeof invalidDeviceMaterial {
  try {
    if (value === null) {
      return null;
    }
    if (!isPlainRecord(value) || !hasExactKeys(value, deviceMaterialKeys)) {
      return invalidDeviceMaterial;
    }
    const accountingRevision = ownDataValue(value, "accountingRevision");
    const agentAccountId = ownDataValue(value, "agentAccountId");
    const deviceKeyId = ownDataValue(value, "deviceKeyId");
    const identityAssurance = ownDataValue(value, "identityAssurance");
    const installationId = ownDataValue(value, "installationId");
    const maximumBackfillDays = ownDataValue(value, "maximumBackfillDays");
    const provider = ownDataValue(value, "provider");
    const publicKey = copyExactBytes(ownDataValue(value, "publicKey"), devicePublicKeyBytes);
    const readerVersion = ownDataValue(value, "readerVersion");
    const scopeKind = ownDataValue(value, "scopeKind");
    if (
      typeof accountingRevision !== "number" ||
      !Number.isSafeInteger(accountingRevision) ||
      accountingRevision < 1 ||
      accountingRevision > 32_767 ||
      typeof agentAccountId !== "string" ||
      !agentAccountIdPattern.test(agentAccountId) ||
      typeof deviceKeyId !== "string" ||
      !deviceKeyIdPattern.test(deviceKeyId) ||
      identityAssurance !== "community_local" ||
      typeof installationId !== "string" ||
      !installationIdPattern.test(installationId) ||
      typeof maximumBackfillDays !== "number" ||
      !Number.isSafeInteger(maximumBackfillDays) ||
      maximumBackfillDays < 1 ||
      maximumBackfillDays > 90 ||
      typeof provider !== "string" ||
      !providerPattern.test(provider) ||
      publicKey === undefined ||
      typeof readerVersion !== "string" ||
      !readerVersionPattern.test(readerVersion) ||
      scopeKind !== "agent_account"
    ) {
      return invalidDeviceMaterial;
    }
    return Object.freeze({
      accountingRevision,
      agentAccountId,
      deviceKeyId,
      identityAssurance,
      installationId,
      maximumBackfillDays,
      provider,
      publicKey,
      readerVersion,
      scopeKind,
    });
  } catch {
    return invalidDeviceMaterial;
  }
}

async function verifyEd25519(
  publicKey: Buffer,
  message: Buffer,
  signature: Buffer,
): Promise<boolean> {
  try {
    return await verifyEd25519Strict(signature, message, publicKey, { zip215: false });
  } catch {
    return false;
  }
}

class DefaultCommunitySyncVerifier implements CommunitySyncVerifier {
  readonly #now: CommunitySyncVerifierOptions["now"];
  readonly #originKeys: ReadonlyMap<string, Buffer>;
  readonly #readDeviceVerificationMaterial: CommunitySyncVerifierOptions["readDeviceVerificationMaterial"];

  constructor(options: ValidatedOptions) {
    this.#now = options.now;
    this.#originKeys = options.originKeys;
    this.#readDeviceVerificationMaterial = options.readDeviceVerificationMaterial;
  }

  async verify(request: unknown): Promise<VerifiedCommunitySync> {
    const envelope = readRawRequest(request);
    const bodyDigest = digestBody(envelope.body);
    const origin = this.#verifyOrigin(
      envelope.headers,
      bodyDigest.base64Url,
      envelope.requestTarget,
    );

    let parsed: unknown;
    try {
      parsed = parseBoundedCommunitySyncJson(envelope.body);
    } catch {
      fail("invalid_body");
    }
    const validation = validateUsageSyncV1(parsed);
    if (!validation.ok) {
      fail("invalid_body");
    }
    const payload = canonicalUsagePayload(validation.value);

    const deviceId = envelope.headers[headerNames.deviceId];
    const deviceNonce = envelope.headers[headerNames.deviceNonce];
    const deviceTimestamp = envelope.headers[headerNames.deviceTimestamp];
    const idempotencyKey = envelope.headers[headerNames.idempotencyKey];
    const signatureBase64Url = envelope.headers[headerNames.deviceSignature];
    const nonceBytes = decodeCanonicalBase64Url(deviceNonce, deviceNonceBytes);
    const signatureBytes = decodeCanonicalBase64Url(signatureBase64Url, deviceSignatureBytes);
    if (
      !deviceIdPattern.test(deviceId) ||
      nonceBytes === undefined ||
      canonicalTimestampMilliseconds(deviceTimestamp) === undefined ||
      deviceTimestamp !== payload.observedAt ||
      !idempotencyKeyPattern.test(idempotencyKey) ||
      idempotencyKey !== payload.syncId ||
      signatureBytes === undefined
    ) {
      fail("device_rejected");
    }

    let rawDeviceMaterial: unknown;
    try {
      rawDeviceMaterial = await this.#readDeviceVerificationMaterial(deviceId);
    } catch {
      fail("dependency_unavailable");
    }
    const deviceMaterial = readDeviceMaterial(rawDeviceMaterial);
    if (deviceMaterial === invalidDeviceMaterial) {
      fail("dependency_unavailable");
    }
    const signingMessage = createDeviceSignatureMessage({
      bodyDigestBase64Url: bodyDigest.base64Url,
      deviceId,
      idempotencyKey,
      nonce: deviceNonce,
      requestTarget: envelope.requestTarget,
      timestamp: deviceTimestamp,
    });
    const candidatePublicKey = deviceMaterial?.publicKey ?? dummyDevicePublicKey;
    const signatureValid = await verifyEd25519(candidatePublicKey, signingMessage, signatureBytes);
    if (
      deviceMaterial === null ||
      !signatureValid ||
      deviceMaterial.agentAccountId !== payload.agentAccountId ||
      deviceMaterial.readerVersion !== payload.readerVersion
    ) {
      fail("device_rejected");
    }

    return Object.freeze({
      accountingRevision: deviceMaterial.accountingRevision,
      agentAccountId: deviceMaterial.agentAccountId,
      bodyDigestHex: bodyDigest.hex,
      deviceNonceDigestHex: createHash("sha256").update(nonceBytes).digest("hex"),
      deviceId,
      deviceKeyId: deviceMaterial.deviceKeyId,
      idempotencyKey,
      originExpiresAtMilliseconds: origin.expiresAtMilliseconds,
      originKeyId: origin.keyId,
      originNonceDigestHex: origin.nonceDigestHex,
      payload,
      provider: deviceMaterial.provider,
      readerVersion: deviceMaterial.readerVersion,
      requestTarget: envelope.requestTarget,
      signatureBase64Url,
      scopeKind: deviceMaterial.scopeKind,
    });
  }

  #verifyOrigin(
    headers: Readonly<Record<RequiredHeaderName, string>>,
    bodyDigestBase64Url: string,
    requestTarget: CommunitySyncRequestTarget,
  ): OriginProofMaterial {
    const keyId = headers[headerNames.originKeyId];
    const nonce = headers[headerNames.originNonce];
    const proof = headers[headerNames.originProof];
    const timestamp = headers[headerNames.originTimestamp];
    const nonceBytes = decodeCanonicalBase64Url(nonce, originProofNonceBytes);
    const proofBytes = decodeCanonicalBase64Url(proof, originProofBytes);
    const timestampMilliseconds = canonicalTimestampMilliseconds(timestamp);
    const configuredSecret = this.#originKeys.get(keyId);
    const expectedProof = createHmac("sha256", configuredSecret ?? dummyOriginSecret)
      .update(
        createOriginProofMessage({
          bodyDigestBase64Url,
          keyId,
          nonce,
          requestTarget,
          timestamp,
        }),
      )
      .digest();

    let now: number;
    try {
      now = this.#now();
    } catch {
      fail("dependency_unavailable");
    }
    if (!Number.isSafeInteger(now) || now < 0) {
      fail("dependency_unavailable");
    }
    const proofMatches = timingSafeEqual(
      proofBytes ?? Buffer.alloc(originProofBytes),
      expectedProof,
    );
    if (
      !originKeyIdPattern.test(keyId) ||
      configuredSecret === undefined ||
      nonceBytes === undefined ||
      proofBytes === undefined ||
      timestampMilliseconds === undefined ||
      timestampMilliseconds <= now - originProofMaximumAgeMilliseconds ||
      timestampMilliseconds > now + originProofMaximumFutureSkewMilliseconds ||
      !proofMatches
    ) {
      fail("origin_rejected");
    }

    const nonceDigestHex = createHash("sha256")
      .update("viberacing-origin-nonce-v1\0", "utf8")
      .update(keyId, "utf8")
      .update("\0", "utf8")
      .update(nonceBytes)
      .digest("hex");
    return Object.freeze({
      expiresAtMilliseconds: timestampMilliseconds + originProofMaximumAgeMilliseconds,
      keyId,
      nonceDigestHex,
    });
  }
}

export function createCommunitySyncVerifier(options: unknown): CommunitySyncVerifier {
  return new DefaultCommunitySyncVerifier(readOptions(options));
}
