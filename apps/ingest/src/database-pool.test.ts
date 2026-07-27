import { describe, expect, it, vi } from "vitest";

import { resolveIngestDatabaseConfig } from "./database-config.js";
import {
  createIngestDatabasePool,
  type IngestDatabaseOriginNonce,
  type IngestDatabaseUsageSubmission,
} from "./database-pool.js";

const config = resolveIngestDatabaseConfig({
  NODE_ENV: "test",
  VIBERACING_INGEST_DATABASE_HOST: "127.0.0.1",
  VIBERACING_INGEST_DATABASE_NAME: "viberacing_local",
  VIBERACING_INGEST_DATABASE_PASSWORD: "synthetic-ingest-password",
  VIBERACING_INGEST_DATABASE_PORT: "54329",
  VIBERACING_INGEST_DATABASE_TLS_MODE: "disable",
  VIBERACING_INGEST_DATABASE_USER: "viberacing_ingest_login",
});

const originNonce: IngestDatabaseOriginNonce = {
  expiresAt: "2026-07-15T12:01:00.000Z",
  nonceDigest: Buffer.alloc(32, 4),
  originKeyId: "edge_primary",
};

const usageSubmission: IngestDatabaseUsageSubmission = {
  accountingRevision: "codex_daily_usage_buckets_v1",
  agentVersion: "0.144.5",
  bodyDigest: Buffer.alloc(32, 5),
  clientVersion: "0.0.0",
  dailyTokenTotals: [84],
  deviceId: "dev_AAAAAAAAAAAAAAAAAAAAAA",
  deviceKeyId: "00000000-0000-4000-8000-000000000101",
  nonceDigest: Buffer.alloc(32, 6),
  observedAt: "2026-07-15T12:00:00.000Z",
  provider: "codex",
  reportedDates: ["2026-07-14"],
  signature: Buffer.alloc(64, 7),
  snapshotId: "00000000-0000-4000-8000-000000000102",
  sourceId: "src_BBBBBBBBBBBBBBBBBBBBBB",
  syncId: "syn_DDDDDDDDDDDDDDDDDDDDDD",
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
    await expect(client.consumeOriginNonce(originNonce)).resolves.toEqual([{ value: 1 }]);
    await expect(client.readDeviceVerificationMaterial(usageSubmission.deviceId)).resolves.toEqual([
      { value: 1 },
    ]);
    await expect(client.submitUsageSync(usageSubmission)).resolves.toEqual([{ value: 1 }]);
    expect(client).not.toHaveProperty("query");
    expect(query).toHaveBeenCalledTimes(4);
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
    const originQuery = query.mock.calls[1]![0];
    expect(originQuery.text).toBe(
      `SELECT
  viberacing_api.consume_origin_nonce(
    $1::text,
    $2::bytea,
    $3::timestamptz
  ) AS consumed`,
    );
    expect(originQuery.values).toEqual([
      originNonce.originKeyId,
      originNonce.nonceDigest,
      originNonce.expiresAt,
    ]);
    expect(originQuery.values[1]).not.toBe(originNonce.nonceDigest);
    expect(query.mock.calls[2]![0]).toMatchObject({ values: [usageSubmission.deviceId] });
    expect(query.mock.calls[2]![0].text).toBe(
      `SELECT
  material.device_key_id::text AS device_key_id,
  material.source_id AS source_id,
  material.public_key AS public_key,
  material.provider AS provider,
  material.accounting_revision AS accounting_revision
FROM viberacing_api.read_device_verification_material($1::text) AS material`,
    );
    const usageQuery = query.mock.calls[3]![0];
    expect(usageQuery.text).toContain("viberacing_api.submit_usage_sync(");
    expect(usageQuery.text).not.toContain(";");
    expect(usageQuery.text.match(/\$[0-9]+/g)).toEqual(
      Array.from({ length: 15 }, (_, index) => `$${String(index + 1)}`),
    );
    expect(usageQuery.text).toContain("$1::uuid");
    expect(usageQuery.text).toContain("$4::text");
    expect(usageQuery.text).toContain("$5::text");
    expect(usageQuery.text).toContain("$6::uuid");
    expect(usageQuery.text).toContain("$8::timestamptz");
    expect(usageQuery.text).toContain("$11::bytea");
    expect(usageQuery.text).toContain("$12::bytea");
    expect(usageQuery.text).toContain("$13::bytea");
    expect(usageQuery.text).toContain("$14::text[]");
    expect(usageQuery.text).toContain("$15::bigint[]");
    expect(usageQuery.values).toEqual([
      usageSubmission.deviceKeyId,
      usageSubmission.deviceId,
      usageSubmission.sourceId,
      usageSubmission.provider,
      usageSubmission.accountingRevision,
      usageSubmission.snapshotId,
      usageSubmission.syncId,
      usageSubmission.observedAt,
      usageSubmission.clientVersion,
      usageSubmission.agentVersion,
      usageSubmission.bodyDigest,
      usageSubmission.signature,
      usageSubmission.nonceDigest,
      ["2026-07-14"],
      ["84"],
    ]);
    expect(usageQuery.values[10]).not.toBe(usageSubmission.bodyDigest);
    expect(usageQuery.values[11]).not.toBe(usageSubmission.signature);
    expect(usageQuery.values[12]).not.toBe(usageSubmission.nonceDigest);
    expect(usageQuery.values[13]).not.toBe(usageSubmission.reportedDates);
    expect(usageQuery.values[14]).not.toBe(usageSubmission.dailyTokenTotals);

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
