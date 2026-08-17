import type { PoolClient } from "pg";
import { agentRegistry, isSupportedAgent } from "./agents";

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
    `WITH account_daily AS (
       SELECT a.id,
              d.usage_date,
              CASE a.aggregation_mode WHEN 'account_max' THEN max(d.total_tokens) ELSE sum(d.total_tokens) END AS tokens
         FROM agent_accounts a
         JOIN installation_sources s ON s.agent_account_id = a.id
         JOIN daily_usage d ON d.source_id = s.id
        WHERE a.user_id = $2 AND a.agent_id = $3
          AND d.usage_date >= $1::date AND d.usage_date < $1::date + 7
        GROUP BY a.id, a.aggregation_mode, d.usage_date
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
    `WITH account_daily AS (
       SELECT a.id,
              date_trunc('week', d.usage_date)::date AS week_start,
              d.usage_date,
              CASE a.aggregation_mode WHEN 'account_max' THEN max(d.total_tokens) ELSE sum(d.total_tokens) END AS tokens
         FROM agent_accounts a
         JOIN installation_sources s ON s.agent_account_id = a.id
         JOIN daily_usage d ON d.source_id = s.id
        WHERE a.user_id = $1 AND a.agent_id = $2
        GROUP BY a.id, a.aggregation_mode, date_trunc('week', d.usage_date)::date, d.usage_date
     )
     INSERT INTO weekly_agent_usage (week_start, user_id, agent_id, tokens)
     SELECT week_start, $1, $2, sum(tokens) FROM account_daily GROUP BY week_start`,
    [userId, agentId],
  );
}
