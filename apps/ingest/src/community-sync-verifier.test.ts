import { createHash, createHmac, generateKeyPairSync, sign, type KeyObject } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  codexAccountingRevision,
  codexProvider,
  CommunitySyncVerificationError,
  CommunitySyncVerifierConfigurationError,
  createCommunitySyncVerifier,
  type CommunitySyncVerifier,
  type CommunitySyncVerifierOptions,
  type DeviceVerificationMaterial,
  type OriginNonceConsumption,
} from "./community-sync-verifier";
import {
  communitySyncMediaType,
  communitySyncMethod,
  type CommunitySyncRequestTarget,
  createDeviceSignatureMessage,
  createOriginProofMessage,
  digestBody,
  headerNames,
  maximumCommunitySyncBodyBytes,
  originProofMaximumAgeMilliseconds,
  originProofMaximumFutureSkewMilliseconds,
  usageSyncRequestTarget,
} from "./protocol";

const nowMilliseconds = Date.UTC(2026, 6, 15, 18);
const observedAt = "2026-07-15T18:00:00.000Z";
const deviceId = "dev_AAAAAAAAAAAAAAAAAAAAAA";
const sourceId = "src_BBBBBBBBBBBBBBBBBBBBBB";
const syncId = "syn_CCCCCCCCCCCCCCCCCCCCCC";
const deviceKeyId = "11111111-2222-4333-8444-555555555555";
const originKeyId = "edge_primary";
const originSecret = Buffer.alloc(32, 0x33);
const originNonce = Buffer.alloc(16, 0x22).toString("base64url");
const deviceNonce = Buffer.alloc(16, 0x11).toString("base64url");
const keyPair = generateKeyPairSync("ed25519");
const exportedPublicKey = keyPair.publicKey.export({ format: "der", type: "spki" });
if (!Buffer.isBuffer(exportedPublicKey)) {
  throw new Error("Synthetic Ed25519 public key export failed.");
}
const devicePublicKey = Buffer.from(exportedPublicKey.subarray(-32));

interface RawRequest {
  method: string;
  rawBody: Uint8Array;
  rawHeaders: string[];
  requestTarget: CommunitySyncRequestTarget;
}

interface RequestOptions {
  readonly deviceId?: string;
  readonly deviceNonce?: string;
  readonly deviceTimestamp?: string;
  readonly idempotencyKey?: string;
  readonly originKeyId?: string;
  readonly originNonce?: string;
  readonly originProof?: string;
  readonly originSecret?: Uint8Array;
  readonly originTimestamp?: string;
  readonly payload?: unknown;
  readonly privateKey?: KeyObject;
  readonly rawBody?: Uint8Array;
  readonly requestTarget?: CommunitySyncRequestTarget;
  readonly signature?: string;
}

interface HarnessOverrides {
  readonly consumeOriginNonce?: CommunitySyncVerifierOptions["consumeOriginNonce"];
  readonly now?: CommunitySyncVerifierOptions["now"];
  readonly originKeys?: CommunitySyncVerifierOptions["originKeys"];
  readonly readDeviceVerificationMaterial?: CommunitySyncVerifierOptions["readDeviceVerificationMaterial"];
}

function validPayload(): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: 1,
    sourceId,
    syncId,
    observedAt,
    clientVersion: "1.2.3",
    agentVersion: "0.144.5",
    dailyEntries: [
      { reportedDate: "2026-07-14", dailyTokenTotal: 123 },
      { reportedDate: "2026-07-15", dailyTokenTotal: 456 },
    ],
  };
}

function bufferWithExoticPrototype(length: number): Buffer {
  const value = Buffer.alloc(length);
  const prototype: object = {};
  Reflect.setPrototypeOf(prototype, Uint8Array.prototype);
  Reflect.setPrototypeOf(value, prototype);
  return value;
}

