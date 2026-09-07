-- Validation takes SHARE UPDATE EXCLUSIVE, compatible with ordinary INSERT/UPDATE/DELETE.
-- Keep this transaction separate from the ACCESS EXCLUSIVE DDL in 012 and 014.

ALTER TABLE agent_accounts VALIDATE CONSTRAINT agent_accounts_agent_id_cursor_check;
ALTER TABLE installation_sources VALIDATE CONSTRAINT installation_sources_agent_id_cursor_check;
ALTER TABLE account_dedup_events VALIDATE CONSTRAINT account_dedup_events_agent_id_cursor_check;
ALTER TABLE browser_sync_runs VALIDATE CONSTRAINT browser_sync_runs_agent_id_cursor_check;
ALTER TABLE daily_agent_usage VALIDATE CONSTRAINT daily_agent_usage_agent_id_cursor_check;
