import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { promisify } from "node:util";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execute = promisify(execFile);
const enabled = process.env.VIBERACING_TEST_ADMISSION_DATABASE === "synthetic-local";
const migrations = new URL("../database/", import.meta.url);
const runner = new URL("../scripts/migrate.mjs", import.meta.url);

describe.skipIf(!enabled)("capacity migration with live old writers", () => {
  let admin: Client;
  let client: Client;
  let connection: string;
  let name: string;
  beforeEach(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.port !== "55439") {
      throw new Error("Disposable loopback database required");
    }
    admin = new Client({ connectionString: url.href });
    await admin.connect();
    name = `capacity_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE ${name}`);
    url.pathname = `/${name}`;
    url.searchParams.set("application_name", name);
    connection = url.href;
    client = new Client({ connectionString: connection });
    await client.connect();
  });
  afterEach(async () => {
    await client.end();
    if (name) await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
  });
  async function baseline(last: string) {
    for (const version of (await readdir(migrations))
      .filter((file) => file.endsWith(".sql") && file <= last)
      .sort()) {
      const sql = await readFile(new URL(version, migrations), "utf8");
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(version,checksum) VALUES ($1,$2)", [
        version,
        createHash("sha256").update(sql).digest("hex"),
      ]);
      await client.query("COMMIT");
    }
  }
  function migrate() {
    return execute(process.execPath, [runner.pathname], {
      env: { ...process.env, DATABASE_URL: connection, VIBERACING_DATABASE_SSL: "false" },
      timeout: 15000,
    });
  }
  async function insert() {
    await client.query(`INSERT INTO rate_limit_buckets(scope,key_hash,window_started_at,request_count,expires_at)
      VALUES ('fixture',decode(repeat('ab',32),'hex'),now(),1,now()-interval '1 second')`);
  }
  async function assertCapacity() {
    expect((await client.query("SELECT bucket_count::text FROM rate_limit_capacity")).rows).toEqual(
      [{ bucket_count: "1" }],
    );
    await client.query("DELETE FROM rate_limit_buckets WHERE expires_at <= now()");
    expect((await client.query("SELECT bucket_count::text FROM rate_limit_capacity")).rows).toEqual(
      [{ bucket_count: "0" }],
    );
  }
  it("locks before taking the initial snapshot and preserves an old writer's committed insert", async () => {
    await baseline("015_usage_observation_order.sql");
    await client.query("BEGIN");
    await insert();
    const pending = migrate();
    // Observe the runner blocked by our uncommitted old-writer transaction.
    // On the broken runner this is CREATE TRIGGER, after its stale count.
    let blocked = "";
    try {
      for (let i = 0; i < 100; i++) {
        const rows = await admin.query<{ query: string }>(
          "SELECT query FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock'",
          [name],
        );
        if (rows.rows[0]) {
          blocked = rows.rows[0].query;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      await client.query("COMMIT");
      await pending;
    }
    expect(blocked).toMatch(/^LOCK TABLE rate_limit_buckets IN SHARE ROW EXCLUSIVE MODE$/);
    await assertCapacity();
  }, 20000);
  it("repairs a previously applied 016 with a stale counter without changing its checksum", async () => {
    await baseline("017_ranking_moderation.sql");
    await insert();
    await client.query("UPDATE rate_limit_capacity SET bucket_count=0");
    const before = await client.query(
      "SELECT version,checksum FROM schema_migrations ORDER BY version",
    );
    await migrate();
    await assertCapacity();
    const after = await client.query(
      "SELECT version,checksum FROM schema_migrations WHERE version < '018' ORDER BY version",
    );
    expect(after.rows).toEqual(before.rows);
    expect((await migrate()).stdout).toContain('"appliedMigrations":0');
  }, 20000);
  it("supports a clean install and a no-op repeat", async () => {
    await migrate();
    await insert();
    await assertCapacity();
    expect((await migrate()).stdout).toContain('"appliedMigrations":0');
  }, 20000);
});
