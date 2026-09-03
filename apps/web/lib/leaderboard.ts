import { agentNames, isSupportedAgent, type SupportedAgent } from "./agents";
import { query } from "./db";
import { currentUtcWeekStart, resolveUsagePeriod, type ResolvedUsagePeriod } from "./usage-period";

export { formatAgentShare, formatCompactTokens, formatExactTokens } from "./leaderboard-format";

interface LeaderboardRowDb {
  handle: string;
  rank: string | null;
  total: string;
  breakdown: Record<string, unknown> | null;
}

export interface LeaderboardRow {
  readonly handle: string;
  readonly rank: string;
  readonly total: string;
  readonly breakdown: readonly { agent: SupportedAgent; label: string; tokens: string }[];
}

export interface PublicProfile extends Omit<LeaderboardRow, "rank"> {
  readonly rank: string | null;
}

interface LeaderboardOptions {
  readonly limit?: number;
  readonly offset?: number;
}

const maximumLeaderboardPageSize = 101;

export function currentWeekStart(now = new Date()): string {
  return currentUtcWeekStart(now);
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

export function currentWeekEndsAt(now = new Date()): string {
  const nextWeek = new Date(`${currentWeekStart(now)}T00:00:00.000Z`);
  nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
  return new Date(nextWeek.getTime() - 1).toISOString();
}

export function currentWeekNumber(now = new Date()): number {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function projectRow(row: LeaderboardRowDb): PublicProfile {
  const breakdown = Object.entries(row.breakdown ?? {}).flatMap(([agent, tokens]) =>
    isSupportedAgent(agent) && typeof tokens === "string"
      ? [{ agent, label: agentNames[agent], tokens }]
      : [],
  );
  return { handle: row.handle, rank: row.rank, total: row.total, breakdown };
}

const rankedSummarySql = `WITH per_user AS (
  SELECT user_id, sum(tokens) AS total
    FROM daily_agent_usage
   WHERE usage_date >= $1::date AND usage_date < $2::date
   GROUP BY user_id
), ranked AS (
  SELECT user_id, total, dense_rank() OVER (ORDER BY total DESC) AS rank
    FROM per_user
)`;

export async function leaderboard(
  { limit = 100, offset = 0 }: LeaderboardOptions = {},
  resolved: ResolvedUsagePeriod = resolveUsagePeriod({ kind: "week" }),
): Promise<readonly LeaderboardRow[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumLeaderboardPageSize) {
    throw new RangeError(
      `Leaderboard limit must be between 1 and ${maximumLeaderboardPageSize.toString()}.`,
    );
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError("Leaderboard offset must be a non-negative safe integer.");
  }
  const rows = await query<LeaderboardRowDb>(
    `${rankedSummarySql}
     SELECT u.handle, r.rank::text, r.total::text,
            (SELECT jsonb_object_agg(agent.agent_id, agent.tokens::text)
               FROM (
                 SELECT usage.agent_id, sum(usage.tokens) AS tokens
                   FROM daily_agent_usage usage
                  WHERE usage.usage_date >= $1::date AND usage.usage_date < $2::date
                    AND usage.user_id = r.user_id
                  GROUP BY usage.agent_id
               ) agent) AS breakdown
       FROM ranked r JOIN users u ON u.id = r.user_id
      ORDER BY r.rank, lower(u.handle), u.id
      LIMIT $3 OFFSET $4`,
    [resolved.from, resolved.toExclusive, limit, offset],
  );
  return rows.map((row) => ({ ...projectRow(row), rank: row.rank as string }));
}

export async function publicProfile(
  handle: string,
  resolved: ResolvedUsagePeriod = resolveUsagePeriod({ kind: "week" }),
): Promise<PublicProfile | null> {
  const rows = await query<LeaderboardRowDb>(
    `${rankedSummarySql}
     SELECT u.handle, r.rank::text, coalesce(r.total, 0)::text AS total,
            (SELECT jsonb_object_agg(agent.agent_id, agent.tokens::text)
               FROM (
                 SELECT usage.agent_id, sum(usage.tokens) AS tokens
                   FROM daily_agent_usage usage
                  WHERE usage.usage_date >= $1::date AND usage.usage_date < $2::date
                    AND usage.user_id = u.id
                  GROUP BY usage.agent_id
               ) agent) AS breakdown
       FROM users u LEFT JOIN ranked r ON r.user_id = u.id
      WHERE lower(u.handle) = lower($3)
        AND (
          EXISTS (SELECT 1 FROM daily_agent_usage retained WHERE retained.user_id = u.id)
          OR EXISTS (
            SELECT 1 FROM installations installation
             WHERE installation.user_id = u.id AND installation.status = 'active'
          )
        )
      LIMIT 1`,
    [resolved.from, resolved.toExclusive, handle],
  );
  const row = rows[0];
  return row === undefined ? null : projectRow(row);
}