function buildRequest(options: RequestOptions = {}): RawRequest {
  const body = Buffer.from(
    options.rawBody ?? Buffer.from(JSON.stringify(options.payload ?? validPayload()), "utf8"),
  );
  const selectedDeviceId = options.deviceId ?? deviceId;
  const selectedDeviceNonce = options.deviceNonce ?? deviceNonce;
  const selectedDeviceTimestamp = options.deviceTimestamp ?? observedAt;
  const selectedIdempotencyKey = options.idempotencyKey ?? syncId;
  const selectedOriginKeyId = options.originKeyId ?? originKeyId;
  const selectedOriginNonce = options.originNonce ?? originNonce;
  const selectedOriginTimestamp = options.originTimestamp ?? observedAt;
  const selectedRequestTarget = options.requestTarget ?? usageSyncRequestTarget;
  const bodyDigest = digestBody(body).base64Url;
  const signature =
    options.signature ??
    sign(
      null,
      createDeviceSignatureMessage({
        bodyDigestBase64Url: bodyDigest,
        deviceId: selectedDeviceId,
        idempotencyKey: selectedIdempotencyKey,
        nonce: selectedDeviceNonce,
        requestTarget: selectedRequestTarget,
        timestamp: selectedDeviceTimestamp,
      }),
      options.privateKey ?? keyPair.privateKey,
    ).toString("base64url");
  const proof =
    options.originProof ??
    createHmac("sha256", options.originSecret ?? originSecret)
      .update(
        createOriginProofMessage({
          bodyDigestBase64Url: bodyDigest,
          keyId: selectedOriginKeyId,
          nonce: selectedOriginNonce,
          requestTarget: selectedRequestTarget,
          timestamp: selectedOriginTimestamp,
        }),
      )
      .digest("base64url");

  return {
    method: communitySyncMethod,
    requestTarget: selectedRequestTarget,
    rawBody: body,
    rawHeaders: [
      headerNames.contentType,
      communitySyncMediaType,
      headerNames.deviceId,
      selectedDeviceId,
      headerNames.deviceNonce,
      selectedDeviceNonce,
      headerNames.deviceTimestamp,
      selectedDeviceTimestamp,
      headerNames.deviceSignature,
      signature,
      headerNames.idempotencyKey,
      selectedIdempotencyKey,
      headerNames.originKeyId,
      selectedOriginKeyId,
      headerNames.originNonce,
      selectedOriginNonce,
      headerNames.originTimestamp,
      selectedOriginTimestamp,
      headerNames.originProof,
      proof,
    ],
  };
}

function headerValue(request: RawRequest, name: string): string {
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) {
      const value = request.rawHeaders[index + 1];
      if (value !== undefined) {
        return value;
      }
    }
  }
  throw new Error("Synthetic header is missing.");
}

function setHeader(request: RawRequest, name: string, value: string): void {
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) {
      request.rawHeaders[index + 1] = value;
      return;
    }
  }
  throw new Error("Synthetic header is missing.");
}

function replaceOriginProof(request: RawRequest, secret: Uint8Array = originSecret): void {
  const proof = createHmac("sha256", secret)
    .update(
      createOriginProofMessage({
        bodyDigestBase64Url: digestBody(request.rawBody).base64Url,
        keyId: headerValue(request, headerNames.originKeyId),
        nonce: headerValue(request, headerNames.originNonce),
        requestTarget: request.requestTarget,
        timestamp: headerValue(request, headerNames.originTimestamp),
      }),
    )
    .digest("base64url");
  setHeader(request, headerNames.originProof, proof);
}

function validDeviceMaterial(): DeviceVerificationMaterial {
  return {
    accountingRevision: codexAccountingRevision,
    deviceKeyId,
    provider: codexProvider,
    publicKey: Buffer.from(devicePublicKey),
    sourceId,
  };
}

function createHarness(overrides: HarnessOverrides = {}): Readonly<{
  consumeOriginNonce: ReturnType<typeof vi.fn>;
  now: ReturnType<typeof vi.fn>;
  readDeviceVerificationMaterial: ReturnType<typeof vi.fn>;
  verifier: CommunitySyncVerifier;
}> {
  const consumeOriginNonce = vi.fn(() => true);
  const now = vi.fn(() => nowMilliseconds);
  const readDeviceVerificationMaterial = vi.fn(() => validDeviceMaterial());
  const verifier = createCommunitySyncVerifier({
    consumeOriginNonce: overrides.consumeOriginNonce ?? consumeOriginNonce,
    now: overrides.now ?? now,
    originKeys: overrides.originKeys ?? [{ keyId: originKeyId, secret: Buffer.from(originSecret) }],
    readDeviceVerificationMaterial:
      overrides.readDeviceVerificationMaterial ?? readDeviceVerificationMaterial,
  });
  return { consumeOriginNonce, now, readDeviceVerificationMaterial, verifier };
}

