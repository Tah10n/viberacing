DROP TRIGGER weekly_agent_usage_daily_compatibility ON weekly_agent_usage;
DROP TRIGGER installation_sources_legacy_partial_coverage ON installation_sources;

DROP FUNCTION mirror_weekly_agent_usage_to_daily();
DROP FUNCTION refresh_daily_agent_usage_compatibility(date, bigint, varchar);
DROP FUNCTION materialize_legacy_partial_source_coverage();

DROP TABLE weekly_agent_usage;
