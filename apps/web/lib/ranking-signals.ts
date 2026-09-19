import type { PoolClient } from "pg";

export interface DailyTotal {
  date: string;
  total: string;
}
export interface RankingSignal {
  date: string;
  rule: "daily_total" | "daily_jump";
}

export function rankingSignals(
  days: readonly DailyTotal[],
  dailyThreshold: bigint,
  jumpRatio: bigint,
): RankingSignal[] {
  const byDate = new Map(days.map((day) => [day.date, BigInt(day.total)]));
  const signals: RankingSignal[] = [];
  for (const day of days) {
    const total = BigInt(day.total);
    if (total > dailyThreshold) signals.push({ date: day.date, rule: "daily_total" });
    const previous = new Date(`${day.date}T00:00:00Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    const prior = byDate.get(previous.toISOString().slice(0, 10));
    // Compare usage dates, never upload time or packet size; require a meaningful baseline.
    if (prior !== undefined && prior >= dailyThreshold / 100n && total > prior * jumpRatio) {
      signals.push({ date: day.date, rule: "daily_jump" });
    }
  }
  return signals
    .sort((a, b) => b.date.localeCompare(a.date) || a.rule.localeCompare(b.rule))
    .slice(0, 32);
}

function threshold(name: string, fallback: string): bigint {
  const value = process.env[name] ?? fallback;
  if (!/^[1-9][0-9]{0,29}$/.test(value)) throw new Error("invalid_ranking_signal_threshold");
  return BigInt(value);
}

export async function refreshRankingSignals(client: PoolClient, userId: string): Promise<void> {
  const rows = await client.query<DailyTotal>(
    `SELECT usage_date::text AS date, sum(tokens)::text AS total FROM daily_agent_usage
      WHERE user_id = $1 AND usage_date >= LEAST(
        date_trunc('year', now() AT TIME ZONE 'UTC')::date - 1,
        (now() AT TIME ZONE 'UTC')::date - 31
      )
        AND usage_date <= (now() AT TIME ZONE 'UTC')::date
      GROUP BY usage_date ORDER BY usage_date DESC LIMIT 367`,
    [userId],
  );
  const signals = rankingSignals(
    rows.rows,
    threshold("VIBERACING_SIGNAL_DAILY_TOKENS", "10000000000"),
    threshold("VIBERACING_SIGNAL_JUMP_RATIO", "20"),
  );
  if (signals.length === 0) {
    await client.query("DELETE FROM ranking_signals WHERE user_id = $1", [userId]);
  } else {
    await client.query(
      `INSERT INTO ranking_signals (user_id, signals) VALUES ($1, $2::jsonb)
       ON CONFLICT (user_id) DO UPDATE SET signals = EXCLUDED.signals, observed_at = now()
       WHERE ranking_signals.signals IS DISTINCT FROM EXCLUDED.signals`,
      [userId, JSON.stringify(signals)],
    );
  }
}
