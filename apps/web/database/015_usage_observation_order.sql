-- Server-issued observation tickets separate collection order from delivery order.
ALTER TABLE installations ADD COLUMN observation_key_hash bytea;
ALTER TABLE users ADD COLUMN usage_observation_cutover_at timestamptz;
ALTER TABLE users ADD COLUMN usage_observation_latest_at timestamptz;
