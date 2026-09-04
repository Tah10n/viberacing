import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  consumeRateLimit: vi.fn(),
  query: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ query: mocks.query, transaction: mocks.transaction }));
vi.mock("@/lib/rate-limit", () => ({
  clientAddress: () => ({ trusted: true, key: "127.0.0.1" }),
  clientAdmissionLimit: (_address: unknown, trustedLimit: number) => trustedLimit,
  consumeAdmissionRateLimit: async (
    scope: string,
    key: string,
    limit: number,
    _globalLimit: number,
    window: number,
  ) => ({ allowed: Boolean(await mocks.consumeRateLimit(scope, key, limit, window)) }),
  consumeRateLimit: mocks.consumeRateLimit,
}));
vi.mock("@/lib/request-log", () => ({
  withRequestLogging: (_route: string, handler: unknown) => handler,
}));

import { parseSourceRegistrationBody, POST } from "./route";

const installationId = "11111111-1111-4111-8111-111111111111";
const profileSourceId = "22222222-2222-4222-8222-222222222222";
const clientSourceId = "33333333-3333-4333-8333-333333333333";
const sourceId = "44444444-4444-4444-8444-444444444444";
const accountId = "55555555-5555-4555-8555-555555555555";
const registrationBody = {
  agentId: "codex",
  clientSourceId,
  collectionMethod: "codex_app_server",
  profileClientSourceId: profileSourceId,
  supportedSurface: "desktop",
};

