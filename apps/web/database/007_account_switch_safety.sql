ALTER TABLE installation_sources
  DROP CONSTRAINT installation_sources_profile_fk,
  ADD CONSTRAINT installation_sources_profile_fk
    FOREIGN KEY (profile_source_id, installation_id)
    REFERENCES installation_sources(id, installation_id) ON DELETE NO ACTION;

ALTER TABLE agent_accounts
  ADD COLUMN new_account_notice_pending boolean NOT NULL DEFAULT false;
