import type { PoolClient } from "pg";
import { agentRegistry, isSupportedAgent } from "./agents";

export const accountMaxObservationIsEligibleSql = `(
  latest_complete_at IS NULL
  OR (completeness = 'complete' AND updated_at = latest_complete_at)
  OR (completeness = 'partial' AND updated_at > latest_complete_at)
)`;

export const accountMaxDailyTokensSql = `max(total_tokens) FILTER (
  WHERE ${accountMaxObservationIsEligibleSql}
)`;

const dailySummaryCtes = `WITH source_days AS (
  SELECT a.id,
         a.aggregation_mode,
         d.usage_date,
         d.total_tokens,
         d.completeness,
         d.updated_at,
         max(d.updated_at) FILTER (WHERE d.completeness = 'complete')
           OVER (PARTITION BY a.id, d.usage_date) AS latest_complete_at
    FROM agent_accounts a
    JOIN installation_sources s ON s.agent_account_id = a.id
    JOIN daily_usage d ON d.source_id = s.id
   WHERE a.user_id = $1 AND a.agent_id = $2
     AND d.usage_date >= $3::date AND d.usage_date < $4::date
), account_daily AS (
  SELECT id,
         usage_date,
         CASE aggregation_mode
           WHEN 'account_max' THEN ${accountMaxDailyTokensSql}
           ELSE sum(total_tokens)
         END AS tokens
    FROM source_days
   GROUP BY id, aggregation_mode, usage_date
)`;

const weeklySummaryCtes = `WITH source_days AS (
  SELECT a.id,
         a.aggregation_mode,
         date_trunc('week', d.usage_date)::date AS week_start,
         d.usage_date,
         d.total_tokens,
         d.completeness,
         d.updated_at,
         max(d.updated_at) FILTER (WHERE d.completeness = 'complete')
           OVER (PARTITION BY a.id, d.usage_date) AS latest_complete_at
    FROM agent_accounts a
    JOIN installation_sources s ON s.agent_account_id = a.id
    JOIN daily_usage d ON d.source_id = s.id
   WHERE a.user_id = $1 AND a.agent_id = $2
     AND d.usage_date >= date_trunc('week', $3::date)::date
     AND d.usage_date < date_trunc('week', $4::date - 1)::date + 7
), account_daily AS (
  SELECT id,
         week_start,
         usage_date,
         CASE aggregation_mode
           WHEN 'account_max' THEN ${accountMaxDailyTokensSql}
           ELSE sum(total_tokens)
         END AS tokens
    FROM source_days
   GROUP BY id, aggregation_mode, week_start, usage_date
)`;

async function refreshWeeklyCompatibilityRange(
  client: PoolClient,
  userId: string,
  agentId: string,
  from: string,
  toExclusive: string,
): Promise<void> {
  await client.query(
    `DELETE FROM weekly_agent_usage
      WHERE user_id = $1 AND agent_id = $2
        AND week_start >= date_trunc('week', $3::date)::date
        AND week_start <= date_trunc('week', $4::date - 1)::date`,
    [userId, agentId, from, toExclusive],
  );
  if (!isSupportedAgent(agentId) || !agentRegistry[agentId].countsExactTokens) return;
  await client.query(
    `${weeklySummaryCtes}
     INSERT INTO weekly_agent_usage (week_start, user_id, agent_id, tokens)
     SELECT week_start, $1, $2, sum(tokens)
       FROM account_daily
      GROUP BY week_start`,
    [userId, agentId, from, toExclusive],
  );
}

export async function refreshAgentRange(
  client: PoolClient,
  userId: string,
  agentId: string,
  from: string,
  toExclusive: string,
): Promise<void> {
  await refreshWeeklyCompatibilityRange(client, userId, agentId, from, toExclusive);
  await client.query(
    `DELETE FROM daily_agent_usage
      WHERE user_id = $1 AND agent_id = $2
        AND usage_date >= $3::date AND usage_date < $4::date`,
    [userId, agentId, from, toExclusive],
  );
  if (!isSupportedAgent(agentId) || !agentRegistry[agentId].countsExactTokens) return;
  await client.query(
    `${dailySummaryCtes}
     INSERT INTO daily_agent_usage (usage_date, user_id, agent_id, tokens)
     SELECT usage_date, $1, $2, sum(tokens)
       FROM account_daily
      GROUP BY usage_date`,
    [userId, agentId, from, toExclusive],
  );
}

export async function rebuildAgentDailySummaries(
  client: PoolClient,
  userId: string,
  agentId: string,
): Promise<void> {
  await client.query("DELETE FROM weekly_agent_usage WHERE user_id = $1 AND agent_id = $2", [
    userId,
    agentId,
  ]);
  if (isSupportedAgent(agentId) && agentRegistry[agentId].countsExactTokens) {
    await client.query(
      `${weeklySummaryCtes}
       INSERT INTO weekly_agent_usage (week_start, user_id, agent_id, tokens)
       SELECT week_start, $1, $2, sum(tokens)
         FROM account_daily
        GROUP BY week_start`,
      [userId, agentId, "0001-01-01", "9999-12-31"],
    );
  }
  await client.query("DELETE FROM daily_agent_usage WHERE user_id = $1 AND agent_id = $2", [
    userId,
    agentId,
  ]);
  if (!isSupportedAgent(agentId) || !agentRegistry[agentId].countsExactTokens) return;
  await client.query(
    `${dailySummaryCtes}
     INSERT INTO daily_agent_usage (usage_date, user_id, agent_id, tokens)
     SELECT usage_date, $1, $2, sum(tokens)
       FROM account_daily
      GROUP BY usage_date`,
    [userId, agentId, "0001-01-01", "9999-12-31"],
  );
}
