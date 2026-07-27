import { readFileSync } from "node:fs";

import { verifyAsync as verifyEd25519Strict } from "@noble/ed25519";
import { validateUsageSyncV1 } from "@viberacing/contracts";
import { describe, expect, it } from "vitest";

import { communitySyncHttpPolicy } from "./community-sync-http-server.js";
import {
  canonicalTimestampMilliseconds,
  communitySyncMediaType,
  communitySyncMethod,
  createDeviceSignatureMessage,
  createOriginProofMessage,
  decodeCanonicalBase64Url,
  deviceIdPattern,
  deviceNonceBytes,
  devicePublicKeyBytes,
  deviceSignatureBytes,
  deviceSignatureMessagePrefix,
  digestBody,
  headerNames,
  idempotencyKeyPattern,
  maximumCommunitySyncBodyBytes,
  maximumCommunitySyncHeaderNameCharacters,
  maximumCommunitySyncHeaderValueCharacters,
  maximumCommunitySyncJsonArrayItems,
  maximumCommunitySyncJsonDepth,
  maximumCommunitySyncJsonNodes,
  maximumCommunitySyncJsonNumberCharacters,
  maximumCommunitySyncJsonObjectMembers,
  maximumCommunitySyncJsonStringCodeUnits,
  maximumCommunitySyncRawHeaderPairs,
  originKeyIdPattern,
  originProofBytes,
  originProofKeyBytes,
  originProofMaximumAgeBoundary,
  originProofMaximumAgeMilliseconds,
  originProofMaximumFutureSkewBoundary,
  originProofMaximumFutureSkewMilliseconds,
  originProofMessagePrefix,
  originProofNonceBytes,
  usageSyncRequestTarget,
} from "./protocol";

