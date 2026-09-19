import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { database, query } from "./db";
import {
  consumeAdmissionRateLimit,
  consumeRateLimit,
  deleteExpiredRateLimitBuckets,
} from "./rate-limit";
import { ResourceOverloaded } from "./overload";

// Opt in only on the disposable database created for this task. Never use production data.
const enabled = process.env.VIBERACING_TEST_ADMISSION_DATABASE === "synthetic-local";
describe.skipIf(!enabled)("admission against isolated PostgreSQL", () => {
  beforeEach(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.port !== "55439") {
      throw new Error("This destructive fixture requires the isolated loopback database");
    }
    await query("TRUNCATE rate_limit_buckets");
  });
  afterAll(async () => {
    if (enabled) await database().end();
  });
  it("does not charge rejected client A to the admitted budget for B", async () => {
    expect(await consumeAdmissionRateLimit("test_isolation", "192.0.2.1", 2, 4, 60)).toEqual({
      allowed: true,
      reason: null,
    });
    expect(await consumeAdmissionRateLimit("test_isolation", "192.0.2.1", 2, 4, 60)).toEqual({
      allowed: true,
      reason: null,
    });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect(await consumeAdmissionRateLimit("test_isolation", "192.0.2.1", 2, 4, 60)).toEqual({
        allowed: false,
        reason: "client",
      });
    }
    expect(await consumeAdmissionRateLimit("test_isolation", "192.0.2.2", 2, 4, 60)).toEqual({
      allowed: true,
      reason: null,
    });
    const rows = await query<{ request_count: number }>(
      "SELECT request_count FROM rate_limit_buckets WHERE scope = 'admit_test_isolation'",
    );
    expect(rows).toEqual([{ request_count: 3 }]);
  });
  it("serializes concurrent admissions and rolls back new keys after global exhaustion", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        consumeAdmissionRateLimit("test_concurrency", `192.0.2.${(i + 1).toString()}`, 2, 3, 60),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(3);
    const rows = await query<{ count: string }>(
      "SELECT count(*)::text FROM rate_limit_buckets WHERE scope = 'test_concurrency'",
    );
    expect(rows).toEqual([{ count: "3" }]);
  });
  it("enforces a hard bucket ceiling and frees capacity in bounded cleanup batches", async () => {
    await query(`INSERT INTO rate_limit_buckets(scope,key_hash,window_started_at,request_count,expires_at)
      SELECT 'capacity_fixture',decode(md5(i::text)||md5(i::text),'hex'),now(),1,now()-interval '1 second'
      FROM generate_series(1,200000) i`);
    await expect(consumeRateLimit("test_capacity", "new", 1, 60)).rejects.toBeInstanceOf(
      ResourceOverloaded,
    );
    const client = await database().connect();
    try {
      expect(await deleteExpiredRateLimitBuckets(client)).toBe(70000);
    } finally {
      client.release();
    }
    expect(await consumeRateLimit("test_capacity", "new", 1, 60)).toBe(true);
    expect(await query("SELECT bucket_count::text FROM rate_limit_capacity")).toEqual([
      { bucket_count: "130001" },
    ]);
  });
  it("reopens admission at a new fixed window", async () => {
    expect((await consumeAdmissionRateLimit("test_window", "192.0.2.77", 1, 10, 1)).allowed).toBe(
      true,
    );
    expect((await consumeAdmissionRateLimit("test_window", "192.0.2.77", 1, 10, 1)).allowed).toBe(
      false,
    );
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await consumeAdmissionRateLimit("test_window", "192.0.2.77", 1, 10, 1)).allowed).toBe(
      true,
    );
  });
});