function makeRequest(body: unknown): Request {
  return new Request("https://viberacing.example/api/installations/current/sources/register", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${"d".repeat(43)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.consumeRateLimit.mockResolvedValue(true);
  mocks.query.mockResolvedValue([{ id: installationId, user_id: "42" }]);
  mocks.transaction.mockImplementation(async (work: (client: unknown) => Promise<unknown>) =>
    work({ query: mocks.clientQuery }),
  );
});

describe.each([
  {
    agentId: "codex",
    collectionMethod: "codex_app_server",
    labelPrefix: "Codex",
    aggregationMode: "account_max",
  },
  {
    agentId: "cursor",
    collectionMethod: "cursor_local_events",
    labelPrefix: "Cursor",
    aggregationMode: "source_sum",
  },
])(
  "dynamic $agentId source registration",
  ({ agentId, collectionMethod, labelPrefix, aggregationMode }) => {
    const body = { ...registrationBody, agentId, collectionMethod };
    function request(value: unknown = body) {
      return makeRequest(value);
    }

    it("accepts only the exact content-free registration metadata", () => {
      expect(parseSourceRegistrationBody(body)).toEqual(body);
      expect(
        parseSourceRegistrationBody({
          ...body,
          providerAccountKey: "acct1_x",
        }),
      ).toBeNull();
      expect(
        parseSourceRegistrationBody({ ...body, profileClientSourceId: clientSourceId }),
      ).toBeNull();
      expect(parseSourceRegistrationBody({ ...body, supportedSurface: "cli" })).toBeNull();
    });

    it("creates one generic account under a locked physical profile", async () => {
      mocks.clientQuery
        .mockResolvedValueOnce({ rows: [{ id: "42" }] })
        .mockResolvedValueOnce({ rows: [{ id: installationId, user_id: "42" }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ id: profileSourceId }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              account_count: 1,
              installation_count: 1,
              profile_count: 1,
              user_source_count: 1,
            },
          ],
        })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              source_id: sourceId,
              client_source_id: clientSourceId,
              agent_account_id: accountId,
              agent_id: agentId,
              account_label: `${labelPrefix} account 2`,
              collection_method: collectionMethod,
              last_accepted_sync_sequence: "0",
              profile_source_id: profileSourceId,
            },
          ],
        });

      const response = await POST(request());

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        source: {
          clientSourceId,
          sourceId,
          agentAccountId: accountId,
          agentId,
          accountLabel: `${labelPrefix} account 2`,
          collectionMethod,
          lastAcceptedSyncSequence: "0",
          profileSourceId,
        },
      });
      expect(mocks.clientQuery).toHaveBeenNthCalledWith(
        1,
        expect.stringMatching(/FROM users[\s\S]*FOR UPDATE/),
        ["42"],
      );
      expect(mocks.clientQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringMatching(/device_token_hash = \$2[\s\S]*user_id = \$3[\s\S]*FOR UPDATE/),
        [installationId, expect.any(Buffer), "42"],
      );
      expect(mocks.clientQuery).toHaveBeenNthCalledWith(
        4,
        expect.stringMatching(
          /user_id = \$3[\s\S]*agent_id = \$4[\s\S]*collection_method = \$5[\s\S]*supported_surface = \$6[\s\S]*status = 'active'[\s\S]*profile_source_id IS NULL[\s\S]*FOR UPDATE/,
        ),
        [profileSourceId, installationId, "42", agentId, collectionMethod, "desktop"],
      );
      expect(mocks.clientQuery).toHaveBeenNthCalledWith(
        7,
        expect.stringContaining("INSERT INTO agent_accounts"),
        [expect.any(String), "42", agentId, `${labelPrefix} account 2`, aggregationMode],
      );
      expect(mocks.clientQuery).toHaveBeenNthCalledWith(
        8,
        expect.stringMatching(/profile_source_id/),
        expect.arrayContaining([clientSourceId, profileSourceId]),
      );
    });

    it("reuses the canonical account from a previous installation", async () => {
      mocks.clientQuery
        .mockResolvedValueOnce({ rows: [{ id: "42" }] })
        .mockResolvedValueOnce({ rows: [{ id: installationId, user_id: "42" }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: profileSourceId }] })
        .mockResolvedValueOnce({
          rows: [{ account_id: accountId, account_label: `${labelPrefix} account 2` }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              account_count: 100,
              installation_count: 1,
              profile_count: 1,
              user_source_count: 1,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              source_id: sourceId,
              client_source_id: clientSourceId,
              agent_account_id: accountId,
              agent_id: agentId,
              account_label: `${labelPrefix} account 2`,
              collection_method: collectionMethod,
              last_accepted_sync_sequence: "0",
              profile_source_id: profileSourceId,
            },
          ],
        });

      const response = await POST(request());

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        source: { agentAccountId: accountId, accountLabel: `${labelPrefix} account 2` },
      });
      expect(mocks.clientQuery).toHaveBeenCalledTimes(7);
      expect(
        mocks.clientQuery.mock.calls.some(([sql]) =>
          String(sql).includes("INSERT INTO agent_accounts"),
        ),
      ).toBe(false);
    });

    it("is idempotent without creating a second account", async () => {
      const mapping = {
        source_id: sourceId,
        client_source_id: clientSourceId,
        agent_account_id: accountId,
        agent_id: agentId,
        account_label: `${labelPrefix} account`,
        collection_method: collectionMethod,
        last_accepted_sync_sequence: "7",
        profile_source_id: profileSourceId,
        status: "active",
      };
      mocks.clientQuery
        .mockResolvedValueOnce({ rows: [{ id: "42" }] })
        .mockResolvedValueOnce({ rows: [{ id: installationId, user_id: "42" }] })
        .mockResolvedValueOnce({ rows: [mapping] })
        .mockResolvedValueOnce({ rows: [{ id: profileSourceId }] });

      const response = await POST(request());

      expect(response.status).toBe(200);
      expect(mocks.clientQuery).toHaveBeenCalledTimes(4);
    });

    it("returns a conflict when an existing source is repeated for another profile", async () => {
      mocks.clientQuery
        .mockResolvedValueOnce({ rows: [{ id: "42" }] })
        .mockResolvedValueOnce({ rows: [{ id: installationId, user_id: "42" }] })
        .mockResolvedValueOnce({
          rows: [
            {
              source_id: sourceId,
              client_source_id: clientSourceId,
              agent_account_id: accountId,
              agent_id: agentId,
              account_label: `${labelPrefix} account 2`,
              collection_method: collectionMethod,
              last_accepted_sync_sequence: "0",
              profile_source_id: profileSourceId,
              status: "active",
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] });

      const response = await POST(
        request({
          ...body,
          profileClientSourceId: "66666666-6666-4666-8666-666666666666",
        }),
      );

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: "source_registration_conflict" });
      expect(mocks.clientQuery).toHaveBeenCalledTimes(4);
    });

    it("fails closed for an existing unlinked secondary client source", async () => {
      mocks.clientQuery
        .mockResolvedValueOnce({ rows: [{ id: "42" }] })
        .mockResolvedValueOnce({ rows: [{ id: installationId, user_id: "42" }] })
        .mockResolvedValueOnce({
          rows: [
            {
              source_id: sourceId,
              client_source_id: clientSourceId,
              agent_account_id: accountId,
              agent_id: agentId,
              account_label: labelPrefix,
              collection_method: collectionMethod,
              last_accepted_sync_sequence: "4",
              profile_source_id: null,
              status: "active",
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ id: profileSourceId }] });

      const response = await POST(request());

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: "source_registration_conflict" });
      expect(mocks.clientQuery).toHaveBeenCalledTimes(4);
    });

    it("fails closed at eight logical accounts without inserting", async () => {
      mocks.clientQuery
        .mockResolvedValueOnce({ rows: [{ id: "42" }] })
        .mockResolvedValueOnce({ rows: [{ id: installationId, user_id: "42" }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: profileSourceId }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              account_count: 8,
              installation_count: 8,
              profile_count: 8,
              user_source_count: 8,
            },
          ],
        });

      const response = await POST(request());

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: "profile_account_limit_reached" });
      expect(mocks.clientQuery).toHaveBeenCalledTimes(6);
    });

    it("fails closed at the existing per-user source and account limits", async () => {
      mocks.clientQuery
        .mockResolvedValueOnce({ rows: [{ id: "42" }] })
        .mockResolvedValueOnce({ rows: [{ id: installationId, user_id: "42" }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: profileSourceId }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              account_count: 100,
              installation_count: 1,
              profile_count: 1,
              user_source_count: 100,
            },
          ],
        });

      const response = await POST(request());

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: "source_limit_reached" });
      expect(mocks.clientQuery).toHaveBeenCalledTimes(6);
    });

    it("fails closed when only the per-user account limit is reached", async () => {
      mocks.clientQuery
        .mockResolvedValueOnce({ rows: [{ id: "42" }] })
        .mockResolvedValueOnce({ rows: [{ id: installationId, user_id: "42" }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: profileSourceId }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              account_count: 100,
              installation_count: 1,
              profile_count: 1,
              user_source_count: 1,
            },
          ],
        });

      const response = await POST(request());

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: "profile_account_limit_reached" });
      expect(mocks.clientQuery).toHaveBeenCalledTimes(6);
    });
    it.each(["aggregationMode", "labelPrefix", "accountSwitchMode", "email", "accountId"])(
      "rejects client-controlled %s",
      async (key) => {
        expect((await POST(request({ ...body, [key]: "CANARY_PRIVATE_VALUE" }))).status).toBe(400);
        expect(mocks.transaction).not.toHaveBeenCalled();
      },
    );

    it("rejects a collection method from the other provider", async () => {
      const otherMethod = agentId === "codex" ? "cursor_local_events" : "codex_app_server";
      expect((await POST(request({ ...body, collectionMethod: otherMethod }))).status).toBe(400);
      expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it("rejects a profile that is not owned by this installation and agent", async () => {
      mocks.clientQuery
        .mockResolvedValueOnce({ rows: [{ id: "42" }] })
        .mockResolvedValueOnce({ rows: [{ id: installationId, user_id: "42" }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });
      expect((await POST(request())).status).toBe(400);
      expect(mocks.clientQuery).toHaveBeenCalledTimes(4);
      expect(mocks.clientQuery.mock.calls[3]?.[1]).toEqual([
        profileSourceId,
        installationId,
        "42",
        agentId,
        collectionMethod,
        "desktop",
      ]);
    });

    it.each(["agent", "method", "status"])(
      "rejects a retry with an incompatible existing %s",
      async (field) => {
        const mapping = {
          profile_source_id: profileSourceId,
          agent_id: agentId,
          collection_method: collectionMethod,
          status: "active",
        };
        if (field === "agent") mapping.agent_id = agentId === "codex" ? "cursor" : "codex";
        if (field === "method") mapping.collection_method = "incompatible";
        if (field === "status") mapping.status = "disconnected";
        mocks.clientQuery
          .mockResolvedValueOnce({ rows: [{ id: "42" }] })
          .mockResolvedValueOnce({ rows: [{ id: installationId, user_id: "42" }] })
          .mockResolvedValueOnce({ rows: [mapping] })
          .mockResolvedValueOnce({ rows: [{ id: profileSourceId }] });
        expect((await POST(request())).status).toBe(409);
        expect(mocks.clientQuery).toHaveBeenCalledTimes(4);
      },
    );
  },
);
