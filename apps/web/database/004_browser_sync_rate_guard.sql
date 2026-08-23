CREATE INDEX browser_sync_runs_installation_created_idx
  ON browser_sync_runs(installation_id, created_at DESC);
