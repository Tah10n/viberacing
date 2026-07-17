import "server-only";

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { verifyAsync as verifyEd25519Strict } from "@noble/ed25519";
import { validateCarRecipeV1, type CarRecipeV1 } from "@viberacing/contracts";

import type { ConnectorCarProposalDeviceMaterial } from "./connector-car-proposal-database";

export const connectorCarProposalMethod = "POST";
export const connectorCarProposalPath = "/v1/connector/cars/proposals";
export const connectorCarProposalMediaType = "application/json";
export const connectorCarProposalMaximumBodyBytes = 512;
export const connectorCarProposalMessagePrefix = "viberacing-car-proposal-request-v1";
export const connectorCarProposalNonceBytes = 16;
export const connectorCarProposalSignatureBytes = 64;
export const connectorCarProposalPublicKeyBytes = 32;
export const connectorCarProposalMaximumAgeMilliseconds = 300_000;
export const connectorCarProposalMaximumFutureSkewMilliseconds = 120_000;

const deviceIdPattern = /^dev_[A-Za-z0-9_-]{22}$/;
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const timestampPattern = /^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const inputKeys = new Set([
  "deviceId",
  "deviceNonce",
  "deviceSignature",
  "deviceTimestamp",
  "rawBody",
]);
const materialKeys = new Set(["deviceKeyId", "publicKey"]);
const dummyPublicKey = Buffer.from(
  "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  "hex",
);

export type ConnectorCarProposalVerificationErrorCode =
  "dependency_unavailable" | "device_rejected" | "invalid_body" | "invalid_request";

export class ConnectorCarProposalVerificationError extends Error {
  readonly code: ConnectorCarProposalVerificationErrorCode;

  constructor(code: ConnectorCarProposalVerificationErrorCode) {
    super("Connector car proposal request rejected.");
    this.name = "ConnectorCarProposalVerificationError";
    this.code = code;
  }
}

export interface ConnectorCarProposalVerifierOptions {
  readonly now: () => number;
  readonly readDeviceMaterial: (
    deviceId: string,
  ) =>
    ConnectorCarProposalDeviceMaterial | null | Promise<ConnectorCarProposalDeviceMaterial | null>;
}

export interface VerifiedConnectorCarProposal {
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly nonceDigest: Uint8Array;
  readonly observedAt: string;
  readonly recipe: CarRecipeV1;
}

export interface ConnectorCarProposalVerifier {
  verify(input: unknown): Promise<VerifiedConnectorCarProposal>;
}

interface StringToken {
  readonly next: number;
  readonly value: string;
}

interface ValidatedInput {
  readonly body: Buffer;
  readonly deviceId: string;
  readonly deviceNonce: Buffer;
  readonly deviceNonceBase64Url: string;
  readonly deviceSignature: Buffer;
  readonly deviceTimestamp: string;
  readonly timestampMilliseconds: number;
}

interface ValidatedMaterial {
  readonly deviceKeyId: string;
  readonly publicKey: Buffer;
}

function fail(code: ConnectorCarProposalVerificationErrorCode): never {
  throw new ConnectorCarProposalVerificationError(code);
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
  return descriptor !== undefined && "value" in descriptor && descriptor.enumerable
    ? (descriptor.value as unknown)
    : undefined;
}

function copyBytes(value: unknown, expectedLength?: number): Buffer | undefined {
  if (!(value instanceof Uint8Array)) {
    return undefined;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (
    (prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) ||
    !(value.buffer instanceof ArrayBuffer) ||
    (expectedLength !== undefined && value.byteLength !== expectedLength)
  ) {
    return undefined;
  }
  return Buffer.from(value);
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

function canonicalTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string" || !timestampPattern.test(value)) {
    return undefined;
  }
  const milliseconds = Date.parse(value);
  return Number.isSafeInteger(milliseconds) && new Date(milliseconds).toISOString() === value
    ? milliseconds
    : undefined;
}