async function expectFailure(
  promise: Promise<unknown>,
  code: CommunitySyncVerificationError["code"],
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CommunitySyncVerificationError);
    expect(error).toMatchObject({ code, message: "Community sync request rejected." });
    expect(String(error)).not.toContain(deviceId);
    expect(String(error)).not.toContain(sourceId);
    expect(String(error)).not.toContain(syncId);
    return;
  }
  throw new Error("Expected Community sync verification to fail.");
}

function validOptions(): CommunitySyncVerifierOptions {
  return {
    consumeOriginNonce: () => true,
    now: () => nowMilliseconds,
    originKeys: [{ keyId: originKeyId, secret: Buffer.from(originSecret) }],
    readDeviceVerificationMaterial: () => validDeviceMaterial(),
  };
}

describe("Community sync verifier configuration", () => {
  it("copies proof secrets and exposes no enumerable configuration", async () => {
    const secret = Buffer.from(originSecret);
    const options = validOptions();
    const verifier = createCommunitySyncVerifier({
      ...options,
      originKeys: [{ keyId: originKeyId, secret }],
    });
    secret.fill(0);

    await expect(verifier.verify(buildRequest())).resolves.toMatchObject({ deviceId, deviceKeyId });
    expect(Object.keys(verifier)).toEqual([]);
    expect(JSON.stringify(verifier)).toBe("{}");
  });

  it("supports a bounded two-key verification window", async () => {
    const verifier = createCommunitySyncVerifier({
      ...validOptions(),
      originKeys: [
        { keyId: "edge_previous", secret: Buffer.alloc(32, 0x44) },
        { keyId: originKeyId, secret: Buffer.from(originSecret) },
      ],
    });
    await expect(verifier.verify(buildRequest())).resolves.toMatchObject({ deviceId });
  });

  it("accepts a closed null-prototype configuration record", async () => {
    const options = Object.assign(Object.create(null) as Record<string, unknown>, validOptions());
    const verifier = createCommunitySyncVerifier(options);
    await expect(verifier.verify(buildRequest())).resolves.toMatchObject({ deviceId });
  });

  it.each([
    null,
    {},
    { ...validOptions(), extra: true },
    { ...validOptions(), consumeOriginNonce: true },
    { ...validOptions(), now: 1 },
    { ...validOptions(), readDeviceVerificationMaterial: "lookup" },
    { ...validOptions(), originKeys: [] },
    { ...validOptions(), originKeys: [{ keyId: "primary", secret: Buffer.alloc(32) }] },
    { ...validOptions(), originKeys: [{ keyId: originKeyId, secret: Buffer.alloc(31) }] },
    {
      ...validOptions(),
      originKeys: [
        { keyId: originKeyId, secret: Buffer.alloc(32) },
        { keyId: originKeyId, secret: Buffer.alloc(32, 1) },
      ],
    },
    {
      ...validOptions(),
      originKeys: [
        { keyId: "edge_one", secret: Buffer.alloc(32) },
        { keyId: "edge_two", secret: Buffer.alloc(32) },
        { keyId: "edge_three", secret: Buffer.alloc(32) },
      ],
    },
    { ...validOptions(), originKeys: [null] },
    { ...validOptions(), originKeys: [{ keyId: originKeyId, secret: Buffer.alloc(32), extra: 1 }] },
    {
      ...validOptions(),
      originKeys: [
        {
          keyId: originKeyId,
          secret: new Uint8Array(new SharedArrayBuffer(32)),
        },
      ],
    },
    {
      ...validOptions(),
      originKeys: [{ keyId: originKeyId, secret: new (class extends Uint8Array {})(32) }],
    },
    {
      ...validOptions(),
      originKeys: [{ keyId: originKeyId, secret: bufferWithExoticPrototype(32) }],
    },
  ])("rejects a malformed closed configuration", (options) => {
    expect(() => createCommunitySyncVerifier(options)).toThrow(
      CommunitySyncVerifierConfigurationError,
    );
  });

  it("rejects sparse, extended, accessor-backed, and trapping configuration", () => {
    const sparse: unknown[] = [];
    sparse.length = 1;
    const extended = [{ keyId: originKeyId, secret: Buffer.alloc(32) }];
    Object.defineProperty(extended, "extra", { enumerable: true, value: true });
    const accessor = [{ keyId: originKeyId, secret: Buffer.alloc(32) }];
    Object.defineProperty(accessor, "0", { enumerable: true, get: () => accessor[0] });
    const optionsAccessor = validOptions() as CommunitySyncVerifierOptions & { now: () => number };
    Object.defineProperty(optionsAccessor, "now", {
      enumerable: true,
      get: () => () => nowMilliseconds,
    });
    const trapping = new Proxy(validOptions(), {
      ownKeys() {
        throw new Error("private trap");
      },
    });

    for (const value of [
      { ...validOptions(), originKeys: sparse },
      { ...validOptions(), originKeys: extended },
      { ...validOptions(), originKeys: accessor },
      optionsAccessor,
      trapping,
    ]) {
      expect(() => createCommunitySyncVerifier(value)).toThrow(
        CommunitySyncVerifierConfigurationError,
      );
    }
  });
});

