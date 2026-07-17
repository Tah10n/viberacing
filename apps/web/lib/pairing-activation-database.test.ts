// @vitest-environment node

import { Buffer } from "node:buffer";

import pairingVector from "../../../contracts/v1/connector-pairing-possession.test-vector.json";
import { describe, expect, it, vi } from "vitest";

import {
  createCloseablePairingActivationDatabase,
  createPairingActivationDatabase,
  PairingActivationDatabaseError,
  type PairingActivationDatabaseAttempt,
  type PairingActivationDatabaseErrorCode,
} from "./pairing-activation-database";
import type {
  PairingDatabaseActivation,
  PairingDatabaseClient,
  PairingDatabasePool,
  PairingDatabaseRateAdmission,
} from "./pairing-database-pool";

const runtimeBoundary = [
  {
    login_scope_ok: true,
    read_write_ok: true,
    role_ok: true,
    search_path_ok: true,
  },
];
const firstDigest = Buffer.alloc(32, 0x11);
const secondDigest = Buffer.alloc(32, 0x22);
const privateValue = "private-database-error-that-must-not-be-reflected";

function vectorRow(candidateIndex = 1): Record<string, unknown> {
  return {
    candidate_index: candidateIndex,
    pairing_challenge: Buffer.from(pairingVector.pairingChallengeBytes),
    pairing_id: pairingVector.pairingId,
    public_key: Buffer.from(pairingVector.devicePublicKeyBase64Url, "base64url"),
  };
}

function statusRow(
  pairingState: "activated" | "approved" | "cancelled" | "pending",
  candidateIndex = 1,
): Record<string, unknown> {
  return {
    candidate_index: candidateIndex,
    device_id: pairingState === "activated" ? "dev_AAAAAAAAAAAAAAAAAAAAAA" : null,
    pairing_state: pairingState,
    source_id: pairingState === "activated" ? "src_BBBBBBBBBBBBBBBBBBBBBB" : null,
  };
}

function validAttempt(
  overrides: Partial<PairingActivationDatabaseAttempt> = {},
): PairingActivationDatabaseAttempt {
  return {
    allowActivation: true,
    auditEventId: "00000000-0000-4000-8000-000000000027",
    clientIdentityDigest: Buffer.alloc(32, 0x33),
    deviceId: "dev_AAAAAAAAAAAAAAAAAAAAAA",
    pollVerifierDigests: [Buffer.from(firstDigest), Buffer.from(secondDigest)],
    rateBucketLimit: 120,
    rateGlobalLimit: 1200,
    rateWindowSeconds: 60,
    requestId: "req_AAAAAAAAAAAAAAAAAAAAAA",
    secondaryCandidateActive: true,
    signatureBase64Url: pairingVector.possessionSignatureBase64Url,
    ...overrides,
  };
}

interface HarnessOptions {
  readonly activation?: unknown;
  readonly activationError?: Error;
  readonly admission?: unknown;
  readonly admissionError?: Error;
  readonly boundary?: unknown;
  readonly closeError?: Error;
  readonly connectError?: Error;
  readonly material?: unknown;
  readonly readError?: Error;
  readonly releaseError?: Error;
  readonly statuses?: readonly unknown[];
}

