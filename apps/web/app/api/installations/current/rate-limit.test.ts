import { afterEach, describe, expect, it, vi } from "vitest";

const { consumeRateLimitMock, queryMock, transactionMock } = vi.hoisted(() => ({
  consumeRateLimitMock: vi.fn(),
  queryMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  clientAddress: () => ({ trusted: true, key: "203.0.113.30" }),
  clientAdmissionLimit: (_address: unknown, trusted: number) => trusted,
  consumeAdmissionRateLimit: async (
    scope: string,
    key: string,
    limit: number,
    _globalLimit: number,
    window: number,
  ) => ({ allowed: Boolean(await consumeRateLimitMock(scope, key, limit, window)), reason: null }),
  consumeRateLimit: consumeRateLimitMock,
}));
vi.mock("@/lib/db", () => ({ query: queryMock, transaction: transactionMock }));

import { DELETE, parseReconciliationBody, POST } from "./route";

const deviceToken = "synthetic-device-token-that-is-long-enough";
const installationId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";
const attestationId = "33333333-3333-4333-8333-333333333333";

function request(body: unknown = { sourceIds: [sourceId] }): Request {
  return new Request("https://viberacing.example/api/installations/current", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${deviceToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("compact reconciliation payload", () => {
  it("accepts legacy, one-off CLI, and installed-handler attestation bodies", () => {
    expect(parseReconciliationBody({ sourceIds: [sourceId] })).toEqual({
      sourceIds: [sourceId],
    });
    expect(parseReconciliationBody({ sourceIds: [sourceId], connectorVersion: "0.3.11" })).toEqual({
      sourceIds: [sourceId],
      connectorVersion: "0.3.11",
    });
    expect(
      parseReconciliationBody({ sourceIds: [sourceId], connectorVersion: "0.3.11-beta.1" }),
    ).toEqual({ sourceIds: [sourceId], connectorVersion: "0.3.11-beta.1" });
    expect(
      parseReconciliationBody({
        sourceIds: [sourceId],
        cliVersion: "0.4.3",
        handlerAttestation: {
          attestationId,
          installedRuntimeVersion: "0.4.2",
          browserSyncProtocol: 1,
        },
      }),
    ).toEqual({
      sourceIds: [sourceId],
      cliVersion: "0.4.3",
      handlerAttestation: {
        attestationId,
        installedRuntimeVersion: "0.4.2",
        browserSyncProtocol: 1,
      },
    });
    expect(
      parseReconciliationBody({
        sourceIds: [sourceId],
        cliVersion: "0.4.3",
        handlerAttestation: {
          attestationId,
          installedRuntimeVersion: null,
          browserSyncProtocol: 0,
        },
      }),
    ).toEqual({
      sourceIds: [sourceId],
      cliVersion: "0.4.3",
      handlerAttestation: {
        attestationId,
        installedRuntimeVersion: null,
        browserSyncProtocol: 0,
      },
    });
    expect(parseReconciliationBody({ sourceIds: [sourceId], cliVersion: "0.4.3" })).toEqual({
      sourceIds: [sourceId],
      cliVersion: "0.4.3",
    });
    expect(
      parseReconciliationBody({
        sourceIds: [sourceId],
        bootstrapSourceIds: [sourceId],
        cliVersion: "0.5.0",
      }),
    ).toEqual({
      sourceIds: [sourceId],
      bootstrapSourceIds: [sourceId],
      cliVersion: "0.5.0",
    });
  });

  it("rejects malformed versions, duplicates, and unknown fields", () => {
    for (const body of [
      { sourceIds: [sourceId], connectorVersion: "0.3" },
      { sourceIds: [sourceId], connectorVersion: "0.3.11+private" },
      { sourceIds: [sourceId], connectorVersion: "1".repeat(41) },
      { sourceIds: [sourceId], cliVersion: "0.3" },
      { sourceIds: [sourceId], handlerAttestation: {} },
      {
        sourceIds: [sourceId],
        cliVersion: "0.4.3",
        handlerAttestation: {
          attestationId,
          installedRuntimeVersion: "0.4.2",
          browserSyncProtocol: -1,
        },
      },
      {
        sourceIds: [sourceId],
        cliVersion: "0.4.3",
        handlerAttestation: {
          attestationId,
          installedRuntimeVersion: "0.4.2",
          browserSyncProtocol: 1.5,
        },
      },
      {
        sourceIds: [sourceId],
        cliVersion: "0.4.3",
        handlerAttestation: {
          attestationId,
          installedRuntimeVersion: "0.4.2",
          browserSyncProtocol: 3,
        },
      },
      { sourceIds: [sourceId, sourceId] },
      { sourceIds: [sourceId], extra: true },
      {
        sourceIds: [sourceId],
        bootstrapSourceIds: ["44444444-4444-4444-8444-444444444444"],
      },
    ]) {
      expect(parseReconciliationBody(body)).toBeNull();
    }
  });
});

describe("compact reconciliation rate limiting", () => {
  afterEach(() => {
    consumeRateLimitMock.mockReset();
    queryMock.mockReset();
    transactionMock.mockReset();
  });

  it("applies the client quota before authentication lookup", async () => {
    consumeRateLimitMock.mockResolvedValue(false);

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(consumeRateLimitMock).toHaveBeenCalledOnce();
    expect(consumeRateLimitMock).toHaveBeenCalledWith(
      "reconciliation_pre_auth",
      "203.0.113.30",
      120,
      60,
    );
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("never persists a version for an invalid capability", async () => {
    consumeRateLimitMock.mockResolvedValue(true);
    queryMock.mockResolvedValue([]);

    const response = await POST(request({ sourceIds: [sourceId], connectorVersion: "0.3.11" }));

    expect(response.status).toBe(401);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("keys the authenticated quota by the server-side installation id", async () => {
    consumeRateLimitMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    queryMock.mockResolvedValue([{ id: installationId }]);

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(consumeRateLimitMock).toHaveBeenNthCalledWith(
      2,
      "reconciliation_installation",
      installationId,
      60,
      60,
    );
    expect(queryMock).toHaveBeenCalledOnce();
  });

  it("applies the shared quota only after capability and installation limits", async () => {
    consumeRateLimitMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    queryMock.mockResolvedValue([{ id: installationId }]);

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(consumeRateLimitMock).toHaveBeenNthCalledWith(
      3,
      "reconciliation_global",
      "all",
      10_000,
      60,
    );
    expect(queryMock.mock.invocationCallOrder[0]).toBeLessThan(
      consumeRateLimitMock.mock.invocationCallOrder[1] ?? Number.NEGATIVE_INFINITY,
    );
  });

  it("records a newer one-off CLI without confirming an installed runtime update", async () => {
    consumeRateLimitMock.mockResolvedValue(true);
    queryMock.mockResolvedValue([{ id: installationId }]);
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            source_id: sourceId,
            status: "active",
            last_accepted_sync_sequence: "7",
          },
        ],
      });
    transactionMock.mockImplementation(
      (callback: (client: { query: typeof clientQuery }) => Promise<unknown>) =>
        callback({ query: clientQuery }),
    );

    const response = await POST(request({ sourceIds: [sourceId], cliVersion: "0.4.3" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sources: [{ sourceId, status: "active", lastAcceptedSyncSequence: "7" }],
    });
    expect(clientQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("last_cli_version IS DISTINCT FROM $2"),
      [installationId, "0.4.3", expect.any(Uint8Array)],
    );
    expect(clientQuery.mock.calls[0]?.[0]).not.toContain("installed_connector_version");
    expect(clientQuery.mock.calls[0]?.[0]).not.toContain("browser_sync_protocol");
    expect(clientQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("source.installation_id = $1"),
      [installationId, [sourceId]],
    );
  });

  it("persists installed runtime and handler protocol only with a durable attestation", async () => {
    consumeRateLimitMock.mockResolvedValue(true);
    queryMock.mockResolvedValue([{ id: installationId }]);
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            source_id: sourceId,
            status: "active",
            last_accepted_sync_sequence: "7",
          },
        ],
      });
    transactionMock.mockImplementation(
      (callback: (client: { query: typeof clientQuery }) => Promise<unknown>) =>
        callback({ query: clientQuery }),
    );

    const response = await POST(
      request({
        sourceIds: [sourceId],
        cliVersion: "0.4.3",
        handlerAttestation: {
          attestationId,
          installedRuntimeVersion: "0.4.2",
          browserSyncProtocol: 1,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(clientQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(
        /installed_connector_version = \$3[\s\S]*browser_sync_protocol = \$4[\s\S]*browser_sync_capable = \$4::smallint > 0/,
      ),
      [installationId, "0.4.3", "0.4.2", 1, expect.any(Uint8Array)],
    );
    expect(clientQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("source.installation_id = $1"),
      [installationId, [sourceId]],
    );
    await expect(response.json()).resolves.toEqual({
      acceptedHandlerAttestationId: attestationId,
      sources: [{ sourceId, status: "active", lastAcceptedSyncSequence: "7" }],
    });
  });

  it("returns an exact bounded OpenCode accepted baseline only when requested", async () => {
    consumeRateLimitMock.mockResolvedValue(true);
    queryMock.mockResolvedValue([{ id: installationId }]);
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            source_id: sourceId,
            status: "active",
            last_accepted_sync_sequence: "7",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            source_id: sourceId,
            accepted_at: "2026-08-10 12:00:00+00",
            entries: [{ date: "2026-08-10", totalTokens: "123" }],
          },
        ],
      });
    transactionMock.mockImplementation(
      (callback: (client: { query: typeof clientQuery }) => Promise<unknown>) =>
        callback({ query: clientQuery }),
    );

    const response = await POST(
      request({
        sourceIds: [sourceId],
        bootstrapSourceIds: [sourceId],
        cliVersion: "0.5.0",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sources: [{ sourceId, status: "active", lastAcceptedSyncSequence: "7" }],
      sourceBaselines: [
        {
          sourceId,
          acceptedAt: "2026-08-10T12:00:00.000Z",
          entries: [{ date: "2026-08-10", totalTokens: "123" }],
        },
      ],
    });
    expect(clientQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringMatching(/daily_usage[\s\S]*source\.agent_id = 'opencode'/),
      [installationId, [sourceId]],
    );
  });

  it("clears installed runtime when the durable attestation observes no version", async () => {
    consumeRateLimitMock.mockResolvedValue(true);
    queryMock.mockResolvedValue([{ id: installationId }]);
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });
    transactionMock.mockImplementation(
      (callback: (client: { query: typeof clientQuery }) => Promise<unknown>) =>
        callback({ query: clientQuery }),
    );

    const response = await POST(
      request({
        sourceIds: [sourceId],
        cliVersion: "0.4.3",
        handlerAttestation: {
          attestationId,
          installedRuntimeVersion: null,
          browserSyncProtocol: 0,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(clientQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("installed_connector_version = $3"),
      [installationId, "0.4.3", null, 0, expect.any(Uint8Array)],
    );
  });

  it("keeps legacy clients read-only while using the same source transaction", async () => {
    consumeRateLimitMock.mockResolvedValue(true);
    queryMock.mockResolvedValue([{ id: installationId }]);
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    transactionMock.mockImplementation(
      (callback: (client: { query: typeof clientQuery }) => Promise<unknown>) =>
        callback({ query: clientQuery }),
    );

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(clientQuery).toHaveBeenCalledOnce();
    expect(clientQuery.mock.calls[0]?.[0]).not.toContain("UPDATE installations");
  });

  it("rejects an invalid reported version before opening a transaction", async () => {
    consumeRateLimitMock.mockResolvedValue(true);
    queryMock.mockResolvedValue([{ id: installationId }]);

    const response = await POST(request({ sourceIds: [sourceId], connectorVersion: "0.3" }));

    expect(response.status).toBe(400);
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("installation deletion admission ordering", () => {
  afterEach(() => {
    consumeRateLimitMock.mockReset();
    queryMock.mockReset();
    transactionMock.mockReset();
  });

  it("does not open a transaction for an invalid capability", async () => {
    consumeRateLimitMock.mockResolvedValue(true);
    queryMock.mockResolvedValue([]);

    const response = await DELETE(request());

    expect(response.status).toBe(401);
    expect(consumeRateLimitMock).toHaveBeenCalledOnce();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("applies the destructive installation quota before the transaction", async () => {
    consumeRateLimitMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    queryMock.mockResolvedValue([{ id: installationId }]);

    const response = await DELETE(request());

    expect(response.status).toBe(429);
    expect(consumeRateLimitMock).toHaveBeenNthCalledWith(
      2,
      "installation_delete",
      installationId,
      5,
      300,
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("keeps an authenticated concurrent repeat idempotent", async () => {
    consumeRateLimitMock.mockResolvedValue(true);
    queryMock.mockResolvedValue([{ id: installationId }]);
    const clientQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    transactionMock.mockImplementation(
      (callback: (client: { query: typeof clientQuery }) => Promise<unknown>) =>
        callback({ query: clientQuery }),
    );

    const response = await DELETE(request());

    expect(response.status).toBe(204);
    expect(clientQuery).toHaveBeenCalledOnce();
  });
});
