// @vitest-environment node

import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import { createBatchPairingDatabase } from "./batch-pairing-database";

const environment = {
  NODE_ENV: "development",
  VIBERACING_WEB_DATABASE_HOST: "127.0.0.1",
  VIBERACING_WEB_DATABASE_NAME: "viberacing_local",
  VIBERACING_WEB_DATABASE_PASSWORD: "private-database-password",
  VIBERACING_WEB_DATABASE_PORT: "54329",
  VIBERACING_WEB_DATABASE_TLS_MODE: "disable",
  VIBERACING_WEB_DATABASE_USER: "viberacing_web_login",
} as const;
const boundary = [
  {
    login_scope_ok: true,
    read_write_ok: true,
    role_ok: true,
    search_path_ok: true,
  },
];

function harness(operationResult: unknown = [{ pairing_id: "pair_AAAAAAAAAAAAAAAAAAAAAA" }]) {
  const queries: { text: string; values: readonly unknown[] }[] = [];
  const release = vi.fn();
  const query = vi.fn((input: { readonly text: string; readonly values: readonly unknown[] }) => {
    queries.push({
      text: input.text,
      values: input.values.map((value) =>
        value instanceof Uint8Array ? Buffer.from(value) : value,
      ),
    });
    return Promise.resolve({ rows: queries.length % 2 === 1 ? boundary : operationResult });
  });
  const client = { query, release };
  const pool = {
    connect: vi.fn(() => Promise.resolve(client)),
    end: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
  };
  pool.on.mockImplementation(() => pool);
  return { client, pool, queries, release };
}

