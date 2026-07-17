// @vitest-environment node

import { Buffer } from "node:buffer";

import pairingVector from "../../../contracts/v1/connector-pairing-possession.test-vector.json";
import { describe, expect, it, vi } from "vitest";

import { createPairingActivationAdmission } from "./pairing-activation-admission";
import {
  createConfiguredPairingActivationApplication,
  createPairingActivationApplication,
  PairingActivationApplicationError,
} from "./pairing-activation-application";
import type { PairingActivationDatabaseAttempt } from "./pairing-activation-database";

const pollToken = Buffer.alloc(32, 0x33).toString("base64url");
const clientIdBase64Url = Buffer.alloc(16, 0x44).toString("base64url");

function candidate(
  options: {
    readonly clearError?: Error;
    readonly secondaryActive?: boolean;
    readonly tokenAccepted?: boolean;
  } = {},
): {
  readonly clear: ReturnType<typeof vi.fn>;
  readonly value: Readonly<{
    clear(): void;
    digests: readonly [Buffer, Buffer];
    secondaryActive: boolean;
    tokenAccepted: boolean;
  }>;
} {
  const digests: [Buffer, Buffer] = [Buffer.alloc(32, 0x11), Buffer.alloc(32, 0x22)];
  Object.freeze(digests);
  const clear = vi.fn(() => {
    if (options.clearError !== undefined) {
      throw options.clearError;
    }
    digests[0].fill(0);
    digests[1].fill(0);
  });
  return {
    clear,
    value: Object.freeze({
      clear,
      digests,
      secondaryActive: options.secondaryActive ?? true,
      tokenAccepted: options.tokenAccepted ?? true,
    }),
  };
}

function harness(
  options: {
    readonly activateError?: Error;
    readonly admission?: { tryAcquire(): unknown };
    readonly candidate?: ReturnType<typeof candidate>;
    readonly databaseResult?: unknown;
    readonly deriveError?: Error;
    readonly settleError?: Error;
  } = {},
): {
  readonly activate: ReturnType<typeof vi.fn>;
  readonly attemptSnapshots: PairingActivationDatabaseAttempt[];
  readonly candidate: ReturnType<typeof candidate>;
  readonly dependencies: object;
  readonly derive: ReturnType<typeof vi.fn>;
  readonly settle: ReturnType<typeof vi.fn>;
  readonly start: ReturnType<typeof vi.fn>;
} {
  const attemptSnapshots: PairingActivationDatabaseAttempt[] = [];
  const proofCandidate = options.candidate ?? candidate();
  const activate = vi.fn((attempt: unknown): Promise<unknown> => {
    const typed = attempt as PairingActivationDatabaseAttempt;
    attemptSnapshots.push({
      ...typed,
      clientIdentityDigest: Buffer.from(typed.clientIdentityDigest),
      pollVerifierDigests: [
        Buffer.from(typed.pollVerifierDigests[0]),
        Buffer.from(typed.pollVerifierDigests[1]),
      ],
    });
    if (options.activateError !== undefined) {
      return Promise.reject(options.activateError);
    }
    return Promise.resolve(
      options.databaseResult ??
        (typed.allowActivation
          ? {
              deviceId: typed.deviceId,
              outcome: "activated",
              sourceId: "src_BBBBBBBBBBBBBBBBBBBBBB",
            }
          : { outcome: "pending" }),
    );
  });
  const derive = vi.fn((token: unknown) => {
    if (options.deriveError !== undefined) {
      throw options.deriveError;
    }
    expect(token === pollToken || token === undefined).toBe(true);
    return proofCandidate.value;
  });
  const start = vi.fn(() => 100);
  const settle = vi.fn((): Promise<void> => {
    if (options.settleError !== undefined) {
      return Promise.reject(options.settleError);
    }
    return Promise.resolve();
  });
  return {
    activate,
    attemptSnapshots,
    candidate: proofCandidate,
    dependencies: {
      admission: options.admission ?? createPairingActivationAdmission(1),
      database: { activate },
      pollVerifier: { derive },
      ratePolicy: {
        limits: () => ({ bucketLimit: 120, globalLimit: 1200, windowSeconds: 60 }),
      },
      timing: { settle, start },
    },
    derive,
    settle,
    start,
  };
}

