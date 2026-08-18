ALTER TABLE weekly_agent_usage
  ALTER COLUMN tokens TYPE numeric;

DELETE FROM daily_usage d
USING installation_sources s
WHERE d.source_id = s.id
  AND s.agent_id = 'cursor';

DELETE FROM weekly_agent_usage
WHERE agent_id = 'cursor';

ALTER TABLE schema_migrations
  ADD COLUMN checksum char(64) NOT NULL DEFAULT repeat('0', 64);
ALTER TABLE schema_migrations
  ALTER COLUMN checksum DROP DEFAULT;
