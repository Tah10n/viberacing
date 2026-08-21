ALTER TABLE agent_accounts
  ADD COLUMN merged_into_account_id uuid;

ALTER TABLE agent_accounts
  ADD CONSTRAINT agent_accounts_not_merged_into_self
    CHECK (merged_into_account_id IS NULL OR merged_into_account_id <> id),
  ADD CONSTRAINT agent_accounts_merged_into_same_owner_agent_fk
    FOREIGN KEY (merged_into_account_id, user_id, agent_id)
    REFERENCES agent_accounts(id, user_id, agent_id) ON DELETE CASCADE;

CREATE INDEX agent_accounts_merged_into_idx
  ON agent_accounts(merged_into_account_id) WHERE merged_into_account_id IS NOT NULL;

ALTER TABLE installation_sources
  ADD COLUMN auto_dedup_decided_at timestamptz,
  ADD CONSTRAINT installation_sources_id_owner_agent_unique UNIQUE (id, user_id, agent_id);

CREATE TABLE account_dedup_events (
  id uuid PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id varchar(32) NOT NULL CHECK (agent_id IN (
    'codex', 'claude_code', 'opencode', 'kimi_code',
    'qwen_code', 'antigravity', 'gemini_cli'
  )),
  source_id uuid NOT NULL,
  previous_account_id uuid NOT NULL,
  target_account_id uuid NOT NULL,
  matched_days smallint NOT NULL CHECK (matched_days >= 2),
  status varchar(16) NOT NULL CHECK (status IN ('active', 'undone', 'superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz,
  UNIQUE (source_id),
  FOREIGN KEY (source_id, user_id, agent_id)
    REFERENCES installation_sources(id, user_id, agent_id) ON DELETE CASCADE,
  FOREIGN KEY (previous_account_id, user_id, agent_id)
    REFERENCES agent_accounts(id, user_id, agent_id) ON DELETE CASCADE,
  FOREIGN KEY (target_account_id, user_id, agent_id)
    REFERENCES agent_accounts(id, user_id, agent_id) ON DELETE CASCADE,
  CHECK (previous_account_id <> target_account_id),
  CHECK (
    (status = 'undone' AND undone_at IS NOT NULL)
    OR (status IN ('active', 'superseded') AND undone_at IS NULL)
  )
);

CREATE INDEX account_dedup_events_user_status_idx
  ON account_dedup_events(user_id, status, created_at DESC);
