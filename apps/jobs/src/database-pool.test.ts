import { describe, expect, it, vi } from "vitest";

import { resolveJobsDatabaseConfig } from "./database-config.js";
import { createJobsDatabasePool } from "./database-pool.js";

const config = resolveJobsDatabaseConfig({
  NODE_ENV: "test",
  VIBERACING_JOBS_DATABASE_HOST: "127.0.0.1",
  VIBERACING_JOBS_DATABASE_NAME: "viberacing_local",
  VIBERACING_JOBS_DATABASE_PASSWORD: "private-test-password-value",
  VIBERACING_JOBS_DATABASE_PORT: "54329",
  VIBERACING_JOBS_DATABASE_TLS_MODE: "disable",
  VIBERACING_JOBS_DATABASE_USER: "viberacing_jobs_login",
});

describe("Jobs database pool", () => {
  it("exposes only the thirteen structured clean-schema capabilities", async () => {
    const query = vi.fn((structuredQuery: { text: string; values: unknown[] }) => {
      void structuredQuery;
      return Promise.resolve({ rows: [{ value: 1 }] });
    });
    const release = vi.fn();
    const end = vi.fn(() => Promise.resolve());
    let errorListener: ((error: Error) => void) | undefined;
    const nodePool = {
      connect: vi.fn(() => Promise.resolve({ query, release })),
      end,
      on: vi.fn((event: "error", listener: (error: Error) => void) => {
        expect(event).toBe("error");
        errorListener = listener;
        return nodePool;
      }),
    };
    const factory = vi.fn(() => nodePool);
    const signal = vi.fn();
    const pool = createJobsDatabasePool(config, signal, factory);
    const client = await pool.connect();

    await client.verifyRuntimeBoundary();
    await client.ensureCurrentSeason();
    await client.refreshDirtyLeaderboard();
    await client.finalizeDueSeason();
    await client.cleanupExpiredAuditEvents(1);
    await client.cleanupExpiredUsageNonces(2);
    await client.cleanupExpiredUsageHistory(3);
    await client.cleanupExpiredPairingState(4);
    await client.cleanupExpiredAuthState(5);
    await client.cleanupAgedRevokedAuthority(6);
    await client.cleanupSnapshotHistory(7);
    await client.purgeProfileDeletions(8);
    await client.cleanupTerminalDeletionJobs(9);
    await client.resetExpiredPairingRequestWindows();

    expect(client).not.toHaveProperty("query");
    expect(query).toHaveBeenCalledTimes(14);
    const calls = query.mock.calls.map(([structured]) => structured);
    expect(calls[0]).toMatchObject({ values: [] });
    expect(calls[0]?.text).toContain("CURRENT_USER = 'viberacing_jobs'");
    expect(calls[0]?.text).toContain("default_transaction_read_only");
    expect(calls.slice(1).map(({ values }) => values)).toEqual([
      [],
      [],
      [],
      [1],
      [2],
      [3],
      [4],
      [5],
      [6],
      [7],
      [8],
      [9],
      [],
    ]);
    const sql = calls
      .slice(1)
      .map(({ text }) => text)
      .join("\n");
    for (const capability of [
      "ensure_current_community_season()",
      "refresh_next_dirty_community_season()",
      "finalize_next_due_community_season()",
      "cleanup_expired_audit_events($1::integer)",
      "cleanup_expired_usage_nonces($1::integer)",
      "cleanup_expired_usage_history($1::integer)",
      "cleanup_expired_pairing_state($1::integer)",
      "cleanup_expired_auth_state($1::integer)",
      "cleanup_aged_revoked_authority($1::integer)",
      "cleanup_snapshot_history($1::integer)",
      "purge_profile_deletions($1::integer)",
      "cleanup_terminal_deletion_jobs($1::integer)",
      "reset_expired_pairing_request_windows()",
    ]) {
      expect(sql).toContain(`viberacing_api.${capability}`);
    }

    client.release(true);
    expect(release).toHaveBeenCalledWith(true);
    errorListener?.(new Error("private driver detail"));
    expect(signal).toHaveBeenCalledWith("idle_client_error");
    await pool.close();
    expect(end).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith(config);
  });

  it("contains synchronous and asynchronous monitoring sink failures", async () => {
    const listeners: ((error: Error) => void)[] = [];
    const nodePool = {
      connect: vi.fn(() => Promise.reject(new Error("unused"))),
      end: vi.fn(() => Promise.resolve()),
      on: vi.fn((event: "error", listener: (error: Error) => void) => {
        expect(event).toBe("error");
        listeners.push(listener);
        return nodePool;
      }),
    };

    createJobsDatabasePool(
      config,
      () => {
        throw new Error("sink failed");
      },
      () => nodePool,
    );
    createJobsDatabasePool(
      config,
      () => Promise.reject(new Error("async sink failed")),
      () => nodePool,
    );
    createJobsDatabasePool(config, undefined, () => nodePool);

    expect(() => {
      for (const listener of listeners) {
        listener(new Error("idle failure"));
      }
    }).not.toThrow();
    await Promise.resolve();
  });

  it("forwards connection and close failures to the caller", async () => {
    const failure = new Error("private pool detail");
    const nodePool = {
      connect: vi.fn(() => Promise.reject(failure)),
      end: vi.fn(() => Promise.reject(failure)),
      on: vi.fn(() => nodePool),
    };
    const pool = createJobsDatabasePool(config, undefined, () => nodePool);

    await expect(pool.connect()).rejects.toBe(failure);
    await expect(pool.close()).rejects.toBe(failure);
  });
});
