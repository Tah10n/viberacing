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
    await expect(client.cleanupExpiredIngestState(8)).resolves.toEqual([{ value: 1 }]);
    await expect(client.cleanupExpiredPairingState(9)).resolves.toEqual([{ value: 1 }]);
    await expect(client.cleanupExpiredSessions(10)).resolves.toEqual([{ value: 1 }]);
    await expect(client.purgeProfileDeletions(10)).resolves.toEqual([{ value: 1 }]);
    await expect(client.refreshCommunitySeason("2026-07-13")).resolves.toEqual([{ value: 1 }]);
    await expect(client.finalizeCommunitySeason("2026-07-06")).resolves.toEqual([{ value: 1 }]);
    expect(client).not.toHaveProperty("query");
    expect(query).toHaveBeenCalledTimes(9);
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
      "viberacing_api.cleanup_expired_ingest_state($1::integer)",
    );
    expect(query.mock.calls[3]![0].text).toContain(
      "cleanup.deleted_origin_nonces AS deleted_origin_nonces",
    );
    expect(query.mock.calls[4]![0]).toMatchObject({ values: [9] });
    expect(query.mock.calls[4]![0].text).toContain(
      "viberacing_api.cleanup_expired_pairing_state($1::integer)",
    );
    expect(query.mock.calls[4]![0].text).toContain(
      "cleanup.deleted_pending_keys AS deleted_pending_keys",
    );
    expect(query.mock.calls[5]![0]).toMatchObject({ values: [10] });
    expect(query.mock.calls[5]![0].text).toContain(
      "viberacing_api.cleanup_expired_sessions($1::integer)",
    );
    expect(query.mock.calls[5]![0].text).toContain("cleanup.deleted_sessions AS deleted_sessions");
    expect(query.mock.calls[6]![0]).toMatchObject({ values: [10] });
    expect(query.mock.calls[6]![0].text).toContain(
      "viberacing_api.purge_profile_deletions($1::integer)",
    );
    expect(query.mock.calls[6]![0].text).toContain("purge.purged_profiles AS purged_profiles");
    expect(query.mock.calls[7]![0]).toMatchObject({ values: ["2026-07-13"] });
    expect(query.mock.calls[7]![0].text).toContain(
      "viberacing_api.refresh_community_season($1::date)",
    );
    expect(query.mock.calls[8]![0]).toMatchObject({ values: ["2026-07-06"] });
    expect(query.mock.calls[8]![0].text).toContain(
      "viberacing_api.finalize_community_season($1::date)",
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
