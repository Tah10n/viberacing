// @vitest-environment node
/* eslint-disable @typescript-eslint/unbound-method -- Vitest inspects injected database spies. */

import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import pollVector from "../../../contracts/v1/connector-pairing-possession.test-vector.json";
import startVector from "../../../contracts/v1/connector-pairing-start-possession.test-vector.json";
import type { BatchPairingDatabase, PairingStartPersistence } from "./batch-pairing-database";
import { createPairingStartAdmission } from "./pairing-start-admission";
import {
  createPairingTransportService,
  type PairingTransportDependencies,
} from "./pairing-transport-service";

function digest(byte: number): Buffer {
  return Buffer.alloc(32, byte);
}

function candidates() {
  const first = digest(1);
  const second = digest(2);
  return {
    clear: vi.fn(() => {
      first.fill(0);
      second.fill(0);
    }),
    codeAccepted: true,
    digests: [first, second] as const,
    secondaryActive: true,
    tokenAccepted: true,
  };
}

function database(overrides: Partial<BatchPairingDatabase> = {}): BatchPairingDatabase {
  return {
    activate: vi.fn(() => Promise.resolve([{ activated_count: 1 }])),
    admit: vi.fn(() => Promise.resolve([{ admitted: true }])),
    approve: vi.fn(),
    close: vi.fn(() => Promise.resolve()),
    createApprovalChallenge: vi.fn(),
    poll: vi.fn(() =>
      Promise.resolve([
        {
          activation_state: "active",
          agent_account_id: "acc_AAAAAAAAAAAAAAAAAAAAAA",
          candidate_id: "cand_AAAAAAAAAAAAAAAAAAAAAA",
          device_id: "dev_AAAAAAAAAAAAAAAAAAAAAA",
          device_key_id: "key_AAAAAAAAAAAAAAAAAAAAAA",
          pairing_state: "activated",
        },
      ]),
    ),
    readAccounts: vi.fn(),
    readApproval: vi.fn(),
    readPairingIdByCode: vi.fn(),
    readPasskey: vi.fn(),
    readPossession: vi.fn(() =>
      Promise.resolve([
        {
          installation_public_key: Buffer.from(pollVector.installationPublicKey, "base64url"),
          manifest_digest: digest(3),
          pairing_state: "approved",
          possession_challenge: Buffer.from(pollVector.pairingChallenge, "base64url"),
          verifier_index: 1,
        },
      ]),
    ),
    start: vi.fn((input: PairingStartPersistence) =>
      Promise.resolve([{ pairing_id: input.pairingId }]),
    ),
    ...overrides,
  };
}

function dependencies(
  databaseValue = database(),
): PairingTransportDependencies & { database: BatchPairingDatabase } {
  return {
    admission: createPairingStartAdmission(),
    database: databaseValue,
    now: () => Date.parse(startVector.signedAt),
    pollVerifier: {
      close: vi.fn(),
      derive: vi.fn(() => candidates()),
    },
    publicOrigin: "https://race.example",
    ratePolicy: {
      limits: vi.fn((operation) =>
        operation === "start"
          ? { bucketLimit: 12, globalLimit: 120, windowSeconds: 60 }
          : { bucketLimit: 120, globalLimit: 1200, windowSeconds: 60 },
      ),
    },
    timing: {
      settle: vi.fn(() => Promise.resolve()),
      start: vi.fn(() => 1),
    },
    userCodeVerifier: {
      close: vi.fn(),
      derive: vi.fn(() => candidates()),
    },
  };
}

function startRequest() {
  return {
    clientRateIdentifier: startVector.clientRateIdentifier,
    discoveryManifest: startVector.manifest,
    installationPossessionProof: {
      nonce: startVector.nonce,
      signature: startVector.possessionSignature,
      signedAt: startVector.signedAt,
    },
    schemaVersion: 1,
  };
}

