import { describe, expect, it, vi } from "vitest";

import {
  createCloseablePublicCommunityRaceStatusStore,
  createCloseablePublicCommunityScoreStore,
  createCloseablePublicCommunityTokenRaceStatusStore,
  createConfiguredPublicCommunityRaceStatusStore,
  createConfiguredPublicCommunityScoreStore,
  createConfiguredPublicCommunityTokenRaceStatusStore,
  createPublicCommunityRaceStore,
  createPublicCommunityRaceStatusStore,
  createPublicCommunityScoreStore,
  createPublicCommunityTokenRaceStatusStore,
  PublicCommunityScoreStoreError,
  type PublicCommunityScoreStoreErrorCode,
} from "./public-community-score-store";
import type {
  PublicScoreDatabaseClient,
  PublicScoreDatabasePool,
} from "./public-score-database-pool";

interface ProjectionRow {
  readonly active_days: number;
  readonly display_position: number;
  readonly handle: string;
  readonly rank_position: number;
  readonly score_version: string;
  readonly season_end: string;
  readonly season_finalized: boolean;
  readonly season_start: string;
  readonly source_count: number;
  readonly weekly_score: number;
}

interface RaceStatusProjectionRow extends ProjectionRow {
  readonly car_recipe: unknown;
  readonly freshness_days: number;
  readonly streak_days: number | null;
}

interface TokenProjectionRow {
  readonly active_days: number;
  readonly car_recipe: null;
  readonly display_position: number;
  readonly freshness_days: number;
  readonly handle: string;
  readonly metric_version: "community_tokens_v1";
  readonly rank_position: number;
  readonly season_end: string;
  readonly season_finalized: boolean;
  readonly season_start: string;
  readonly source_count: number;
  readonly streak_days: number | null;
  readonly weekly_token_total: string;
}

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[] | undefined;
}

const baseProjectionRow: ProjectionRow = {
  season_start: "2026-07-13",
  season_end: "2026-07-19",
  score_version: "community_v1",
  season_finalized: false,
  handle: "alpha-driver",
  weekly_score: 500,
  active_days: 5,
  source_count: 2,
  rank_position: 1,
  display_position: 1,
};
const baseRuntimeBoundaryRow = {
  role_ok: true,
  login_scope_ok: true,
  search_path_ok: true,
  read_only_ok: true,
} as const;
const baseTokenProjectionRow: TokenProjectionRow = {
  season_start: "2026-07-27",
  season_end: "2026-08-02",
  metric_version: "community_tokens_v1",
  season_finalized: false,
  handle: "token-driver",
  weekly_token_total: "12345678",
  active_days: 5,
  source_count: 2,
  rank_position: 1,
  display_position: 1,
  car_recipe: null,
  freshness_days: 0,
  streak_days: null,
};

function runtimeBoundary(overrides: Record<string, unknown> = {}): unknown[] {
  return [{ ...baseRuntimeBoundaryRow, ...overrides }];
}

function harness(actions: unknown[]): {
  readonly calls: QueryCall[];
  readonly connect: ReturnType<typeof vi.fn>;
  readonly pool: PublicScoreDatabasePool;
  readonly releases: boolean[];
} {
  const pending = [...actions];
  const calls: QueryCall[] = [];
  const releases: boolean[] = [];
  const client: PublicScoreDatabaseClient = {
    query(text: string, values?: readonly unknown[]): Promise<unknown> {
      calls.push({ text, values });
      const action = pending.shift();
      if (action instanceof Error) {
        return Promise.reject(action);
      }
      return Promise.resolve(action);
    },
    release(destroy = false): void {
      releases.push(destroy);
    },
  };
  const connect = vi.fn(() => Promise.resolve(client));
  return {
    calls,
    connect,
    pool: {
      close(): Promise<void> {
        return Promise.resolve();
      },
      connect,
    },
    releases,
  };
}

async function expectStoreError(
  operation: Promise<unknown>,
  code: PublicCommunityScoreStoreErrorCode,
  privateValue = "private-value-that-must-not-be-reflected",
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(PublicCommunityScoreStoreError);
    expect(error).toMatchObject({
      code,
      message: "Community score data is unavailable.",
      name: "PublicCommunityScoreStoreError",
    });
    expect(String(error)).not.toContain(privateValue);
    return;
  }
  throw new Error("expected Community score store operation to fail");
}

