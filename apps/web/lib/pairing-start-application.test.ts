// @vitest-environment node

import { Buffer } from "node:buffer";

import pairingVector from "../../../contracts/v1/connector-pairing-possession.test-vector.json";
import { describe, expect, it, vi } from "vitest";

import { createPairingStartAdmission } from "./pairing-start-admission";
import {
  createConfiguredPairingStartApplication,
  createPairingStartApplication,
  PairingStartApplicationError,
} from "./pairing-start-application";
import type { PairingStartDatabaseAttempt } from "./pairing-start-database";
import { pairingUserCodePattern } from "./pairing-user-code-verifier";

const validRequest = {
  architecture: "x86_64",
  clientIdBase64Url: Buffer.alloc(16, 0x77).toString("base64url"),
  connectorVersion: "0.0.0-test",
  deviceLabel: "Synthetic device",
  devicePublicKeyBase64Url: pairingVector.devicePublicKeyBase64Url,
  osFamily: "windows",
} as const;

function pollCandidate(clearError?: Error) {
  const digests: [Buffer, Buffer] = [Buffer.alloc(32, 0x11), Buffer.alloc(32, 0x12)];
  Object.freeze(digests);
  const clear = vi.fn(() => {
    digests[0].fill(0);
    digests[1].fill(0);
    if (clearError !== undefined) {
      throw clearError;
    }
  });
  return {
    clear,
    value: Object.freeze({ clear, digests, secondaryActive: false, tokenAccepted: true }),
  };
}

function codeCandidate(clearError?: Error) {
  const digests: [Buffer, Buffer] = [Buffer.alloc(32, 0x21), Buffer.alloc(32, 0x22)];
  Object.freeze(digests);
  const clear = vi.fn(() => {
    digests[0].fill(0);
    digests[1].fill(0);
    if (clearError !== undefined) {
      throw clearError;
    }
  });
  return {
    clear,
    value: Object.freeze({ clear, codeAccepted: true, digests, secondaryActive: false }),
  };
}

function harness(
  options: {
    readonly admission?: { tryAcquire(): unknown };
    readonly codeCandidate?: ReturnType<typeof codeCandidate>;
    readonly codeError?: Error;
    readonly databaseResult?: unknown;
    readonly databaseError?: Error;
    readonly pollCandidate?: ReturnType<typeof pollCandidate>;
    readonly pollError?: Error;
    readonly settleError?: Error;
  } = {},
): {
  readonly codeCandidate: ReturnType<typeof codeCandidate>;
  readonly deriveCode: ReturnType<typeof vi.fn>;
  readonly derivePoll: ReturnType<typeof vi.fn>;
  readonly pollCandidate: ReturnType<typeof pollCandidate>;
  readonly settle: ReturnType<typeof vi.fn>;
  readonly startDatabase: ReturnType<typeof vi.fn>;
  readonly startSnapshots: PairingStartDatabaseAttempt[];
  readonly startTiming: ReturnType<typeof vi.fn>;
  readonly dependencies: object;
} {
  const selectedPollCandidate = options.pollCandidate ?? pollCandidate();
  const selectedCodeCandidate = options.codeCandidate ?? codeCandidate();
  const startSnapshots: PairingStartDatabaseAttempt[] = [];
  const derivePoll = vi.fn((token: unknown) => {
    if (options.pollError !== undefined) {
      throw options.pollError;
    }
    expect(typeof token === "string" ? Buffer.from(token, "base64url") : undefined).toHaveLength(
      32,
    );
    return selectedPollCandidate.value;
  });
  const deriveCode = vi.fn((code: unknown) => {
    if (options.codeError !== undefined) {
      throw options.codeError;
    }
    expect(typeof code === "string" && pairingUserCodePattern.test(code)).toBe(true);
    return selectedCodeCandidate.value;
  });
  const startDatabase = vi.fn((attempt: unknown): Promise<unknown> => {
    const typed = attempt as PairingStartDatabaseAttempt;
    startSnapshots.push({
      ...typed,
      clientIdentityDigest: Buffer.from(typed.clientIdentityDigest),
      pairingChallenge: Buffer.from(typed.pairingChallenge),
      pollVerifierDigest: Buffer.from(typed.pollVerifierDigest),
      publicKey: Buffer.from(typed.publicKey),
      userCodeDigest: Buffer.from(typed.userCodeDigest),
    });
    return options.databaseError === undefined
      ? Promise.resolve(options.databaseResult ?? "created")
      : Promise.reject(options.databaseError);
  });
  const startTiming = vi.fn(() => 100);
  const settle = vi.fn(() =>
    options.settleError === undefined ? Promise.resolve() : Promise.reject(options.settleError),
  );
  return {
    codeCandidate: selectedCodeCandidate,
    dependencies: {
      admission: options.admission ?? createPairingStartAdmission(1),
      database: { start: startDatabase },
      pollVerifier: { derive: derivePoll },
      ratePolicy: {
        limits: () => ({ bucketLimit: 20, globalLimit: 200, windowSeconds: 60 }),
      },
      timing: { settle, start: startTiming },
      userCodeVerifier: { derive: deriveCode },
    },
    deriveCode,
    derivePoll,
    pollCandidate: selectedPollCandidate,
    settle,
    startDatabase,
    startSnapshots,
    startTiming,
  };
}