describe("Community sync raw request boundary", () => {
  it("accepts case-insensitive required header names and ignores bounded transport headers", async () => {
    const request = buildRequest();
    request.rawHeaders = request.rawHeaders.map((value, index) =>
      index % 2 === 0 ? value.toUpperCase() : value,
    );
    request.rawHeaders.push("User-Agent", "synthetic-test");
    await expect(createHarness().verifier.verify(request)).resolves.toMatchObject({ deviceId });
  });

  it("accepts exactly 64 raw header pairs", async () => {
    const request = buildRequest();
    for (let index = 0; index < 54; index += 1) {
      request.rawHeaders.push(`x-synthetic-${String(index)}`, "value");
    }
    await expect(createHarness().verifier.verify(request)).resolves.toMatchObject({ deviceId });
  });

  it("copies body and headers before awaiting replay consumption", async () => {
    let resolveReplay: ((value: boolean) => void) | undefined;
    const replay = new Promise<boolean>((resolve) => {
      resolveReplay = resolve;
    });
    const request = buildRequest();
    const originalDigest = digestBody(request.rawBody).hex;
    const harness = createHarness({ consumeOriginNonce: async () => replay });
    const verification = harness.verifier.verify(request);
    await vi.waitFor(() => {
      expect(resolveReplay).toBeTypeOf("function");
    });
    request.rawBody.fill(0);
    request.rawHeaders.fill("mutated");
    resolveReplay?.(true);

    await expect(verification).resolves.toMatchObject({ bodyDigestHex: originalDigest, deviceId });
  });

  it.each([
    null,
    [],
    { ...buildRequest(), method: "GET" },
    { ...buildRequest(), requestTarget: "/v1/community/sync" as never },
    { ...buildRequest(), requestTarget: "/v1/community/usage?extra=1" as never },
    { ...buildRequest(), extra: true },
    { method: communitySyncMethod },
    { ...buildRequest(), rawBody: "{}" },
    { ...buildRequest(), rawBody: Buffer.alloc(0) },
    { ...buildRequest(), rawBody: Buffer.alloc(maximumCommunitySyncBodyBytes + 1) },
    { ...buildRequest(), rawBody: new Uint8Array(new SharedArrayBuffer(8)) },
    { ...buildRequest(), rawBody: new (class extends Uint8Array {})(8) },
    { ...buildRequest(), rawBody: bufferWithExoticPrototype(8) },
    { ...buildRequest(), rawHeaders: "headers" },
    { ...buildRequest(), rawHeaders: [headerNames.contentType] },
  ])("rejects a malformed closed raw request", async (request) => {
    await expectFailure(createHarness().verifier.verify(request), "invalid_request");
  });

  it("rejects sparse, extended, accessor-backed, and trapping request structures", async () => {
    const sparse = buildRequest();
    Reflect.deleteProperty(sparse.rawHeaders, "0");
    const extended = buildRequest();
    Object.defineProperty(extended.rawHeaders, "extra", { enumerable: true, value: true });
    const accessor = buildRequest();
    Object.defineProperty(accessor.rawHeaders, "0", {
      enumerable: true,
      get: () => headerNames.contentType,
    });
    const requestAccessor = buildRequest();
    Object.defineProperty(requestAccessor, "method", {
      enumerable: true,
      get: () => communitySyncMethod,
    });
    const trapping = new Proxy(buildRequest(), {
      ownKeys() {
        throw new Error("private request trap");
      },
    });

    for (const request of [sparse, extended, accessor, requestAccessor, trapping]) {
      await expectFailure(createHarness().verifier.verify(request), "invalid_request");
    }
  });

  it("rejects too many, duplicate, missing, malformed, and non-JSON headers", async () => {
    const tooMany = buildRequest();
    for (let index = 0; index < 55; index += 1) {
      tooMany.rawHeaders.push(`x-synthetic-${String(index)}`, "value");
    }
    const duplicate = buildRequest();
    duplicate.rawHeaders.push("Content-Type", communitySyncMediaType);
    const missing = buildRequest();
    missing.rawHeaders.splice(0, 2);
    const wrongMedia = buildRequest();
    setHeader(wrongMedia, headerNames.contentType, "application/json; charset=utf-8");
    const emptyName = buildRequest();
    emptyName.rawHeaders.push("", "value");
    const longName = buildRequest();
    longName.rawHeaders.push("x".repeat(65), "value");
    const badName = buildRequest();
    badName.rawHeaders.push("bad name", "value");
    const nonStringName = buildRequest();
    (nonStringName.rawHeaders as unknown[]).push(1, "value");
    const longValue = buildRequest();
    longValue.rawHeaders.push("x-synthetic", "v".repeat(257));
    const controlValue = buildRequest();
    controlValue.rawHeaders.push("x-synthetic", "bad\nvalue");
    const nonStringValue = buildRequest();
    (nonStringValue.rawHeaders as unknown[]).push("x-synthetic", 1);

    for (const request of [
      tooMany,
      duplicate,
      missing,
      wrongMedia,
      emptyName,
      longName,
      badName,
      nonStringName,
      longValue,
      controlValue,
      nonStringValue,
    ]) {
      await expectFailure(createHarness().verifier.verify(request), "invalid_request");
    }
  });
});

