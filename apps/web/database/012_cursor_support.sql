-- Extend the agent allowlists only. Existing usage and aggregation modes are unchanged.
-- daily_usage references installation_sources and has no independent agent ID column.

ALTER TABLE agent_accounts
  DROP CONSTRAINT agent_accounts_agent_id_check,
  ADD CONSTRAINT agent_accounts_agent_id_check CHECK (agent_id IN (
    'codex', 'claude_code', 'opencode', 'kimi_code',
    'qwen_code', 'antigravity', 'gemini_cli', 'cursor'
  ));

ALTER TABLE installation_sources
  DROP CONSTRAINT installation_sources_agent_id_check,
  ADD CONSTRAINT installation_sources_agent_id_check CHECK (agent_id IN (
    'codex', 'claude_code', 'opencode', 'kimi_code',
    'qwen_code', 'antigravity', 'gemini_cli', 'cursor'
  ));

ALTER TABLE account_dedup_events
  DROP CONSTRAINT account_dedup_events_agent_id_check,
  ADD CONSTRAINT account_dedup_events_agent_id_check CHECK (agent_id IN (
    'codex', 'claude_code', 'opencode', 'kimi_code',
    'qwen_code', 'antigravity', 'gemini_cli', 'cursor'
  ));

ALTER TABLE browser_sync_runs
  DROP CONSTRAINT browser_sync_runs_agent_id_check,
  ADD CONSTRAINT browser_sync_runs_agent_id_check CHECK (agent_id IN (
    'codex', 'claude_code', 'opencode', 'kimi_code',
    'qwen_code', 'antigravity', 'gemini_cli', 'cursor'
  ));

ALTER TABLE daily_agent_usage
  DROP CONSTRAINT daily_agent_usage_agent_id_check,
  ADD CONSTRAINT daily_agent_usage_agent_id_check CHECK (agent_id IN (
    'codex', 'claude_code', 'opencode', 'kimi_code',
    'qwen_code', 'antigravity', 'gemini_cli', 'cursor'
  ));
