\set ON_ERROR_STOP on

-- Persist one synthetic revision-0038 terminal season so revision 0039 must exercise its backfill.
-- The future season cannot become retention-eligible in this disposable integration database.

BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES (
  '00000000-0000-4000-8000-000000039801',
  900000000000039801,
  'retention-backfill',
  'active'
);

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES (
  'src_' || pg_catalog.lpad('39801', 22, 'U'),
  '00000000-0000-4000-8000-000000039801'
);

INSERT INTO viberacing_private.seasons (
  season_start,
  season_end,
  score_version,
  created_at,
  refreshed_at,
  state,
  grace_ends_at,
  finalized_at
)
VALUES (
  DATE '2098-01-06',
  DATE '2098-01-12',
  'community_v1',
  TIMESTAMPTZ '2098-01-06 00:00:00+00',
  TIMESTAMPTZ '2098-01-15 00:30:00+00',
  'finalized',
  viberacing_private.community_season_grace_ends_at(DATE '2098-01-06'),
  TIMESTAMPTZ '2098-01-15 01:00:00+00'
);

INSERT INTO viberacing_private.source_day_values (
  source_id,
  codex_reported_date,
  tokens,
  accepted_sync_id,
  accepted_device_id,
  first_accepted_at,
  last_accepted_at
)
VALUES (
  'src_' || pg_catalog.lpad('39801', 22, 'U'),
  DATE '2098-01-06',
  123,
  'syn_' || pg_catalog.lpad('39801', 22, 'U'),
  'dev_' || pg_catalog.lpad('39801', 22, 'U'),
  TIMESTAMPTZ '2098-01-08 08:00:00+00',
  TIMESTAMPTZ '2098-01-08 09:00:00+00'
);

COMMIT;
