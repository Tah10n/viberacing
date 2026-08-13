CREATE TABLE IF NOT EXISTS users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  github_id bigint NOT NULL UNIQUE CHECK (github_id > 0),
  handle varchar(39) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_handle_lower_uidx ON users(lower(handle));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS connections (
  id uuid PRIMARY KEY,
  user_id bigint REFERENCES users(id) ON DELETE CASCADE,
  name varchar(40) CHECK (name IS NULL OR length(trim(name)) BETWEEN 1 AND 40),
  replaces_connection_id uuid REFERENCES connections(id) ON DELETE SET NULL,
  status varchar(16) NOT NULL CHECK (status IN ('pending', 'active', 'revoked')),
  agents text[] NOT NULL CHECK (cardinality(agents) BETWEEN 1 AND 2),
  code_hash bytea NOT NULL UNIQUE CHECK (octet_length(code_hash) = 32),
  poll_token_hash bytea NOT NULL UNIQUE CHECK (octet_length(poll_token_hash) = 32),
  device_token_hash bytea NOT NULL UNIQUE CHECK (octet_length(device_token_hash) = 32),
  expires_at timestamptz NOT NULL,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE connections ADD COLUMN IF NOT EXISTS name varchar(40);
ALTER TABLE connections ADD COLUMN IF NOT EXISTS replaces_connection_id uuid
  REFERENCES connections(id) ON DELETE SET NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'connections_name_check'
       AND conrelid = 'connections'::regclass
  ) THEN
    ALTER TABLE connections
      ADD CONSTRAINT connections_name_check
      CHECK (name IS NULL OR length(trim(name)) BETWEEN 1 AND 40);
  END IF;
END
$$;
UPDATE connections
   SET name = 'Computer ' || numbered.position
  FROM (
    SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at, id) AS position
      FROM connections
     WHERE user_id IS NOT NULL
  ) AS numbered
 WHERE connections.id = numbered.id AND connections.name IS NULL;
CREATE INDEX IF NOT EXISTS connections_user_id_idx ON connections(user_id);
DROP INDEX IF EXISTS connections_one_active_per_user_idx;
CREATE INDEX IF NOT EXISTS connections_active_user_idx
  ON connections(user_id, created_at DESC) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS daily_usage (
  connection_id uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent varchar(32) NOT NULL CHECK (agent IN ('codex', 'claude_code')),
  usage_date date NOT NULL,
  tokens numeric(30,0) NOT NULL CHECK (tokens >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, agent, usage_date)
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'daily_usage'::regclass
       AND contype = 'p'
       AND pg_get_constraintdef(oid) = 'PRIMARY KEY (connection_id, agent, usage_date)'
  ) THEN
    ALTER TABLE daily_usage DROP CONSTRAINT IF EXISTS daily_usage_pkey;
    ALTER TABLE daily_usage
      ADD CONSTRAINT daily_usage_pkey PRIMARY KEY (connection_id, agent, usage_date);
  END IF;
END
$$;
CREATE INDEX IF NOT EXISTS daily_usage_ranking_idx ON daily_usage(usage_date, user_id);
CREATE INDEX IF NOT EXISTS daily_usage_user_id_idx ON daily_usage(user_id);