describe("public Community score store", () => {
  it("checks the runtime boundary and maps a fixed parameterized top-32 query", async () => {
    const testHarness = harness([runtimeBoundary(), [baseProjectionRow]]);
    const store = createPublicCommunityScoreStore(testHarness.pool);

    await expect(store.read("2026-07-13")).resolves.toMatchObject({
      schemaVersion: 1,
      selfReported: true,
      trustTier: "community",
      participants: [{ handle: "alpha-driver", weeklyScore: 500 }],
    });

    expect(testHarness.calls).toHaveLength(2);
    const [boundaryCall, scoreCall] = testHarness.calls;
    expect(boundaryCall?.values).toBeUndefined();
    expect(boundaryCall?.text).toContain("CURRENT_USER = 'viberacing_web'");
    expect(boundaryCall?.text).toContain("SESSION_USER <> CURRENT_USER");
    expect(boundaryCall?.text).toContain("'viberacing_web', 'SET'");
    expect(boundaryCall?.text).toContain("pg_catalog.pg_roles");
    expect(boundaryCall?.text).toContain("NOT login_role.rolsuper");
    expect(boundaryCall?.text).toContain("granted_role.rolname <> 'viberacing_web'");
    expect(boundaryCall?.text).toContain("default_transaction_read_only");
    expect(boundaryCall?.text).toContain("search_path");
    expect(scoreCall?.values).toEqual(["2026-07-13", 32]);
    expect(scoreCall?.text).toContain(
      "viberacing_api.list_public_community_scores($1::date, $2::integer)",
    );
    expect(scoreCall?.text).toContain("score.season_start::text AS season_start");
    expect(scoreCall?.text).toContain("score.season_end::text AS season_end");
    expect(scoreCall?.text).toContain("ORDER BY score.display_position");
    expect(scoreCall?.text).not.toContain("2026-07-13");
    expect(testHarness.releases).toEqual([false]);
    expect(Object.isFrozen(store)).toBe(true);
  });

  it("checks the effective boundary on every checkout instead of trusting pooled state", async () => {
    const testHarness = harness([runtimeBoundary(), [], runtimeBoundary(), [baseProjectionRow]]);
    const store = createPublicCommunityScoreStore(testHarness.pool);

    await expect(store.read("2026-07-13")).resolves.toMatchObject({ participants: [] });
    await expect(store.read("2026-07-13")).resolves.toMatchObject({
      participants: [{ handle: "alpha-driver" }],
    });

    expect(testHarness.connect).toHaveBeenCalledTimes(2);
    expect(testHarness.calls.filter(({ text }) => text.includes("CURRENT_USER"))).toHaveLength(2);
    expect(testHarness.releases).toEqual([false, false]);
  });

  it("maps the separate fixed race query without widening the stable score query", async () => {
    const recipe = {
      schemaVersion: 1,
      chassis: "formula",
      nose: "wedge",
      cockpit: "canopy",
      wing: "high",
      wheels: "slick",
      palette: "magenta",
      trail: "spark",
      seed: 101,
    } as const;
    const testHarness = harness([
      runtimeBoundary(),
      [{ ...baseProjectionRow, car_recipe: recipe }],
      runtimeBoundary(),
      [{ ...baseProjectionRow, car_recipe: null }],
    ]);
    const store = createPublicCommunityRaceStore(testHarness.pool);

    const withRecipe = await store.read("2026-07-13");
    expect(withRecipe).toMatchObject({
      participants: [{ handle: "alpha-driver", carRecipe: recipe }],
    });
    const withoutRecipe = await store.read("2026-07-13");
    expect(withoutRecipe).toMatchObject({
      participants: [{ handle: "alpha-driver" }],
    });
    expect(Object.hasOwn(withoutRecipe.participants[0] ?? {}, "carRecipe")).toBe(false);

    const raceCalls = testHarness.calls.filter(({ text }) =>
      text.includes("list_public_community_race"),
    );
    expect(raceCalls).toHaveLength(2);
    expect(raceCalls[0]?.values).toEqual(["2026-07-13", 32]);
    expect(raceCalls[0]?.text).toContain("race.car_recipe AS car_recipe");
    expect(raceCalls[0]?.text).not.toContain("list_public_community_scores");
    expect(testHarness.releases).toEqual([false, false]);
  });

  it("maps the fixed race-status query with rounded freshness and optional streak", async () => {
    const statusRow: RaceStatusProjectionRow = {
      ...baseProjectionRow,
      car_recipe: null,
      freshness_days: 2,
      streak_days: 11,
    };
    const testHarness = harness([runtimeBoundary(), [statusRow]]);
    const store = createPublicCommunityRaceStatusStore(testHarness.pool);

    await expect(store.read("2026-07-13")).resolves.toMatchObject({
      participants: [
        {
          handle: "alpha-driver",
          freshnessDays: 2,
          streakDays: 11,
        },
      ],
    });

    const statusCall = testHarness.calls.find(({ text }) =>
      text.includes("list_public_community_race_status"),
    );
    expect(statusCall?.values).toEqual(["2026-07-13", 32]);
    expect(statusCall?.text).toContain("status.freshness_days AS freshness_days");
    expect(statusCall?.text).toContain("status.streak_days AS streak_days");
    expect(statusCall?.text).not.toContain("list_public_community_race(");
    expect(testHarness.releases).toEqual([false]);
  });

  it("maps the fixed direct-token query from canonical bigint text", async () => {
    const testHarness = harness([runtimeBoundary(), [baseTokenProjectionRow]]);
    const store = createPublicCommunityTokenRaceStatusStore(testHarness.pool);

    await expect(store.read("2026-07-27")).resolves.toMatchObject({
      participants: [
        {
          handle: "token-driver",
          metricVersion: "community_tokens_v1",
          weeklyTokenTotal: 12_345_678,
        },
      ],
    });

    const tokenCall = testHarness.calls.find(({ text }) =>
      text.includes("list_public_community_token_race_status"),
    );
    expect(tokenCall?.values).toEqual(["2026-07-27", 32]);
    expect(tokenCall?.text).toContain("status.weekly_token_total::text AS weekly_token_total");
    expect(tokenCall?.text).toContain("status.freshness_days AS freshness_days");
    expect(tokenCall?.text).not.toContain("list_public_community_race_status(");
    expect(testHarness.releases).toEqual([false]);
    expect(Object.isFrozen(store)).toBe(true);
  });

  it("rejects invalid token input and database projection without retaining row detail", async () => {
    const invalidSeasonHarness = harness([]);
    await expectStoreError(
      createPublicCommunityTokenRaceStatusStore(invalidSeasonHarness.pool).read("2026-07-29"),
      "invalid_season",
    );
    expect(invalidSeasonHarness.connect).not.toHaveBeenCalled();

    const invalidProjectionHarness = harness([
      runtimeBoundary(),
      [{ ...baseTokenProjectionRow, weekly_token_total: "9007199254740992" }],
    ]);
    await expectStoreError(
      createPublicCommunityTokenRaceStatusStore(invalidProjectionHarness.pool).read("2026-07-27"),
      "projection_rejected",
    );
    expect(invalidProjectionHarness.releases).toEqual([false]);
  });

  it("rejects an invalid race-status season before acquiring a connection", async () => {
    const testHarness = harness([]);
    const store = createPublicCommunityRaceStatusStore(testHarness.pool);

    await expectStoreError(store.read("2026-07-14"), "invalid_season");
    expect(testHarness.connect).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    null,
    20_260_713,
    "2026-7-13",
    "2026-02-30",
    "2026-07-14",
    "1999-12-20",
    "2100-01-04",
  ])("rejects an invalid season before acquiring a connection: %o", async (seasonStart) => {
    const testHarness = harness([]);
    const store = createPublicCommunityScoreStore(testHarness.pool);

    await expectStoreError(store.read(seasonStart), "invalid_season");

    expect(testHarness.connect).not.toHaveBeenCalled();
    expect(testHarness.calls).toEqual([]);
    expect(testHarness.releases).toEqual([]);
  });

  it.each(["1999-12-27", "2099-12-28"])(
    "accepts an inclusive database calendar boundary: %s",
    async (seasonStart) => {
      const testHarness = harness([runtimeBoundary(), []]);
      const store = createPublicCommunityScoreStore(testHarness.pool);

      await expect(store.read(seasonStart)).resolves.toMatchObject({ participants: [] });
      expect(testHarness.calls[1]?.values).toEqual([seasonStart, 32]);
    },
  );

  it.each(["role_ok", "login_scope_ok", "search_path_ok", "read_only_ok"])(
    "destroys the connection when the %s probe fails",
    async (column) => {
      const testHarness = harness([runtimeBoundary({ [column]: false })]);
      const store = createPublicCommunityScoreStore(testHarness.pool);

      await expectStoreError(store.read("2026-07-13"), "runtime_boundary_mismatch");

      expect(testHarness.calls).toHaveLength(1);
      expect(testHarness.releases).toEqual([true]);
    },
  );

  it("rejects malformed boundary rows without invoking accessors", async () => {
    let reads = 0;
    const accessorRow = {
      role_ok: true,
      login_scope_ok: true,
      search_path_ok: true,
      read_only_ok: true,
    };
    Object.defineProperty(accessorRow, "role_ok", {
      enumerable: true,
      get() {
        reads += 1;
        return true;
      },
    });
    const testHarness = harness([[accessorRow]]);
    const store = createPublicCommunityScoreStore(testHarness.pool);

    await expectStoreError(store.read("2026-07-13"), "runtime_boundary_mismatch");

    expect(reads).toBe(0);
    expect(testHarness.releases).toEqual([true]);
  });

  it("rejects unexpected array metadata and revoked boundary results non-reflectively", async () => {
    const extraArrayField = runtimeBoundary();
    Object.defineProperty(extraArrayField, "private", {
      enumerable: true,
      value: "private-value-that-must-not-be-reflected",
    });
    const revoked = Proxy.revocable(baseRuntimeBoundaryRow, {});
    revoked.revoke();

    for (const boundaryRows of [extraArrayField, [revoked.proxy]]) {
      const testHarness = harness([boundaryRows]);
      await expectStoreError(
        createPublicCommunityScoreStore(testHarness.pool).read("2026-07-13"),
        "runtime_boundary_mismatch",
      );
      expect(testHarness.releases).toEqual([true]);
    }
  });

  it.each([
    { boundaryRows: [] },
    { boundaryRows: [baseRuntimeBoundaryRow, baseRuntimeBoundaryRow] },
    {
      boundaryRows: [
        {
          ...baseRuntimeBoundaryRow,
          private_field: "private-value-that-must-not-be-reflected",
        },
      ],
    },
    { boundaryRows: [{ role_ok: true, login_scope_ok: true, search_path_ok: true }] },
    {
      boundaryRows: [
        Object.assign(Object.create({ inherited: true }) as object, baseRuntimeBoundaryRow),
      ],
    },
  ])("fails closed for malformed runtime boundary output", async ({ boundaryRows }) => {
    const testHarness = harness([boundaryRows]);
    const store = createPublicCommunityScoreStore(testHarness.pool);

    await expectStoreError(store.read("2026-07-13"), "runtime_boundary_mismatch");
    expect(testHarness.releases).toEqual([true]);
  });

  it("sanitizes a connection-acquisition failure without attempting release", async () => {
    const privateValue = "private-connect-error-that-must-not-be-reflected";
    const pool: PublicScoreDatabasePool = {
      close(): Promise<void> {
        return Promise.resolve();
      },
      connect(): Promise<never> {
        return Promise.reject(new Error(privateValue));
      },
    };

    await expectStoreError(
      createPublicCommunityScoreStore(pool).read("2026-07-13"),
      "connection_unavailable",
      privateValue,
    );
  });

  it.each([
    {
      actions: [new Error("private-boundary-query-error")],
      privateValue: "private-boundary-query-error",
    },
    {
      actions: [runtimeBoundary(), new Error("private-score-query-error")],
      privateValue: "private-score-query-error",
    },
  ])("destroys a client and sanitizes a query failure", async ({ actions, privateValue }) => {
    const testHarness = harness(actions);
    const store = createPublicCommunityScoreStore(testHarness.pool);

    await expectStoreError(store.read("2026-07-13"), "query_failed", privateValue);

    expect(testHarness.releases).toEqual([true]);
  });

  it("fails closed if a checked-out client cannot be released", async () => {
    const privateValue = "private-release-error-that-must-not-be-reflected";
    const client: PublicScoreDatabaseClient = {
      query(text: string): Promise<unknown> {
        return Promise.resolve(text.includes("CURRENT_USER") ? runtimeBoundary() : []);
      },
      release(): void {
        throw new Error(privateValue);
      },
    };
    const pool: PublicScoreDatabasePool = {
      close(): Promise<void> {
        return Promise.resolve();
      },
      connect(): Promise<PublicScoreDatabaseClient> {
        return Promise.resolve(client);
      },
    };

    await expectStoreError(
      createPublicCommunityScoreStore(pool).read("2026-07-13"),
      "connection_release_failed",
      privateValue,
    );
  });

  it("releases a healthy connection before rejecting an invalid projection", async () => {
    const privateValue = "private-projection-value-that-must-not-be-reflected";
    const testHarness = harness([
      runtimeBoundary(),
      [{ ...baseProjectionRow, private_field: privateValue }],
    ]);
    const store = createPublicCommunityScoreStore(testHarness.pool);

    await expectStoreError(store.read("2026-07-13"), "projection_rejected", privateValue);

    expect(testHarness.releases).toEqual([false]);
  });

  it("creates a closeable configured adapter without opening a connection eagerly", async () => {
    const store = createConfiguredPublicCommunityScoreStore({
      NODE_ENV: "development",
      VIBERACING_WEB_DATABASE_HOST: "127.0.0.1",
      VIBERACING_WEB_DATABASE_NAME: "viberacing_local",
      VIBERACING_WEB_DATABASE_PASSWORD: "private-configured-store-password",
      VIBERACING_WEB_DATABASE_PORT: "54329",
      VIBERACING_WEB_DATABASE_TLS_MODE: "disable",
      VIBERACING_WEB_DATABASE_USER: "viberacing_web_login",
    });

    expect(Object.isFrozen(store)).toBe(true);
    await expect(store.close()).resolves.toBeUndefined();
  });

  it("creates and closes the separate configured race-status adapter lazily", async () => {
    const store = createConfiguredPublicCommunityRaceStatusStore({
      NODE_ENV: "development",
      VIBERACING_WEB_DATABASE_HOST: "127.0.0.1",
      VIBERACING_WEB_DATABASE_NAME: "viberacing_local",
      VIBERACING_WEB_DATABASE_PASSWORD: "private-configured-status-store-password",
      VIBERACING_WEB_DATABASE_PORT: "54329",
      VIBERACING_WEB_DATABASE_TLS_MODE: "disable",
      VIBERACING_WEB_DATABASE_USER: "viberacing_web_login",
    });

    expect(Object.isFrozen(store)).toBe(true);
    await expect(store.close()).resolves.toBeUndefined();
  });

  it("creates and closes the token adapter lazily without database work", async () => {
    const store = createConfiguredPublicCommunityTokenRaceStatusStore({
      NODE_ENV: "development",
      VIBERACING_WEB_DATABASE_HOST: "127.0.0.1",
      VIBERACING_WEB_DATABASE_NAME: "viberacing_local",
      VIBERACING_WEB_DATABASE_PASSWORD: "private-configured-token-store-password",
      VIBERACING_WEB_DATABASE_PORT: "54329",
      VIBERACING_WEB_DATABASE_TLS_MODE: "disable",
      VIBERACING_WEB_DATABASE_USER: "viberacing_web_login",
    });

    expect(Object.isFrozen(store)).toBe(true);
    await expect(store.close()).resolves.toBeUndefined();
  });

  it("closes a race-status store without opening a connection", async () => {
    const testHarness = harness([]);
    const store = createCloseablePublicCommunityRaceStatusStore(testHarness.pool);

    await expect(store.close()).resolves.toBeUndefined();
    expect(testHarness.connect).not.toHaveBeenCalled();
  });

  it("sanitizes a pool close failure", async () => {
    const privateValue = "private-pool-close-error-that-must-not-be-reflected";
    const pool: PublicScoreDatabasePool = {
      close(): Promise<void> {
        return Promise.reject(new Error(privateValue));
      },
      connect(): Promise<never> {
        return Promise.reject(new Error("not used"));
      },
    };
    const store = createCloseablePublicCommunityScoreStore(pool);

    await expectStoreError(store.close(), "pool_close_failed", privateValue);
  });

  it("closes the token store and sanitizes its isolated pool-close failure", async () => {
    const successHarness = harness([]);
    await expect(
      createCloseablePublicCommunityTokenRaceStatusStore(successHarness.pool).close(),
    ).resolves.toBeUndefined();
    expect(successHarness.connect).not.toHaveBeenCalled();

    const privateValue = "private-token-pool-close-error";
    const pool: PublicScoreDatabasePool = {
      close(): Promise<void> {
        return Promise.reject(new Error(privateValue));
      },
      connect(): Promise<never> {
        return Promise.reject(new Error("not used"));
      },
    };
    await expectStoreError(
      createCloseablePublicCommunityTokenRaceStatusStore(pool).close(),
      "pool_close_failed",
      privateValue,
    );
  });
});