describe("batch pairing transport service", () => {
  it("persists one verified manifest and returns only the final start contract", async () => {
    const deps = dependencies();
    const service = createPairingTransportService(deps);

    const decision = await service.start(startRequest());

    expect(deps.database.start).toHaveBeenCalledOnce();
    const startAdmission = vi.mocked(deps.database.admit).mock.calls[0]?.[0];
    expect(startAdmission).toMatchObject({
      bucketLimit: 12,
      globalLimit: 120,
      operation: "start",
      windowSeconds: 60,
    });
    expect(startAdmission?.clientIdentityDigest).toBeInstanceOf(Uint8Array);
    expect(vi.mocked(deps.database.admit).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.database.start).mock.invocationCallOrder[0] ?? 0,
    );
    await expect(vi.mocked(deps.database.start).mock.results[0]?.value).resolves.toEqual([
      {
        pairing_id: vi.mocked(deps.database.start).mock.calls[0]?.[0].pairingId,
      },
    ]);
    expect(decision.outcome).toBe("created");
    if (decision.outcome !== "created") {
      throw new Error("expected created");
    }
    expect(decision.result.schemaVersion).toBe(1);
    expect(decision.result.approvalUrl).toMatch(
      /^https:\/\/race\.example\/connect\?code=[A-HJ-NP-Z2-9-]{14}$/,
    );
    const persisted = vi.mocked(deps.database.start).mock.calls[0]?.[0];
    expect(persisted).toMatchObject({
      architecture: "x86_64",
      candidates: [
        {
          candidateId: "cand_AAAAAAAAAAAAAAAAAAAAAA",
          fingerprintDigest: null,
          preview: {
            currentWeekTokenTotal: "579",
            lastUsageDate: "2026-07-14",
            status: "ready",
          },
          provider: "codex",
          syncPublicKey: "00".repeat(32),
        },
      ],
    });
    expect(persisted?.installationId).toMatch(/^ins_[A-Za-z0-9_-]{22}$/);
    expect(persisted?.manifestDigest.every((byte) => byte === 0)).toBe(true);
  });

  it("verifies the poll token and installation proof before atomic activation", async () => {
    const deps = dependencies();
    const service = createPairingTransportService(deps);

    const decision = await service.poll({
      pairingId: pollVector.pairingId,
      pollToken: "A".repeat(43),
      possessionSignature: pollVector.possessionSignature,
      schemaVersion: 1,
    });

    expect(decision).toMatchObject({
      outcome: "ok",
      result: {
        candidateActivations: [
          {
            activationState: "active",
            agentAccountId: "acc_AAAAAAAAAAAAAAAAAAAAAA",
            candidateId: "cand_AAAAAAAAAAAAAAAAAAAAAA",
            deviceId: "dev_AAAAAAAAAAAAAAAAAAAAAA",
            nextAction: "sync",
            serverBindingMaterial: {
              deviceKeyId: "key_AAAAAAAAAAAAAAAAAAAAAA",
              signatureProtocol: "viberacing-usage-sync-auth-v1",
              usageEndpoint: "/v1/usage",
            },
          },
        ],
        pairingState: "activated",
        schemaVersion: 1,
      },
    });
    if (decision.outcome !== "ok") {
      throw new Error("expected successful poll");
    }
    expect(decision.result.requestId).toMatch(/^req_[A-Za-z0-9_-]{22}$/);
    expect(deps.database.activate).toHaveBeenCalledOnce();
    const pollAdmission = vi.mocked(deps.database.admit).mock.calls[0]?.[0];
    expect(pollAdmission).toMatchObject({
      bucketLimit: 120,
      globalLimit: 1200,
      operation: "poll",
      windowSeconds: 60,
    });
    expect(pollAdmission?.clientIdentityDigest).toBeInstanceOf(Uint8Array);
    expect(vi.mocked(deps.database.admit).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.database.readPossession).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("fails closed before persistence for malformed or tampered requests", async () => {
    const deps = dependencies();
    const service = createPairingTransportService(deps);
    const request = startRequest();

    await expect(service.start({ ...request, extra: true })).resolves.toEqual({
      outcome: "invalid",
    });
    await expect(
      service.start({
        ...request,
        discoveryManifest: {
          ...request.discoveryManifest,
          architecture: "aarch64",
        },
      }),
    ).resolves.toEqual({ outcome: "invalid" });
    expect(deps.database.start).not.toHaveBeenCalled();
  });

  it("returns bounded unavailable decisions on saturation and storage failure", async () => {
    const admission = createPairingStartAdmission(1);
    const held = admission.tryAcquire();
    const deps = { ...dependencies(), admission };
    const service = createPairingTransportService(deps);
    await expect(service.start(startRequest())).resolves.toEqual({ outcome: "unavailable" });
    held?.release();

    const failing = dependencies(
      database({
        start: vi.fn(() => Promise.reject(new Error("private storage detail"))),
      }),
    );
    await expect(createPairingTransportService(failing).start(startRequest())).resolves.toEqual({
      outcome: "unavailable",
    });
  });

  it("stops before possession or pairing state work when durable admission rejects", async () => {
    const startDependencies = dependencies(
      database({
        admit: vi.fn(() => Promise.resolve([{ admitted: false }])),
      }),
    );
    await expect(
      createPairingTransportService(startDependencies).start(startRequest()),
    ).resolves.toEqual({ outcome: "unavailable" });
    expect(startDependencies.database.start).not.toHaveBeenCalled();

    const pollDependencies = dependencies(
      database({
        admit: vi.fn(() => Promise.resolve([{ admitted: false }])),
      }),
    );
    await expect(
      createPairingTransportService(pollDependencies).poll({
        pairingId: pollVector.pairingId,
        pollToken: "A".repeat(43),
        possessionSignature: pollVector.possessionSignature,
        schemaVersion: 1,
      }),
    ).resolves.toEqual({ outcome: "unavailable" });
    expect(pollDependencies.database.readPossession).not.toHaveBeenCalled();
    expect(pollDependencies.pollVerifier.derive).not.toHaveBeenCalled();
  });
});