describe("pairing start application", () => {
  it("creates one exact pending transaction and returns only connector start material", async () => {
    const testHarness = harness();
    const application = createPairingStartApplication(testHarness.dependencies);

    const decision = await application.execute(validRequest);

    expect(decision).toMatchObject({ outcome: "created" });
    expect(decision.requestId).toMatch(/^req_[A-Za-z0-9_-]{22}$/);
    if (decision.outcome !== "created") {
      throw new Error("expected created pairing start decision");
    }
    expect(Reflect.ownKeys(decision).sort()).toEqual([
      "expiresAt",
      "outcome",
      "pairingChallengeBase64Url",
      "pairingId",
      "pollToken",
      "requestId",
      "userCode",
    ]);
    expect(decision.pairingId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(Buffer.from(decision.pollToken, "base64url")).toHaveLength(32);
    expect(Buffer.from(decision.pairingChallengeBase64Url, "base64url")).toHaveLength(32);
    expect(pairingUserCodePattern.test(decision.userCode)).toBe(true);
    expect(Number.isFinite(Date.parse(decision.expiresAt))).toBe(true);
    expect(Object.isFrozen(decision)).toBe(true);
    expect(testHarness.startSnapshots).toHaveLength(1);
    expect(testHarness.startSnapshots[0]).toMatchObject({
      architecture: validRequest.architecture,
      connectorVersion: validRequest.connectorVersion,
      deviceLabel: validRequest.deviceLabel,
      expiresAt: decision.expiresAt,
      osFamily: validRequest.osFamily,
      pairingId: decision.pairingId,
      rateBucketLimit: 20,
      rateGlobalLimit: 200,
      rateWindowSeconds: 60,
    });
    expect(testHarness.startSnapshots[0]?.clientIdentityDigest).toHaveLength(32);
    expect(testHarness.startSnapshots[0]?.clientIdentityDigest).not.toEqual(Buffer.alloc(32));
    expect(testHarness.startSnapshots[0]?.deviceKeyId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(testHarness.startSnapshots[0]?.deviceKeyId).not.toBe(decision.pairingId);
    expect(testHarness.startSnapshots[0]?.pairingChallenge).toEqual(
      Buffer.from(decision.pairingChallengeBase64Url, "base64url"),
    );
    expect(testHarness.startSnapshots[0]?.pollVerifierDigest).toEqual(Buffer.alloc(32, 0x11));
    expect(testHarness.startSnapshots[0]?.userCodeDigest).toEqual(Buffer.alloc(32, 0x21));
    expect(testHarness.startSnapshots[0]?.publicKey).toEqual(
      Buffer.from(validRequest.devicePublicKeyBase64Url, "base64url"),
    );
    expect(testHarness.pollCandidate.clear).toHaveBeenCalledOnce();
    expect(testHarness.codeCandidate.clear).toHaveBeenCalledOnce();
    expect(testHarness.startTiming).toHaveBeenCalledOnce();
    expect(testHarness.settle).toHaveBeenCalledWith(100);
    expect(Object.isFrozen(application)).toBe(true);
  });

  it.each([
    null,
    {},
    { ...validRequest, extra: true },
    { ...validRequest, clientIdBase64Url: "A".repeat(21) },
    { ...validRequest, devicePublicKeyBase64Url: "A".repeat(43) },
    { ...validRequest, deviceLabel: " Synthetic device" },
    { ...validRequest, deviceLabel: "A".repeat(129) },
    { ...validRequest, connectorVersion: "candidate" },
    { ...validRequest, connectorVersion: "01.2.3" },
    { ...validRequest, connectorVersion: "1.2.3-alpha..1" },
    { ...validRequest, osFamily: "other" },
    { ...validRequest, architecture: "other" },
  ])("keeps admitted malformed input generic without writing: %o", async (input) => {
    const testHarness = harness();
    const decision = await createPairingStartApplication(testHarness.dependencies).execute(input);

    expect(decision).toMatchObject({ outcome: "not_created" });
    expect(Reflect.ownKeys(decision).sort()).toEqual(["outcome", "requestId"]);
    expect(testHarness.derivePoll).toHaveBeenCalledOnce();
    expect(testHarness.deriveCode).toHaveBeenCalledOnce();
    expect(testHarness.startDatabase).not.toHaveBeenCalled();
    expect(testHarness.pollCandidate.clear).toHaveBeenCalledOnce();
    expect(testHarness.codeCandidate.clear).toHaveBeenCalledOnce();
    expect(testHarness.settle).toHaveBeenCalledOnce();
  });

  it("does no entropy, derivation, or database work when local admission is exhausted", async () => {
    const testHarness = harness({ admission: { tryAcquire: () => undefined } });
    const decision = await createPairingStartApplication(testHarness.dependencies).execute(
      validRequest,
    );

    expect(decision).toMatchObject({ outcome: "not_created" });
    expect(testHarness.derivePoll).not.toHaveBeenCalled();
    expect(testHarness.deriveCode).not.toHaveBeenCalled();
    expect(testHarness.startDatabase).not.toHaveBeenCalled();
    expect(testHarness.startTiming).not.toHaveBeenCalled();
  });

  it("does no material or database work when timing returns an invalid marker", async () => {
    const testHarness = harness();
    const dependencies = {
      ...testHarness.dependencies,
      timing: { settle: testHarness.settle, start: () => Number.NaN },
    };

    const decision = await createPairingStartApplication(dependencies).execute(validRequest);

    expect(decision).toMatchObject({ outcome: "not_created" });
    expect(testHarness.derivePoll).not.toHaveBeenCalled();
    expect(testHarness.deriveCode).not.toHaveBeenCalled();
    expect(testHarness.startDatabase).not.toHaveBeenCalled();
    expect(testHarness.settle).not.toHaveBeenCalled();
  });

  it("holds the admission lease until settlement completes", async () => {
    let finishSettlement: (() => void) | undefined;
    const settlement = new Promise<void>((resolve) => {
      finishSettlement = resolve;
    });
    const poll = pollCandidate();
    const code = codeCandidate();
    const startDatabase = vi.fn(() => Promise.resolve("rate_limited"));
    const derivePoll = vi.fn(() => poll.value);
    const deriveCode = vi.fn(() => code.value);
    const settle = vi.fn(() => settlement);
    const application = createPairingStartApplication({
      admission: createPairingStartAdmission(1),
      database: { start: startDatabase },
      pollVerifier: { derive: derivePoll },
      ratePolicy: {
        limits: () => ({ bucketLimit: 20, globalLimit: 200, windowSeconds: 60 }),
      },
      timing: { settle, start: () => 100 },
      userCodeVerifier: { derive: deriveCode },
    });

    const first = application.execute(validRequest);
    await vi.waitFor(() => {
      expect(settle).toHaveBeenCalledOnce();
    });
    const second = await application.execute(validRequest);

    expect(second).toMatchObject({ outcome: "not_created" });
    expect(startDatabase).toHaveBeenCalledOnce();
    finishSettlement?.();
    await expect(first).resolves.toMatchObject({ outcome: "rate_limited" });
  });

  it.each([
    { label: "poll derivation failure", options: { pollError: new Error("private failure") } },
    { label: "code derivation failure", options: { codeError: new Error("private failure") } },
    { label: "database failure", options: { databaseError: new Error("private failure") } },
    { label: "timing failure", options: { settleError: new Error("private failure") } },
    {
      label: "poll cleanup failure",
      options: { pollCandidate: pollCandidate(new Error("private failure")) },
    },
    {
      label: "code cleanup failure",
      options: { codeCandidate: codeCandidate(new Error("private failure")) },
    },
    {
      label: "lease release failure",
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
    const decision = await createPairingStartApplication(testHarness.dependencies).execute(
      validRequest,
    );

    expect(decision).toMatchObject({ outcome: "not_created" });
    expect(JSON.stringify(decision)).not.toContain("private failure");
  });

  it("returns an explicit rate decision without exposing policy thresholds", async () => {
    const testHarness = harness({ databaseResult: "rate_limited" });

    const decision = await createPairingStartApplication(testHarness.dependencies).execute(
      validRequest,
    );

    expect(decision).toMatchObject({ outcome: "rate_limited" });
    expect(Reflect.ownKeys(decision).sort()).toEqual(["outcome", "requestId"]);
  });

  it("rejects an unknown database result", async () => {
    const testHarness = harness();
    const dependencies = {
      ...testHarness.dependencies,
      database: { start: () => Promise.resolve("started") },
    };

    await expect(
      createPairingStartApplication(dependencies).execute(validRequest),
    ).resolves.toMatchObject({ outcome: "not_created" });
  });

  it.each([
    null,
    {},
    {
      admission: createPairingStartAdmission(),
      database: { start: () => Promise.resolve("rate_limited") },
      pollVerifier: { derive: () => pollCandidate().value },
      ratePolicy: {
        limits: () => ({ bucketLimit: 20, globalLimit: 200, windowSeconds: 60 }),
      },
      timing: { settle: () => Promise.resolve(), start: () => 0 },
      userCodeVerifier: { derive: () => codeCandidate().value },
      extra: true,
    },
  ])("rejects an invalid dependency graph: %o", (dependencies) => {
    expect(() => createPairingStartApplication(dependencies)).toThrow(PairingStartApplicationError);
  });

  it("constructs and closes the configured boundary without opening a connection", async () => {
    const application = await createConfiguredPairingStartApplication({
      NODE_ENV: "test",
      VIBERACING_WEB_DATABASE_HOST: "127.0.0.1",
      VIBERACING_WEB_DATABASE_NAME: "viberacing_local",
      VIBERACING_WEB_DATABASE_PASSWORD: "private-pairing-database-password",
      VIBERACING_WEB_DATABASE_PORT: "54329",
      VIBERACING_WEB_DATABASE_TLS_MODE: "disable",
      VIBERACING_WEB_DATABASE_USER: "viberacing_web_login",
      VIBERACING_WEB_PAIRING_CODE_PRIMARY_KEY_BASE64URL: Buffer.alloc(32, 0x55).toString(
        "base64url",
      ),
      VIBERACING_WEB_PAIRING_POLL_BUCKET_LIMIT: "20",
      VIBERACING_WEB_PAIRING_POLL_GLOBAL_LIMIT: "200",
      VIBERACING_WEB_PAIRING_POLL_PRIMARY_KEY_BASE64URL: Buffer.alloc(32, 0x44).toString(
        "base64url",
      ),
      VIBERACING_WEB_PAIRING_POLL_WINDOW_SECONDS: "60",
      VIBERACING_WEB_PAIRING_START_BUCKET_LIMIT: "10",
      VIBERACING_WEB_PAIRING_START_GLOBAL_LIMIT: "100",
      VIBERACING_WEB_PAIRING_START_WINDOW_SECONDS: "60",
    });

    expect(Object.isFrozen(application)).toBe(true);
    await expect(application.close()).resolves.toBeUndefined();
    await expect(application.close()).resolves.toBeUndefined();
  });
});
