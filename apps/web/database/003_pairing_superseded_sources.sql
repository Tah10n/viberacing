ALTER TABLE installation_sources
  ADD COLUMN pending_disconnect boolean NOT NULL DEFAULT false;
