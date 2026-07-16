// @vitest-environment node

import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import type {
  PairingDatabaseClient,
  PairingDatabasePool,
  PairingDatabaseStart,
} from "./pairing-database-pool";
import {
  createCloseablePairingStartDatabase,
  createPairingStartDatabase,
  PairingStartDatabaseError,
  type PairingStartDatabaseAttempt,
  type PairingStartDatabaseErrorCode,
} from "./pairing-start-database";

const runtimeBoundary = [
  {
    login_scope_ok: true,
    read_write_ok: true,
    role_ok: true,
    search_path_ok: true,
  },
];
const privateValue = "private-pairing-start-database-error";

function validAttempt(
  overrides: Partial<PairingStartDatabaseAttempt> = {},
): PairingStartDatabaseAttempt {
  return {
    architecture: "x86_64",
    connectorVersion: "0.0.0-test",
    deviceKeyId: "00000000-0000-4000-8000-000000000028",
    deviceLabel: "Synthetic device",
    expiresAt: "2026-07-16T08:00:00.000Z",
    osFamily: "windows",
    pairingChallenge: Buffer.alloc(32, 0x33),
    pairingId: "00000000-0000-4000-8000-000000000029",
    pollVerifierDigest: Buffer.alloc(32, 0x11),
    publicKey: Buffer.alloc(32, 0x44),
    userCodeDigest: Buffer.alloc(32, 0x22),
    ...overrides,
  };
}

interface HarnessOptions {
  readonly boundary?: unknown;
  readonly closeError?: Error;
  readonly connectError?: Error;
  readonly releaseError?: Error;
  readonly startError?: Error;
  readonly startResult?: unknown;
}

function harness(options: HarnessOptions = {}): {
  readonly close: ReturnType<typeof vi.fn>;
  readonly connect: ReturnType<typeof vi.fn>;
  readonly events: string[];
  readonly pool: PairingDatabasePool;
  readonly releases: boolean[];
  readonly startReferences: PairingDatabaseStart[];
  readonly startSnapshots: PairingDatabaseStart[];
} {
  const events: string[] = [];
  const releases: boolean[] = [];
  const startReferences: PairingDatabaseStart[] = [];
  const startSnapshots: PairingDatabaseStart[] = [];
  const client: PairingDatabaseClient = {
    activatePairing(): Promise<never> {
      return Promise.reject(new Error("unexpected activation"));
    },
    readVerificationMaterial(): Promise<never> {
      return Promise.reject(new Error("unexpected material lookup"));
    },
    release(destroy = false): void {
      events.push(`release:${String(destroy)}`);
      releases.push(destroy);
      if (options.releaseError !== undefined) {
        throw options.releaseError;
      }
    },
    startPairing(input): Promise<unknown> {
      events.push("start");
      startReferences.push(input);
      startSnapshots.push({
        ...input,
        pairingChallenge: Buffer.from(input.pairingChallenge),
        pollVerifierDigest: Buffer.from(input.pollVerifierDigest),
        publicKey: Buffer.from(input.publicKey),
        userCodeDigest: Buffer.from(input.userCodeDigest),
      });
      return options.startError === undefined
        ? Promise.resolve(options.startResult ?? [{ started: true }])
        : Promise.reject(options.startError);
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
    close,
    connect,
    events,
    pool: { close, connect },
    releases,
    startReferences,
    startSnapshots,
  };
}

async function expectDatabaseError(
  operation: Promise<unknown>,
  code: PairingStartDatabaseErrorCode,
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(PairingStartDatabaseError);
    expect(error).toMatchObject({
      code,
      message: "Pairing start is unavailable.",
      name: "PairingStartDatabaseError",
    });
    expect(String(error)).not.toContain(privateValue);
    return;
  }
  throw new Error("expected pairing start database operation to fail");
}