function harness(options: HarnessOptions = {}): {
  readonly activationCalls: PairingDatabaseActivation[];
  readonly close: ReturnType<typeof vi.fn>;
  readonly connect: ReturnType<typeof vi.fn>;
  readonly events: string[];
  readonly pool: PairingDatabasePool;
  readonly rateCalls: PairingDatabaseRateAdmission[];
  readonly rateReferences: PairingDatabaseRateAdmission[];
  readonly readDigestReferences: (readonly [Uint8Array, Uint8Array])[];
  readonly releases: boolean[];
  readonly statusDigestReferences: (readonly [Uint8Array, Uint8Array])[];
} {
  const activationCalls: PairingDatabaseActivation[] = [];
  const events: string[] = [];
  const rateCalls: PairingDatabaseRateAdmission[] = [];
  const rateReferences: PairingDatabaseRateAdmission[] = [];
  const readDigestReferences: (readonly [Uint8Array, Uint8Array])[] = [];
  const releases: boolean[] = [];
  const statusDigestReferences: (readonly [Uint8Array, Uint8Array])[] = [];
  const statuses = [...(options.statuses ?? [[statusRow("approved")], [statusRow("activated")]])];
  const client: PairingDatabaseClient = {
    admitPairingTransportRequest(input): Promise<unknown> {
      events.push("admit");
      rateReferences.push(input);
      rateCalls.push({
        ...input,
        clientIdentityDigest: Buffer.from(input.clientIdentityDigest),
      });
      return options.admissionError === undefined
        ? Promise.resolve(options.admission ?? [{ admitted: true }])
        : Promise.reject(options.admissionError);
    },
    activatePairing(input): Promise<unknown> {
      events.push("activate");
      activationCalls.push({
        ...input,
        pollVerifierDigest: Buffer.from(input.pollVerifierDigest),
      });
      return options.activationError === undefined
        ? Promise.resolve(options.activation ?? [{ activated: true }])
        : Promise.reject(options.activationError);
    },
    pollPairingStatus(digests): Promise<unknown> {
      events.push("status");
      statusDigestReferences.push(digests);
      return Promise.resolve(statuses.shift() ?? []);
    },
    readVerificationMaterial(digests): Promise<unknown> {
      events.push("read");
      readDigestReferences.push(digests);
      if (options.readError !== undefined) {
        return Promise.reject(options.readError);
      }
      return Promise.resolve(options.material ?? [vectorRow()]);
    },
    release(destroy = false): void {
      events.push(`release:${String(destroy)}`);
      releases.push(destroy);
      if (options.releaseError !== undefined) {
        throw options.releaseError;
      }
    },
    startPairing(): Promise<never> {
      return Promise.reject(new Error("unexpected pairing start"));
    },
    verifyRuntimeBoundary(): Promise<unknown> {
      events.push("boundary");
      return Promise.resolve(options.boundary ?? runtimeBoundary);
    },
  };
  const connect = vi.fn(() =>
    options.connectError === undefined
      ? Promise.resolve(client)
      : Promise.reject(options.connectError),
  );
  const close = vi.fn(() =>
    options.closeError === undefined ? Promise.resolve() : Promise.reject(options.closeError),
  );
  return {
    activationCalls,
    close,
    connect,
    events,
    pool: { close, connect },
    rateCalls,
    rateReferences,
    readDigestReferences,
    releases,
    statusDigestReferences,
  };
}

async function expectDatabaseError(
  operation: Promise<unknown>,
  code: PairingActivationDatabaseErrorCode,
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(PairingActivationDatabaseError);
    expect(error).toMatchObject({
      code,
      message: "Pairing activation is unavailable.",
      name: "PairingActivationDatabaseError",
    });
    expect(String(error)).not.toContain(privateValue);
    return;
  }
  throw new Error("expected pairing activation database operation to fail");
}

