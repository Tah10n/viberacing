CREATE TABLE schema_migrations (
  version varchar(128) PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  github_id bigint NOT NULL UNIQUE CHECK (github_id > 0),
  handle varchar(39) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_handle_lower_uidx ON users(lower(handle));

CREATE TABLE sessions (
  token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE installations (
  id uuid PRIMARY KEY,
  user_id bigint REFERENCES users(id) ON DELETE CASCADE,
  name varchar(40) CHECK (name IS NULL OR length(trim(name)) BETWEEN 1 AND 40),
  status varchar(16) NOT NULL CHECK (status IN ('pending', 'active', 'revoked')),
  installation_secret_hash bytea NOT NULL CHECK (octet_length(installation_secret_hash) = 32),
  pairing_code_hash bytea CHECK (pairing_code_hash IS NULL OR octet_length(pairing_code_hash) = 32),
  poll_token_hash bytea CHECK (poll_token_hash IS NULL OR octet_length(poll_token_hash) = 32),
  pending_device_token_hash bytea CHECK (
    pending_device_token_hash IS NULL OR octet_length(pending_device_token_hash) = 32
  ),
  device_token_hash bytea CHECK (device_token_hash IS NULL OR octet_length(device_token_hash) = 32),
  connector_version varchar(40) NOT NULL,
  protocol_version integer NOT NULL CHECK (protocol_version > 0),
  pairing_expires_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (id, user_id),
  CHECK (
    (status = 'pending' AND pairing_code_hash IS NOT NULL AND poll_token_hash IS NOT NULL
      AND pending_device_token_hash IS NOT NULL AND pairing_expires_at IS NOT NULL)
    OR (status = 'active' AND user_id IS NOT NULL AND name IS NOT NULL
      AND device_token_hash IS NOT NULL)
    OR status = 'revoked'
  )
);
CREATE UNIQUE INDEX installations_pairing_code_uidx
  ON installations(pairing_code_hash) WHERE pairing_code_hash IS NOT NULL;
CREATE UNIQUE INDEX installations_poll_token_uidx
  ON installations(poll_token_hash) WHERE poll_token_hash IS NOT NULL;
CREATE UNIQUE INDEX installations_device_token_uidx
  ON installations(device_token_hash) WHERE device_token_hash IS NOT NULL;
CREATE INDEX installations_user_status_idx ON installations(user_id, status, created_at DESC);
CREATE INDEX installations_pairing_expiration_idx
  ON installations(pairing_expires_at) WHERE status = 'pending';
CREATE INDEX installations_revoked_cleanup_idx
  ON installations(revoked_at) WHERE status = 'revoked';

CREATE TABLE agent_accounts (
  id uuid PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id varchar(32) NOT NULL CHECK (agent_id IN (
    'codex', 'claude_code', 'opencode', 'kimi_code',
    'qwen_code', 'cursor', 'antigravity', 'gemini_cli'
  )),
  label varchar(40) NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 40),
  aggregation_mode varchar(16) NOT NULL CHECK (aggregation_mode IN ('account_max', 'source_sum')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id, agent_id)
);
CREATE INDEX agent_accounts_user_agent_idx ON agent_accounts(user_id, agent_id, created_at);

CREATE TABLE installation_sources (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  user_id bigint,
  agent_account_id uuid,
  agent_id varchar(32) NOT NULL CHECK (agent_id IN (
    'codex', 'claude_code', 'opencode', 'kimi_code',
    'qwen_code', 'cursor', 'antigravity', 'gemini_cli'
  )),
  client_source_id varchar(128) NOT NULL CHECK (length(client_source_id) BETWEEN 1 AND 128),
  collection_method varchar(40) NOT NULL,
  supported_surface varchar(16) NOT NULL CHECK (supported_surface IN ('cli', 'desktop')),
  suggested_label varchar(40) CHECK (
    suggested_label IS NULL OR length(trim(suggested_label)) BETWEEN 1 AND 40
  ),
  status varchar(16) NOT NULL CHECK (status IN ('pending', 'active', 'disconnected')),
  last_successful_sync_at timestamptz,
  last_error_summary varchar(500),
  last_warning_summary varchar(500),
  last_completeness varchar(16) CHECK (
    last_completeness IS NULL OR last_completeness IN ('complete', 'partial')
  ),
  last_accepted_sync_sequence numeric(30,0) NOT NULL DEFAULT 0
    CHECK (last_accepted_sync_sequence >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (installation_id, client_source_id),
  FOREIGN KEY (installation_id, user_id) REFERENCES installations(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (agent_account_id, user_id, agent_id)
    REFERENCES agent_accounts(id, user_id, agent_id) ON DELETE CASCADE,
  CHECK (
    (status = 'pending' AND (
      (user_id IS NULL AND agent_account_id IS NULL)
      OR (user_id IS NOT NULL AND agent_account_id IS NOT NULL)
    ))
    OR (status IN ('active', 'disconnected') AND user_id IS NOT NULL AND agent_account_id IS NOT NULL)
  )
);
CREATE INDEX installation_sources_installation_idx
  ON installation_sources(installation_id, status, created_at);
CREATE INDEX installation_sources_owner_idx
  ON installation_sources(user_id, agent_account_id, status);

CREATE TABLE daily_usage (
  source_id uuid NOT NULL REFERENCES installation_sources(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  total_tokens numeric(30,0) NOT NULL CHECK (total_tokens >= 0),
  input_tokens numeric(30,0) CHECK (input_tokens >= 0),
  output_tokens numeric(30,0) CHECK (output_tokens >= 0),
  cache_read_tokens numeric(30,0) CHECK (cache_read_tokens >= 0),
  cache_write_tokens numeric(30,0) CHECK (cache_write_tokens >= 0),
  reasoning_tokens numeric(30,0) CHECK (reasoning_tokens >= 0),
  completeness varchar(16) NOT NULL CHECK (completeness IN ('complete', 'partial')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, usage_date)
);
CREATE INDEX daily_usage_date_source_idx ON daily_usage(usage_date, source_id);

CREATE TABLE weekly_agent_usage (
  week_start date NOT NULL,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id varchar(32) NOT NULL CHECK (agent_id IN (
    'codex', 'claude_code', 'opencode', 'kimi_code',
    'qwen_code', 'cursor', 'antigravity', 'gemini_cli'
  )),
  tokens numeric(30,0) NOT NULL CHECK (tokens >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (week_start, user_id, agent_id)
);
CREATE INDEX weekly_agent_usage_ranking_idx ON weekly_agent_usage(week_start, tokens DESC, user_id);
CREATE INDEX weekly_agent_usage_profile_idx ON weekly_agent_usage(user_id, week_start DESC, agent_id);

CREATE TABLE rate_limit_buckets (
  scope varchar(40) NOT NULL,
  key_hash bytea NOT NULL CHECK (octet_length(key_hash) = 32),
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope, key_hash, window_started_at)
);
CREATE INDEX rate_limit_buckets_expiration_idx ON rate_limit_buckets(expires_at);
