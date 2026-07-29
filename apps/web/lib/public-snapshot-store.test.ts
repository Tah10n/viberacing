import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createCloseablePublicSnapshotStore,
  createPublicSnapshotStore,
  PublicSnapshotStoreError,
  type PublicSnapshotStoreErrorCode,
} from "./public-snapshot-store";
import type {
  PublicSnapshotDatabaseClient,
  PublicSnapshotDatabasePool,
} from "./public-snapshot-database-pool";

const generatedAt = "2026-07-27T12:00:00.000000Z";
const runtimeBoundary = [
  {
    login_scope_ok: true,
    read_only_ok: true,
    role_ok: true,
    search_path_ok: true,
  },
];

function leaderboardPayload(
  page = 1,
  seasonStart = "2026-07-27",
  seasonState: "finalized" | "open" = "open",
): Record<string, unknown> {
  return {
    generatedAt,
    metricVersion: "provider_reported_tokens_v1",
    nextPage: null,
    page,
    pageSize: 100,
    participantCount: 1,
    participants: [
      {
        displayPosition: 1,
        freshnessDays: 0,
        handle: "demo_driver",
        rankPosition: 1,
        weeklyTokenTotal: "12345678",
      },
    ],
    schemaVersion: 1,
    seasonEnd: seasonStart === "2026-07-27" ? "2026-08-02" : "2026-07-26",
    seasonStart,
    seasonState,
    snapshotRevision: 4,
    trustTier: "community",
  };
}

function profilePayload(handle = "demo_driver"): Record<string, unknown> {
  return {
    carRecipe: null,
    freshnessDays: 0,
    handle,
    participantCount: 1,
    rankPosition: 1,
    schemaVersion: 1,
    season: {
      seasonEnd: "2026-08-02",
      seasonStart: "2026-07-27",
      seasonState: "open",
    },
    trustTier: "community",
    weeklyTokenTotal: "12345678",
  };
}

function snapshotRow(
  payload: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const canonicalPayload = JSON.stringify(payload);
  const digest = createHash("sha256").update(canonicalPayload).digest();
  return {
    canonical_payload: canonicalPayload,
    etag: `"${digest.toString("hex")}"`,
    finalized:
      payload.seasonState === "finalized" ||
      (payload.season as { seasonState?: unknown } | undefined)?.seasonState === "finalized",
    generated_at: generatedAt,
    payload_digest: digest,
    ...overrides,
  };
}

interface ScriptedPool {
  readonly pool: PublicSnapshotDatabasePool;
  readonly queries: readonly Readonly<{
    readonly text: string;
    readonly values: readonly unknown[];
  }>[];
  readonly releases: readonly boolean[];
  readonly state: { closed: boolean; connects: number };
}

function scriptedPool(
  dataResults: readonly unknown[],
  options: Readonly<{
    boundary?: unknown;
    closeError?: Error;
    connectError?: Error;
    queryErrorAt?: number;
    releaseError?: Error;
  }> = {},
): ScriptedPool {
  const queries: { text: string; values: readonly unknown[] }[] = [];
  const releases: boolean[] = [];
  const state = { closed: false, connects: 0 };
  let dataIndex = 0;
  const client: PublicSnapshotDatabaseClient = {
    query(text, values = []): Promise<unknown> {
      queries.push({ text, values });
      if (text.includes("CURRENT_USER = 'viberacing_web'")) {
        return Promise.resolve(options.boundary ?? runtimeBoundary);
      }
      const index = dataIndex;
      dataIndex += 1;
      if (options.queryErrorAt === index) {
        return Promise.reject(new Error("private query detail"));
      }
      return Promise.resolve(dataResults[index]);
    },
    release(destroy = false): void {
      releases.push(destroy);
      if (options.releaseError !== undefined) {
        throw options.releaseError;
      }
    },
  };
  return {
    pool: {
      close(): Promise<void> {
        state.closed = true;
        return options.closeError === undefined
          ? Promise.resolve()
          : Promise.reject(options.closeError);
      },
      connect(): Promise<PublicSnapshotDatabaseClient> {
        state.connects += 1;
        return options.connectError === undefined
          ? Promise.resolve(client)
          : Promise.reject(options.connectError);
      },
    },
    queries,
    releases,
    state,
  };
}

