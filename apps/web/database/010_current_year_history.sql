CREATE TABLE daily_agent_usage (
  usage_date date NOT NULL,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id varchar(32) NOT NULL CHECK (agent_id IN (
    'codex', 'claude_code', 'opencode', 'kimi_code',
    'qwen_code', 'antigravity', 'gemini_cli'
  )),
  tokens numeric NOT NULL CHECK (tokens >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usage_date, user_id, agent_id)
);

CREATE INDEX daily_agent_usage_user_range_idx
  ON daily_agent_usage(user_id, usage_date, agent_id);
CREATE INDEX daily_agent_usage_agent_range_idx
  ON daily_agent_usage(agent_id, usage_date, user_id);

WITH source_days AS (
  SELECT account.id AS account_id,
         account.user_id,
         account.agent_id,
         account.aggregation_mode,
         usage.usage_date,
         usage.total_tokens,
         usage.completeness,
         usage.updated_at,
         max(usage.updated_at) FILTER (WHERE usage.completeness = 'complete')
           OVER (PARTITION BY account.id, usage.usage_date) AS latest_complete_at
    FROM agent_accounts account
    JOIN installation_sources source ON source.agent_account_id = account.id
    JOIN daily_usage usage ON usage.source_id = source.id
), account_daily AS (
  SELECT account_id,
         user_id,
         agent_id,
         usage_date,
         CASE aggregation_mode
           WHEN 'account_max' THEN max(total_tokens) FILTER (
             WHERE latest_complete_at IS NULL
                OR (completeness = 'complete' AND updated_at = latest_complete_at)
                OR (completeness = 'partial' AND updated_at > latest_complete_at)
           )
           ELSE sum(total_tokens)
         END AS tokens
    FROM source_days
   GROUP BY account_id, user_id, agent_id, aggregation_mode, usage_date
)
INSERT INTO daily_agent_usage (usage_date, user_id, agent_id, tokens)
SELECT usage_date, user_id, agent_id, sum(tokens)
  FROM account_daily
 GROUP BY usage_date, user_id, agent_id;

ALTER TABLE installation_sources
  ADD COLUMN history_backfill_year integer NOT NULL
    DEFAULT extract(year FROM (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))::integer
    CHECK (history_backfill_year BETWEEN 1970 AND 9999),
  ADD COLUMN history_backfill_status varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (history_backfill_status IN ('pending', 'complete', 'partial')),
  ADD COLUMN history_backfill_completed_at timestamptz,
  ADD CONSTRAINT installation_sources_history_backfill_completion_check CHECK (
    (history_backfill_status = 'pending' AND history_backfill_completed_at IS NULL)
    OR (history_backfill_status IN ('complete', 'partial')
      AND history_backfill_completed_at IS NOT NULL)
  );
