/* eslint-disable @typescript-eslint/unbound-method -- Vitest inspects injected database spies. */

import { describe, expect, it, vi } from "vitest";

import type { JobsDatabaseClient, JobsDatabasePool } from "./database-pool.js";
import {
  createCloseableJobsMaintenanceRunner,
  createConfiguredJobsMaintenanceRunner,
  createJobsMaintenanceRunner,
  JobsMaintenanceError,
  maximumCleanupBatchSize,
  maximumProfileDeletionPurgeBatchSize,
} from "./maintenance.js";

const boundary = [
  {
    login_scope_ok: true,
    read_write_ok: true,
    role_ok: true,
    search_path_ok: true,
  },
];

function clientFixture(overrides: Partial<JobsDatabaseClient> = {}): JobsDatabaseClient {
  return {
    cleanupAgedRevokedAuthority: vi.fn(() =>
      Promise.resolve([
        {
          deleted_device_keys: 1,
          deleted_installations: 1,
          deleted_passkeys: 1,
          redacted_pairings: 1,
        },
      ]),
    ),
    cleanupExpiredAuthState: vi.fn(() =>
      Promise.resolve([
        {
          deleted_challenges: 1,
          deleted_invites: 1,
          deleted_recovery_codes: 1,
          deleted_sessions: 1,
        },
      ]),
    ),
    cleanupExpiredPairingState: vi.fn(() =>
      Promise.resolve([{ deleted_accounts: 2, deleted_installations: 1, deleted_pairings: 1 }]),
    ),
    cleanupExpiredAuditEvents: vi.fn(() =>
      Promise.resolve([{ deleted_admin_audit_events: 0, deleted_ranking_events: 1 }]),
    ),
    cleanupExpiredUsageHistory: vi.fn(() =>
      Promise.resolve([
        {
          deleted_idempotency_records: 1,
          deleted_observations: 1,
          redacted_day_totals: 2,
        },
      ]),
    ),
    cleanupExpiredUsageNonces: vi.fn(() =>
      Promise.resolve([{ deleted_device_nonces: 1, deleted_origin_nonces: 1 }]),
    ),
    cleanupSnapshotHistory: vi.fn(() => Promise.resolve([{ deleted_snapshots: 1 }])),
    cleanupTerminalDeletionJobs: vi.fn(() => Promise.resolve([{ deleted_deletion_jobs: 1 }])),
    ensureCurrentSeason: vi.fn(() => Promise.resolve([{ season_start: "2026-07-27" }])),
    finalizeDueSeason: vi.fn(() =>
      Promise.resolve([
        {
          outcome: "finalized",
          season_start: "2026-07-13",
          snapshot_id: "snp_AAAAAAAAAAAAAAAAAAAAAA",
        },
      ]),
    ),
    purgeProfileDeletions: vi.fn(() => Promise.resolve([{ purged_profiles: 1 }])),
    refreshDirtyLeaderboard: vi.fn(() =>
      Promise.resolve([
        {
          outcome: "published",
          season_start: "2026-07-27",
          snapshot_id: "snp_BBBBBBBBBBBBBBBBBBBBBB",
        },
      ]),
    ),
    release: vi.fn(),
    resetExpiredPairingRequestWindows: vi.fn(() => Promise.resolve([{ reset_windows: 1 }])),
    verifyRuntimeBoundary: vi.fn(() => Promise.resolve(boundary)),
    ...overrides,
  };
}

function poolFixture(client = clientFixture()): JobsDatabasePool & {
  close: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
} {
  return {
    close: vi.fn(() => Promise.resolve()),
    connect: vi.fn(() => Promise.resolve(client)),
  };
}