describe("canonical Community usage sync protocol", () => {
  it("matches the language-neutral v1 authentication policy exactly", () => {
    const policy = JSON.parse(
      readFileSync(
        new URL("../../../contracts/v1/connector-usage-sync-authentication.json", import.meta.url),
        "utf8",
      ),
    ) as unknown;

    expect(policy).toEqual({
      schemaVersion: 1,
      protocolId: "viberacing-usage-sync-auth-v1",
      method: communitySyncMethod,
      requestTarget: usageSyncRequestTarget,
      mediaType: communitySyncMediaType,
      maximumBodyBytes: maximumCommunitySyncBodyBytes,
      maximumRawHeaderPairs: maximumCommunitySyncRawHeaderPairs,
      maximumHeaderNameCharacters: maximumCommunitySyncHeaderNameCharacters,
      maximumHeaderValueCharacters: maximumCommunitySyncHeaderValueCharacters,
      maximumJsonDepth: maximumCommunitySyncJsonDepth,
      maximumJsonNodes: maximumCommunitySyncJsonNodes,
      maximumJsonObjectMembers: maximumCommunitySyncJsonObjectMembers,
      maximumJsonArrayItems: maximumCommunitySyncJsonArrayItems,
      maximumJsonNumberCharacters: maximumCommunitySyncJsonNumberCharacters,
      maximumDecodedJsonStringCodeUnits: maximumCommunitySyncJsonStringCodeUnits,
      canonicalMessageEncoding: "UTF-8",
      canonicalMessageSeparator: "LF",
      canonicalMessageTrailingSeparator: false,
      binaryEncoding: "base64url-unpadded",
      digestEncoding: "base64url-unpadded",
      httpTransport: {
        framework: communitySyncHttpPolicy.framework,
        admissionMode: communitySyncHttpPolicy.admissionMode,
        admissionLimit: communitySyncHttpPolicy.admissionLimit,
        maximumHeaderBytes: communitySyncHttpPolicy.maximumHeaderBytes,
        maximumConnections: communitySyncHttpPolicy.maximumConnections,
        maximumRequestsPerSocket: communitySyncHttpPolicy.maximumRequestsPerSocket,
        requestTimeoutMilliseconds: communitySyncHttpPolicy.requestTimeoutMs,
        handlerTimeoutMilliseconds: communitySyncHttpPolicy.handlerTimeoutMs,
        connectionTimeoutMilliseconds: communitySyncHttpPolicy.connectionTimeoutMs,
        keepAliveTimeoutMilliseconds: communitySyncHttpPolicy.keepAliveTimeoutMs,
        trustProxy: communitySyncHttpPolicy.trustProxy,
        forwardedHeadersTrusted: communitySyncHttpPolicy.forwardedHeadersTrusted,
        inboundRequestIdAccepted: communitySyncHttpPolicy.inboundRequestIdAccepted,
        requestLogging: communitySyncHttpPolicy.requestLogging,
        acceptPolicy: communitySyncHttpPolicy.acceptPolicy,
        cacheControl: communitySyncHttpPolicy.cacheControl,
        corsPolicy: communitySyncHttpPolicy.corsPolicy,
      },
      originProof: {
        messagePrefix: originProofMessagePrefix,
        algorithm: "HMAC-SHA-256",
        keyBytes: originProofKeyBytes,
        proofBytes: originProofBytes,
        nonceBytes: originProofNonceBytes,
        maximumAgeMilliseconds: originProofMaximumAgeMilliseconds,
        maximumAgeBoundary: originProofMaximumAgeBoundary,
        maximumFutureSkewMilliseconds: originProofMaximumFutureSkewMilliseconds,
        maximumFutureSkewBoundary: originProofMaximumFutureSkewBoundary,
        keyIdPattern: "^edge_[A-Za-z0-9_-]{1,22}$",
        headers: {
          keyId: headerNames.originKeyId,
          timestamp: headerNames.originTimestamp,
          nonce: headerNames.originNonce,
          proof: headerNames.originProof,
        },
        canonicalFields: [
          "messagePrefix",
          "keyId",
          "method",
          "requestTarget",
          "bodyDigestBase64Url",
          "timestamp",
          "nonce",
        ],
      },
      deviceSignature: {
        messagePrefix: deviceSignatureMessagePrefix,
        algorithm: "Ed25519",
        publicKeyBytes: devicePublicKeyBytes,
        signatureBytes: deviceSignatureBytes,
        nonceBytes: deviceNonceBytes,
        deviceIdPattern: "^dev_[A-Za-z0-9_-]{22}$",
        idempotencyKeyPattern: "^syn_[A-Za-z0-9_-]{22}$",
        headers: {
          deviceId: headerNames.deviceId,
          timestamp: headerNames.deviceTimestamp,
          nonce: headerNames.deviceNonce,
          signature: headerNames.deviceSignature,
          idempotencyKey: headerNames.idempotencyKey,
        },
        canonicalFields: [
          "messagePrefix",
          "method",
          "requestTarget",
          "bodyDigestBase64Url",
          "deviceId",
          "nonce",
          "timestamp",
          "idempotencyKey",
        ],
      },
    });
  });

  it("accepts only canonical millisecond UTC timestamps", () => {
    expect(canonicalTimestampMilliseconds("2026-07-15T18:00:00.000Z")).toBe(
      Date.UTC(2026, 6, 15, 18),
    );
    expect(canonicalTimestampMilliseconds("2026-07-15T18:00:00Z")).toBeUndefined();
    expect(canonicalTimestampMilliseconds("2026-02-30T18:00:00.000Z")).toBeUndefined();
  });

  it("decodes only exact unpadded canonical base64url", () => {
    const bytes = Buffer.alloc(16, 0xab);
    const encoded = bytes.toString("base64url");
    expect(decodeCanonicalBase64Url(encoded, 16)).toEqual(bytes);
    expect(decodeCanonicalBase64Url(`${encoded}=`, 16)).toBeUndefined();
    expect(decodeCanonicalBase64Url(`${encoded.slice(0, -1)}+`, 16)).toBeUndefined();
    expect(decodeCanonicalBase64Url("__", 1)).toBeUndefined();
  });

  it("returns both canonical body-digest encodings without exposing mutable bytes", () => {
    const digest = digestBody(Buffer.from("abc", "utf8"));
    expect(digest).toEqual({
      base64Url: "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0",
      hex: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
    expect(Object.isFrozen(digest)).toBe(true);
  });

  it("builds the exact origin message with no trailing separator", () => {
    expect(
      createOriginProofMessage({
        bodyDigestBase64Url: "digest",
        keyId: "edge_primary",
        nonce: "nonce",
        timestamp: "2026-07-15T18:00:00.000Z",
      }).toString("utf8"),
    ).toBe(
      [
        "viberacing-origin-proof-v1",
        "edge_primary",
        "POST",
        "/v1/community/usage",
        "digest",
        "2026-07-15T18:00:00.000Z",
        "nonce",
      ].join("\n"),
    );
  });

  it("builds the exact device message with no trailing separator", () => {
    expect(
      createDeviceSignatureMessage({
        bodyDigestBase64Url: "digest",
        deviceId: "dev_AAAAAAAAAAAAAAAAAAAAAA",
        idempotencyKey: "syn_CCCCCCCCCCCCCCCCCCCCCC",
        nonce: "nonce",
        timestamp: "2026-07-15T18:00:00.000Z",
      }).toString("utf8"),
    ).toBe(
      [
        "viberacing-device-request-v1",
        "POST",
        "/v1/community/usage",
        "digest",
        "dev_AAAAAAAAAAAAAAAAAAAAAA",
        "nonce",
        "2026-07-15T18:00:00.000Z",
        "syn_CCCCCCCCCCCCCCCCCCCCCC",
      ].join("\n"),
    );
  });

  it("matches and verifies the shared Rust UsageSyncV1 device request vector", async () => {
    const vector = JSON.parse(
      readFileSync(
        new URL(
          "../../../contracts/v1/connector-usage-sync-device-request.test-vector.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Readonly<{
      body: string;
      bodyDigestBase64Url: string;
      deviceId: string;
      deviceNonceBase64Url: string;
      deviceNonceBytes: readonly number[];
      devicePublicKeyBase64Url: string;
      deviceSignatureBase64Url: string;
      deviceSignatureMessage: string;
      observedAt: string;
      schemaVersion: number;
      sourceId: string;
      syncId: string;
    }>;
    const body = Buffer.from(vector.body, "utf8");
    const parsedBody = JSON.parse(vector.body) as unknown;

    expect(vector.schemaVersion).toBe(1);
    expect(vector.deviceNonceBytes).toHaveLength(deviceNonceBytes);
    expect(validateUsageSyncV1(parsedBody).ok).toBe(true);
    expect(body.byteLength).toBeLessThanOrEqual(maximumCommunitySyncBodyBytes);
    expect(digestBody(body).base64Url).toBe(vector.bodyDigestBase64Url);
    expect(Buffer.from(vector.deviceNonceBytes).toString("base64url")).toBe(
      vector.deviceNonceBase64Url,
    );
    expect(
      createDeviceSignatureMessage({
        bodyDigestBase64Url: vector.bodyDigestBase64Url,
        deviceId: vector.deviceId,
        idempotencyKey: vector.syncId,
        nonce: vector.deviceNonceBase64Url,
        timestamp: vector.observedAt,
      }).toString("utf8"),
    ).toBe(vector.deviceSignatureMessage);
    expect((parsedBody as Readonly<{ sourceId?: unknown }>).sourceId).toBe(vector.sourceId);

    const publicKey = decodeCanonicalBase64Url(
      vector.devicePublicKeyBase64Url,
      devicePublicKeyBytes,
    );
    const signature = decodeCanonicalBase64Url(
      vector.deviceSignatureBase64Url,
      deviceSignatureBytes,
    );
    if (publicKey === undefined || signature === undefined) {
      throw new Error("shared usage signature vector must use canonical fixed-length values");
    }
    const message = Buffer.from(vector.deviceSignatureMessage, "utf8");
    expect(await verifyEd25519Strict(signature, message, publicKey, { zip215: false })).toBe(true);
    expect(
      await verifyEd25519Strict(signature, Buffer.concat([message, Buffer.from("\n")]), publicKey, {
        zip215: false,
      }),
    ).toBe(false);
  });

  it("keeps protocol identifiers inside their closed alphabets", () => {
    expect(originKeyIdPattern.test("edge_primary-1")).toBe(true);
    expect(originKeyIdPattern.test("primary")).toBe(false);
    expect(deviceIdPattern.test("dev_AAAAAAAAAAAAAAAAAAAAAA")).toBe(true);
    expect(deviceIdPattern.test("dev_short")).toBe(false);
    expect(idempotencyKeyPattern.test("syn_CCCCCCCCCCCCCCCCCCCCCC")).toBe(true);
    expect(idempotencyKeyPattern.test("req_CCCCCCCCCCCCCCCCCCCCCC")).toBe(false);
  });
});
