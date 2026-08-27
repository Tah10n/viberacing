ALTER TABLE installation_sources
  ADD COLUMN profile_source_id uuid;

ALTER TABLE installation_sources
  ADD CONSTRAINT installation_sources_id_installation_unique UNIQUE (id, installation_id),
  ADD CONSTRAINT installation_sources_profile_not_self
    CHECK (profile_source_id IS NULL OR profile_source_id <> id),
  ADD CONSTRAINT installation_sources_profile_fk
    FOREIGN KEY (profile_source_id, installation_id)
    REFERENCES installation_sources(id, installation_id) ON DELETE CASCADE;

CREATE INDEX installation_sources_profile_idx
  ON installation_sources(profile_source_id, status, created_at)
  WHERE profile_source_id IS NOT NULL;

ALTER TABLE browser_sync_runs
  DROP CONSTRAINT browser_sync_runs_result_code_check,
  ADD CONSTRAINT browser_sync_runs_result_code_check CHECK (result_code IS NULL OR result_code IN (
    'complete', 'unchanged', 'partial', 'partial_accounts_inactive', 'account_setup_pending',
    'account_not_active', 'busy', 'collector_failed', 'network_failed',
    'authorization_failed', 'invalid_request'
  ));