describe("batch pairing PostgreSQL adapter", () => {
  it("probes the least-privilege boundary before the exact start query and clears copies", async () => {
    const testHarness = harness();
    const database = createBatchPairingDatabase(environment, () => testHarness.pool);
    const installationKey = Buffer.alloc(32, 0x11);
    const manifest = Buffer.alloc(32, 0x12);
    const proof = Buffer.alloc(32, 0x13);
    const poll = Buffer.alloc(32, 0x14);
    const code = Buffer.alloc(32, 0x15);
    const challenge = Buffer.alloc(32, 0x16);

    await expect(
      database.start({
        architecture: "x86_64",
        candidates: [{ candidateId: "cand_AAAAAAAAAAAAAAAAAAAAAA" }],
        connectorVersion: "0.0.0",
        expiresAt: "2026-07-28T12:09:00.000Z",
        installationId: "ins_AAAAAAAAAAAAAAAAAAAAAA",
        installationLabel: "Main workstation",
        installationPublicKey: installationKey,
        manifestDigest: manifest,
        osFamily: "windows",
        pairingChallenge: challenge,
        pairingId: "pair_AAAAAAAAAAAAAAAAAAAAAA",
        pollVerifierDigest: poll,
        startProofDigest: proof,
        userCodeVerifierDigest: code,
      }),
    ).resolves.toEqual([{ pairing_id: "pair_AAAAAAAAAAAAAAAAAAAAAA" }]);

    expect(testHarness.queries).toHaveLength(2);
    expect(testHarness.queries[0]?.text).toContain("CURRENT_USER = 'viberacing_web'");
    expect(testHarness.queries[1]?.text).toContain("viberacing_api.start_pairing_batch");
    expect(testHarness.queries[1]?.values).toEqual([
      "pair_AAAAAAAAAAAAAAAAAAAAAA",
      "ins_AAAAAAAAAAAAAAAAAAAAAA",
      installationKey,
      "Main workstation",
      "0.0.0",
      "windows",
      "x86_64",
      manifest,
      proof,
      poll,
      code,
      challenge,
      "2026-07-28T12:09:00.000Z",
      '[{"candidateId":"cand_AAAAAAAAAAAAAAAAAAAAAA"}]',
    ]);
    expect(testHarness.release).toHaveBeenCalledWith(false);
    expect(installationKey).toEqual(Buffer.alloc(32, 0x11));
    expect(manifest).toEqual(Buffer.alloc(32, 0x12));
    expect(proof).toEqual(Buffer.alloc(32, 0x13));
  });

  it("uses only fixed queries for browser approval and connector possession operations", async () => {
    const testHarness = harness([]);
    const database = createBatchPairingDatabase(environment, () => testHarness.pool);
    const authority = {
      sessionId: "30000000-0000-4000-8000-000000000002",
      sessionVerifierDigest: Buffer.alloc(32, 0x41),
    };

    const rateIdentity = Buffer.alloc(32, 0x31);
    await database.admit({
      bucketLimit: 12,
      clientIdentityDigest: rateIdentity,
      globalLimit: 120,
      operation: "start",
      windowSeconds: 60,
    });
    await database.readPairingIdByCode(authority, Buffer.alloc(32, 0x51), Buffer.alloc(32, 0x52));
    await database.readApproval(authority, "pair_AAAAAAAAAAAAAAAAAAAAAA");
    await database.readAccounts(authority);
    await database.createApprovalChallenge(authority, {
      challengeDigest: Buffer.alloc(32, 0x61),
      challengeId: "30000000-0000-4000-8000-000000000003",
      contextDigest: Buffer.alloc(32, 0x62),
      expiresAt: "2026-07-28T12:04:00.000Z",
    });
    await database.readPasskey(Buffer.alloc(32, 0x63));
    await database.approve({
      ...authority,
      backupState: false,
      challengeId: "30000000-0000-4000-8000-000000000003",
      contextDigest: Buffer.alloc(32, 0x62),
      decisions: [{ decision: "skip" }],
      manifestDigest: Buffer.alloc(32, 0x64),
      observedSignCount: 7,
      pairingId: "pair_AAAAAAAAAAAAAAAAAAAAAA",
      verifiedPasskeyId: "30000000-0000-4000-8000-000000000004",
    });
    await database.readPossession("pair_AAAAAAAAAAAAAAAAAAAAAA", [
      Buffer.alloc(32, 0x71),
      Buffer.alloc(32, 0x72),
    ]);
    await database.activate("pair_AAAAAAAAAAAAAAAAAAAAAA", Buffer.alloc(32, 0x71));
    await database.poll("pair_AAAAAAAAAAAAAAAAAAAAAA", Buffer.alloc(32, 0x71));

    const operationQueries = testHarness.queries
      .filter((_, index) => index % 2 === 1)
      .map(({ text }) => text);
    expect(operationQueries).toHaveLength(10);
    expect(operationQueries.join("\n")).toContain("viberacing_api.admit_pairing_transport_request");
    expect(operationQueries.join("\n")).toContain("viberacing_api.read_pairing_batch_by_code");
    expect(operationQueries.join("\n")).toContain("viberacing_api.read_pairing_batch_for_approval");
    expect(operationQueries.join("\n")).toContain("viberacing_api.read_agent_accounts_for_pairing");
    expect(operationQueries.join("\n")).toContain("viberacing_api.approve_pairing_batch");
    expect(operationQueries.join("\n")).toContain(
      "viberacing_api.read_pairing_possession_material",
    );
    expect(operationQueries.join("\n")).toContain("viberacing_api.activate_pairing_batch");
    expect(operationQueries.join("\n")).toContain("viberacing_api.poll_pairing_batch");
    expect(rateIdentity).toEqual(Buffer.alloc(32, 0x31));
  });

  it("destroys a client and suppresses private errors on boundary or query failure", async () => {
    const testHarness = harness();
    testHarness.client.query.mockResolvedValueOnce({
      rows: [{ ...boundary[0], login_scope_ok: false }],
    });
    const database = createBatchPairingDatabase(environment, () => testHarness.pool);

    await expect(
      database.poll("pair_AAAAAAAAAAAAAAAAAAAAAA", Buffer.alloc(32, 0x71)),
    ).rejects.toThrow("pairing database unavailable");
    expect(testHarness.release).toHaveBeenCalledWith(true);

    const queryFailure = harness();
    queryFailure.client.query
      .mockResolvedValueOnce({ rows: boundary })
      .mockRejectedValueOnce(new Error("private-database-password"));
    const failingDatabase = createBatchPairingDatabase(environment, () => queryFailure.pool);
    let reflected = "";
    try {
      await failingDatabase.poll("pair_AAAAAAAAAAAAAAAAAAAAAA", Buffer.alloc(32, 0x71));
    } catch (error) {
      reflected = String(error);
    }
    expect(reflected).toContain("pairing database unavailable");
    expect(reflected).not.toContain("private-database-password");
    expect(queryFailure.release).toHaveBeenCalledWith(true);
  });
});
