-- Expand without scanning existing rows. The old allowlists still reject Cursor writes.
-- This transaction only holds the brief DDL locks needed to install NOT VALID checks.

ALTER TABLE agent_accounts
  ADD CONSTRAINT agent_accounts_agent_id_cursor_check CHECK (agent_id IN (
    'codex', 'claude_code', 'opencode', 'kimi_code',
    'qwen_code', 'antigravity', 'gemini_cli', 'cursor'
  )) NOT VALID;

ALTER TABLE installation_sources
  ADD CONSTRAINT installation_sources_agent_id_cursor_check CHECK (agent_id IN (
    'codex', 'claude_code', 'opencode', 'kimi_code',
    'qwen_code', 'antigravity', 'gemini_cli', 'cursor'
  )) NOT VALID;

ALTER TABLE account_dedup_events
  ADD CONSTRAINT account_dedup_events_agent_id_cursor_check CHECK (agent_id IN (
    'codex', 'claude_code', 'opencode', 'kimi_code',
    'qwen_code', 'antigravity', 'gemini_cli', 'cursor'
  )) NOT VALID;

ALTER TABLE browser_sync_runs
  ADD CONSTRAINT browser_sync_runs_agent_id_cursor_check CHECK (agent_id IN (
    'codex', 'claude_code', 'opencode', 'kimi_code',
    'qwen_code', 'antigravity', 'gemini_cli', 'cursor'
  )) NOT VALID;

ALTER TABLE daily_agent_usage
  ADD CONSTRAINT daily_agent_usage_agent_id_cursor_check CHECK (agent_id IN (
    'codex', 'claude_code', 'opencode', 'kimi_code',
    'qwen_code', 'antigravity', 'gemini_cli', 'cursor'
  )) NOT VALID;
