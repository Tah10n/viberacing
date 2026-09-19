import { Client, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { refreshRankingSignals } from "./ranking-signals";

const enabled = process.env.VIBERACING_TEST_ADMISSION_DATABASE === "synthetic-local";
describe.skipIf(!enabled)("signal refresh across the UTC year boundary", () => {
  it.each([
    {
      today: "2027-01-01",
      dates: ["2026-12-31", "2027-01-01"],
      totals: ["100000000", "5000000000"],
      expected: [{ date: "2027-01-01", rule: "daily_jump" }],
    },
    {
      today: "2027-01-15",
      dates: ["2026-12-15", "2026-12-16"],
      totals: ["100000000", "11000000000"],
      expected: [
        { date: "2026-12-16", rule: "daily_jump" },
        { date: "2026-12-16", rule: "daily_total" },
      ],
    },
  ])(
    "includes rolling delivery and its prior-day baseline on $today",
    async ({ today, dates, totals, expected }) => {
      const url = new URL(process.env.DATABASE_URL ?? "");
      if (url.hostname !== "127.0.0.1" || url.port !== "55439")
        throw new Error("Disposable loopback database required");
      const client = new Client({ connectionString: url.href });
      await client.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "CREATE TEMP TABLE daily_agent_usage(usage_date date,user_id bigint,tokens numeric)",
        );
        await client.query(
          "CREATE TEMP TABLE ranking_signals(user_id bigint PRIMARY KEY,signals jsonb,observed_at timestamptz DEFAULT now())",
        );
        await client.query("INSERT INTO daily_agent_usage VALUES ($1,1,$2),($3,1,$4)", [
          dates[0],
          totals[0],
          dates[1],
          totals[1],
        ]);
        // Execute the actual refresh SQL against PostgreSQL, changing only its clock.
        const clock = {
          query: (sql: string, values: unknown[]) =>
            client.query(sql.replaceAll("now()", `'${today} 12:00:00+00'::timestamptz`), values),
        } as unknown as PoolClient;
        await refreshRankingSignals(clock, "1");
        expect((await client.query("SELECT signals FROM ranking_signals")).rows).toEqual([
          { signals: expected },
        ]);
        await client.query("UPDATE daily_agent_usage SET tokens=100000000");
        await refreshRankingSignals(clock, "1");
        expect((await client.query("SELECT signals FROM ranking_signals")).rows).toEqual([]);
      } finally {
        await client.query("ROLLBACK");
        await client.end();
      }
    },
  );
});
