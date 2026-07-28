import crypto, { createHmac, generateKeyPairSync, sign } from "node:crypto";

import { validateProblemDetailsV1, validateUsageSyncResultV1 } from "@viberacing/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  CommunitySyncApplicationError,
  createCommunitySyncApplication,
  createConfiguredCommunitySyncApplication,
  type CommunitySyncApplicationDecision,
} from "./community-sync-application.js";
import {
  CommunitySyncDatabaseError,
  createCommunitySyncDatabase,
  type CommunitySyncSubmissionResult,
} from "./community-sync-database.js";
import {
  CommunitySyncVerificationError,
  createCommunitySyncVerifier,
  type VerifiedCommunitySync,
} from "./community-sync-verifier.js";
import type { IngestDatabaseClient, IngestDatabasePool } from "./database-pool.js";
import { OriginProofConfigurationError } from "./origin-proof-config.js";
import {
  communitySyncMediaType,
  communitySyncMethod,
  createDeviceSignatureMessage,
  createOriginProofMessage,
  digestBody,
  headerNames,
  usageSyncRequestTarget,
} from "./protocol.js";

const requestId = "req_AAAAAAAAAAAAAAAAAAAAAA";
const nowMilliseconds = Date.UTC(2026, 6, 15, 18);
const observedAt = "2026-07-15T18:00:00.000Z";
const deviceId = "dev_AAAAAAAAAAAAAAAAAAAAAA";
const agentAccountId = "acc_BBBBBBBBBBBBBBBBBBBBBB";
const syncId = "syn_CCCCCCCCCCCCCCCCCCCCCC";
const deviceKeyId = "key_DDDDDDDDDDDDDDDDDDDDDD";
const installationId = "ins_EEEEEEEEEEEEEEEEEEEEEE";
const accountingRevision = 1;
const provider = "codex";
const readerVersion = "codex_daily_usage_buckets_v1";
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

const configuredEnvironment = {
  NODE_ENV: "test",
  VIBERACING_INGEST_DATABASE_HOST: "127.0.0.1",
  VIBERACING_INGEST_DATABASE_NAME: "viberacing_local",
  VIBERACING_INGEST_DATABASE_PASSWORD: "synthetic-ingest-password-value",
  VIBERACING_INGEST_DATABASE_PORT: "54329",
  VIBERACING_INGEST_DATABASE_TLS_MODE: "disable",
  VIBERACING_INGEST_DATABASE_USER: "viberacing_ingest_login",
  VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_BASE64URL: originSecret.toString("base64url"),
  VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_ID: originKeyId,
} as const;

function fixedEntropy(): Buffer {
  return Buffer.alloc(16);
}

type EntropySource = (size: number) => Uint8Array;

interface RandomBytesSpy {
  mockImplementation(implementation: EntropySource): void;
}

function mockRandomBytes(source: EntropySource): void {
  const spy = vi.spyOn(crypto, "randomBytes") as unknown as RandomBytesSpy;
  spy.mockImplementation(source);
}

function validPayload(entryCount = 2): VerifiedCommunitySync["payload"] {
  return Object.freeze({
    schemaVersion: 1,
    agentAccountId,
    syncId,
    observedAt,
    clientVersion: "1.2.3",
    readerVersion,
    dailyEntries: Object.freeze(
      Array.from({ length: entryCount }, (_, index) =>
        Object.freeze({
          usageDate: `2026-07-${String(14 + index).padStart(2, "0")}`,
          dailyTokenTotal: String(123 + index),
        }),
      ),
    ),
  });
}

function validVerifiedSubmission(entryCount = 2): VerifiedCommunitySync {
  return Object.freeze({
    accountingRevision,
    agentAccountId,
    bodyDigestHex: "11".repeat(32),
    deviceNonceDigestHex: "22".repeat(32),
    deviceId,
    deviceKeyId,
    idempotencyKey: syncId,
    originExpiresAtMilliseconds: nowMilliseconds + 60_000,
    originKeyId,
    originNonceDigestHex: "33".repeat(32),
    payload: validPayload(entryCount),
    provider,
    readerVersion,
    requestTarget: usageSyncRequestTarget,
    signatureBase64Url: Buffer.alloc(64, 0x44).toString("base64url"),
    scopeKind: "agent_account",
  });
}