async function expectStoreError(
  operation: Promise<unknown>,
  code: PublicSnapshotStoreErrorCode,
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(PublicSnapshotStoreError);
    expect(error).toMatchObject({
      code,
      message: "Public snapshot data is unavailable.",
      name: "PublicSnapshotStoreError",
    });
    expect(String(error)).not.toContain("private");
    return;
  }
  throw new Error(`expected public snapshot store error ${code}`);
}

describe("public snapshot store", () => {
  it("reads and verifies one current canonical snapshot page through the exact runtime boundary", async () => {
    const fixture = scriptedPool([[snapshotRow(leaderboardPayload())]]);
    const store = createPublicSnapshotStore(fixture.pool);

    const record = await store.readCurrentLeaderboard(1);

    expect(JSON.parse(record.canonicalPayload)).toMatchObject({
      page: 1,
      seasonStart: "2026-07-27",
    });
    expect(record.etag).toMatch(/^"[a-f0-9]{64}"$/);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(store)).toBe(true);
    expect(fixture.queries).toHaveLength(2);
    expect(fixture.queries[1]?.text).toContain(
      "viberacing_api.read_current_leaderboard_page($1::integer)",
    );
    expect(fixture.queries[1]?.values).toEqual([1]);
    expect(fixture.releases).toEqual([false]);
  });

  it("reads historical and current-profile materializations without raw aggregation", async () => {
    const fixture = scriptedPool([
      [snapshotRow(leaderboardPayload(2, "2026-07-20", "finalized"))],
      [snapshotRow(profilePayload("demo_driver"))],
    ]);
    const store = createPublicSnapshotStore(fixture.pool);

    await expect(store.readSeasonLeaderboard("2026-07-20", 2)).resolves.toMatchObject({
      finalized: true,
    });
    await expect(store.readCurrentProfile("demo_driver")).resolves.toMatchObject({
      finalized: false,
    });

    expect(fixture.queries[1]?.text).toContain("viberacing_api.read_season_leaderboard_page");
    expect(fixture.queries[1]?.values).toEqual(["2026-07-20", 2]);
    expect(fixture.queries[3]?.text).toContain(
      "viberacing_api.read_current_public_profile($1::text)",
    );
    expect(fixture.queries[3]?.values).toEqual(["demo_driver"]);
    expect(fixture.queries.map((query) => query.text).join("\n")).not.toMatch(
      /\b(?:SUM|RANK)\s*\(/i,
    );
  });

  it.each([
    [
      "current page",
      (store: ReturnType<typeof createPublicSnapshotStore>) => store.readCurrentLeaderboard(0),
    ],
    [
      "historical season",
      (store: ReturnType<typeof createPublicSnapshotStore>) =>
        store.readSeasonLeaderboard("2026-07-28", 1),
    ],
    [
      "historical page",
      (store: ReturnType<typeof createPublicSnapshotStore>) =>
        store.readSeasonLeaderboard("2026-07-20", "01"),
    ],
    [
      "profile handle",
      (store: ReturnType<typeof createPublicSnapshotStore>) =>
        store.readCurrentProfile("../private"),
    ],
  ])("rejects invalid %s before a checkout", async (_label, operation) => {
    const fixture = scriptedPool([]);
    await expectStoreError(operation(createPublicSnapshotStore(fixture.pool)), "invalid_input");
    expect(fixture.state.connects).toBe(0);
  });

  it("distinguishes a missing current snapshot from a missing later page", async () => {
    const absent = scriptedPool([[]]);
    await expectStoreError(
      createPublicSnapshotStore(absent.pool).readCurrentLeaderboard(1),
      "snapshot_unavailable",
    );

    const laterPage = scriptedPool([[], [snapshotRow(leaderboardPayload())]]);
    await expectStoreError(
      createPublicSnapshotStore(laterPage.pool).readCurrentLeaderboard(2),
      "not_found",
    );
    expect(laterPage.state.connects).toBe(2);
  });

  it("distinguishes a hidden profile from a completely absent current snapshot", async () => {
    const hidden = scriptedPool([[], [snapshotRow(leaderboardPayload())]]);
    await expectStoreError(
      createPublicSnapshotStore(hidden.pool).readCurrentProfile("hidden_driver"),
      "not_found",
    );

    const absent = scriptedPool([[], []]);
    await expectStoreError(
      createPublicSnapshotStore(absent.pool).readCurrentProfile("hidden_driver"),
      "snapshot_unavailable",
    );
  });

  it("returns not found for an absent historical page", async () => {
    const fixture = scriptedPool([[]]);
    await expectStoreError(
      createPublicSnapshotStore(fixture.pool).readSeasonLeaderboard("2026-07-20", 1),
      "not_found",
    );
  });

  it.each([
    {
      code: "projection_rejected" as const,
      rows: {},
    },
    {
      code: "projection_rejected" as const,
      rows: [snapshotRow(leaderboardPayload()), snapshotRow(leaderboardPayload())],
    },
    {
      code: "projection_rejected" as const,
      rows: [{ ...snapshotRow(leaderboardPayload()), private_column: "private" }],
    },
    {
      code: "projection_rejected" as const,
      rows: [snapshotRow(leaderboardPayload(), { etag: '"deadbeef"' })],
    },
    {
      code: "projection_rejected" as const,
      rows: [snapshotRow(leaderboardPayload(), { payload_digest: Buffer.alloc(32) })],
    },
    {
      code: "projection_rejected" as const,
      rows: [snapshotRow(leaderboardPayload(), { canonical_payload: "{" })],
    },
    {
      code: "projection_rejected" as const,
      rows: [snapshotRow(leaderboardPayload(2))],
    },
  ])("rejects malformed fixed-query output %#", async ({ code, rows }) => {
    const fixture = scriptedPool([rows]);
    await expectStoreError(createPublicSnapshotStore(fixture.pool).readCurrentLeaderboard(1), code);
    expect(fixture.releases).toEqual([false]);
  });

  it("rejects a valid contract that does not match the requested historical season", async () => {
    const fixture = scriptedPool([[snapshotRow(leaderboardPayload(1, "2026-07-27"))]]);
    await expectStoreError(
      createPublicSnapshotStore(fixture.pool).readSeasonLeaderboard("2026-07-20", 1),
      "projection_rejected",
    );
  });

  it("rejects a valid profile contract for another handle", async () => {
    const fixture = scriptedPool([[snapshotRow(profilePayload("other_driver"))]]);
    await expectStoreError(
      createPublicSnapshotStore(fixture.pool).readCurrentProfile("demo_driver"),
      "projection_rejected",
    );
  });

  it.each([
    {
      code: "connection_unavailable" as const,
      options: { connectError: new Error("private connect detail") },
    },
    {
      code: "runtime_boundary_mismatch" as const,
      options: { boundary: [{ ...runtimeBoundary[0], read_only_ok: false }] },
    },
    {
      code: "query_failed" as const,
      options: { queryErrorAt: 0 },
    },
    {
      code: "connection_release_failed" as const,
      options: { releaseError: new Error("private release detail") },
    },
  ])("contains a database boundary failure %#", async ({ code, options }) => {
    const fixture = scriptedPool([[snapshotRow(leaderboardPayload())]], options);
    await expectStoreError(createPublicSnapshotStore(fixture.pool).readCurrentLeaderboard(1), code);
    if (code === "query_failed" || code === "runtime_boundary_mismatch") {
      expect(fixture.releases).toEqual([true]);
    }
  });

  it("closes only through the configured wrapper and contains close failure", async () => {
    const success = scriptedPool([]);
    const store = createCloseablePublicSnapshotStore(success.pool);
    await store.close();
    expect(success.state.closed).toBe(true);

    const failure = scriptedPool([], { closeError: new Error("private close detail") });
    await expectStoreError(
      createCloseablePublicSnapshotStore(failure.pool).close(),
      "pool_close_failed",
    );
  });
});
