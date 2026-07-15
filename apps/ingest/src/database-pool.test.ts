import { describe, expect, it, vi } from "vitest";

import { resolveIngestDatabaseConfig } from "./database-config.js";
import { createIngestDatabasePool, type IngestDatabaseSubmission } from "./database-pool.js";

const config = resolveIngestDatabaseConfig({
  NODE_ENV: "test",
  VIBERACING_INGEST_DATABASE_HOST: "127.0.0.1",
  VIBERACING_INGEST_DATABASE_NAME: "viberacing_local",
  VIBERACING_INGEST_DATABASE_PASSWORD: "synthetic-ingest-password",
  VIBERACING_INGEST_DATABASE_PORT: "54329",
  VIBERACING_INGEST_DATABASE_TLS_MODE: "disable",
  VIBERACING_INGEST_DATABASE_USER: "viberacing_ingest_login",
});

const submission: IngestDatabaseSubmission = {
  bodyDigest: Buffer.alloc(32, 1),
  codexReportedDates: ["2026-07-13"],
  codexVersion: "1.2.3",
  connectorVersion: "1.2.3",
  deviceId: "dev_AAAAAAAAAAAAAAAAAAAAAA",
  deviceKeyId: "00000000-0000-4000-8000-000000000101",
  nonceDigest: Buffer.alloc(32, 2),
  observedAt: "2026-07-15T12:00:00.000Z",
  signature: Buffer.alloc(64, 3),
  snapshotId: "00000000-0000-4000-8000-000000000102",
  sourceId: "src_BBBBBBBBBBBBBBBBBBBBBB",
  syncId: "syn_CCCCCCCCCCCCCCCCCCCCCC",
  tokens: [42],
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
    await expect(client.readDeviceVerificationMaterial(submission.deviceId)).resolves.toEqual([
      { value: 1 },
    ]);
    await expect(client.submitCommunitySync(submission)).resolves.toEqual([{ value: 1 }]);
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
    expect(query.mock.calls[1]![0]).toMatchObject({ values: [submission.deviceId] });
    expect(query.mock.calls[1]![0].text).toBe(
      `SELECT
  material.device_key_id::text AS device_key_id,
  material.source_id AS source_id,
  material.public_key AS public_key
FROM viberacing_api.read_device_verification_material($1::text) AS material`,
    );
    const submitQuery = query.mock.calls[2]![0];
    expect(submitQuery.text).toContain("viberacing_api.submit_community_sync(");
    expect(submitQuery.text).not.toContain(";");
    expect(submitQuery.text.match(/\$[0-9]+/g)).toEqual(
      Array.from({ length: 13 }, (_, index) => `$${String(index + 1)}`),
    );
    expect(submitQuery.text).toContain("$1::uuid");
    expect(submitQuery.text).toContain("$4::uuid");
    expect(submitQuery.text).toContain("$6::timestamptz");
    expect(submitQuery.text).toContain("$9::bytea");
    expect(submitQuery.text).toContain("$10::bytea");
    expect(submitQuery.text).toContain("$11::bytea");
    expect(submitQuery.text).toContain("$12::text[]");
    expect(submitQuery.text).toContain("$13::bigint[]");
    expect(submitQuery.values).toEqual([
      submission.deviceKeyId,
      submission.deviceId,
      submission.sourceId,
      submission.snapshotId,
      submission.syncId,
      submission.observedAt,
      submission.connectorVersion,
      submission.codexVersion,
      submission.bodyDigest,
      submission.signature,
      submission.nonceDigest,
      ["2026-07-13"],
      ["42"],
    ]);
    expect(submitQuery.values[8]).not.toBe(submission.bodyDigest);
    expect(submitQuery.values[9]).not.toBe(submission.signature);
    expect(submitQuery.values[10]).not.toBe(submission.nonceDigest);
    expect(submitQuery.values[11]).not.toBe(submission.codexReportedDates);
    expect(submitQuery.values[12]).not.toBe(submission.tokens);

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
