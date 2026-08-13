import { agentNames, isSupportedAgent, type SupportedAgent } from "./agents";
import { query } from "./db";

export { formatAgentShare, formatCompactTokens, formatExactTokens } from "./leaderboard-format";

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

interface LeaderboardOptions {
  readonly limit?: number;
  readonly offset?: number;
}

const maximumLeaderboardPageSize = 101;

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

export function currentWeekNumber(now = new Date()): number {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function projectRow(row: LeaderboardRowDb): LeaderboardRow {
  const breakdown = Object.entries(row.breakdown ?? {}).flatMap(([agent, tokens]) =>
    isSupportedAgent(agent) && typeof tokens === "string"
      ? [{ agent, label: agentNames[agent], tokens }]
      : [],
  );
  return { handle: row.handle, rank: row.rank, total: row.total, breakdown };
}

export async function leaderboard({ limit = 100, offset = 0 }: LeaderboardOptions = {}): Promise<
  readonly LeaderboardRow[]
> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumLeaderboardPageSize) {
    throw new RangeError(
      `Leaderboard limit must be between 1 and ${maximumLeaderboardPageSize.toString()}.`,
    );
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError("Leaderboard offset must be a non-negative safe integer.");
  }
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
      ORDER BY r.rank, lower(u.handle), u.id
      LIMIT $2 OFFSET $3`,
    [currentWeekStart(), limit, offset],
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