describe("Community sync edge-origin proof", () => {
  it("accepts the oldest valid millisecond and exact future boundary", async () => {
    for (const timestampMilliseconds of [
      nowMilliseconds - originProofMaximumAgeMilliseconds + 1,
      nowMilliseconds + originProofMaximumFutureSkewMilliseconds,
    ]) {
      const timestamp = new Date(timestampMilliseconds).toISOString();
      const harness = createHarness();
      await expect(
        harness.verifier.verify(buildRequest({ originTimestamp: timestamp })),
      ).resolves.toMatchObject({ deviceId });
      const input = harness.consumeOriginNonce.mock.calls[0]?.[0] as
        OriginNonceConsumption | undefined;
      expect(input).toEqual({
        expiresAtMilliseconds: timestampMilliseconds + originProofMaximumAgeMilliseconds,
        keyId: originKeyId,
        nonceDigestHex: createHash("sha256")
          .update("viberacing-origin-nonce-v1\0", "utf8")
          .update(originKeyId, "utf8")
          .update("\0", "utf8")
          .update(Buffer.from(originNonce, "base64url"))
          .digest("hex"),
      });
      expect(Object.isFrozen(input)).toBe(true);
    }
  });

  it.each([
    {
      originTimestamp: new Date(nowMilliseconds - originProofMaximumAgeMilliseconds).toISOString(),
    },
    {
      originTimestamp: new Date(
        nowMilliseconds + originProofMaximumFutureSkewMilliseconds + 1,
      ).toISOString(),
    },
    { originTimestamp: "2026-07-15T18:00:00Z" },
    { originKeyId: "primary" },
    { originKeyId: "edge_unknown" },
    { originNonce: "short" },
    { originNonce: `${originNonce.slice(0, -1)}+` },
    { originProof: "short" },
    { originSecret: Buffer.alloc(32, 0x99) },
  ])("rejects malformed, stale, unknown, or forged proof input", async (options) => {
    const harness = createHarness();
    await expectFailure(harness.verifier.verify(buildRequest(options)), "origin_rejected");
    expect(harness.consumeOriginNonce).not.toHaveBeenCalled();
    expect(harness.readDeviceVerificationMaterial).not.toHaveBeenCalled();
  });

  it("rejects body tampering before JSON parsing or device lookup", async () => {
    const request = buildRequest();
    request.rawBody = Buffer.from('{"not":"the signed body"}', "utf8");
    const harness = createHarness();
    await expectFailure(harness.verifier.verify(request), "origin_rejected");
    expect(harness.consumeOriginNonce).not.toHaveBeenCalled();
    expect(harness.readDeviceVerificationMaterial).not.toHaveBeenCalled();
  });

  it("maps invalid clocks and replay-store failures without reflection", async () => {
    for (const now of [
      () => {
        throw new Error("private clock failure");
      },
      () => Number.NaN,
      () => -1,
      () => 1.5,
    ]) {
      await expectFailure(
        createHarness({ now }).verifier.verify(buildRequest()),
        "dependency_unavailable",
      );
    }
    for (const consumeOriginNonce of [
      () => {
        throw new Error("private replay failure");
      },
      () => "yes" as unknown as boolean,
    ]) {
      await expectFailure(
        createHarness({ consumeOriginNonce }).verifier.verify(buildRequest()),
        "dependency_unavailable",
      );
    }
    await expectFailure(
      createHarness({ consumeOriginNonce: () => false }).verifier.verify(buildRequest()),
      "origin_rejected",
    );
  });
});

