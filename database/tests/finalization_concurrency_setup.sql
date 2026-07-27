\set ON_ERROR_STOP on

-- Synthetic committed state for the idempotent finalization lock race. The isolated PostgreSQL
-- project is portless, tmpfs-backed, and destroyed in the integration runner's finally block.

BEGIN;
SET LOCAL ROLE viberacing_owner;

CREATE FUNCTION pg_temp.finalization_race_date(p_day_offset integer)
RETURNS date
LANGUAGE sql
STABLE
AS $function$
  SELECT pg_catalog.current_setting('viberacing.test_week_start')::date - 14 + p_day_offset
$function$;

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES (
  '00000000-0000-4000-8000-000000017101',
  900000000000017101,
  'finalization-race',
  'active'
);

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES (
  'src_' || pg_catalog.repeat('M', 22),
  '00000000-0000-4000-8000-000000017101'
);

-- This race verifies compatibility finalization, so bind it to a preserved legacy season instead
-- of letting the fixed production cutover change the expected projection as wall time advances.
INSERT INTO viberacing_private.seasons (
  season_start,
  season_end,
  score_version,
  state,
  grace_ends_at
)
VALUES (
  pg_temp.finalization_race_date(0),
  pg_temp.finalization_race_date(6),
  'community_v1',
  'open',
  viberacing_private.community_season_grace_ends_at(
    pg_temp.finalization_race_date(0)
  )
);

INSERT INTO viberacing_private.device_keys (
  device_key_id,
  device_id,
  source_id,
  public_key,
  label,
  connector_version,
  os_family,
  architecture,
  state,
  activated_at
)
VALUES (
  '00000000-0000-4000-8000-000000017401',
  'dev_' || pg_catalog.repeat('M', 22),
  'src_' || pg_catalog.repeat('M', 22),
  pg_catalog.decode(pg_catalog.lpad('17401', 64, '0'), 'hex'),
  'Concurrent finalization connector',
  '1.2.3',
  'linux',
  'x86_64',
  'active',
  pg_catalog.statement_timestamp()
);

INSERT INTO viberacing_private.usage_snapshots (
  usage_snapshot_id,
  device_key_id,
  device_id,
  source_id,
  sync_id,
  observed_at,
  connector_version,
  codex_version,
  body_digest,
  signature,
  nonce_digest,
  outcome,
  quarantine_reason,
  entry_count,
  received_at,
  retention_expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000017501',
  '00000000-0000-4000-8000-000000017401',
  'dev_' || pg_catalog.repeat('M', 22),
  'src_' || pg_catalog.repeat('M', 22),
  'syn_' || pg_catalog.repeat('M', 22),
  viberacing_private.community_season_grace_ends_at(pg_temp.finalization_race_date(0))
    - INTERVAL '1 hour',
  '1.2.3',
  '4.5.6',
  pg_catalog.decode(pg_catalog.lpad('17501', 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('27501', 128, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('37501', 64, '0'), 'hex'),
  'accepted',
  NULL,
  1,
  viberacing_private.community_season_grace_ends_at(pg_temp.finalization_race_date(0))
    - INTERVAL '1 hour',
  viberacing_private.community_season_grace_ends_at(pg_temp.finalization_race_date(0))
    + INTERVAL '30 days'
);

INSERT INTO viberacing_private.usage_snapshot_entries (
  usage_snapshot_id,
  codex_reported_date,
  tokens
)
VALUES (
  '00000000-0000-4000-8000-000000017501',
  pg_temp.finalization_race_date(0),
  100000
);

INSERT INTO viberacing_private.source_day_values (
  source_id,
  codex_reported_date,
  tokens,
  accepted_snapshot_id,
  accepted_sync_id,
  accepted_device_id,
  first_accepted_at,
  last_accepted_at
)
VALUES (
  'src_' || pg_catalog.repeat('M', 22),
  pg_temp.finalization_race_date(0),
  100000,
  '00000000-0000-4000-8000-000000017501',
  'syn_' || pg_catalog.repeat('M', 22),
  'dev_' || pg_catalog.repeat('M', 22),
  viberacing_private.community_season_grace_ends_at(pg_temp.finalization_race_date(0))
    - INTERVAL '1 hour',
  viberacing_private.community_season_grace_ends_at(pg_temp.finalization_race_date(0))
    - INTERVAL '1 hour'
);

COMMIT;
