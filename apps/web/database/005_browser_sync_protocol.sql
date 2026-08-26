ALTER TABLE installations
  ADD COLUMN browser_sync_protocol smallint NOT NULL DEFAULT 0;

UPDATE installations
   SET browser_sync_protocol = 1
 WHERE browser_sync_capable;

-- Keep the legacy capability and the new protocol independently writable so the previous web
-- release remains valid while this pre-deploy migration is active and after an application rollback.
ALTER TABLE installations
  ADD CONSTRAINT installations_browser_sync_protocol_check
  CHECK (browser_sync_protocol BETWEEN 0 AND 2);

-- Account-scoped rows retain their old default and foreign key. Installation-scoped rows have no
-- arbitrary account owner, so deleting one account cannot erase an installation-wide run.
ALTER TABLE browser_sync_runs
  ADD COLUMN scope varchar(16) NOT NULL DEFAULT 'account',
  ALTER COLUMN agent_account_id DROP NOT NULL,
  ALTER COLUMN agent_id DROP NOT NULL,
  ADD CONSTRAINT browser_sync_runs_scope_value_check
    CHECK (scope IN ('account', 'installation')),
  ADD CONSTRAINT browser_sync_runs_scope_owner_check CHECK (
    (scope = 'account' AND agent_account_id IS NOT NULL AND agent_id IS NOT NULL)
    OR (scope = 'installation' AND agent_account_id IS NULL AND agent_id IS NULL)
  );
