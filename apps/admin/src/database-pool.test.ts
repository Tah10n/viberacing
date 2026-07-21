import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import { resolveAdminDatabaseConfig } from "./database-config.js";
import { createAdminDatabasePool } from "./database-pool.js";

const config = resolveAdminDatabaseConfig({
  NODE_ENV: "test",
  VIBERACING_ADMIN_DATABASE_HOST: "127.0.0.1",
  VIBERACING_ADMIN_DATABASE_NAME: "viberacing_local",
  VIBERACING_ADMIN_DATABASE_PASSWORD: "private-admin-test-password",
  VIBERACING_ADMIN_DATABASE_PORT: "54329",
  VIBERACING_ADMIN_DATABASE_TLS_MODE: "disable",
  VIBERACING_ADMIN_DATABASE_USER: "viberacing_admin_login",
});

const inviteInput = Object.freeze({
  auditEventId: "00000000-0000-4000-8000-000000000202",
  expiresAt: new Date("2026-07-28T12:00:00.000Z"),
  inviteId: "00000000-0000-4000-8000-000000000201",
  reasonCode: "BETA_ADMISSION" as const,
  requestId: `req_${"A".repeat(22)}`,
  verifierDigest: Buffer.alloc(32, 0x41),
});

describe("Admin database pool", () => {
  it("exposes only the fixed probe and issuance query, clears its digest copy, and closes", async () => {
    const observedDigests: Buffer[] = [];
    const query = vi.fn((structuredQuery: { text: string; values: unknown[] }) => {
      const digest = structuredQuery.values[1];
      if (Buffer.isBuffer(digest)) {
        observedDigests.push(Buffer.from(digest));
      }
      return Promise.resolve({ rows: [{ issued: true }] });
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
    const pool = createAdminDatabasePool(config, signal, factory);
    const client = await pool.connect();

    await expect(client.verifyRuntimeBoundary()).resolves.toEqual([{ issued: true }]);
    await expect(client.issueInvite(inviteInput)).resolves.toEqual([{ issued: true }]);
    expect(client).not.toHaveProperty("query");
    expect(factory).toHaveBeenCalledWith(config);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]![0].values).toEqual(["viberacing_admin_login", false]);
    expect(query.mock.calls[0]![0].text).toContain("CURRENT_USER = 'viberacing_admin'");
    expect(query.mock.calls[0]![0].text).toContain("granted_role.rolname <> 'viberacing_admin'");
    expect(query.mock.calls[0]![0].text).toContain("pg_catalog.pg_stat_ssl");
    expect(query.mock.calls[0]![0].text).toContain("procedure.proname = 'issue_invite'");
    expect(query.mock.calls[0]![0].text).toContain("owner_role.rolname = 'viberacing_owner'");
    expect(query.mock.calls[0]![0].text).toContain("procedure.prosecdef");
    expect(query.mock.calls[0]![0].text).toContain(
      "procedure.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']::text[]",
    );
    expect(query.mock.calls[0]![0].text).toContain("namespace.nspname = 'viberacing_private'");
    expect(query.mock.calls[1]![0].text).toContain(
      "viberacing_api.issue_invite(\n    $1::uuid,\n    $2::bytea",
    );
    expect(query.mock.calls[1]![0].values).toHaveLength(6);
    expect(query.mock.calls[1]![0].values[0]).toBe(inviteInput.inviteId);
    expect(query.mock.calls[1]![0].values[1]).not.toBe(inviteInput.verifierDigest);
    expect(query.mock.calls[1]![0].values[2]).toBe(inviteInput.expiresAt);
    expect(query.mock.calls[1]![0].values.slice(3)).toEqual([
      inviteInput.auditEventId,
      inviteInput.requestId,
      "BETA_ADMISSION",
    ]);
    expect(observedDigests).toEqual([Buffer.alloc(32, 0x41)]);
    expect(query.mock.calls[1]![0].values[1]).toEqual(Buffer.alloc(32));
    expect(inviteInput.verifierDigest).toEqual(Buffer.alloc(32, 0x41));

    client.release(true);
    expect(release).toHaveBeenCalledWith(true);
    errorListener?.(new Error("private driver detail"));
    expect(signal).toHaveBeenCalledWith("idle_client_error");
    await pool.close();
    expect(end).toHaveBeenCalledOnce();
  });

  it("contains absent, throwing, and rejecting idle-error sinks", async () => {
    const listeners: ((error: Error) => void)[] = [];
    const createNodePool = () => {
      const nodePool = {
        connect: vi.fn(),
        end: vi.fn(() => Promise.resolve()),
        on: vi.fn((event: "error", listener: (error: Error) => void) => {
          expect(event).toBe("error");
          listeners.push(listener);
          return nodePool;
        }),
      };
      return nodePool;
    };
    const throwing = vi.fn(() => {
      throw new Error("private sink error");
    });
    const rejecting = vi.fn(() => {
      return Promise.reject(new Error("private async sink error"));
    });

    createAdminDatabasePool(config, undefined, createNodePool);
    createAdminDatabasePool(config, throwing, createNodePool);
    createAdminDatabasePool(config, rejecting, createNodePool);
    for (const listener of listeners) {
      expect(() => {
        listener(new Error("private driver error"));
      }).not.toThrow();
    }
    await Promise.resolve();
    expect(throwing).toHaveBeenCalledWith("idle_client_error");
    expect(rejecting).toHaveBeenCalledWith("idle_client_error");
  });

  it("constructs and closes the default driver pool without opening a connection", async () => {
    const pool = createAdminDatabasePool(config);
    await expect(pool.close()).resolves.toBeUndefined();
  });
});
