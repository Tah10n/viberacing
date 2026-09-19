import { execFile } from "node:child_process";
import { randomInt } from "node:crypto";
import { promisify } from "node:util";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const execute = promisify(execFile);
const enabled = process.env.VIBERACING_TEST_ADMISSION_DATABASE === "synthetic-local";
interface Row {
  user_id: string;
  ranking_hidden: boolean;
}
describe.skipIf(!enabled)("operator moderation pagination", () => {
  it("finds more than 100 signals and hidden users without fresh signals, then restores them", async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.port !== "55439")
      throw new Error("Disposable loopback database required");
    const client = new Client({ connectionString: url.href });
    await client.connect();
    let ids: string[] = [];
    const seed = randomInt(1000000000);
    async function command(...args: string[]) {
      const result = await execute(
        process.execPath,
        [new URL("../scripts/moderate.mjs", import.meta.url).pathname, ...args],
        { env: process.env, timeout: 10000 },
      );
      return JSON.parse(result.stdout) as Row[];
    }
    async function pages(action: string) {
      const all: Row[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 10; i++) {
        const page = await command(action, ...(cursor === undefined ? [] : [cursor]));
        expect(page.length).toBeLessThanOrEqual(100);
        if (page.length === 0) return all;
        for (const row of page) {
          expect(BigInt(row.user_id)).toBeGreaterThan(BigInt(cursor ?? "0"));
          cursor = row.user_id;
          all.push(row);
        }
      }
      throw new Error("fixture pagination budget exhausted");
    }
    try {
      ids = (
        await client.query<{ id: string }>(
          `INSERT INTO users(github_id,handle)
        SELECT $1::bigint+i, 'cli-'||$1::text||'-'||i FROM generate_series(1,207) i RETURNING id::text`,
          [1000000000000 + seed * 1000],
        )
      ).rows.map((row) => row.id);
      const signalIds = ids.slice(0, 205);
      await client.query(
        "INSERT INTO ranking_signals(user_id,signals) SELECT unnest($1::bigint[]),'[]'::jsonb",
        [signalIds],
      );
      const noSignal = ids[205];
      const expired = ids[206];
      if (!noSignal || !expired) throw new Error("fixture missing");
      await client.query(
        "INSERT INTO ranking_signals(user_id,signals,observed_at) VALUES ($1,'[]',now()-interval '31 days')",
        [expired],
      );
      await command("hide", noSignal);
      await command("hide", expired);
      const listed = await pages("list");
      expect(listed.filter((row) => ids.includes(row.user_id)).map((row) => row.user_id)).toEqual(
        signalIds,
      );
      const hidden = await pages("hidden");
      expect(hidden.filter((row) => ids.includes(row.user_id)).map((row) => row.user_id)).toEqual([
        noSignal,
        expired,
      ]);
      await command("restore", noSignal);
      await command("restore", expired);
      expect((await pages("hidden")).filter((row) => ids.includes(row.user_id))).toEqual([]);
      expect(
        (
          await client.query(
            "SELECT count(*)::int AS count FROM ranking_signals WHERE user_id=ANY($1::bigint[])",
            [signalIds],
          )
        ).rows,
      ).toEqual([{ count: 205 }]);
    } finally {
      await client.query("DELETE FROM users WHERE id=ANY($1::bigint[])", [ids]);
      await client.end();
    }
  }, 20000);
});