function readInput(value: unknown): ValidatedInput {
  let body: Buffer | undefined;
  let deviceNonce: Buffer | undefined;
  let deviceSignature: Buffer | undefined;
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, inputKeys)) {
      fail("invalid_request");
    }
    body = copyBytes(ownDataValue(value, "rawBody"));
    const deviceId = ownDataValue(value, "deviceId");
    const deviceNonceBase64Url = ownDataValue(value, "deviceNonce");
    const deviceSignatureBase64Url = ownDataValue(value, "deviceSignature");
    const deviceTimestamp = ownDataValue(value, "deviceTimestamp");
    deviceNonce = decodeCanonicalBase64Url(deviceNonceBase64Url, connectorCarProposalNonceBytes);
    deviceSignature = decodeCanonicalBase64Url(
      deviceSignatureBase64Url,
      connectorCarProposalSignatureBytes,
    );
    const timestampMilliseconds = canonicalTimestamp(deviceTimestamp);
    if (
      body === undefined ||
      body.length < 1 ||
      body.length > connectorCarProposalMaximumBodyBytes ||
      typeof deviceId !== "string" ||
      !deviceIdPattern.test(deviceId) ||
      typeof deviceNonceBase64Url !== "string" ||
      deviceNonce === undefined ||
      deviceSignature === undefined ||
      typeof deviceTimestamp !== "string" ||
      timestampMilliseconds === undefined
    ) {
      fail("invalid_request");
    }
    return {
      body,
      deviceId,
      deviceNonce,
      deviceNonceBase64Url,
      deviceSignature,
      deviceTimestamp,
      timestampMilliseconds,
    };
  } catch (error) {
    body?.fill(0);
    deviceNonce?.fill(0);
    deviceSignature?.fill(0);
    if (error instanceof ConnectorCarProposalVerificationError) {
      throw error;
    }
    fail("invalid_request");
  }
}

function skipWhitespace(value: string, start: number): number {
  let index = start;
  while (index < value.length && /[\t\n\r ]/.test(value[index] ?? "")) {
    index += 1;
  }
  return index;
}

function readString(value: string, start: number): StringToken | undefined {
  if (value[start] !== '"') {
    return undefined;
  }
  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\") {
      index += 1;
      if (index >= value.length) {
        return undefined;
      }
      continue;
    }
    if (character === '"') {
      try {
        const decoded: unknown = JSON.parse(value.slice(start, index + 1));
        return typeof decoded === "string" ? { next: index + 1, value: decoded } : undefined;
      } catch {
        return undefined;
      }
    }
    if (character !== undefined && character.charCodeAt(0) <= 0x1f) {
      return undefined;
    }
  }
  return undefined;
}

function readScalar(
  value: string,
  start: number,
): { readonly next: number; readonly value: unknown } | undefined {
  if (value[start] === '"') {
    const token = readString(value, start);
    return token !== undefined && token.value.length <= 16 ? token : undefined;
  }
  let end = start;
  while (end < value.length && value[end] !== "," && value[end] !== "}") {
    end += 1;
  }
  const token = value.slice(start, end).trim();
  if (token.length === 0 || token.length > 5 || token.includes("{") || token.includes("[")) {
    return undefined;
  }
  try {
    const decoded: unknown = JSON.parse(token);
    return decoded === null || typeof decoded !== "object"
      ? { next: end, value: decoded }
      : undefined;
  } catch {
    return undefined;
  }
}

