import { agentNames, isSupportedAgent, type SupportedAgent } from "./agents";
import { query } from "./db";

interface LeaderboardRowDb {
  handle: string;
  rank: string;
  total: string;
  breakdown: Record<string, unknown> | null;
}

export interface LeaderboardRow {
  readonly handle: string;
  readonly rank: string;
  readonly total: string;
  readonly breakdown: readonly { agent: SupportedAgent; label: string; tokens: string }[];
}

export function currentWeekStart(now = new Date()): string {
  const day = now.getUTCDay();
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((day + 6) % 7)),
  );
  return monday.toISOString().slice(0, 10);
}

export function currentWeekLabel(now = new Date()): string {
  const start = new Date(`${currentWeekStart(now)}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: "UTC" });
  const month = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const endLabel = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(end);
  return start.getUTCMonth() === end.getUTCMonth()
    ? `${day.format(start)}–${endLabel}`
    : `${month.format(start)}–${endLabel}`;
}

function projectRow(row: LeaderboardRowDb): LeaderboardRow {
  const breakdown = Object.entries(row.breakdown ?? {}).flatMap(([agent, tokens]) =>
    isSupportedAgent(agent) && typeof tokens === "string"
      ? [{ agent, label: agentNames[agent], tokens }]
      : [],
  );
  return { handle: row.handle, rank: row.rank, total: row.total, breakdown };
}

export async function leaderboard(limit = 100): Promise<readonly LeaderboardRow[]> {
  const rows = await query<LeaderboardRowDb>(
    `WITH per_day AS (
       SELECT user_id, agent, usage_date,
              CASE WHEN agent = 'codex' THEN max(tokens) ELSE sum(tokens) END AS tokens
         FROM daily_usage
        WHERE usage_date >= $1::date AND usage_date < ($1::date + 7)
        GROUP BY user_id, agent, usage_date
     ), per_agent AS (
       SELECT user_id, agent, sum(tokens)::text AS tokens
         FROM per_day
        GROUP BY user_id, agent
     ), totals AS (
       SELECT user_id, sum(tokens::numeric) AS total FROM per_agent GROUP BY user_id
     ), ranked AS (
       SELECT user_id, total, dense_rank() OVER (ORDER BY total DESC) AS rank FROM totals
     )
     SELECT u.handle, r.rank::text, r.total::text,
            (SELECT jsonb_object_agg(p.agent, p.tokens) FROM per_agent p WHERE p.user_id = r.user_id) AS breakdown
       FROM ranked r JOIN users u ON u.id = r.user_id
      ORDER BY r.rank, lower(u.handle), u.id LIMIT $2`,
    [currentWeekStart(), limit],
  );
  return rows.map(projectRow);
}

export async function publicProfile(handle: string): Promise<LeaderboardRow | null> {
  const rows = await query<LeaderboardRowDb>(
    `WITH per_day AS (
       SELECT user_id, agent, usage_date,
              CASE WHEN agent = 'codex' THEN max(tokens) ELSE sum(tokens) END AS tokens
         FROM daily_usage
        WHERE usage_date >= $1::date AND usage_date < ($1::date + 7)
        GROUP BY user_id, agent, usage_date
     ), per_agent AS (
       SELECT user_id, agent, sum(tokens)::text AS tokens
         FROM per_day
        GROUP BY user_id, agent
     ), totals AS (
       SELECT user_id, sum(tokens::numeric) AS total FROM per_agent GROUP BY user_id
     ), ranked AS (
       SELECT user_id, total, dense_rank() OVER (ORDER BY total DESC) AS rank FROM totals
     )
     SELECT u.handle, r.rank::text, r.total::text,
            (SELECT jsonb_object_agg(p.agent, p.tokens) FROM per_agent p WHERE p.user_id = r.user_id) AS breakdown
       FROM ranked r JOIN users u ON u.id = r.user_id WHERE lower(u.handle) = lower($2) LIMIT 1`,
    [currentWeekStart(), handle],
  );
  const row = rows[0];
  return row === undefined ? null : projectRow(row);
}

export function formatExactTokens(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function formatCompactTokens(value: string): string {
  const tokens = BigInt(value);
  const units = [
    { divisor: 1n, suffix: "" },
    { divisor: 1_000n, suffix: "K" },
    { divisor: 1_000_000n, suffix: "M" },
    { divisor: 1_000_000_000n, suffix: "B" },
    { divisor: 1_000_000_000_000n, suffix: "T" },
  ];
  let index = units.findLastIndex((unit) => tokens >= unit.divisor);
  if (index <= 0) return tokens.toString();
  let unit = units[index];
  if (unit === undefined) return tokens.toString();
  let tenths = (tokens * 10n + unit.divisor / 2n) / unit.divisor;
  if (tenths >= 10_000n && index < units.length - 1) {
    index += 1;
    unit = units[index] ?? unit;
    tenths = (tokens * 10n + unit.divisor / 2n) / unit.divisor;
  }
  const whole = tenths / 10n;
  const decimal = tenths % 10n;
  return `${whole.toString()}${decimal === 0n ? "" : `,${decimal.toString()}`}${unit.suffix}`;
}