describe("pairing start database", () => {
  it("probes the read-write boundary and calls only exact start material", async () => {
    const testHarness = harness();
    const database = createPairingStartDatabase(testHarness.pool);
    const attempt = validAttempt();

    await expect(database.start(attempt)).resolves.toBe(true);

    expect(testHarness.events).toEqual(["boundary", "start", "release:false"]);
    expect(testHarness.startSnapshots).toEqual([attempt]);
    expect(testHarness.startReferences[0]?.pairingChallenge).toEqual(Buffer.alloc(32));
    expect(testHarness.startReferences[0]?.pollVerifierDigest).toEqual(Buffer.alloc(32));
    expect(testHarness.startReferences[0]?.publicKey).toEqual(Buffer.alloc(32));
    expect(testHarness.startReferences[0]?.userCodeDigest).toEqual(Buffer.alloc(32));
    expect(attempt.pairingChallenge).toEqual(Buffer.alloc(32, 0x33));
    expect(attempt.pollVerifierDigest).toEqual(Buffer.alloc(32, 0x11));
    expect(attempt.publicKey).toEqual(Buffer.alloc(32, 0x44));
    expect(attempt.userCodeDigest).toEqual(Buffer.alloc(32, 0x22));
    expect(Object.isFrozen(database)).toBe(true);
  });

  it.each([
    {
      code: "runtime_boundary_mismatch" as const,
      options: { boundary: [{ ...runtimeBoundary[0], read_write_ok: false }] },
    },
    {
      code: "result_invalid" as const,
      options: { startResult: [{ started: false }] },
    },
    {
      code: "result_invalid" as const,
      options: { startResult: [{ started: true, unexpected: true }] },
    },
  ])("destroys the client for $code", async ({ code, options }) => {
    const testHarness = harness(options);

    await expectDatabaseError(
      createPairingStartDatabase(testHarness.pool).start(validAttempt()),
      code,
    );

    expect(testHarness.releases).toEqual([true]);
  });

  it("maps connection, query, and release failures without reflection", async () => {
    const connectFailure = harness({ connectError: new Error(privateValue) });
    await expectDatabaseError(
      createPairingStartDatabase(connectFailure.pool).start(validAttempt()),
      "connection_unavailable",
    );
    expect(connectFailure.releases).toEqual([]);

    const queryFailure = harness({ startError: new Error(privateValue) });
    await expectDatabaseError(
      createPairingStartDatabase(queryFailure.pool).start(validAttempt()),
      "query_failed",
    );
    expect(queryFailure.releases).toEqual([true]);

    const releaseFailure = harness({ releaseError: new Error(privateValue) });
    await expectDatabaseError(
      createPairingStartDatabase(releaseFailure.pool).start(validAttempt()),
      "connection_release_failed",
    );
  });

  it.each([
    null,
    {},
    { ...validAttempt(), extra: true },
    { ...validAttempt(), pairingId: "not-a-uuid" },
    { ...validAttempt(), deviceKeyId: "00000000-0000-0000-0000-000000000000" },
    { ...validAttempt(), pollVerifierDigest: Buffer.alloc(31) },
    { ...validAttempt(), userCodeDigest: Buffer.alloc(33) },
    { ...validAttempt(), pairingChallenge: Buffer.alloc(31) },
    { ...validAttempt(), publicKey: Buffer.alloc(32) },
    { ...validAttempt(), deviceLabel: " Synthetic device" },
    { ...validAttempt(), deviceLabel: "A".repeat(129) },
    { ...validAttempt(), deviceLabel: "Synthetic\u0000device" },
    { ...validAttempt(), connectorVersion: "candidate" },
    { ...validAttempt(), connectorVersion: "01.2.3" },
    { ...validAttempt(), connectorVersion: "1.2.3-alpha..1" },
    { ...validAttempt(), osFamily: "other" },
    { ...validAttempt(), architecture: "other" },
    { ...validAttempt(), expiresAt: "2026-07-16T08:00:00Z" },
  ])("rejects malformed input before checkout: %o", async (attempt) => {
    const testHarness = harness();

    await expectDatabaseError(
      createPairingStartDatabase(testHarness.pool).start(attempt),
      "input_invalid",
    );

    expect(testHarness.connect).not.toHaveBeenCalled();
  });

  it("rejects accessor-backed input without invoking the accessor", async () => {
    const getter = vi.fn(() => "Synthetic device");
    const attempt = { ...validAttempt() };
    Object.defineProperty(attempt, "deviceLabel", { enumerable: true, get: getter });
    const testHarness = harness();

    await expectDatabaseError(
      createPairingStartDatabase(testHarness.pool).start(attempt),
      "input_invalid",
    );

    expect(getter).not.toHaveBeenCalled();
    expect(testHarness.connect).not.toHaveBeenCalled();
  });

  it("closes explicitly and maps a private close failure", async () => {
    const successful = harness();
    const database = createCloseablePairingStartDatabase(successful.pool);
    await expect(database.close()).resolves.toBeUndefined();
    expect(successful.close).toHaveBeenCalledOnce();
    expect(Object.isFrozen(database)).toBe(true);

    const failed = harness({ closeError: new Error(privateValue) });
    await expectDatabaseError(
      createCloseablePairingStartDatabase(failed.pool).close(),
      "pool_close_failed",
    );
  });
});