describe("Jobs maintenance runner", () => {
  it("executes and validates the exact thirteen-capability clean catalog", async () => {
    const client = clientFixture();
    const pool = poolFixture(client);
    const runner = createJobsMaintenanceRunner(pool);
    const jobs = [
      Object.freeze({ kind: "ensure_current_season" as const }),
      Object.freeze({ kind: "refresh_dirty_leaderboard" as const }),
      Object.freeze({ kind: "finalize_due_season" as const }),
      Object.freeze({
        batchSize: maximumCleanupBatchSize,
        kind: "cleanup_expired_audit_events" as const,
      }),
      Object.freeze({
        batchSize: maximumCleanupBatchSize,
        kind: "cleanup_expired_usage_nonces" as const,
      }),
      Object.freeze({
        batchSize: maximumCleanupBatchSize,
        kind: "cleanup_expired_usage_history" as const,
      }),
      Object.freeze({
        batchSize: maximumCleanupBatchSize,
        kind: "cleanup_expired_pairing_state" as const,
      }),
      Object.freeze({
        batchSize: maximumCleanupBatchSize,
        kind: "cleanup_expired_auth_state" as const,
      }),
      Object.freeze({
        batchSize: maximumCleanupBatchSize,
        kind: "cleanup_aged_revoked_authority" as const,
      }),
      Object.freeze({
        batchSize: maximumCleanupBatchSize,
        kind: "cleanup_snapshot_history" as const,
      }),
      Object.freeze({
        batchSize: maximumProfileDeletionPurgeBatchSize,
        kind: "purge_profile_deletions" as const,
      }),
      Object.freeze({
        batchSize: maximumCleanupBatchSize,
        kind: "cleanup_terminal_deletion_jobs" as const,
      }),
      Object.freeze({ kind: "reset_expired_pairing_request_windows" as const }),
    ];

    const results = [];
    for (const job of jobs) {
      results.push(await runner.execute(job));
    }

    expect(results).toEqual([
      { kind: "ensure_current_season", outcome: "ensured" },
      { kind: "refresh_dirty_leaderboard", outcome: "published" },
      { kind: "finalize_due_season", outcome: "finalized" },
      { affectedCount: 1, kind: "cleanup_expired_audit_events" },
      { affectedCount: 2, kind: "cleanup_expired_usage_nonces" },
      { affectedCount: 4, kind: "cleanup_expired_usage_history" },
      { affectedCount: 4, kind: "cleanup_expired_pairing_state" },
      { affectedCount: 4, kind: "cleanup_expired_auth_state" },
      { affectedCount: 4, kind: "cleanup_aged_revoked_authority" },
      { affectedCount: 1, kind: "cleanup_snapshot_history" },
      { affectedCount: 1, kind: "purge_profile_deletions" },
      { affectedCount: 1, kind: "cleanup_terminal_deletion_jobs" },
      { affectedCount: 1, kind: "reset_expired_pairing_request_windows" },
    ]);
    expect(pool.connect).toHaveBeenCalledTimes(13);
    expect(client.verifyRuntimeBoundary).toHaveBeenCalledTimes(13);
    expect(client.release).toHaveBeenCalledTimes(13);
    expect(client.release).toHaveBeenCalledWith(false);
  });

  it.each([
    [
      "ensure_current_season",
      { ensureCurrentSeason: vi.fn(() => Promise.resolve([{ season_start: null }])) },
      "busy",
    ],
    [
      "refresh_dirty_leaderboard",
      {
        refreshDirtyLeaderboard: vi.fn(() =>
          Promise.resolve([{ outcome: "idle", season_start: null, snapshot_id: null }]),
        ),
      },
      "idle",
    ],
    [
      "refresh_dirty_leaderboard",
      {
        refreshDirtyLeaderboard: vi.fn(() =>
          Promise.resolve([
            {
              outcome: "retry_scheduled",
              season_start: "2026-07-27",
              snapshot_id: null,
            },
          ]),
        ),
      },
      "retry_scheduled",
    ],
    [
      "finalize_due_season",
      {
        finalizeDueSeason: vi.fn(() =>
          Promise.resolve([
            { outcome: "needs_refresh", season_start: "2026-07-13", snapshot_id: null },
          ]),
        ),
      },
      "needs_refresh",
    ],
    [
      "finalize_due_season",
      {
        finalizeDueSeason: vi.fn(() =>
          Promise.resolve([{ outcome: "idle", season_start: null, snapshot_id: null }]),
        ),
      },
      "idle",
    ],
  ] as const)("maps closed no-work and retry outcomes for %s", async (kind, overrides, outcome) => {
    const runner = createJobsMaintenanceRunner(poolFixture(clientFixture(overrides)));
    await expect(runner.execute(Object.freeze({ kind }))).resolves.toEqual({ kind, outcome });
  });

  it.each([
    {},
    { kind: "unknown" },
    { kind: "refresh_dirty_leaderboard", extra: true },
    { batchSize: 0, kind: "cleanup_expired_usage_nonces" },
    { batchSize: 1001, kind: "cleanup_expired_usage_nonces" },
    { batchSize: 11, kind: "purge_profile_deletions" },
    { batchSize: 1.5, kind: "cleanup_expired_auth_state" },
  ])("rejects invalid or mutable jobs before connecting: %o", async (job) => {
    const pool = poolFixture();
    const runner = createJobsMaintenanceRunner(pool);
    await expect(runner.execute(job)).rejects.toThrow(
      expect.objectContaining({ code: "input_invalid" }),
    );
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it.each([
    null,
    Object.freeze({ extra: true, kind: "ensure_current_season" }),
    Object.freeze({ kind: "unknown" }),
    Object.freeze({
      batchSize: maximumCleanupBatchSize,
      extra: true,
      kind: "cleanup_expired_usage_nonces",
    }),
    Object.freeze({ batchSize: 0, kind: "cleanup_expired_usage_nonces" }),
  ])("rejects each closed frozen-job shape branch before connecting: %o", async (job) => {
    const pool = poolFixture();
    const runner = createJobsMaintenanceRunner(pool);
    await expect(runner.execute(job)).rejects.toThrow(
      expect.objectContaining({ code: "input_invalid" }),
    );
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("rejects accessor, prototype, and reflection traps without evaluating values", async () => {
    let getterCalls = 0;
    const accessor = Object.freeze(
      Object.defineProperty({}, "kind", {
        enumerable: true,
        get() {
          getterCalls += 1;
          return "ensure_current_season";
        },
      }),
    );
    const trapped = new Proxy(Object.freeze({ kind: "ensure_current_season" }), {
      ownKeys() {
        throw new Error("private");
      },
    });
    const wrongPrototype = Object.freeze(
      new (class {
        readonly kind = "ensure_current_season";
      })(),
    );
    const runner = createJobsMaintenanceRunner(poolFixture());
    for (const job of [accessor, trapped, wrongPrototype]) {
      await expect(runner.execute(job)).rejects.toThrow(JobsMaintenanceError);
    }
    expect(getterCalls).toBe(0);
  });

  it.each([
    [
      { ensureCurrentSeason: vi.fn(() => Promise.resolve([{ season_start: "2026-02-30" }])) },
      { kind: "ensure_current_season" },
    ],
    [
      { ensureCurrentSeason: vi.fn(() => Promise.resolve([{ season_start: 1 }])) },
      { kind: "ensure_current_season" },
    ],
    [
      {
        refreshDirtyLeaderboard: vi.fn(() =>
          Promise.resolve([
            { outcome: "published", season_start: "2026-07-27", snapshot_id: null },
          ]),
        ),
      },
      { kind: "refresh_dirty_leaderboard" },
    ],
    [
      {
        cleanupExpiredUsageNonces: vi.fn(() =>
          Promise.resolve([{ deleted_device_nonces: -1, deleted_origin_nonces: 0 }]),
        ),
      },
      { batchSize: 1000, kind: "cleanup_expired_usage_nonces" },
    ],
    [
      {
        cleanupExpiredUsageNonces: vi.fn(() =>
          Promise.resolve([{ deleted_device_nonces: 0, deleted_origin_nonces: 0, extra: true }]),
        ),
      },
      { batchSize: 1000, kind: "cleanup_expired_usage_nonces" },
    ],
    [
      {
        cleanupExpiredAuditEvents: vi.fn(() =>
          Promise.resolve([{ deleted_admin_audit_events: 500, deleted_ranking_events: 501 }]),
        ),
      },
      { batchSize: 1000, kind: "cleanup_expired_audit_events" },
    ],
    [
      {
        finalizeDueSeason: vi.fn(() =>
          Promise.resolve([
            {
              outcome: "finalized",
              season_start: "2026-07-13",
              snapshot_id: null,
            },
          ]),
        ),
      },
      { kind: "finalize_due_season" },
    ],
    [{ ensureCurrentSeason: vi.fn(() => Promise.resolve([])) }, { kind: "ensure_current_season" }],
  ] as const)("destroys the client for malformed database results", async (overrides, job) => {
    const client = clientFixture(overrides);
    const runner = createJobsMaintenanceRunner(poolFixture(client));
    await expect(runner.execute(Object.freeze(job))).rejects.toThrow(
      expect.objectContaining({ code: "result_invalid" }),
    );
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it("contains boundary, query, connection, and release failures", async () => {
    const boundaryClient = clientFixture({
      verifyRuntimeBoundary: vi.fn(() =>
        Promise.resolve([{ ...boundary[0], login_scope_ok: false }]),
      ),
    });
    await expect(
      createJobsMaintenanceRunner(poolFixture(boundaryClient)).execute(
        Object.freeze({ kind: "ensure_current_season" }),
      ),
    ).rejects.toThrow(expect.objectContaining({ code: "runtime_boundary_mismatch" }));
    expect(boundaryClient.release).toHaveBeenCalledWith(true);

    const malformedBoundaryClient = clientFixture({
      verifyRuntimeBoundary: vi.fn(() => Promise.resolve([])),
    });
    await expect(
      createJobsMaintenanceRunner(poolFixture(malformedBoundaryClient)).execute(
        Object.freeze({ kind: "ensure_current_season" }),
      ),
    ).rejects.toThrow(expect.objectContaining({ code: "runtime_boundary_mismatch" }));
    expect(malformedBoundaryClient.release).toHaveBeenCalledWith(true);

    const queryClient = clientFixture({
      ensureCurrentSeason: vi.fn(() => Promise.reject(new Error("private query"))),
    });
    await expect(
      createJobsMaintenanceRunner(poolFixture(queryClient)).execute(
        Object.freeze({ kind: "ensure_current_season" }),
      ),
    ).rejects.toThrow(expect.objectContaining({ code: "query_failed" }));

    const unavailable = poolFixture();
    unavailable.connect.mockRejectedValueOnce(new Error("private connection"));
    await expect(
      createJobsMaintenanceRunner(unavailable).execute(
        Object.freeze({ kind: "ensure_current_season" }),
      ),
    ).rejects.toThrow(expect.objectContaining({ code: "connection_unavailable" }));

    const releaseClient = clientFixture({
      release: vi.fn(() => {
        throw new Error("private release");
      }),
    });
    await expect(
      createJobsMaintenanceRunner(poolFixture(releaseClient)).execute(
        Object.freeze({ kind: "ensure_current_season" }),
      ),
    ).rejects.toThrow(expect.objectContaining({ code: "connection_release_failed" }));
  });

  it("closes configured pools and contains close failures", async () => {
    const pool = poolFixture();
    const runner = createCloseableJobsMaintenanceRunner(pool);
    await expect(runner.execute(Object.freeze({ kind: "ensure_current_season" }))).resolves.toEqual(
      { kind: "ensure_current_season", outcome: "ensured" },
    );
    await expect(runner.close()).resolves.toBeUndefined();
    expect(pool.close).toHaveBeenCalledOnce();

    pool.close.mockRejectedValueOnce(new Error("private close"));
    await expect(runner.close()).rejects.toThrow(
      expect.objectContaining({ code: "pool_close_failed" }),
    );
    expect(() => createConfiguredJobsMaintenanceRunner({})).toThrow();
  });
});
