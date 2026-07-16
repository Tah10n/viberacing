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

function validAttempt(
  overrides: Partial<PairingActivationDatabaseAttempt> = {},
): PairingActivationDatabaseAttempt {
  return {
    allowActivation: true,
    auditEventId: "00000000-0000-4000-8000-000000000027",
    deviceId: "dev_AAAAAAAAAAAAAAAAAAAAAA",
    pollVerifierDigests: [Buffer.from(firstDigest), Buffer.from(secondDigest)],
    requestId: "req_AAAAAAAAAAAAAAAAAAAAAA",
    secondaryCandidateActive: true,
    signatureBase64Url: pairingVector.possessionSignatureBase64Url,
    ...overrides,
  };
}

interface HarnessOptions {
  readonly activation?: unknown;
  readonly boundary?: unknown;
  readonly closeError?: Error;
  readonly connectError?: Error;
  readonly material?: unknown;
  readonly readError?: Error;
  readonly releaseError?: Error;
}

function harness(options: HarnessOptions = {}): {
  readonly activationCalls: PairingDatabaseActivation[];
  readonly close: ReturnType<typeof vi.fn>;
  readonly connect: ReturnType<typeof vi.fn>;
  readonly events: string[];
  readonly pool: PairingDatabasePool;
  readonly readDigestReferences: (readonly [Uint8Array, Uint8Array])[];
  readonly releases: boolean[];
} {
  const activationCalls: PairingDatabaseActivation[] = [];
  const events: string[] = [];
  const readDigestReferences: (readonly [Uint8Array, Uint8Array])[] = [];
  const releases: boolean[] = [];
  const client: PairingDatabaseClient = {
    activatePairing(input): Promise<unknown> {
      events.push("activate");
      activationCalls.push({
        ...input,
        pollVerifierDigest: Buffer.from(input.pollVerifierDigest),
      });
      return Promise.resolve(options.activation ?? [{ activated: true }]);
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
    readDigestReferences,
    releases,
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

    await expect(database.activate(attempt)).resolves.toBe(true);

    expect(testHarness.events).toEqual(["boundary", "read", "activate", "release:false"]);
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
    expect(testHarness.readDigestReferences[0]).toEqual([Buffer.alloc(32), Buffer.alloc(32)]);
    expect(Object.isFrozen(database)).toBe(true);
  });

  it("selects the secondary rotation digest only when it produced the approved material", async () => {
    const testHarness = harness({ material: [vectorRow(2)] });
    const database = createPairingActivationDatabase(testHarness.pool);

    await expect(database.activate(validAttempt())).resolves.toBe(true);

    expect(testHarness.activationCalls[0]?.pollVerifierDigest).toEqual(secondDigest);
    expect(testHarness.events).toEqual(["boundary", "read", "activate", "release:false"]);
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

    await expect(database.activate(validAttempt(overrides))).resolves.toBe(false);

    expect(testHarness.activationCalls).toEqual([]);
    expect(testHarness.events).toEqual(["boundary", "read", "release:false"]);
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
      options: { activation: [{ activated: false }] },
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
