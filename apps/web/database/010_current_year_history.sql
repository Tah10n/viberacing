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
  ADD COLUMN unresolved_usage_dates date[] NOT NULL DEFAULT '{}'::date[],
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
  ADD CONSTRAINT installation_sources_unresolved_usage_dates_check CHECK (
    cardinality(unresolved_usage_dates) <= 366
    AND array_position(unresolved_usage_dates, NULL) IS NULL
  );

-- Legacy releases only persisted a coarse partial bit. Materialize a conservative rolling
-- coverage window before the new application can interpret a disconnected source. Days with an
-- explicitly complete source row are proven; every other day remains unresolved instead of being
-- presented as trusted no-data.
WITH legacy_partial AS (
  SELECT source.id,
         greatest(
           date_trunc('year', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,
           least(
             coalesce((source.last_successful_sync_at AT TIME ZONE 'UTC')::date,
                      (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date),
             (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
           ) - 30
         ) AS range_start,
         least(
           coalesce((source.last_successful_sync_at AT TIME ZONE 'UTC')::date,
                    (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date),
           (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
         ) AS range_end
   FROM installation_sources source
   WHERE source.status IN ('active', 'disconnected')
     AND source.last_completeness = 'partial'
     AND least(
           coalesce((source.last_successful_sync_at AT TIME ZONE 'UTC')::date,
                    (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date),
           (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
         ) >= date_trunc('year', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
), legacy_coverage AS (
  SELECT partial.id,
         partial.range_start,
         partial.range_end,
         coalesce(array_agg(day.value::date ORDER BY day.value) FILTER (
           WHERE NOT EXISTS (
             SELECT 1
               FROM daily_usage usage
              WHERE usage.source_id = partial.id
                AND usage.usage_date = day.value::date
                AND usage.completeness = 'complete'
           )
         ), '{}'::date[]) AS unresolved_dates
    FROM legacy_partial partial
    CROSS JOIN LATERAL generate_series(
      partial.range_start,
      partial.range_end,
      interval '1 day'
    ) AS day(value)
   GROUP BY partial.id, partial.range_start, partial.range_end
)
UPDATE installation_sources source
   SET last_rolling_range_start = coverage.range_start,
       last_rolling_range_end = coverage.range_end,
       unresolved_usage_dates = coverage.unresolved_dates
  FROM legacy_coverage coverage
 WHERE source.id = coverage.id;

-- The old application may remain live briefly after migration 010 commits. Materialize the same
-- conservative coverage when that release writes a partial result without the new columns, so a
-- subsequent disconnect cannot turn the source into trusted no-data for the new dashboard.
-- The current application sets a transaction-local marker before its native coverage writes.
-- Column-scoped updates keep unrelated lifecycle/diagnostic changes out of this compatibility path,
-- while known unresolved dates outside the legacy rolling window remain durable.
CREATE FUNCTION materialize_legacy_partial_source_coverage()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  utc_today date := (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;
  utc_year_start date := date_trunc('year', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;
  coverage_end date;
  coverage_start date;
BEGIN
  IF NEW.last_completeness IS DISTINCT FROM 'partial' THEN
    RETURN NEW;
  END IF;
  IF current_setting('viberacing.native_usage_coverage', true) = 'on' THEN
    RETURN NEW;
  END IF;

  coverage_end := least(
    coalesce((NEW.last_successful_sync_at AT TIME ZONE 'UTC')::date, utc_today),
    utc_today
  );
  IF coverage_end < utc_year_start THEN
    RETURN NEW;
  END IF;
  coverage_start := greatest(utc_year_start, coverage_end - 30);
  NEW.last_rolling_range_start := coverage_start;
  NEW.last_rolling_range_end := coverage_end;
  SELECT coalesce(array_agg(candidate.usage_date ORDER BY candidate.usage_date), '{}'::date[])
    INTO NEW.unresolved_usage_dates
    FROM (
      SELECT known.usage_date
        FROM unnest(NEW.unresolved_usage_dates) AS known(usage_date)
       WHERE known.usage_date < coverage_start OR known.usage_date > coverage_end
      UNION
      SELECT day.value::date AS usage_date
        FROM generate_series(coverage_start, coverage_end, interval '1 day') AS day(value)
       WHERE NOT EXISTS (
         SELECT 1
           FROM daily_usage usage
          WHERE usage.source_id = NEW.id
            AND usage.usage_date = day.value::date
            AND usage.completeness = 'complete'
       )
    ) AS candidate;
  RETURN NEW;
END;
$$;

CREATE TRIGGER installation_sources_legacy_partial_coverage
BEFORE INSERT OR UPDATE OF last_successful_sync_at, last_completeness ON installation_sources
FOR EACH ROW EXECUTE FUNCTION materialize_legacy_partial_source_coverage();

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