function createHarness(
  options: Readonly<{
    entropySource?: EntropySource;
    submission?: VerifiedCommunitySync;
    submit?: (value: unknown) => Promise<CommunitySyncSubmissionResult>;
    verify?: (request: unknown) => Promise<VerifiedCommunitySync>;
  }> = {},
): Readonly<{
  application: ReturnType<typeof createCommunitySyncApplication>;
  submit: ReturnType<typeof vi.fn>;
  verify: ReturnType<typeof vi.fn>;
}> {
  const submission = options.submission ?? validVerifiedSubmission();
  const verify = vi.fn(options.verify ?? (() => Promise.resolve(submission)));
  const submit = vi.fn(
    options.submit ??
      (() =>
        Promise.resolve({
          acceptedEntries: submission.payload.dailyEntries.length,
          outcome: "accepted" as const,
        })),
  );
  mockRandomBytes(options.entropySource ?? fixedEntropy);
  return {
    application: createCommunitySyncApplication({ submit, verify }),
    submit,
    verify,
  };
}

function expectProblem(
  decision: CommunitySyncApplicationDecision,
  expected: Readonly<{
    errorCode: string;
    retryable: boolean;
    status: 400 | 401 | 422 | 500 | 503;
    title: string;
  }>,
): void {
  expect(decision).toEqual({
    body: {
      schemaVersion: 1,
      requestId,
      status: expected.status,
      errorCode: expected.errorCode,
      title: expected.title,
      retryable: expected.retryable,
    },
    ok: false,
    status: expected.status,
  });
  expect(Object.isFrozen(decision)).toBe(true);
  expect(Object.isFrozen(decision.body)).toBe(true);
  expect(Object.getPrototypeOf(decision.body)).toBeNull();
  expect(validateProblemDetailsV1(decision.body)).toMatchObject({ ok: true });
}

function buildSignedRawRequest(): Readonly<{
  method: string;
  rawBody: Uint8Array;
  rawHeaders: readonly string[];
  requestTarget: string;
}> {
  const rawBody = Buffer.from(JSON.stringify(validPayload()), "utf8");
  const bodyDigestBase64Url = digestBody(rawBody).base64Url;
  const signature = sign(
    null,
    createDeviceSignatureMessage({
      bodyDigestBase64Url,
      deviceId,
      idempotencyKey: syncId,
      nonce: deviceNonce,
      timestamp: observedAt,
    }),
    keyPair.privateKey,
  ).toString("base64url");
  const originProof = createHmac("sha256", originSecret)
    .update(
      createOriginProofMessage({
        bodyDigestBase64Url,
        keyId: originKeyId,
        nonce: originNonce,
        timestamp: observedAt,
      }),
    )
    .digest("base64url");
  return Object.freeze({
    method: communitySyncMethod,
    rawBody,
    rawHeaders: Object.freeze([
      headerNames.contentType,
      communitySyncMediaType,
      headerNames.deviceId,
      deviceId,
      headerNames.deviceNonce,
      deviceNonce,
      headerNames.deviceTimestamp,
      observedAt,
      headerNames.deviceSignature,
      signature,
      headerNames.idempotencyKey,
      syncId,
      headerNames.originKeyId,
      originKeyId,
      headerNames.originNonce,
      originNonce,
      headerNames.originTimestamp,
      observedAt,
      headerNames.originProof,
      originProof,
    ]),
    requestTarget: usageSyncRequestTarget,
  });
}

