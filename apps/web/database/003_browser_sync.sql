ALTER TABLE installations
  ADD COLUMN browser_sync_capable boolean NOT NULL DEFAULT false;

CREATE TABLE browser_sync_grants (
  grant_hash bytea PRIMARY KEY CHECK (octet_length(grant_hash) = 32),
  installation_id uuid NOT NULL,
  user_id bigint NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (installation_id, user_id)
    REFERENCES installations(id, user_id) ON DELETE CASCADE
);

CREATE INDEX browser_sync_grants_expiry_idx ON browser_sync_grants(expires_at);

CREATE TABLE browser_sync_runs (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  user_id bigint NOT NULL,
  agent_account_id uuid NOT NULL,
  agent_id varchar(32) NOT NULL CHECK (agent_id IN (
    'codex', 'claude_code', 'opencode', 'kimi_code',
    'qwen_code', 'antigravity', 'gemini_cli'
  )),
  status varchar(16) NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  result_code varchar(32) CHECK (result_code IS NULL OR result_code IN (
    'complete', 'unchanged', 'partial', 'busy', 'collector_failed',
    'network_failed', 'authorization_failed', 'invalid_request'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (installation_id, user_id)
    REFERENCES installations(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (agent_account_id, user_id, agent_id)
    REFERENCES agent_accounts(id, user_id, agent_id) ON DELETE CASCADE,
  CHECK (
    (status = 'running' AND result_code IS NULL)
    OR (status <> 'running' AND result_code IS NOT NULL)
  )
);

CREATE INDEX browser_sync_runs_cleanup_idx ON browser_sync_runs(created_at);
CREATE INDEX browser_sync_runs_owner_idx ON browser_sync_runs(user_id, created_at DESC);
