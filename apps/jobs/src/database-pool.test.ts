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
  it("passes only structured queries, forwards destroy release, and closes the pool", async () => {
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

    await expect(client.verifyRuntimeBoundary()).resolves.toEqual([{ value: 1 }]);
    await expect(client.cleanupExpiredAuthState(6)).resolves.toEqual([{ value: 1 }]);
    await expect(client.cleanupExpiredCarRecipeProposals(7)).resolves.toEqual([{ value: 1 }]);
    await expect(client.cleanupExpiredInvites(8)).resolves.toEqual([{ value: 1 }]);
    await expect(client.cleanupExpiredIngestState(9)).resolves.toEqual([{ value: 1 }]);
    await expect(client.cleanupExpiredPairingState(10)).resolves.toEqual([{ value: 1 }]);
    await expect(client.cleanupExpiredSessions(11)).resolves.toEqual([{ value: 1 }]);
    await expect(client.cleanupTerminalDeletionJobs(12)).resolves.toEqual([{ value: 1 }]);
    await expect(client.purgeProfileDeletions(10)).resolves.toEqual([{ value: 1 }]);
    await expect(client.refreshCommunitySeason("2026-07-13")).resolves.toEqual([{ value: 1 }]);
    await expect(client.finalizeCommunitySeason("2026-07-06")).resolves.toEqual([{ value: 1 }]);
    await expect(client.cleanupExpiredAuditEvents(13)).resolves.toEqual([{ value: 1 }]);
    await expect(client.redactAgedPairingApprovalProvenance(14)).resolves.toEqual([{ value: 1 }]);
    await expect(client.cleanupAgedRevokedPasskeys(15)).resolves.toEqual([{ value: 1 }]);
    await expect(client.cleanupAgedRevokedDevices(16)).resolves.toEqual([{ value: 1 }]);
    await expect(client.resetExpiredPairingRequestWindows()).resolves.toEqual([{ value: 1 }]);
    await expect(client.cleanupAbandonedEnrollments(17)).resolves.toEqual([{ value: 1 }]);
    await expect(client.cleanupFinalizedSourceDayValues(18)).resolves.toEqual([{ value: 1 }]);
    expect(client).not.toHaveProperty("query");
    expect(query).toHaveBeenCalledTimes(18);
    expect(query.mock.calls[0]![0]).toMatchObject({ values: [] });
    expect(query.mock.calls[0]![0].text).toContain("CURRENT_USER = 'viberacing_jobs'");
    expect(query.mock.calls[1]![0]).toMatchObject({ values: [6] });
    expect(query.mock.calls[1]![0].text).toContain(
      "viberacing_api.cleanup_expired_auth_state($1::integer)",
    );
    expect(query.mock.calls[1]![0].text).toContain(
      "cleanup.deleted_used_recovery_codes AS deleted_used_recovery_codes",
    );
    expect(query.mock.calls[2]![0]).toMatchObject({ values: [7] });
    expect(query.mock.calls[2]![0].text).toContain(
      "viberacing_api.cleanup_expired_car_recipe_proposals($1::integer)",
    );
    expect(query.mock.calls[2]![0].text).toContain(
      "cleanup.deleted_proposals AS deleted_proposals",
    );
    expect(query.mock.calls[3]![0]).toMatchObject({ values: [8] });
    expect(query.mock.calls[3]![0].text).toContain(
      "viberacing_api.cleanup_expired_invites($1::integer)",
    );
    expect(query.mock.calls[3]![0].text).toContain("cleanup.deleted_invites AS deleted_invites");
    expect(query.mock.calls[4]![0]).toMatchObject({ values: [9] });
    expect(query.mock.calls[4]![0].text).toContain(
      "viberacing_api.cleanup_expired_ingest_state($1::integer)",
    );
    expect(query.mock.calls[4]![0].text).toContain(
      "cleanup.deleted_origin_nonces AS deleted_origin_nonces",
    );
    expect(query.mock.calls[5]![0]).toMatchObject({ values: [10] });
    expect(query.mock.calls[5]![0].text).toContain(
      "viberacing_api.cleanup_expired_pairing_state($1::integer)",
    );
    expect(query.mock.calls[5]![0].text).toContain(
      "cleanup.deleted_pending_keys AS deleted_pending_keys",
    );
    expect(query.mock.calls[6]![0]).toMatchObject({ values: [11] });
    expect(query.mock.calls[6]![0].text).toContain(
      "viberacing_api.cleanup_expired_sessions($1::integer)",
    );
    expect(query.mock.calls[6]![0].text).toContain("cleanup.deleted_sessions AS deleted_sessions");
    expect(query.mock.calls[7]![0]).toMatchObject({ values: [12] });
    expect(query.mock.calls[7]![0].text).toContain(
      "viberacing_api.cleanup_terminal_deletion_jobs($1::integer)",
    );
    expect(query.mock.calls[7]![0].text).toContain(
      "cleanup.deleted_deletion_jobs AS deleted_deletion_jobs",
    );
    expect(query.mock.calls[8]![0]).toMatchObject({ values: [10] });
    expect(query.mock.calls[8]![0].text).toContain(
      "viberacing_api.purge_profile_deletions($1::integer)",
    );
    expect(query.mock.calls[8]![0].text).toContain("purge.purged_profiles AS purged_profiles");
    expect(query.mock.calls[9]![0]).toMatchObject({ values: ["2026-07-13"] });
    expect(query.mock.calls[9]![0].text).toContain(
      "viberacing_api.refresh_community_season($1::date)",
    );
    expect(query.mock.calls[10]![0]).toMatchObject({ values: ["2026-07-06"] });
    expect(query.mock.calls[10]![0].text).toContain(
      "viberacing_api.finalize_community_season($1::date)",
    );
    expect(query.mock.calls[11]![0]).toMatchObject({ values: [13] });
    expect(query.mock.calls[11]![0].text).toContain(
      "viberacing_api.cleanup_expired_audit_events($1::integer)",
    );
    expect(query.mock.calls[11]![0].text).toContain(
      "cleanup.deleted_audit_events AS deleted_audit_events",
    );
    expect(query.mock.calls[12]![0]).toMatchObject({ values: [14] });
    expect(query.mock.calls[12]![0].text).toContain(
      "viberacing_api.redact_aged_pairing_approval_provenance($1::integer)",
    );
    expect(query.mock.calls[12]![0].text).toContain(
      "cleanup.redacted_pairings AS redacted_pairings",
    );
    expect(query.mock.calls[13]![0]).toMatchObject({ values: [15] });
    expect(query.mock.calls[13]![0].text).toContain(
      "viberacing_api.cleanup_aged_revoked_passkeys($1::integer)",
    );
    expect(query.mock.calls[13]![0].text).toContain("cleanup.deleted_passkeys AS deleted_passkeys");
    expect(query.mock.calls[14]![0]).toMatchObject({ values: [16] });
    expect(query.mock.calls[14]![0].text).toContain(
      "viberacing_api.cleanup_aged_revoked_devices($1::integer)",
    );
    expect(query.mock.calls[14]![0].text).toContain(
      "cleanup.deleted_device_keys AS deleted_device_keys",
    );
    expect(query.mock.calls[14]![0].text).toContain("cleanup.deleted_pairings AS deleted_pairings");
    expect(query.mock.calls[15]![0]).toMatchObject({ values: [] });
    expect(query.mock.calls[15]![0].text).toContain(
      "viberacing_api.reset_expired_pairing_request_windows()",
    );
    expect(query.mock.calls[15]![0].text).toContain("reset.reset_windows AS reset_windows");
    expect(query.mock.calls[16]![0]).toMatchObject({ values: [17] });
    expect(query.mock.calls[16]![0].text).toContain(
      "viberacing_api.cleanup_abandoned_enrollments($1::integer)",
    );
    expect(query.mock.calls[16]![0].text).toContain(
      "cleanup.deleted_enrollments AS deleted_enrollments",
    );
    expect(query.mock.calls[17]![0]).toMatchObject({ values: [18] });
    expect(query.mock.calls[17]![0].text).toContain(
      "viberacing_api.cleanup_finalized_source_day_values($1::integer)",
    );
    expect(query.mock.calls[17]![0].text).toContain(
      "cleanup.deleted_source_day_values AS deleted_source_day_values",
    );
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
