ALTER TABLE users ADD COLUMN ranking_hidden boolean NOT NULL DEFAULT false;
CREATE TABLE ranking_signals (
  user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  signals jsonb NOT NULL CHECK (jsonb_typeof(signals) = 'array' AND jsonb_array_length(signals) <= 32),
  observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ranking_signals_retention_idx ON ranking_signals(observed_at);
CREATE TABLE ranking_moderation_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hidden boolean NOT NULL,
  acted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ranking_moderation_log_user_idx ON ranking_moderation_log(user_id, id DESC);
CREATE INDEX ranking_moderation_log_retention_idx ON ranking_moderation_log(acted_at);