describe("Community sync body and device verification", () => {
  it("returns one frozen allowlisted submission after strict verification", async () => {
    const request = buildRequest();
    const harness = createHarness();
    const result = await harness.verifier.verify(request);

    expect(result).toEqual({
      accountingRevision: codexAccountingRevision,
      bodyDigestHex: digestBody(request.rawBody).hex,
      deviceId,
      deviceKeyId,
      idempotencyKey: syncId,
      nonceDigestHex: createHash("sha256")
        .update(Buffer.from(deviceNonce, "base64url"))
        .digest("hex"),
      payload: validPayload(),
      provider: codexProvider,
      requestTarget: usageSyncRequestTarget,
      signatureBase64Url: headerValue(request, headerNames.deviceSignature),
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.payload)).toBe(true);
    expect(Object.isFrozen(result.payload.dailyEntries)).toBe(true);
    expect(result.payload.dailyEntries.every((entry) => Object.isFrozen(entry))).toBe(true);
    expect(Object.getPrototypeOf(result.payload)).toBe(Object.prototype);
    expect(Object.keys(result)).toEqual([
      "accountingRevision",
      "bodyDigestHex",
      "deviceId",
      "deviceKeyId",
      "idempotencyKey",
      "nonceDigestHex",
      "payload",
      "provider",
      "requestTarget",
      "signatureBase64Url",
    ]);
    expect(harness.readDeviceVerificationMaterial).toHaveBeenCalledOnce();
    expect(harness.readDeviceVerificationMaterial).toHaveBeenCalledWith(deviceId);
    expect(harness.now).toHaveBeenCalledOnce();
  });

  it("accepts a whitespace-padded body at the exact raw-byte ceiling", async () => {
    const encoded = Buffer.from(JSON.stringify(validPayload()), "utf8");
    const body = Buffer.concat([
      encoded,
      Buffer.alloc(maximumCommunitySyncBodyBytes - encoded.length, 0x20),
    ]);
    await expect(
      createHarness().verifier.verify(buildRequest({ rawBody: body })),
    ).resolves.toMatchObject({ bodyDigestHex: digestBody(body).hex });
  });

  it.each([
    Buffer.from("not-json", "utf8"),
    Buffer.from('{"schemaVersion":1,"schemaVersion":1}', "utf8"),
    Buffer.from(JSON.stringify({ ...validPayload(), privateField: true }), "utf8"),
    Buffer.from(JSON.stringify([]), "utf8"),
    Buffer.from(
      JSON.stringify({
        ...validPayload(),
        dailyEntries: [
          { reportedDate: "2026-07-15", dailyTokenTotal: 1 },
          { reportedDate: "2026-07-15", dailyTokenTotal: 2 },
        ],
      }),
      "utf8",
    ),
    Buffer.from(
      JSON.stringify({
        ...validPayload(),
        dailyEntries: [{ reportedDate: "2026-07-14", dailyTokenTotal: -1 }],
      }),
      "utf8",
    ),
  ])("maps malformed or contract-invalid bodies to one stable failure", async (rawBody) => {
    const harness = createHarness();
    await expectFailure(harness.verifier.verify(buildRequest({ rawBody })), "invalid_body");
    expect(harness.consumeOriginNonce).toHaveBeenCalledOnce();
    expect(harness.readDeviceVerificationMaterial).not.toHaveBeenCalled();
  });

  it.each([
    { deviceId: "dev_short" },
    { deviceNonce: "short" },
    { deviceNonce: `${deviceNonce.slice(0, -1)}+` },
    { deviceTimestamp: "2026-07-15T18:00:00Z" },
    { deviceTimestamp: "2026-07-15T18:00:01.000Z" },
    { idempotencyKey: "syn_DDDDDDDDDDDDDDDDDDDDDD" },
    { idempotencyKey: "req_CCCCCCCCCCCCCCCCCCCCCC" },
    { signature: "short" },
  ])("rejects malformed or body-mismatched device headers before lookup", async (options) => {
    const harness = createHarness();
    await expectFailure(harness.verifier.verify(buildRequest(options)), "device_rejected");
    expect(harness.readDeviceVerificationMaterial).not.toHaveBeenCalled();
  });

  it("rejects an unknown device and cross-source binding with the same public failure", async () => {
    await expectFailure(
      createHarness({ readDeviceVerificationMaterial: () => null }).verifier.verify(buildRequest()),
      "device_rejected",
    );
    for (const material of [
      { ...validDeviceMaterial(), provider: "claude-code" },
      { ...validDeviceMaterial(), accountingRevision: "codex_daily_usage_buckets_v2" },
    ]) {
      await expectFailure(
        createHarness({
          readDeviceVerificationMaterial: () => material,
        }).verifier.verify(buildRequest()),
        "device_rejected",
      );
    }
    await expectFailure(
      createHarness({
        readDeviceVerificationMaterial: () => ({
          ...validDeviceMaterial(),
          sourceId: "src_DDDDDDDDDDDDDDDDDDDDDD",
        }),
      }).verifier.verify(buildRequest()),
      "device_rejected",
    );
  });

  it("rejects native-OpenSSL's zero-key/zero-signature weak-key bypass", async () => {
    const request = buildRequest({ signature: Buffer.alloc(64).toString("base64url") });
    await expectFailure(
      createHarness({
        readDeviceVerificationMaterial: () => ({
          ...validDeviceMaterial(),
          publicKey: Buffer.alloc(32),
        }),
      }).verifier.verify(request),
      "device_rejected",
    );
  });

  it("maps an unavailable strict-crypto backend to the same device rejection", async () => {
    const request = buildRequest();
    vi.stubGlobal("crypto", undefined);
    try {
      await expectFailure(createHarness().verifier.verify(request), "device_rejected");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects a signature from another key or a tampered signature", async () => {
    const otherKey = generateKeyPairSync("ed25519");
    await expectFailure(
      createHarness().verifier.verify(buildRequest({ privateKey: otherKey.privateKey })),
      "device_rejected",
    );
    const request = buildRequest();
    setHeader(request, headerNames.deviceSignature, Buffer.alloc(64, 0x7f).toString("base64url"));
    await expectFailure(createHarness().verifier.verify(request), "device_rejected");
  });

  it("reaches device verification only when a body change has a fresh edge proof", async () => {
    const request = buildRequest();
    request.rawBody = Buffer.from(JSON.stringify({ ...validPayload(), clientVersion: "9.9.9" }));
    replaceOriginProof(request);
    await expectFailure(createHarness().verifier.verify(request), "device_rejected");
  });

  it("maps device lookup failures and malformed trusted results to dependency failure", async () => {
    const accessor = validDeviceMaterial();
    Object.defineProperty(accessor, "sourceId", { enumerable: true, get: () => sourceId });
    const proxy = new Proxy(validDeviceMaterial(), {
      ownKeys() {
        throw new Error("private material trap");
      },
    });
    const malformed: unknown[] = [
      undefined,
      {},
      { ...validDeviceMaterial(), extra: true },
      { ...validDeviceMaterial(), deviceKeyId: "not-a-uuid" },
      { ...validDeviceMaterial(), sourceId: "src_short" },
      { ...validDeviceMaterial(), provider: "CODEX" },
      { ...validDeviceMaterial(), accountingRevision: "../private" },
      { ...validDeviceMaterial(), publicKey: Buffer.alloc(31) },
      { ...validDeviceMaterial(), publicKey: new Uint8Array(new SharedArrayBuffer(32)) },
      { ...validDeviceMaterial(), publicKey: new (class extends Uint8Array {})(32) },
      { ...validDeviceMaterial(), publicKey: bufferWithExoticPrototype(32) },
      accessor,
      proxy,
    ];
    for (const value of malformed) {
      await expectFailure(
        createHarness({
          readDeviceVerificationMaterial: () => value as DeviceVerificationMaterial | null,
        }).verifier.verify(buildRequest()),
        "dependency_unavailable",
      );
    }
    await expectFailure(
      createHarness({
        readDeviceVerificationMaterial: () => {
          throw new Error("private database failure");
        },
      }).verifier.verify(buildRequest()),
      "dependency_unavailable",
    );
  });
});
