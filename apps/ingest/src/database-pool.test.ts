import { describe, expect, it, vi } from "vitest";

import { resolveIngestDatabaseConfig } from "./database-config.js";
import { createIngestDatabasePool, type IngestDatabaseUsageSubmission } from "./database-pool.js";

const config = resolveIngestDatabaseConfig({
  NODE_ENV: "test",
  VIBERACING_INGEST_DATABASE_HOST: "127.0.0.1",
  VIBERACING_INGEST_DATABASE_NAME: "viberacing_local",
  VIBERACING_INGEST_DATABASE_PASSWORD: "synthetic-ingest-password",
  VIBERACING_INGEST_DATABASE_PORT: "54329",
  VIBERACING_INGEST_DATABASE_TLS_MODE: "disable",
  VIBERACING_INGEST_DATABASE_USER: "viberacing_ingest_login",
});

const usageSubmission: IngestDatabaseUsageSubmission = {
  agentAccountId: "acc_BBBBBBBBBBBBBBBBBBBBBB",
  bodyDigest: Buffer.alloc(32, 5),
  clientVersion: "0.0.0",
  dailyTokenTotals: ["9007199254740993"],
  deviceId: "dev_AAAAAAAAAAAAAAAAAAAAAA",
  deviceKeyId: "key_CCCCCCCCCCCCCCCCCCCCCC",
  deviceNonceDigest: Buffer.alloc(32, 6),
  eventId: "evt_DDDDDDDDDDDDDDDDDDDDDD",
  observationId: "obs_EEEEEEEEEEEEEEEEEEEEEE",
  observedAt: "2026-07-15T12:00:00.000Z",
  originExpiresAt: "2026-07-15T12:01:00.000Z",
  originKeyId: "edge_primary",
  originNonceDigest: Buffer.alloc(32, 4),
  readerVersion: "codex_daily_usage_buckets_v1",
  signature: Buffer.alloc(64, 7),
  syncId: "syn_DDDDDDDDDDDDDDDDDDDDDD",
  usageDates: ["2026-07-14"],
};

