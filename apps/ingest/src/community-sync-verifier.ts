import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { verifyAsync as verifyEd25519Strict } from "@noble/ed25519";
import {
  validateConnectorSyncV1,
  validateUsageSyncV1,
  type ConnectorSyncV1,
  type UsageSyncV1,
} from "@viberacing/contracts";

import { parseBoundedCommunitySyncJson } from "./bounded-json.js";
import {
  canonicalTimestampMilliseconds,
  communitySyncMediaType,
  communitySyncMethod,
  communitySyncRequestTarget,
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

export const codexProvider = "codex";
export const codexAccountingRevision = "codex_daily_usage_buckets_v1";
export type AgentProvider = typeof codexProvider;
export type AgentAccountingRevision = typeof codexAccountingRevision;

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

export interface OriginNonceConsumption {
  readonly expiresAtMilliseconds: number;
  readonly keyId: string;
  readonly nonceDigestHex: string;
}

export interface DeviceVerificationMaterial {
  readonly accountingRevision: string;
  readonly deviceKeyId: string;
  readonly provider: string;
  readonly publicKey: Uint8Array;
  readonly sourceId: string;
}

export interface CommunitySyncVerifierOptions {
  readonly consumeOriginNonce: (input: OriginNonceConsumption) => boolean | Promise<boolean>;
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
  readonly accountingRevision: AgentAccountingRevision;
  readonly bodyDigestHex: string;
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly idempotencyKey: string;
  readonly nonceDigestHex: string;
  readonly payload: ConnectorSyncV1 | UsageSyncV1;
  readonly provider: AgentProvider;
  readonly requestTarget: CommunitySyncRequestTarget;
  readonly signatureBase64Url: string;
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
  readonly accountingRevision: string;
  readonly deviceKeyId: string;
  readonly provider: string;
  readonly publicKey: Buffer;
  readonly sourceId: string;
}

interface ValidatedOptions {
  readonly consumeOriginNonce: CommunitySyncVerifierOptions["consumeOriginNonce"];
  readonly now: CommunitySyncVerifierOptions["now"];
  readonly originKeys: ReadonlyMap<string, Buffer>;
  readonly readDeviceVerificationMaterial: CommunitySyncVerifierOptions["readDeviceVerificationMaterial"];
}

const requestKeys = new Set(["method", "rawBody", "rawHeaders", "requestTarget"]);
const optionKeys = new Set([
  "consumeOriginNonce",
  "now",
  "originKeys",
  "readDeviceVerificationMaterial",
]);
const originKeyKeys = new Set(["keyId", "secret"]);
const deviceMaterialKeys = new Set([
  "accountingRevision",
  "deviceKeyId",
  "provider",
  "publicKey",
  "sourceId",
]);
const requiredHeaderNameSet = new Set<string>(requiredHeaderNames);
const sourceIdPattern = /^src_[A-Za-z0-9_-]{22}$/;
const providerPattern = /^[a-z][a-z0-9-]{1,31}$/;
const accountingRevisionPattern = /^[a-z][a-z0-9_]{1,63}$/;
const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
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
    const consumeOriginNonce = ownDataValue(value, "consumeOriginNonce");
    const now = ownDataValue(value, "now");
    const originKeyValues = readDenseArray(ownDataValue(value, "originKeys"), 2);
    const readDeviceVerificationMaterial = ownDataValue(value, "readDeviceVerificationMaterial");
    if (
      typeof consumeOriginNonce !== "function" ||
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
      consumeOriginNonce: consumeOriginNonce as CommunitySyncVerifierOptions["consumeOriginNonce"],
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
      (requestTarget !== communitySyncRequestTarget && requestTarget !== usageSyncRequestTarget)
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

function canonicalPayload(value: ConnectorSyncV1): ConnectorSyncV1 {
  return Object.freeze({
    schemaVersion: 1,
    sourceId: value.sourceId,
    syncId: value.syncId,
    observedAt: value.observedAt,
    connectorVersion: value.connectorVersion,
    codexVersion: value.codexVersion,
    dailyEntries: Object.freeze(
      value.dailyEntries.map((entry) =>
        Object.freeze({
          codexReportedDate: entry.codexReportedDate,
          tokens: entry.tokens,
        }),
      ),
    ),
  });
}

function canonicalUsagePayload(value: UsageSyncV1): UsageSyncV1 {
  return Object.freeze({
    schemaVersion: 1,
    sourceId: value.sourceId,
    syncId: value.syncId,
    observedAt: value.observedAt,
    clientVersion: value.clientVersion,
    agentVersion: value.agentVersion,
    dailyEntries: Object.freeze(
      value.dailyEntries.map((entry) =>
        Object.freeze({
          reportedDate: entry.reportedDate,
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
    const deviceKeyId = ownDataValue(value, "deviceKeyId");
    const provider = ownDataValue(value, "provider");
    const publicKey = copyExactBytes(ownDataValue(value, "publicKey"), devicePublicKeyBytes);
    const sourceId = ownDataValue(value, "sourceId");
    if (
      typeof accountingRevision !== "string" ||
      !accountingRevisionPattern.test(accountingRevision) ||
      typeof deviceKeyId !== "string" ||
      !canonicalUuidPattern.test(deviceKeyId) ||
      typeof provider !== "string" ||
      !providerPattern.test(provider) ||
      publicKey === undefined ||
      typeof sourceId !== "string" ||
      !sourceIdPattern.test(sourceId)
    ) {
      return invalidDeviceMaterial;
    }
    return Object.freeze({
      accountingRevision,
      deviceKeyId,
      provider,
      publicKey,
      sourceId,
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
  readonly #consumeOriginNonce: CommunitySyncVerifierOptions["consumeOriginNonce"];
  readonly #now: CommunitySyncVerifierOptions["now"];
  readonly #originKeys: ReadonlyMap<string, Buffer>;
  readonly #readDeviceVerificationMaterial: CommunitySyncVerifierOptions["readDeviceVerificationMaterial"];

  constructor(options: ValidatedOptions) {
    this.#consumeOriginNonce = options.consumeOriginNonce;
    this.#now = options.now;
    this.#originKeys = options.originKeys;
    this.#readDeviceVerificationMaterial = options.readDeviceVerificationMaterial;
  }

  async verify(request: unknown): Promise<VerifiedCommunitySync> {
    const envelope = readRawRequest(request);
    const bodyDigest = digestBody(envelope.body);
    await this.#verifyOrigin(envelope.headers, bodyDigest.base64Url, envelope.requestTarget);

    let parsed: unknown;
    try {
      parsed = parseBoundedCommunitySyncJson(envelope.body);
    } catch {
      fail("invalid_body");
    }
    let payload: ConnectorSyncV1 | UsageSyncV1;
    if (envelope.requestTarget === usageSyncRequestTarget) {
      const validation = validateUsageSyncV1(parsed);
      if (!validation.ok) {
        fail("invalid_body");
      }
      payload = canonicalUsagePayload(validation.value);
    } else {
      const validation = validateConnectorSyncV1(parsed);
      if (!validation.ok) {
        fail("invalid_body");
      }
      payload = canonicalPayload(validation.value);
    }

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
      deviceMaterial.sourceId !== payload.sourceId ||
      deviceMaterial.provider !== codexProvider ||
      deviceMaterial.accountingRevision !== codexAccountingRevision
    ) {
      fail("device_rejected");
    }

    return Object.freeze({
      accountingRevision: codexAccountingRevision,
      bodyDigestHex: bodyDigest.hex,
      deviceId,
      deviceKeyId: deviceMaterial.deviceKeyId,
      idempotencyKey,
      nonceDigestHex: createHash("sha256").update(nonceBytes).digest("hex"),
      payload,
      provider: codexProvider,
      requestTarget: envelope.requestTarget,
      signatureBase64Url,
    });
  }

  async #verifyOrigin(
    headers: Readonly<Record<RequiredHeaderName, string>>,
    bodyDigestBase64Url: string,
    requestTarget: CommunitySyncRequestTarget,
  ): Promise<void> {
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
    let consumed: unknown;
    try {
      consumed = await this.#consumeOriginNonce(
        Object.freeze({
          expiresAtMilliseconds: timestampMilliseconds + originProofMaximumAgeMilliseconds,
          keyId,
          nonceDigestHex,
        }),
      );
    } catch {
      fail("dependency_unavailable");
    }
    if (typeof consumed !== "boolean") {
      fail("dependency_unavailable");
    }
    if (!consumed) {
      fail("origin_rejected");
    }
  }
}

export function createCommunitySyncVerifier(options: unknown): CommunitySyncVerifier {
  return new DefaultCommunitySyncVerifier(readOptions(options));
}
