import { describe, expect, it, vi } from "vitest";

import {
  CommunityMaintenanceError,
  createCloseableCommunityMaintenanceRunner,
  createCommunityMaintenanceRunner,
  createConfiguredCommunityMaintenanceRunner,
  type CommunityMaintenanceErrorCode,
  type CommunityMaintenanceJob,
} from "./community-maintenance.js";
import type { JobsDatabaseClient, JobsDatabasePool } from "./database-pool.js";

const privateDetail = "private database detail must not leak";
const runtimeBoundary = [
  {
    login_scope_ok: true,
    role_ok: true,
    search_path_ok: true,
  },
];

interface PoolFixture {
  readonly client: JobsDatabaseClient;
  readonly close: ReturnType<typeof vi.fn>;
  readonly cleanupExpiredIngestState: ReturnType<typeof vi.fn>;
  readonly cleanupExpiredPairingState: ReturnType<typeof vi.fn>;
  readonly connect: ReturnType<typeof vi.fn>;
  readonly finalizeCommunitySeason: ReturnType<typeof vi.fn>;
  readonly pool: JobsDatabasePool;
  readonly release: ReturnType<typeof vi.fn>;
  readonly refreshCommunitySeason: ReturnType<typeof vi.fn>;
  readonly verifyRuntimeBoundary: ReturnType<typeof vi.fn>;
}

function createPoolFixture(jobResult: unknown): PoolFixture {
  const cleanupExpiredIngestState = vi.fn(() => Promise.resolve(jobResult));
  const cleanupExpiredPairingState = vi.fn(() => Promise.resolve(jobResult));
  const finalizeCommunitySeason = vi.fn(() => Promise.resolve(jobResult));
  const release = vi.fn();
  const refreshCommunitySeason = vi.fn(() => Promise.resolve(jobResult));
  const verifyRuntimeBoundary = vi.fn(() => Promise.resolve(runtimeBoundary));
  const client: JobsDatabaseClient = {
    cleanupExpiredIngestState,
    cleanupExpiredPairingState,
    finalizeCommunitySeason,
    release,
    refreshCommunitySeason,
    verifyRuntimeBoundary,
  };
  const connect = vi.fn(() => Promise.resolve(client));
  const close = vi.fn(() => Promise.resolve());
  return {
    client,
    close,
    cleanupExpiredIngestState,
    cleanupExpiredPairingState,
    connect,
    finalizeCommunitySeason,
    pool: { close, connect },
    release,
    refreshCommunitySeason,
    verifyRuntimeBoundary,
  };
}

async function expectMaintenanceError(
  promise: Promise<unknown>,
  code: CommunityMaintenanceErrorCode,
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CommunityMaintenanceError);
    expect(error).toMatchObject({
      code,
      message: "Community maintenance job failed.",
      name: "CommunityMaintenanceError",
    });
    expect(String(error)).not.toContain(privateDetail);
    return;
  }
  throw new Error("expected maintenance execution to fail");
}