describe("pairing activation application", () => {
  it("composes an exact eligible attempt and returns only the issued device identifier", async () => {
    const testHarness = harness();
    const application = createPairingActivationApplication(testHarness.dependencies);

    const decision = await application.execute({
      clientIdBase64Url,
      pollToken,
      possessionSignature: pairingVector.possessionSignatureBase64Url,
    });

    expect(decision).toMatchObject({ outcome: "activated" });
    expect(decision.requestId).toMatch(/^req_[A-Za-z0-9_-]{22}$/);
    expect(decision.outcome === "activated" ? decision.deviceId : undefined).toMatch(
      /^dev_[A-Za-z0-9_-]{22}$/,
    );
    expect(decision.outcome === "activated" ? decision.sourceId : undefined).toBe(
      "src_BBBBBBBBBBBBBBBBBBBBBB",
    );
    expect(Reflect.ownKeys(decision).sort()).toEqual([
      "deviceId",
      "outcome",
      "requestId",
      "sourceId",
    ]);
    expect(Object.isFrozen(decision)).toBe(true);
    expect(testHarness.attemptSnapshots).toHaveLength(1);
    expect(testHarness.attemptSnapshots[0]).toMatchObject({
      allowActivation: true,
      deviceId: decision.outcome === "activated" ? decision.deviceId : undefined,
      requestId: decision.requestId,
      rateBucketLimit: 120,
      rateGlobalLimit: 1200,
      rateWindowSeconds: 60,
      secondaryCandidateActive: true,
      signatureBase64Url: pairingVector.possessionSignatureBase64Url,
    });
    expect(testHarness.attemptSnapshots[0]?.auditEventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(testHarness.attemptSnapshots[0]?.pollVerifierDigests).toEqual([
      Buffer.alloc(32, 0x11),
      Buffer.alloc(32, 0x22),
    ]);
    expect(testHarness.attemptSnapshots[0]?.clientIdentityDigest).toHaveLength(32);
    expect(testHarness.attemptSnapshots[0]?.clientIdentityDigest).not.toEqual(Buffer.alloc(32));
    expect(testHarness.candidate.clear).toHaveBeenCalledOnce();
    expect(testHarness.candidate.value.digests).toEqual([Buffer.alloc(32), Buffer.alloc(32)]);
    expect(testHarness.start).toHaveBeenCalledOnce();
    expect(testHarness.settle).toHaveBeenCalledWith(100);
    expect(Object.isFrozen(application)).toBe(true);
  });

  it.each([
    null,
    {},
    {
      clientIdBase64Url,
      pollToken,
      possessionSignature: pairingVector.possessionSignatureBase64Url,
      extra: true,
    },
    {
      clientIdBase64Url,
      pollToken,
      possessionSignature: `${pairingVector.possessionSignatureBase64Url}=`,
    },
    {
      clientIdBase64Url: "A".repeat(21),
      pollToken,
      possessionSignature: pairingVector.possessionSignatureBase64Url,
    },
  ])(
    "keeps malformed input on the same dependency path but makes it ineligible: %o",
    async (input) => {
      const testHarness = harness();
      const application = createPairingActivationApplication(testHarness.dependencies);

      const decision = await application.execute(input);

      expect(decision).toMatchObject({ outcome: "pending" });
      expect(Reflect.ownKeys(decision).sort()).toEqual(["outcome", "requestId"]);
      expect(testHarness.activate).toHaveBeenCalledOnce();
      expect(testHarness.attemptSnapshots[0]?.allowActivation).toBe(false);
      expect(testHarness.attemptSnapshots[0]?.signatureBase64Url).toMatch(/^[A-Za-z0-9_-]{86}$/);
      expect(testHarness.candidate.clear).toHaveBeenCalledOnce();
      expect(testHarness.settle).toHaveBeenCalledOnce();
    },
  );

  it("does no derivation or database work when the process admission budget is exhausted", async () => {
    const testHarness = harness({ admission: { tryAcquire: () => undefined } });
    const application = createPairingActivationApplication(testHarness.dependencies);

    const decision = await application.execute({
      clientIdBase64Url,
      pollToken,
      possessionSignature: pairingVector.possessionSignatureBase64Url,
    });

    expect(decision).toMatchObject({ outcome: "not_activated" });
    expect(testHarness.derive).not.toHaveBeenCalled();
    expect(testHarness.activate).not.toHaveBeenCalled();
    expect(testHarness.start).not.toHaveBeenCalled();
    expect(testHarness.settle).not.toHaveBeenCalled();
  });

  it("holds admission until settlement completes", async () => {
    let finishSettlement: (() => void) | undefined;
    const settlement = new Promise<void>((resolve) => {
      finishSettlement = resolve;
    });
    const proofCandidate = candidate();
    const activate = vi.fn(() => Promise.resolve({ outcome: "pending" }));
    const derive = vi.fn(() => proofCandidate.value);
    const settle = vi.fn(() => settlement);
    const application = createPairingActivationApplication({
      admission: createPairingActivationAdmission(1),
      database: { activate },
      pollVerifier: { derive },
      ratePolicy: {
        limits: () => ({ bucketLimit: 120, globalLimit: 1200, windowSeconds: 60 }),
      },
      timing: { settle, start: () => 100 },
    });

    const first = application.execute({
      clientIdBase64Url,
      pollToken,
      possessionSignature: pairingVector.possessionSignatureBase64Url,
    });
    await vi.waitFor(() => {
      expect(settle).toHaveBeenCalledOnce();
    });
    const second = await application.execute({
      clientIdBase64Url,
      pollToken,
      possessionSignature: pairingVector.possessionSignatureBase64Url,
    });

    expect(second).toMatchObject({ outcome: "not_activated" });
    expect(derive).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledOnce();
    finishSettlement?.();
    await expect(first).resolves.toMatchObject({ outcome: "pending" });
  });

  it.each([
    {
      label: "derivation failure",
      options: { deriveError: new Error("private failure") },
    },
    {
      label: "database failure",
      options: { activateError: new Error("private failure") },
    },
    {
      label: "timing failure after activation",
      options: { settleError: new Error("private failure") },
    },
    {
      label: "candidate cleanup failure after activation",
      options: { candidate: candidate({ clearError: new Error("private failure") }) },
    },
    {
      label: "lease release failure after activation",
      options: {
        admission: {
          tryAcquire: () => ({
            release() {
              throw new Error("private failure");
            },
          }),
        },
      },
    },
  ])("returns the same generic decision for $label", async ({ options }) => {
    const testHarness = harness(options);
    const application = createPairingActivationApplication(testHarness.dependencies);

    const decision = await application.execute({
      clientIdBase64Url,
      pollToken,
      possessionSignature: pairingVector.possessionSignatureBase64Url,
    });

    expect(decision).toMatchObject({ outcome: "not_activated" });
    expect(Reflect.ownKeys(decision).sort()).toEqual(["outcome", "requestId"]);
    expect(JSON.stringify(decision)).not.toContain("private failure");
  });

  it("returns an explicit rate decision without exposing thresholds", async () => {
    const testHarness = harness({ databaseResult: { outcome: "rate_limited" } });

    const decision = await createPairingActivationApplication(testHarness.dependencies).execute({
      clientIdBase64Url,
      pollToken,
      possessionSignature: pairingVector.possessionSignatureBase64Url,
    });

    expect(decision).toMatchObject({ outcome: "rate_limited" });
    expect(Reflect.ownKeys(decision).sort()).toEqual(["outcome", "requestId"]);
  });

  it("contains an unknown database result", async () => {
    const testHarness = harness({ databaseResult: true });

    await expect(
      createPairingActivationApplication(testHarness.dependencies).execute({
        clientIdBase64Url,
        pollToken,
        possessionSignature: pairingVector.possessionSignatureBase64Url,
      }),
    ).resolves.toMatchObject({ outcome: "not_activated" });
  });

  it.each([
    null,
    {},
    {
      admission: createPairingActivationAdmission(),
      database: { activate: () => Promise.resolve({ outcome: "pending" }) },
      pollVerifier: { derive: () => candidate().value },
      ratePolicy: {
        limits: () => ({ bucketLimit: 120, globalLimit: 1200, windowSeconds: 60 }),
      },
      timing: { settle: () => Promise.resolve(), start: () => 0 },
      extra: true,
    },
  ])("rejects an invalid dependency graph: %o", (dependencies) => {
    expect(() => createPairingActivationApplication(dependencies)).toThrow(
      PairingActivationApplicationError,
    );
  });

  it("constructs and closes the dormant configured boundary without opening a connection", async () => {
    const application = await createConfiguredPairingActivationApplication({
      NODE_ENV: "test",
      VIBERACING_WEB_DATABASE_HOST: "127.0.0.1",
      VIBERACING_WEB_DATABASE_NAME: "viberacing_local",
      VIBERACING_WEB_DATABASE_PASSWORD: "private-pairing-database-password",
      VIBERACING_WEB_DATABASE_PORT: "54329",
      VIBERACING_WEB_DATABASE_TLS_MODE: "disable",
      VIBERACING_WEB_DATABASE_USER: "viberacing_web_login",
      VIBERACING_WEB_PAIRING_POLL_PRIMARY_KEY_BASE64URL: Buffer.alloc(32, 0x44).toString(
        "base64url",
      ),
      VIBERACING_WEB_PAIRING_POLL_BUCKET_LIMIT: "120",
      VIBERACING_WEB_PAIRING_POLL_GLOBAL_LIMIT: "1200",
      VIBERACING_WEB_PAIRING_POLL_WINDOW_SECONDS: "60",
      VIBERACING_WEB_PAIRING_START_BUCKET_LIMIT: "12",
      VIBERACING_WEB_PAIRING_START_GLOBAL_LIMIT: "120",
      VIBERACING_WEB_PAIRING_START_WINDOW_SECONDS: "60",
    });

    expect(Object.isFrozen(application)).toBe(true);
    await expect(application.close()).resolves.toBeUndefined();
    await expect(application.close()).resolves.toBeUndefined();
  });
});