describe("Ingest database pool", () => {
  it("exposes only fixed structured capabilities and copies binary and array parameters", async () => {
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
    const pool = createIngestDatabasePool(config, signal, factory);
    const client = await pool.connect();

    await expect(client.verifyRuntimeBoundary()).resolves.toEqual([{ value: 1 }]);
    await expect(client.readDeviceVerificationMaterial(usageSubmission.deviceId)).resolves.toEqual([
      { value: 1 },
    ]);
    await expect(client.submitUsageSync(usageSubmission)).resolves.toEqual([{ value: 1 }]);
    expect(client).not.toHaveProperty("query");
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0]![0]).toMatchObject({ values: [] });
    const boundaryQuery = query.mock.calls[0]![0].text;
    expect(boundaryQuery).toContain("CURRENT_USER = 'viberacing_ingest'");
    expect(boundaryQuery).toContain("SESSION_USER <> CURRENT_USER");
    expect(boundaryQuery).toContain(
      "pg_catalog.pg_has_role(SESSION_USER, 'viberacing_ingest', 'SET')",
    );
    expect(boundaryQuery).toContain("'CREATE'");
    expect(boundaryQuery).toContain("'TEMPORARY'");
    expect(boundaryQuery).toContain("NOT login_role.rolsuper");
    expect(boundaryQuery).toContain("NOT login_role.rolbypassrls");
    expect(boundaryQuery).toContain("granted_role.rolname <> 'viberacing_ingest'");
    expect(boundaryQuery).toContain(
      "pg_catalog.current_setting('search_path') = 'pg_catalog,pg_temp'",
    );
    expect(query.mock.calls[1]![0]).toMatchObject({ values: [usageSubmission.deviceId] });
    expect(query.mock.calls[1]![0].text).toBe(
      `SELECT
  material.device_key_id::text AS device_key_id,
  material.device_id::text AS device_id,
  material.installation_id::text AS installation_id,
  material.agent_account_id::text AS agent_account_id,
  material.public_key AS public_key,
  material.provider_code::text AS provider_code,
  material.accounting_revision AS accounting_revision,
  material.reader_version::text AS reader_version,
  material.scope_kind::text AS scope_kind,
  material.maximum_backfill_days AS maximum_backfill_days,
  material.identity_assurance::text AS identity_assurance
FROM viberacing_api.read_usage_device_verification_material($1::text) AS material`,
    );
    const usageQuery = query.mock.calls[2]![0];
    expect(usageQuery.text).toContain("viberacing_api.submit_usage_sync(");
    expect(usageQuery.text).not.toContain(";");
    expect(usageQuery.text.match(/\$[0-9]+/g)).toEqual(
      Array.from({ length: 17 }, (_, index) => `$${String(index + 1)}`),
    );
    expect(usageQuery.text).toContain("$1::text");
    expect(usageQuery.text).toContain("$4::bytea");
    expect(usageQuery.text).toContain("$5::timestamptz");
    expect(usageQuery.text).toContain("$10::timestamptz");
    expect(usageQuery.text).toContain("$13::bytea");
    expect(usageQuery.text).toContain("$14::bytea");
    expect(usageQuery.text).toContain("$15::bytea");
    expect(usageQuery.text).toContain("$16::date[]");
    expect(usageQuery.text).toContain("$17::text[]");
    expect(usageQuery.values).toEqual([
      usageSubmission.observationId,
      usageSubmission.eventId,
      usageSubmission.originKeyId,
      usageSubmission.originNonceDigest,
      usageSubmission.originExpiresAt,
      usageSubmission.deviceKeyId,
      usageSubmission.deviceId,
      usageSubmission.agentAccountId,
      usageSubmission.syncId,
      usageSubmission.observedAt,
      usageSubmission.clientVersion,
      usageSubmission.readerVersion,
      usageSubmission.bodyDigest,
      usageSubmission.signature,
      usageSubmission.deviceNonceDigest,
      ["2026-07-14"],
      ["9007199254740993"],
    ]);
    expect(usageQuery.values[3]).not.toBe(usageSubmission.originNonceDigest);
    expect(usageQuery.values[12]).not.toBe(usageSubmission.bodyDigest);
    expect(usageQuery.values[13]).not.toBe(usageSubmission.signature);
    expect(usageQuery.values[14]).not.toBe(usageSubmission.deviceNonceDigest);
    expect(usageQuery.values[15]).not.toBe(usageSubmission.usageDates);
    expect(usageQuery.values[16]).not.toBe(usageSubmission.dailyTokenTotals);

    client.release();
    client.release(true);
    expect(release).toHaveBeenNthCalledWith(1, false);
    expect(release).toHaveBeenNthCalledWith(2, true);

    errorListener?.(new Error("synthetic driver detail"));
    expect(signal).toHaveBeenCalledWith("idle_client_error");
    await pool.close();
    expect(end).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith(config);
  });

  it("contains synchronous, asynchronous, and absent monitoring sinks", async () => {
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

    createIngestDatabasePool(
      config,
      () => {
        throw new Error("sink failed");
      },
      () => nodePool,
    );
    createIngestDatabasePool(
      config,
      () => Promise.reject(new Error("async sink failed")),
      () => nodePool,
    );
    createIngestDatabasePool(config, undefined, () => nodePool);

    expect(() => {
      for (const listener of listeners) {
        listener(new Error("idle failure"));
      }
    }).not.toThrow();
    await Promise.resolve();
  });

  it("forwards connection and close failures to the caller", async () => {
    const failure = new Error("synthetic pool detail");
    const nodePool = {
      connect: vi.fn(() => Promise.reject(failure)),
      end: vi.fn(() => Promise.reject(failure)),
      on: vi.fn(() => nodePool),
    };
    const pool = createIngestDatabasePool(config, undefined, () => nodePool);

    await expect(pool.connect()).rejects.toBe(failure);
    await expect(pool.close()).rejects.toBe(failure);
  });

  it("constructs and closes the default driver without opening a connection", async () => {
    const pool = createIngestDatabasePool(config);
    await expect(pool.close()).resolves.toBeUndefined();
  });
});
