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

export async function refreshAgentRange(
  client: PoolClient,
  userId: string,
  agentId: string,
  from: string,
  toExclusive: string,
): Promise<void> {
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
