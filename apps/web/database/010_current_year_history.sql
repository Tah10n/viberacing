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

ALTER TABLE installation_sources
  ADD COLUMN history_backfill_year integer NOT NULL
    DEFAULT extract(year FROM (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))::integer
    CHECK (history_backfill_year BETWEEN 1970 AND 9999),
  ADD COLUMN history_backfill_status varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (history_backfill_status IN ('pending', 'complete', 'partial')),
  ADD COLUMN history_backfill_completed_at timestamptz,
  ADD COLUMN last_rolling_range_start date,
  ADD COLUMN last_rolling_range_end date,
  ADD COLUMN last_rolling_incomplete_dates date[],
  ADD CONSTRAINT installation_sources_history_backfill_completion_check CHECK (
    (history_backfill_status = 'pending' AND history_backfill_completed_at IS NULL)
    OR (history_backfill_status IN ('complete', 'partial')
      AND history_backfill_completed_at IS NOT NULL)
  ),
  ADD CONSTRAINT installation_sources_last_rolling_range_check CHECK (
    (last_rolling_range_start IS NULL AND last_rolling_range_end IS NULL)
    OR (last_rolling_range_start IS NOT NULL
      AND last_rolling_range_end IS NOT NULL
      AND last_rolling_range_start <= last_rolling_range_end)
  ),
  ADD CONSTRAINT installation_sources_last_rolling_incomplete_dates_check CHECK (
    last_rolling_incomplete_dates IS NULL
    OR (cardinality(last_rolling_incomplete_dates) <= 31
      AND array_position(last_rolling_incomplete_dates, NULL) IS NULL)
  );

-- Migration 010 is the expand half of an expand-contract rollout. The previous application release
-- still reads and writes weekly_agent_usage while Railway runs this migration before switching
-- traffic. Reflect every old weekly mutation into the new daily summary from the authoritative raw
-- rows, and keep the new application dual-writing both summaries until a separately deployed
-- cleanup migration removes this bridge and weekly_agent_usage.
CREATE FUNCTION refresh_daily_agent_usage_compatibility(
  affected_week_start date,
  affected_user_id bigint,
  affected_agent_id varchar(32)
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM daily_agent_usage
   WHERE user_id = affected_user_id
     AND agent_id = affected_agent_id
     AND usage_date >= affected_week_start
     AND usage_date < affected_week_start + 7;

  WITH source_days AS (
    SELECT account.id AS account_id,
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
     WHERE account.user_id = affected_user_id
       AND account.agent_id = affected_agent_id
       AND usage.usage_date >= affected_week_start
       AND usage.usage_date < affected_week_start + 7
  ), account_daily AS (
    SELECT account_id,
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
     GROUP BY account_id, aggregation_mode, usage_date
  )
  INSERT INTO daily_agent_usage (usage_date, user_id, agent_id, tokens)
  SELECT usage_date, affected_user_id, affected_agent_id, sum(tokens)
    FROM account_daily
   GROUP BY usage_date;
END;
$$;

CREATE FUNCTION mirror_weekly_agent_usage_to_daily()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM refresh_daily_agent_usage_compatibility(
      OLD.week_start,
      OLD.user_id,
      OLD.agent_id
    );
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM refresh_daily_agent_usage_compatibility(
      NEW.week_start,
      NEW.user_id,
      NEW.agent_id
    );
  ELSIF TG_OP = 'UPDATE'
    AND ROW(NEW.week_start, NEW.user_id, NEW.agent_id)
      IS DISTINCT FROM ROW(OLD.week_start, OLD.user_id, OLD.agent_id) THEN
    PERFORM refresh_daily_agent_usage_compatibility(
      NEW.week_start,
      NEW.user_id,
      NEW.agent_id
    );
  END IF;
  RETURN NULL;
END;
$$;

-- Compatibility lock boundary: trigger creation acquires the legacy summary lock retained through
-- the final authoritative backfill and transaction commit.
CREATE TRIGGER weekly_agent_usage_daily_compatibility
AFTER INSERT OR UPDATE OR DELETE ON weekly_agent_usage
FOR EACH ROW EXECUTE FUNCTION mirror_weekly_agent_usage_to_daily();

-- Final authoritative backfill begins only after CREATE TRIGGER has acquired its lock on the
-- legacy summary. Writers that committed before that lock are visible here; writers waiting behind
-- it resume after this transaction commits and are mirrored by the trigger.
TRUNCATE daily_agent_usage;

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