describe("pairing activation database", () => {
  it("probes the read-write boundary, verifies the shared proof, and activates exact material", async () => {
    const testHarness = harness();
    const database = createPairingActivationDatabase(testHarness.pool);
    const attempt = validAttempt();

    await expect(database.activate(attempt)).resolves.toEqual({
      deviceId: "dev_AAAAAAAAAAAAAAAAAAAAAA",
      outcome: "activated",
      sourceId: "src_BBBBBBBBBBBBBBBBBBBBBB",
    });

    expect(testHarness.events).toEqual([
      "boundary",
      "admit",
      "read",
      "status",
      "activate",
      "status",
      "release:false",
    ]);
    expect(testHarness.rateCalls).toEqual([
      {
        bucketLimit: 120,
        clientIdentityDigest: Buffer.alloc(32, 0x33),
        globalLimit: 1200,
        operation: "poll",
        windowSeconds: 60,
      },
    ]);
    expect(testHarness.activationCalls).toEqual([
      {
        auditEventId: attempt.auditEventId,
        deviceId: attempt.deviceId,
        pairingId: pairingVector.pairingId,
        pollVerifierDigest: firstDigest,
        requestId: attempt.requestId,
      },
    ]);
    expect(testHarness.releases).toEqual([false]);
    expect(attempt.pollVerifierDigests).toEqual([firstDigest, secondDigest]);
    expect(attempt.clientIdentityDigest).toEqual(Buffer.alloc(32, 0x33));
    expect(testHarness.rateReferences[0]?.clientIdentityDigest).toEqual(Buffer.alloc(32));
    expect(testHarness.readDigestReferences[0]).toEqual([Buffer.alloc(32), Buffer.alloc(32)]);
    expect(testHarness.statusDigestReferences).toEqual([
      [Buffer.alloc(32), Buffer.alloc(32)],
      [Buffer.alloc(32), Buffer.alloc(32)],
    ]);
    expect(Object.isFrozen(database)).toBe(true);
  });

  it("selects the secondary rotation digest only when it produced the approved material", async () => {
    const testHarness = harness({
      material: [vectorRow(2)],
      statuses: [[statusRow("approved", 2)], [statusRow("activated", 2)]],
    });
    const database = createPairingActivationDatabase(testHarness.pool);

    await expect(database.activate(validAttempt())).resolves.toMatchObject({
      outcome: "activated",
    });

    expect(testHarness.activationCalls[0]?.pollVerifierDigest).toEqual(secondDigest);
    expect(testHarness.events).toEqual([
      "boundary",
      "admit",
      "read",
      "status",
      "activate",
      "status",
      "release:false",
    ]);
  });

  it("returns an existing binding only after repeating proof, without reactivation", async () => {
    const testHarness = harness({ statuses: [[statusRow("activated")]] });

    await expect(
      createPairingActivationDatabase(testHarness.pool).activate(validAttempt()),
    ).resolves.toEqual({
      deviceId: "dev_AAAAAAAAAAAAAAAAAAAAAA",
      outcome: "activated",
      sourceId: "src_BBBBBBBBBBBBBBBBBBBBBB",
    });

    expect(testHarness.events).toEqual(["boundary", "admit", "read", "status", "release:false"]);
    expect(testHarness.activationCalls).toEqual([]);
  });

  it("does not disclose an existing binding when possession proof is invalid", async () => {
    const testHarness = harness({ statuses: [[statusRow("activated")]] });

    await expect(
      createPairingActivationDatabase(testHarness.pool).activate(
        validAttempt({
          signatureBase64Url: `A${pairingVector.possessionSignatureBase64Url.slice(1)}`,
        }),
      ),
    ).resolves.toEqual({ outcome: "pending" });

    expect(testHarness.events).toEqual(["boundary", "admit", "read", "release:false"]);
    expect(testHarness.activationCalls).toEqual([]);
    expect(testHarness.statusDigestReferences).toEqual([]);
  });

  it("recovers an activation race by reading the committed binding", async () => {
    const testHarness = harness({ activationError: new Error(privateValue) });

    await expect(
      createPairingActivationDatabase(testHarness.pool).activate(validAttempt()),
    ).resolves.toMatchObject({ outcome: "activated" });

    expect(testHarness.events).toEqual([
      "boundary",
      "admit",
      "read",
      "status",
      "activate",
      "status",
      "release:false",
    ]);
  });

  it("returns a bounded rate decision before token lookup", async () => {
    const testHarness = harness({ admission: [{ admitted: false }] });

    await expect(
      createPairingActivationDatabase(testHarness.pool).activate(validAttempt()),
    ).resolves.toEqual({ outcome: "rate_limited" });

    expect(testHarness.events).toEqual(["boundary", "admit", "release:false"]);
    expect(testHarness.activationCalls).toEqual([]);
  });

  it.each([
    {
      label: "missing material",
      options: { material: [] },
      overrides: {},
    },
    {
      label: "invalid proof",
      options: {},
      overrides: {
        signatureBase64Url: `A${pairingVector.possessionSignatureBase64Url.slice(1)}`,
      },
    },
    {
      label: "ineligible input",
      options: {},
      overrides: { allowActivation: false },
    },
  ])("runs the proof path but never activates $label", async ({ options, overrides }) => {
    const testHarness = harness(options);
    const database = createPairingActivationDatabase(testHarness.pool);

    await expect(database.activate(validAttempt(overrides))).resolves.toEqual({
      outcome: "pending",
    });

    expect(testHarness.activationCalls).toEqual([]);
    expect(testHarness.events).toEqual(["boundary", "admit", "read", "release:false"]);
    expect(testHarness.releases).toEqual([false]);
  });

  it.each([
    {
      code: "runtime_boundary_mismatch" as const,
      options: { boundary: [{ ...runtimeBoundary[0], read_write_ok: false }] },
    },
    {
      code: "result_invalid" as const,
      options: { material: [vectorRow(), vectorRow(2)] },
    },
    {
      code: "result_invalid" as const,
      options: { material: [{ ...vectorRow(), unexpected: true }] },
    },
    {
      code: "result_invalid" as const,
      options: { material: [vectorRow(2)] },
      overrides: { secondaryCandidateActive: false },
    },
    {
      code: "result_invalid" as const,
      options: {
        activation: [{ activated: false }],
        statuses: [[statusRow("approved")], [statusRow("approved")]],
      },
    },
    {
      code: "result_invalid" as const,
      options: { admission: [{ admitted: "yes" }] },
    },
    {
      code: "result_invalid" as const,
      options: { statuses: [[{ ...statusRow("approved"), source_id: "src_invalid" }]] },
    },
  ])("destroys the client for $code", async ({ code, options, overrides = {} }) => {
    const testHarness = harness(options);
    const database = createPairingActivationDatabase(testHarness.pool);

    await expectDatabaseError(database.activate(validAttempt(overrides)), code);

    expect(testHarness.releases).toEqual([true]);
    expect(testHarness.events.at(-1)).toBe("release:true");
  });

  it("rejects accessor-backed material without invoking the accessor", async () => {
    const getter = vi.fn(() => pairingVector.pairingId);
    const row = vectorRow();
    Object.defineProperty(row, "pairing_id", { enumerable: true, get: getter });
    const testHarness = harness({ material: [row] });

    await expectDatabaseError(
      createPairingActivationDatabase(testHarness.pool).activate(validAttempt()),
      "result_invalid",
    );

    expect(getter).not.toHaveBeenCalled();
    expect(testHarness.releases).toEqual([true]);
  });

  it("maps connection, query, and release failures without reflecting private values", async () => {
    const connectFailure = harness({ connectError: new Error(privateValue) });
    await expectDatabaseError(
      createPairingActivationDatabase(connectFailure.pool).activate(validAttempt()),
      "connection_unavailable",
    );
    expect(connectFailure.releases).toEqual([]);

    const queryFailure = harness({ readError: new Error(privateValue) });
    await expectDatabaseError(
      createPairingActivationDatabase(queryFailure.pool).activate(validAttempt()),
      "query_failed",
    );
    expect(queryFailure.releases).toEqual([true]);

    const admissionFailure = harness({ admissionError: new Error(privateValue) });
    await expectDatabaseError(
      createPairingActivationDatabase(admissionFailure.pool).activate(validAttempt()),
      "query_failed",
    );
    expect(admissionFailure.releases).toEqual([true]);

    const activationFailure = harness({
      activationError: new Error(privateValue),
      statuses: [[statusRow("approved")], [statusRow("approved")]],
    });
    await expectDatabaseError(
      createPairingActivationDatabase(activationFailure.pool).activate(validAttempt()),
      "query_failed",
    );
    expect(activationFailure.releases).toEqual([true]);

    const releaseFailure = harness({ releaseError: new Error(privateValue) });
    await expectDatabaseError(
      createPairingActivationDatabase(releaseFailure.pool).activate(validAttempt()),
      "connection_release_failed",
    );
  });

  it.each([
    null,
    {},
    { ...validAttempt(), extra: true },
    { ...validAttempt(), deviceId: "dev_invalid" },
    { ...validAttempt(), auditEventId: "00000000-0000-0000-0000-000000000000" },
    { ...validAttempt(), requestId: "req_invalid" },
    { ...validAttempt(), pollVerifierDigests: [Buffer.alloc(31), Buffer.alloc(32)] },
    { ...validAttempt(), clientIdentityDigest: Buffer.alloc(31) },
    { ...validAttempt(), rateBucketLimit: 0 },
    { ...validAttempt(), rateBucketLimit: 1201 },
    { ...validAttempt(), rateGlobalLimit: 1_000_001 },
    { ...validAttempt(), rateWindowSeconds: 0 },
    { ...validAttempt(), signatureBase64Url: `${pairingVector.possessionSignatureBase64Url}=` },
  ])("rejects malformed input before checkout: %o", async (attempt) => {
    const testHarness = harness();

    await expectDatabaseError(
      createPairingActivationDatabase(testHarness.pool).activate(attempt),
      "input_invalid",
    );

    expect(testHarness.connect).not.toHaveBeenCalled();
    expect(testHarness.events).toEqual([]);
  });

  it("closes explicitly and maps a private close failure", async () => {
    const successful = harness();
    const database = createCloseablePairingActivationDatabase(successful.pool);

    await expect(database.close()).resolves.toBeUndefined();
    expect(successful.close).toHaveBeenCalledOnce();
    expect(Object.isFrozen(database)).toBe(true);

    const failed = harness({ closeError: new Error(privateValue) });
    await expectDatabaseError(
      createCloseablePairingActivationDatabase(failed.pool).close(),
      "pool_close_failed",
    );
  });
});