function parseFlatJson(value: string): Readonly<Record<string, unknown>> | undefined {
  try {
    let index = skipWhitespace(value, 0);
    if (value[index] !== "{") {
      return undefined;
    }
    index = skipWhitespace(value, index + 1);
    const result = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    if (value[index] === "}") {
      return skipWhitespace(value, index + 1) === value.length ? Object.freeze(result) : undefined;
    }
    while (keys.size < 9) {
      const key = readString(value, index);
      if (key === undefined || keys.has(key.value) || key.value.length > 16) {
        return undefined;
      }
      keys.add(key.value);
      index = skipWhitespace(value, key.next);
      if (value[index] !== ":") {
        return undefined;
      }
      index = skipWhitespace(value, index + 1);
      const scalar = readScalar(value, index);
      if (scalar === undefined) {
        return undefined;
      }
      Object.defineProperty(result, key.value, {
        enumerable: true,
        value: scalar.value,
        writable: false,
      });
      index = skipWhitespace(value, scalar.next);
      if (value[index] === "}") {
        return skipWhitespace(value, index + 1) === value.length
          ? Object.freeze(result)
          : undefined;
      }
      if (value[index] !== ",") {
        return undefined;
      }
      index = skipWhitespace(value, index + 1);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function readRecipe(body: Buffer): CarRecipeV1 {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    fail("invalid_body");
  }
  const parsed = parseFlatJson(text);
  const validation = validateCarRecipeV1(parsed);
  if (!validation.ok) {
    fail("invalid_body");
  }
  return Object.freeze({ ...validation.value });
}

function readMaterial(value: unknown): ValidatedMaterial | null | undefined {
  try {
    if (value === null) {
      return null;
    }
    if (!isPlainRecord(value) || !hasExactKeys(value, materialKeys)) {
      return undefined;
    }
    const deviceKeyId = ownDataValue(value, "deviceKeyId");
    const rawPublicKey = ownDataValue(value, "publicKey");
    const publicKey = copyBytes(rawPublicKey, connectorCarProposalPublicKeyBytes);
    if (rawPublicKey instanceof Uint8Array) {
      rawPublicKey.fill(0);
    }
    if (
      typeof deviceKeyId !== "string" ||
      !uuidV4Pattern.test(deviceKeyId) ||
      publicKey === undefined
    ) {
      publicKey?.fill(0);
      return undefined;
    }
    return { deviceKeyId, publicKey };
  } catch {
    return undefined;
  }
}

function createSignatureMessage(input: ValidatedInput): Buffer {
  const digest = createHash("sha256").update(input.body).digest("base64url");
  return Buffer.from(
    [
      connectorCarProposalMessagePrefix,
      connectorCarProposalMethod,
      connectorCarProposalPath,
      digest,
      input.deviceId,
      input.deviceNonceBase64Url,
      input.deviceTimestamp,
    ].join("\n"),
    "utf8",
  );
}

export function createConnectorCarProposalVerifier(
  options: ConnectorCarProposalVerifierOptions,
): ConnectorCarProposalVerifier {
  if (typeof options.now !== "function" || typeof options.readDeviceMaterial !== "function") {
    throw new ConnectorCarProposalVerificationError("dependency_unavailable");
  }
  return Object.freeze({
    async verify(input: unknown): Promise<VerifiedConnectorCarProposal> {
      const request = readInput(input);
      let material: ValidatedMaterial | null | undefined;
      let message: Buffer | undefined;
      try {
        let now: number;
        try {
          now = options.now();
        } catch {
          fail("dependency_unavailable");
        }
        if (!Number.isSafeInteger(now) || now < 0) {
          fail("dependency_unavailable");
        }
        if (
          request.timestampMilliseconds <= now - connectorCarProposalMaximumAgeMilliseconds ||
          request.timestampMilliseconds > now + connectorCarProposalMaximumFutureSkewMilliseconds
        ) {
          fail("device_rejected");
        }
        const recipe = readRecipe(request.body);
        let rawMaterial: unknown;
        try {
          rawMaterial = await options.readDeviceMaterial(request.deviceId);
        } catch {
          fail("dependency_unavailable");
        }
        material = readMaterial(rawMaterial);
        if (material === undefined) {
          fail("dependency_unavailable");
        }
        message = createSignatureMessage(request);
        let signatureValid = false;
        try {
          signatureValid = await verifyEd25519Strict(
            request.deviceSignature,
            message,
            material?.publicKey ?? dummyPublicKey,
            { zip215: false },
          );
        } catch {
          signatureValid = false;
        }
        if (material === null || !signatureValid) {
          fail("device_rejected");
        }
        const nonceDigest = createHash("sha256")
          .update("viberacing-car-proposal-nonce-v1\0", "utf8")
          .update(request.deviceNonce)
          .digest();
        return Object.freeze({
          deviceId: request.deviceId,
          deviceKeyId: material.deviceKeyId,
          nonceDigest,
          observedAt: request.deviceTimestamp,
          recipe,
        });
      } finally {
        request.body.fill(0);
        request.deviceNonce.fill(0);
        request.deviceSignature.fill(0);
        material?.publicKey.fill(0);
        message?.fill(0);
      }
    },
  });
}
