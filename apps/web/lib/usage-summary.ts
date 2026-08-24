import type { PoolClient } from "pg";
import { agentRegistry, isSupportedAgent } from "./agents";

export const accountMaxDailyTokensSql = `max(total_tokens) FILTER (
  WHERE latest_complete_at IS NULL
     OR completeness = 'complete'
     OR (completeness = 'partial' AND updated_at > latest_complete_at)
)`;

export async function refreshAgentWeek(
  client: PoolClient,
  userId: string,
  agentId: string,
  weekStart: string,
): Promise<void> {
  if (!isSupportedAgent(agentId) || !agentRegistry[agentId].countsExactTokens) {
    await client.query(
      "DELETE FROM weekly_agent_usage WHERE week_start = $1::date AND user_id = $2 AND agent_id = $3",
      [weekStart, userId, agentId],
    );
    return;
  }
  await client.query(
    `WITH source_days AS (
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
        WHERE a.user_id = $2 AND a.agent_id = $3
          AND d.usage_date >= $1::date AND d.usage_date < $1::date + 7
     ), account_daily AS (
       SELECT id,
              usage_date,
              CASE aggregation_mode
                WHEN 'account_max' THEN ${accountMaxDailyTokensSql}
                ELSE sum(total_tokens)
              END AS tokens
         FROM source_days
        GROUP BY id, aggregation_mode, usage_date
     )
     INSERT INTO weekly_agent_usage (week_start, user_id, agent_id, tokens)
     SELECT $1::date, $2, $3, sum(tokens) FROM account_daily
     HAVING sum(tokens) IS NOT NULL
     ON CONFLICT (week_start, user_id, agent_id) DO UPDATE
       SET tokens = EXCLUDED.tokens, updated_at = now()`,
    [weekStart, userId, agentId],
  );
  await client.query(
    `DELETE FROM weekly_agent_usage w
      WHERE w.week_start = $1::date AND w.user_id = $2 AND w.agent_id = $3
        AND NOT EXISTS (
          SELECT 1
            FROM agent_accounts a
            JOIN installation_sources s ON s.agent_account_id = a.id
            JOIN daily_usage d ON d.source_id = s.id
           WHERE a.user_id = $2 AND a.agent_id = $3
             AND d.usage_date >= $1::date AND d.usage_date < $1::date + 7
        )`,
    [weekStart, userId, agentId],
  );
}

export async function rebuildAgentSummaries(
  client: PoolClient,
  userId: string,
  agentId: string,
): Promise<void> {
  await client.query("DELETE FROM weekly_agent_usage WHERE user_id = $1 AND agent_id = $2", [
    userId,
    agentId,
  ]);
  if (!isSupportedAgent(agentId) || !agentRegistry[agentId].countsExactTokens) return;
  await client.query(
    `WITH source_days AS (
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
     )
     INSERT INTO weekly_agent_usage (week_start, user_id, agent_id, tokens)
     SELECT week_start, $1, $2, sum(tokens) FROM account_daily GROUP BY week_start`,
    [userId, agentId],
  );
}
