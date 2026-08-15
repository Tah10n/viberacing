DELETE FROM daily_usage d
USING installation_sources s
WHERE d.source_id = s.id
  AND s.agent_id = 'cursor';

DELETE FROM weekly_agent_usage
WHERE agent_id = 'cursor';