describe("Community sync application", () => {
  it("returns a frozen, contract-valid acknowledgement after verify then submit", async () => {
    const events: string[] = [];
    const submission = validVerifiedSubmission();
    const entropySource = vi.fn(() => {
      events.push("request-id");
      return new Uint8Array(16);
    });
    const verify = vi.fn(() => {
      events.push("verify");
      return Promise.resolve(submission);
    });
    const submit = vi.fn(() => {
      events.push("submit");
      return Promise.resolve({ acceptedEntries: 2, outcome: "accepted" } as const);
    });
    mockRandomBytes(entropySource);
    const application = createCommunitySyncApplication({ submit, verify });

    const decision = await application.execute({ attackerControlled: true });

    expect(events).toEqual(["request-id", "verify", "submit"]);
    expect(entropySource).toHaveBeenCalledWith(16);
    expect(verify).toHaveBeenCalledWith({ attackerControlled: true });
    expect(submit).toHaveBeenCalledWith(submission);
    expect(decision).toEqual({
      body: {
        schemaVersion: 1,
        requestId,
        syncId,
        outcome: "accepted",
        acceptedEntries: 2,
      },
      ok: true,
      status: 200,
    });
    expect(Object.isFrozen(application)).toBe(true);
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.body)).toBe(true);
    expect(Object.getPrototypeOf(decision.body)).toBeNull();
    expect(validateUsageSyncResultV1(decision.body)).toMatchObject({ ok: true });
  });

  it.each([
    ["duplicate", 0],
    ["quarantined", 0],
  ] as const)(
    "returns the closed %s acknowledgement without a private reason",
    async (outcome, acceptedEntries) => {
      const harness = createHarness({
        submit: () => Promise.resolve({ acceptedEntries, outcome }),
      });

      const decision = await harness.application.execute({});

      expect(decision).toMatchObject({
        body: { acceptedEntries, outcome, requestId, syncId },
        ok: true,
        status: 200,
      });
    },
  );

  it.each([
    "update_connector",
    "reconnect_account",
    "contact_support",
    "retry_later",
  ] as const)("returns the closed coarse recovery action %s", async (recoveryAction) => {
    const harness = createHarness({
      submit: () =>
        Promise.resolve({
          acceptedEntries: 0,
          outcome: "quarantined",
          recoveryAction,
        }),
    });

    const decision = await harness.application.execute({});

    expect(decision).toMatchObject({
      body: { acceptedEntries: 0, outcome: "quarantined", recoveryAction },
      ok: true,
      status: 200,
    });
    expect(validateUsageSyncResultV1(decision.body)).toMatchObject({ ok: true });
  });

  it("uses distinct cryptographic request IDs by default", async () => {
    const submission = validVerifiedSubmission();
    const application = createCommunitySyncApplication({
      submit: () => Promise.resolve({ acceptedEntries: 2, outcome: "accepted" }),
      verify: () => Promise.resolve(submission),
    });

    const first = await application.execute({});
    const second = await application.execute({});

    expect(first.body.requestId).toMatch(/^req_[A-Za-z0-9_-]{22}$/);
    expect(second.body.requestId).toMatch(/^req_[A-Za-z0-9_-]{22}$/);
    expect(second.body.requestId).not.toBe(first.body.requestId);
  });

  it.each([
    ["invalid_request", "invalid_request", 400, "Invalid request", false],
    ["invalid_body", "validation_failed", 422, "Validation failed", false],
    ["origin_rejected", "unauthorized", 401, "Unauthorized", false],
    ["device_rejected", "unauthorized", 401, "Unauthorized", false],
    ["dependency_unavailable", "temporarily_unavailable", 503, "Temporarily unavailable", true],
  ] as const)(
    "maps verifier %s to one generic public problem",
    async (verificationCode, errorCode, status, title, retryable) => {
      const privateFailure = `private-${verificationCode}`;
      const harness = createHarness({
        verify: () =>
          Promise.reject(
            Object.assign(new CommunitySyncVerificationError(verificationCode), {
              privateFailure,
            }),
          ),
      });

      const decision = await harness.application.execute({ privateFailure });

      expectProblem(decision, { errorCode, retryable, status, title });
      expect(harness.submit).not.toHaveBeenCalled();
      expect(JSON.stringify(decision)).not.toContain(privateFailure);
    },
  );

  it("contains an unknown verifier failure as a non-retryable internal problem", async () => {
    const harness = createHarness({
      verify: () => Promise.reject(new Error("private verifier failure")),
    });

    const decision = await harness.application.execute({});

    expectProblem(decision, {
      errorCode: "internal_error",
      retryable: false,
      status: 500,
      title: "Internal server error",
    });
    expect(JSON.stringify(decision)).not.toContain("private verifier failure");
  });

  it.each([
    ["connection_release_failed", "temporarily_unavailable", 503, "Temporarily unavailable", true],
    ["connection_unavailable", "temporarily_unavailable", 503, "Temporarily unavailable", true],
    ["identifier_unavailable", "internal_error", 500, "Internal server error", false],
    ["input_invalid", "internal_error", 500, "Internal server error", false],
    ["pool_close_failed", "internal_error", 500, "Internal server error", false],
    ["query_failed", "temporarily_unavailable", 503, "Temporarily unavailable", true],
    ["result_invalid", "internal_error", 500, "Internal server error", false],
    ["runtime_boundary_mismatch", "temporarily_unavailable", 503, "Temporarily unavailable", true],
  ] as const)(
    "maps database %s to one generic public problem",
    async (databaseCode, errorCode, status, title, retryable) => {
      const privateFailure = `private-${databaseCode}`;
      const harness = createHarness({
        submit: () =>
          Promise.reject(
            Object.assign(new CommunitySyncDatabaseError(databaseCode), { privateFailure }),
          ),
      });

      const decision = await harness.application.execute({});

      expectProblem(decision, { errorCode, retryable, status, title });
      expect(JSON.stringify(decision)).not.toContain(privateFailure);
    },
  );

  it("contains an unknown database failure without reflecting its details", async () => {
    const harness = createHarness({
      submit: () => Promise.reject(new Error("private database failure")),
    });

    const decision = await harness.application.execute({});

    expectProblem(decision, {
      errorCode: "internal_error",
      retryable: false,
      status: 500,
      title: "Internal server error",
    });
    expect(JSON.stringify(decision)).not.toContain("private database failure");
  });

  it.each([
    ["not frozen", () => ({ ...validVerifiedSubmission() })],
    ["wrong top-level keys", () => Object.freeze({ payload: validPayload() })],
    [
      "unfrozen payload",
      () => Object.freeze({ ...validVerifiedSubmission(), payload: { ...validPayload() } }),
    ],
    [
      "wrong payload keys",
      () => Object.freeze({ ...validVerifiedSubmission(), payload: Object.freeze({ syncId }) }),
    ],
    [
      "invalid sync ID",
      () =>
        Object.freeze({
          ...validVerifiedSubmission(),
          payload: Object.freeze({ ...validPayload(), syncId: "private-sync" }),
        }),
    ],
    [
      "unfrozen entries",
      () =>
        Object.freeze({
          ...validVerifiedSubmission(),
          payload: Object.freeze({
            ...validPayload(),
            dailyEntries: [...validPayload().dailyEntries],
          }),
        }),
    ],
    [
      "empty entries",
      () =>
        Object.freeze({
          ...validVerifiedSubmission(),
          payload: Object.freeze({ ...validPayload(), dailyEntries: Object.freeze([]) }),
        }),
    ],
    [
      "decorated entries",
      () => {
        const entries = [...validPayload().dailyEntries];
        Object.defineProperty(entries, "private", { enumerable: true, value: "hidden" });
        Object.freeze(entries);
        return Object.freeze({
          ...validVerifiedSubmission(),
          payload: Object.freeze({ ...validPayload(), dailyEntries: entries }),
        });
      },
    ],
    [
      "accessor payload",
      () => {
        const value = { ...validVerifiedSubmission() };
        Object.defineProperty(value, "payload", { enumerable: true, get: () => validPayload() });
        return Object.freeze(value);
      },
    ],
    [
      "throwing-prototype verifier result",
      () =>
        new Proxy(validVerifiedSubmission(), {
          getPrototypeOf: () => {
            throw new Error("private verifier prototype failure");
          },
        }),
    ],
  ] as const)(
    "fails closed before submission for a %s verifier result",
    async (_name, createValue) => {
      const verify = vi.fn(() => Promise.resolve(createValue() as VerifiedCommunitySync));
      const submit = vi.fn(() =>
        Promise.resolve({ acceptedEntries: 2, outcome: "accepted" } as const),
      );
      mockRandomBytes(fixedEntropy);
      const application = createCommunitySyncApplication({ submit, verify });

      const decision = await application.execute({});

      expectProblem(decision, {
        errorCode: "internal_error",
        retryable: false,
        status: 500,
        title: "Internal server error",
      });
      expect(submit).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["non-object", 1],
    ["decorated", { acceptedEntries: 2, outcome: "accepted", privateReason: "hidden" }],
    ["fractional count", { acceptedEntries: 1.5, outcome: "accepted" }],
    ["accepted overflow", { acceptedEntries: 3, outcome: "accepted" }],
    ["duplicate count", { acceptedEntries: 2, outcome: "duplicate" }],
    ["quarantined count", { acceptedEntries: 2, outcome: "quarantined" }],
    ["unknown outcome", { acceptedEntries: 0, outcome: "private" }],
    [
      "accessor",
      Object.defineProperty({ outcome: "accepted" }, "acceptedEntries", {
        enumerable: true,
        get: () => 2,
      }),
    ],
  ] as const)("fails closed for a %s database result", async (_name, rawResult) => {
    const harness = createHarness({
      submit: () => Promise.resolve(rawResult as unknown as CommunitySyncSubmissionResult),
    });

    const decision = await harness.application.execute({});

    expectProblem(decision, {
      errorCode: "internal_error",
      retryable: false,
      status: 500,
      title: "Internal server error",
    });
  });

  it("contains a throwing-prototype database result", async () => {
    const hostile: CommunitySyncSubmissionResult = new Proxy(
      { acceptedEntries: 2, outcome: "accepted" },
      {
        getPrototypeOf: () => {
          throw new Error("private database prototype failure");
        },
      },
    );
    const harness = createHarness({
      submit: () => Promise.resolve(hostile),
    });

    const decision = await harness.application.execute({});

    expectProblem(decision, {
      errorCode: "internal_error",
      retryable: false,
      status: 500,
      title: "Internal server error",
    });
  });

  it.each([
    null,
    {},
    { submit: () => Promise.resolve({ acceptedEntries: 0, outcome: "duplicate" }) },
    { submit: 1, verify: () => Promise.resolve(validVerifiedSubmission()) },
    { submit: () => Promise.resolve({ acceptedEntries: 2, outcome: "accepted" }), verify: 1 },
    {
      extra: true,
      submit: () => Promise.resolve({ acceptedEntries: 2, outcome: "accepted" }),
      verify: () => Promise.resolve(validVerifiedSubmission()),
    },
  ])("rejects malformed application dependencies", (dependencies) => {
    expect(() => createCommunitySyncApplication(dependencies)).toThrow(
      expect.objectContaining({
        code: "dependency_invalid",
        message: "Community sync application response construction failed.",
      }),
    );
  });

  it("rejects accessor-backed and revoked dependency containers", () => {
    const accessorDependencies = {
      submit: () => Promise.resolve({ acceptedEntries: 2, outcome: "accepted" } as const),
    };
    Object.defineProperty(accessorDependencies, "verify", {
      enumerable: true,
      get: () => () => Promise.resolve(validVerifiedSubmission()),
    });
    expect(() => createCommunitySyncApplication(accessorDependencies)).toThrow(
      expect.objectContaining({ code: "dependency_invalid" }),
    );

    const revoked = Proxy.revocable(
      {
        submit: () => Promise.resolve({ acceptedEntries: 2, outcome: "accepted" } as const),
        verify: () => Promise.resolve(validVerifiedSubmission()),
      },
      {},
    );
    revoked.revoke();
    expect(() => createCommunitySyncApplication(revoked.proxy)).toThrow(
      expect.objectContaining({ code: "dependency_invalid" }),
    );
  });

  it("does not accept a caller-selected entropy source", async () => {
    const productionEntropy = vi.fn(() => Buffer.alloc(16, 0x01));
    mockRandomBytes(productionEntropy);
    const createWithIgnoredArgument = createCommunitySyncApplication as unknown as (
      dependencies: unknown,
      ignoredEntropy: () => Uint8Array,
    ) => ReturnType<typeof createCommunitySyncApplication>;
    const application = createWithIgnoredArgument(
      {
        submit: () => Promise.resolve({ acceptedEntries: 2, outcome: "accepted" } as const),
        verify: () => Promise.resolve(validVerifiedSubmission()),
      },
      fixedEntropy,
    );

    const decision = await application.execute({});

    expect(productionEntropy).toHaveBeenCalledWith(16);
    expect(decision.body.requestId).not.toBe(requestId);
  });

  it("accepts null-prototype capability and result records without inherited behavior", async () => {
    const dependencies = Object.assign(Object.create(null) as object, {
      submit: () =>
        Promise.resolve(
          Object.assign(Object.create(null) as object, {
            acceptedEntries: 2,
            outcome: "accepted" as const,
          }) as CommunitySyncSubmissionResult,
        ),
      verify: () => Promise.resolve(validVerifiedSubmission()),
    });
    mockRandomBytes(fixedEntropy);
    const application = createCommunitySyncApplication(dependencies);

    const decision = await application.execute({});

    expect(decision).toMatchObject({
      body: { acceptedEntries: 2, outcome: "accepted", requestId, syncId },
      ok: true,
      status: 200,
    });
  });

  it("fails before verification when request ID entropy is unavailable or malformed", async () => {
    const unavailable = createHarness({
      entropySource: () => {
        throw new Error("private entropy failure");
      },
    });
    await expect(unavailable.application.execute({})).rejects.toMatchObject({
      code: "entropy_unavailable",
      message: "Community sync application response construction failed.",
    });
    expect(unavailable.verify).not.toHaveBeenCalled();

    const short = createHarness({ entropySource: () => Buffer.alloc(15) });
    await expect(short.application.execute({})).rejects.toMatchObject({ code: "entropy_invalid" });
    expect(short.verify).not.toHaveBeenCalled();

    const wrongType = createHarness({
      entropySource: (() => "private") as unknown as EntropySource,
    });
    await expect(wrongType.application.execute({})).rejects.toMatchObject({
      code: "entropy_invalid",
    });
    expect(wrongType.verify).not.toHaveBeenCalled();

    const throwingLength = Object.defineProperty(new Uint8Array(16), "byteLength", {
      configurable: true,
      get: () => {
        throw new Error("private length failure");
      },
    });
    const hostile = createHarness({ entropySource: () => throwingLength });
    await expect(hostile.application.execute({})).rejects.toMatchObject({
      code: "entropy_invalid",
    });
    expect(hostile.verify).not.toHaveBeenCalled();
  });

  it("composes the production verifier and database adapter in the required order", async () => {
    const release = vi.fn();
    const verifyRuntimeBoundary = vi.fn(() =>
      Promise.resolve([{ login_scope_ok: true, role_ok: true, search_path_ok: true }]),
    );
    const readDeviceVerificationMaterial = vi.fn(() =>
      Promise.resolve([
        {
          accounting_revision: accountingRevision,
          agent_account_id: agentAccountId,
          device_id: deviceId,
          device_key_id: deviceKeyId,
          identity_assurance: "community_local",
          installation_id: installationId,
          maximum_backfill_days: 31,
          provider_code: provider,
          public_key: Buffer.from(devicePublicKey),
          reader_version: readerVersion,
          scope_kind: "agent_account",
        },
      ]),
    );
    const submitUsageSync = vi.fn(() =>
      Promise.resolve([
        { accepted_entries: 2, outcome: "accepted", recovery_action: null },
      ]),
    );
    const client: IngestDatabaseClient = {
      readDeviceVerificationMaterial,
      release,
      submitUsageSync,
      verifyRuntimeBoundary,
    };
    const close = vi.fn(() => Promise.resolve());
    const connect = vi.fn(() => Promise.resolve(client));
    const pool: IngestDatabasePool = { close, connect };
    const database = createCommunitySyncDatabase(
      pool,
      (prefix) =>
        prefix === "obs"
          ? "obs_FFFFFFFFFFFFFFFFFFFFFF"
          : "evt_GGGGGGGGGGGGGGGGGGGGGG",
    );
    const verifier = createCommunitySyncVerifier({
      now: () => nowMilliseconds,
      originKeys: [{ keyId: originKeyId, secret: Buffer.from(originSecret) }],
      readDeviceVerificationMaterial: (candidateDeviceId: string) =>
        database.readDeviceVerificationMaterial(candidateDeviceId),
    });
    mockRandomBytes(fixedEntropy);
    const application = createCommunitySyncApplication({
      submit: (submission: unknown) => database.submit(submission),
      verify: (request: unknown) => verifier.verify(request),
    });

    const decision = await application.execute(buildSignedRawRequest());

    expect(decision).toMatchObject({
      body: { acceptedEntries: 2, outcome: "accepted", requestId, syncId },
      ok: true,
      status: 200,
    });
    expect(connect).toHaveBeenCalledTimes(2);
    expect(verifyRuntimeBoundary).toHaveBeenCalledTimes(2);
    expect(readDeviceVerificationMaterial).toHaveBeenCalledWith(deviceId);
    expect(submitUsageSync).toHaveBeenCalledTimes(1);
    expect(readDeviceVerificationMaterial.mock.invocationCallOrder[0]).toBeLessThan(
      submitUsageSync.mock.invocationCallOrder[0]!,
    );
    expect(submitUsageSync).toHaveBeenCalledWith(
      expect.objectContaining({
        agentAccountId,
        eventId: "evt_GGGGGGGGGGGGGGGGGGGGGG",
        observationId: "obs_FFFFFFFFFFFFFFFFFFFFFF",
        originKeyId,
        readerVersion,
      }),
    );
    expect(release).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenNthCalledWith(1, false);
    expect(release).toHaveBeenNthCalledWith(2, false);
  });

  it("constructs and closes the configured production composition without opening a connection", async () => {
    const application = await createConfiguredCommunitySyncApplication(
      configuredEnvironment,
      undefined,
      () => nowMilliseconds,
    );

    expect(Object.keys(application).sort()).toEqual(["close", "execute"]);
    expect(Object.isFrozen(application)).toBe(true);
    await application.close();
  });

  it("closes the configured database boundary when origin configuration fails", async () => {
    const environment = { ...configuredEnvironment } as Record<string, string | undefined>;
    delete environment.VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_BASE64URL;

    await expect(
      createConfiguredCommunitySyncApplication(environment, undefined, () => nowMilliseconds),
    ).rejects.toBeInstanceOf(OriginProofConfigurationError);
  });
});

describe("Community sync application error", () => {
  it("contains only its bounded construction code", () => {
    const error = new CommunitySyncApplicationError("contract_rejected");

    expect(error).toMatchObject({
      code: "contract_rejected",
      message: "Community sync application response construction failed.",
      name: "CommunitySyncApplicationError",
    });
    expect(Object.keys(error).sort()).toEqual(["code", "name"]);
  });
});
