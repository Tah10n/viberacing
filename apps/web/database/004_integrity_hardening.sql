ALTER TABLE weekly_agent_usage
  ALTER COLUMN tokens TYPE numeric;

ALTER TABLE schema_migrations
  ADD COLUMN checksum char(64) NOT NULL DEFAULT repeat('0', 64);
ALTER TABLE schema_migrations
  ALTER COLUMN checksum DROP DEFAULT;