describe("Community maintenance runner", () => {
  it.each([
    {
      expected: {
        deletedNonces: 7,
        deletedOriginNonces: 3,
        deletedSnapshots: 5,
        kind: "cleanup_expired_ingest_state",
      },
      functionName: "cleanup_expired_ingest_state",
      input: { batchSize: 10, kind: "cleanup_expired_ingest_state" },
      rows: [{ deleted_nonces: 7, deleted_origin_nonces: 3, deleted_snapshots: 5 }],
      values: [10],
    },
    {
      expected: {
        deletedPairings: 4,
        deletedPendingKeys: 4,
        kind: "cleanup_expired_pairing_state",
      },
      functionName: "cleanup_expired_pairing_state",
      input: { batchSize: 8, kind: "cleanup_expired_pairing_state" },
      rows: [{ deleted_pairings: 4, deleted_pending_keys: 4 }],
      values: [8],
    },
    {
      expected: { kind: "refresh_community_season", profileCount: 12 },
      functionName: "refresh_community_season",
      input: { kind: "refresh_community_season", seasonStart: "2026-07-13" },
      rows: [{ profile_count: 12 }],
      values: ["2026-07-13"],
    },
    {
      expected: { kind: "finalize_community_season", profileCount: 0 },
      functionName: "finalize_community_season",
      input: { kind: "finalize_community_season", seasonStart: "1999-12-27" },
      rows: [{ profile_count: 0 }],
      values: ["1999-12-27"],
    },
  ] as const)("executes only the fixed $functionName capability", async (testCase) => {
    const fixture = createPoolFixture(testCase.rows);
    const runner = createCommunityMaintenanceRunner(fixture.pool);

    const result = await runner.execute(testCase.input);

    expect(result).toEqual(testCase.expected);
    expect(Object.isFrozen(result)).toBe(true);
    expect(fixture.connect).toHaveBeenCalledOnce();
    expect(fixture.verifyRuntimeBoundary).toHaveBeenCalledOnce();
    if (testCase.input.kind === "cleanup_expired_ingest_state") {
      expect(fixture.cleanupExpiredIngestState).toHaveBeenCalledWith(testCase.values[0]);
    } else if (testCase.input.kind === "cleanup_expired_pairing_state") {
      expect(fixture.cleanupExpiredPairingState).toHaveBeenCalledWith(testCase.values[0]);
    } else if (testCase.input.kind === "refresh_community_season") {
      expect(fixture.refreshCommunitySeason).toHaveBeenCalledWith(testCase.values[0]);
    } else {
      expect(fixture.finalizeCommunitySeason).toHaveBeenCalledWith(testCase.values[0]);
    }
    expect(
      fixture.cleanupExpiredIngestState.mock.calls.length +
        fixture.cleanupExpiredPairingState.mock.calls.length +
        fixture.refreshCommunitySeason.mock.calls.length +
        fixture.finalizeCommunitySeason.mock.calls.length,
    ).toBe(1);
    expect(fixture.release).toHaveBeenCalledWith(false);
  });

  it.each([
    null,
    [],
    { batchSize: 0, kind: "cleanup_expired_ingest_state" },
    { batchSize: 1_001, kind: "cleanup_expired_ingest_state" },
    { batchSize: 1.5, kind: "cleanup_expired_ingest_state" },
    { batchSize: "1", kind: "cleanup_expired_ingest_state" },
    { batchSize: 1, extra: true, kind: "cleanup_expired_ingest_state" },
    { batchSize: 0, kind: "cleanup_expired_pairing_state" },
    { batchSize: 1_001, kind: "cleanup_expired_pairing_state" },
    { batchSize: 1, extra: true, kind: "cleanup_expired_pairing_state" },
    { kind: "refresh_community_season", seasonStart: "2026-07-14" },
    { extra: true, kind: "refresh_community_season", seasonStart: "2026-07-13" },
    { kind: "refresh_community_season", seasonStart: "2026-02-30" },
    { kind: "refresh_community_season", seasonStart: "1999-12-20" },
    { kind: "finalize_community_season", seasonStart: "2100-01-04" },
    { kind: "unknown", seasonStart: "2026-07-13" },
    Object.assign(Object.create({ inherited: true }), {
      kind: "refresh_community_season",
      seasonStart: "2026-07-13",
    }),
  ])("rejects an invalid job before opening a connection", async (input) => {
    const fixture = createPoolFixture([{ profile_count: 1 }]);
    const runner = createCommunityMaintenanceRunner(fixture.pool);

    await expectMaintenanceError(runner.execute(input), "job_invalid");
    expect(fixture.connect).not.toHaveBeenCalled();
  });

  it("does not invoke input accessors and contains proxy traps", async () => {
    let getterCalls = 0;
    const accessorInput = { batchSize: 1 };
    Object.defineProperty(accessorInput, "kind", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "cleanup_expired_ingest_state";
      },
    });
    const proxyInput = new Proxy(
      { batchSize: 1, kind: "cleanup_expired_ingest_state" },
      {
        getPrototypeOf() {
          throw new Error(privateDetail);
        },
      },
    );
    const fixture = createPoolFixture([
      { deleted_nonces: 0, deleted_origin_nonces: 0, deleted_snapshots: 0 },
    ]);
    const runner = createCommunityMaintenanceRunner(fixture.pool);

    await expectMaintenanceError(runner.execute(accessorInput), "job_invalid");
    await expectMaintenanceError(runner.execute(proxyInput), "job_invalid");
    expect(getterCalls).toBe(0);
    expect(fixture.connect).not.toHaveBeenCalled();
  });

  it.each([
    { rows: [] },
    { rows: [{ login_scope_ok: true, role_ok: false, search_path_ok: true }] },
    { rows: [{ extra: true, login_scope_ok: true, role_ok: true, search_path_ok: true }] },
    { rows: [{ login_scope_ok: true, role_ok: true }] },
  ])("rejects a malformed or false runtime boundary and destroys the client", async ({ rows }) => {
    const fixture = createPoolFixture([{ profile_count: 1 }]);
    fixture.verifyRuntimeBoundary.mockResolvedValueOnce(rows);
    const runner = createCommunityMaintenanceRunner(fixture.pool);

    await expectMaintenanceError(
      runner.execute({ kind: "refresh_community_season", seasonStart: "2026-07-13" }),
      "runtime_boundary_mismatch",
    );
    expect(fixture.verifyRuntimeBoundary).toHaveBeenCalledOnce();
    expect(fixture.refreshCommunitySeason).not.toHaveBeenCalled();
    expect(fixture.release).toHaveBeenCalledWith(true);
  });

  it("rejects accessor-backed runtime rows without invoking the accessor", async () => {
    let getterCalls = 0;
    const row = { login_scope_ok: true, search_path_ok: true };
    Object.defineProperty(row, "role_ok", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return true;
      },
    });
    const fixture = createPoolFixture([{ profile_count: 1 }]);
    fixture.verifyRuntimeBoundary.mockResolvedValueOnce([row]);

    await expectMaintenanceError(
      createCommunityMaintenanceRunner(fixture.pool).execute({
        kind: "refresh_community_season",
        seasonStart: "2026-07-13",
      }),
      "runtime_boundary_mismatch",
    );
    expect(getterCalls).toBe(0);
  });

  it.each([
    { cleanup: false, rows: [] },
    { cleanup: false, rows: [{ profile_count: -1 }] },
    { cleanup: false, rows: [{ profile_count: 2_147_483_648 }] },
    { cleanup: false, rows: [{ profile_count: "1" }] },
    { cleanup: false, rows: [{ extra: true, profile_count: 1 }] },
    { cleanup: true, rows: [{ deleted_nonces: 2, deleted_snapshots: 0 }] },
    { cleanup: "pairing", rows: [{ deleted_pairings: 1 }] },
  ])("rejects invalid fixed result shapes", async ({ cleanup, rows }) => {
    const fixture = createPoolFixture(rows);
    const job: CommunityMaintenanceJob =
      cleanup === "pairing"
        ? { batchSize: 1, kind: "cleanup_expired_pairing_state" }
        : cleanup
          ? { batchSize: 1, kind: "cleanup_expired_ingest_state" }
          : { kind: "refresh_community_season", seasonStart: "2026-07-13" };

    await expectMaintenanceError(
      createCommunityMaintenanceRunner(fixture.pool).execute(job),
      "result_invalid",
    );
    expect(fixture.release).toHaveBeenCalledWith(true);
  });

  it("rejects sparse arrays, row accessors, and hostile result proxies", async () => {
    const sparse = new Array(1);
    let getterCalls = 0;
    const row = {};
    Object.defineProperty(row, "profile_count", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 1;
      },
    });
    const proxy = new Proxy([{ profile_count: 1 }], {
      ownKeys() {
        throw new Error(privateDetail);
      },
    });

    for (const result of [sparse, [row], proxy]) {
      const fixture = createPoolFixture(result);
      await expectMaintenanceError(
        createCommunityMaintenanceRunner(fixture.pool).execute({
          kind: "refresh_community_season",
          seasonStart: "2026-07-13",
        }),
        "result_invalid",
      );
    }
    expect(getterCalls).toBe(0);
  });

  it.each([
    { deleted_nonces: 2, deleted_origin_nonces: 0, deleted_snapshots: 0 },
    { deleted_nonces: 0, deleted_origin_nonces: 2, deleted_snapshots: 0 },
    { deleted_nonces: 0, deleted_origin_nonces: 0, deleted_snapshots: 2 },
  ])("bounds every cleanup result count to the requested batch", async (row) => {
    const fixture = createPoolFixture([row]);
    await expectMaintenanceError(
      createCommunityMaintenanceRunner(fixture.pool).execute({
        batchSize: 1,
        kind: "cleanup_expired_ingest_state",
      }),
      "result_invalid",
    );
  });

  it.each([
    { batchSize: 1, row: { deleted_pairings: 2, deleted_pending_keys: 0 } },
    { batchSize: 1, row: { deleted_pairings: 0, deleted_pending_keys: 2 } },
    { batchSize: 2, row: { deleted_pairings: 1, deleted_pending_keys: 0 } },
    { batchSize: 2, row: { deleted_pairings: 0, deleted_pending_keys: 1 } },
  ])("bounds and correlates pairing cleanup result counts", async ({ batchSize, row }) => {
    const fixture = createPoolFixture([row]);
    await expectMaintenanceError(
      createCommunityMaintenanceRunner(fixture.pool).execute({
        batchSize,
        kind: "cleanup_expired_pairing_state",
      }),
      "result_invalid",
    );
  });

  it("translates connection and query failures without reflecting details", async () => {
    const connectFailure = createPoolFixture([{ profile_count: 1 }]);
    connectFailure.connect.mockRejectedValueOnce(new Error(privateDetail));
    await expectMaintenanceError(
      createCommunityMaintenanceRunner(connectFailure.pool).execute({
        kind: "refresh_community_season",
        seasonStart: "2026-07-13",
      }),
      "connection_unavailable",
    );

    for (const failingQueryIndex of [1, 2]) {
      const fixture = createPoolFixture([{ profile_count: 1 }]);
      if (failingQueryIndex === 1) {
        fixture.verifyRuntimeBoundary.mockRejectedValueOnce(new Error(privateDetail));
      } else {
        fixture.refreshCommunitySeason.mockRejectedValueOnce(new Error(privateDetail));
      }
      await expectMaintenanceError(
        createCommunityMaintenanceRunner(fixture.pool).execute({
          kind: "refresh_community_season",
          seasonStart: "2026-07-13",
        }),
        "query_failed",
      );
      expect(fixture.release).toHaveBeenCalledWith(true);
    }
  });

  it("holds the client until the capability query settles", async () => {
    let resolveRows: ((value: unknown) => void) | undefined;
    const deferredRows = new Promise<unknown>((resolve) => {
      resolveRows = resolve;
    });
    const fixture = createPoolFixture([{ profile_count: 1 }]);
    fixture.refreshCommunitySeason.mockReturnValueOnce(deferredRows);
    const pending = createCommunityMaintenanceRunner(fixture.pool).execute({
      kind: "refresh_community_season",
      seasonStart: "2026-07-13",
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(fixture.release).not.toHaveBeenCalled();
    resolveRows?.([{ profile_count: 1 }]);
    await expect(pending).resolves.toEqual({
      kind: "refresh_community_season",
      profileCount: 1,
    });
    expect(fixture.release).toHaveBeenCalledWith(false);
  });

  it("fails closed when releasing either a healthy or failed client throws", async () => {
    for (const queryFails of [false, true]) {
      const fixture = createPoolFixture([{ profile_count: 1 }]);
      if (queryFails) {
        fixture.refreshCommunitySeason.mockRejectedValueOnce(new Error(privateDetail));
      }
      fixture.release.mockImplementation(() => {
        throw new Error(privateDetail);
      });
      await expectMaintenanceError(
        createCommunityMaintenanceRunner(fixture.pool).execute({
          kind: "refresh_community_season",
          seasonStart: "2026-07-13",
        }),
        "connection_release_failed",
      );
    }
  });

  it("closes a configured boundary and translates close failure", async () => {
    const fixture = createPoolFixture([{ profile_count: 1 }]);
    const runner = createCloseableCommunityMaintenanceRunner(fixture.pool);
    await expect(
      runner.execute({ kind: "refresh_community_season", seasonStart: "2026-07-13" }),
    ).resolves.toEqual({ kind: "refresh_community_season", profileCount: 1 });
    await runner.close();
    expect(fixture.close).toHaveBeenCalledOnce();

    fixture.close.mockRejectedValueOnce(new Error(privateDetail));
    await expectMaintenanceError(runner.close(), "pool_close_failed");
  });

  it("can construct and close the configured pool without opening a connection", async () => {
    const runner = createConfiguredCommunityMaintenanceRunner({
      NODE_ENV: "test",
      VIBERACING_JOBS_DATABASE_HOST: "127.0.0.1",
      VIBERACING_JOBS_DATABASE_NAME: "viberacing_local",
      VIBERACING_JOBS_DATABASE_PASSWORD: "private-test-password-value",
      VIBERACING_JOBS_DATABASE_PORT: "54329",
      VIBERACING_JOBS_DATABASE_TLS_MODE: "disable",
      VIBERACING_JOBS_DATABASE_USER: "viberacing_jobs_login",
    });

    await expect(runner.close()).resolves.toBeUndefined();
  });
});
