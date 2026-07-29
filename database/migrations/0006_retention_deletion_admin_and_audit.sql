\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824762001);

ALTER TABLE viberacing_private.pairing_transactions
  DROP CONSTRAINT pairing_transactions_lifecycle_shape,
  ADD CONSTRAINT pairing_transactions_lifecycle_shape CHECK (
    (state = 'pending'
      AND profile_id IS NULL
      AND approved_at IS NULL
      AND activated_at IS NULL
      AND approved_by_session_id IS NULL
      AND approved_by_passkey_id IS NULL)
    OR (state = 'approved'
      AND profile_id IS NOT NULL
      AND approved_at IS NOT NULL
      AND activated_at IS NULL
      AND approved_by_session_id IS NOT NULL
      AND approved_by_passkey_id IS NOT NULL)
    OR (state = 'activated'
      AND profile_id IS NOT NULL
      AND approved_at IS NOT NULL
      AND activated_at IS NOT NULL
      AND (
        (
          approved_by_session_id IS NOT NULL
          AND approved_by_passkey_id IS NOT NULL
        )
        OR (
          approved_by_session_id IS NULL
          AND approved_by_passkey_id IS NULL
        )
      ))
    OR (state IN ('rejected', 'expired') AND activated_at IS NULL)
  );

CREATE TABLE viberacing_private.profile_deletion_jobs (
  profile_id uuid PRIMARY KEY,
  state varchar(10) NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL,
  completed_at timestamptz,
  retention_expires_at timestamptz,
  CONSTRAINT profile_deletion_jobs_state_closed
    CHECK (state IN ('pending', 'completed')),
  CONSTRAINT profile_deletion_jobs_lifecycle_shape CHECK (
    (
      state = 'pending'
      AND completed_at IS NULL
      AND retention_expires_at IS NULL
    )
    OR (
      state = 'completed'
      AND completed_at >= requested_at
      AND retention_expires_at = completed_at + interval '30 days'
    )
  )
);

CREATE INDEX profile_deletion_jobs_due_idx
  ON viberacing_private.profile_deletion_jobs (state, requested_at, profile_id);

ALTER TABLE viberacing_private.maintenance_mutexes
  DROP CONSTRAINT maintenance_mutexes_capability_closed,
  ADD CONSTRAINT maintenance_mutexes_capability_closed CHECK (
    capability IN (
      'season_ensure',
      'leaderboard_refresh',
      'season_finalization',
      'pairing_cleanup',
      'usage_nonce_cleanup',
      'usage_history_cleanup',
      'auth_cleanup',
      'authority_cleanup',
      'profile_purge',
      'snapshot_cleanup',
      'audit_cleanup',
      'deletion_job_cleanup',
      'pairing_rate_reset'
    )
  );

INSERT INTO viberacing_private.maintenance_mutexes (capability)
VALUES
  ('pairing_cleanup'),
  ('usage_nonce_cleanup'),
  ('usage_history_cleanup'),
  ('auth_cleanup'),
  ('authority_cleanup'),
  ('profile_purge'),
  ('snapshot_cleanup'),
  ('audit_cleanup'),
  ('deletion_job_cleanup'),
  ('pairing_rate_reset');

CREATE OR REPLACE FUNCTION viberacing_api.request_profile_deletion(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_challenge_id uuid,
  p_context_digest bytea,
  p_verified_passkey_id uuid,
  p_new_sign_count bigint,
  p_backup_state boolean,
  p_typed_handle text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_profile_id uuid;
BEGIN
  v_profile_id := viberacing_api.consume_auth_challenge(
    p_session_id,
    p_session_verifier_digest,
    p_challenge_id,
    'profile_delete',
    p_context_digest,
    p_verified_passkey_id,
    p_new_sign_count,
    p_backup_state
  );

  UPDATE viberacing_private.profiles
  SET state = 'deletion_pending'
  WHERE profile_id = v_profile_id
    AND state = 'active'
    AND handle = p_typed_handle;
  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.pairing_transactions AS pairing
  SET state = 'expired'
  WHERE pairing.state IN ('pending', 'approved')
    AND (
      pairing.profile_id = v_profile_id
      OR pairing.installation_id IN (
        SELECT installation.installation_id
        FROM viberacing_private.connector_installations AS installation
        WHERE installation.profile_id = v_profile_id
      )
    );

  UPDATE viberacing_private.device_keys
  SET state = 'revoked',
      revoked_at = v_now
  WHERE profile_id = v_profile_id
    AND state = 'active';

  UPDATE viberacing_private.connector_installations
  SET state = 'revoked',
      revoked_at = v_now
  WHERE profile_id = v_profile_id
    AND state IN ('pending', 'active');

  UPDATE viberacing_private.agent_accounts
  SET state = 'unlinked'
  WHERE profile_id = v_profile_id
    AND state <> 'unlinked';

  UPDATE viberacing_private.sessions
  SET state = 'revoked',
      revoked_at = v_now
  WHERE profile_id = v_profile_id
    AND state = 'active';

  UPDATE viberacing_private.passkeys
  SET state = 'revoked',
      revoked_at = v_now
  WHERE profile_id = v_profile_id
    AND state = 'active';
END
$function$;

CREATE FUNCTION viberacing_private.enqueue_profile_deletion_job()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.state <> 'deletion_pending' AND NEW.state = 'deletion_pending' THEN
    INSERT INTO viberacing_private.profile_deletion_jobs (
      profile_id,
      requested_at
    )
    VALUES (
      NEW.profile_id,
      NEW.deletion_requested_at
    );
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER profiles_enqueue_deletion_job
AFTER UPDATE OF state ON viberacing_private.profiles
FOR EACH ROW EXECUTE FUNCTION viberacing_private.enqueue_profile_deletion_job();

CREATE FUNCTION viberacing_private.validate_maintenance_batch(
  p_batch_size integer,
  p_maximum integer
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF p_batch_size IS NULL
    OR p_maximum IS NULL
    OR p_maximum NOT BETWEEN 1 AND 1000
    OR p_batch_size NOT BETWEEN 1 AND p_maximum
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
END
$function$;

CREATE FUNCTION viberacing_private.try_lock_maintenance(p_capability text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  PERFORM 1
  FROM viberacing_private.maintenance_mutexes
  WHERE capability = p_capability
  FOR UPDATE SKIP LOCKED;
  RETURN FOUND;
END
$function$;

CREATE FUNCTION viberacing_api.cleanup_expired_pairing_state(p_batch_size integer)
RETURNS TABLE (
  deleted_pairings integer,
  deleted_accounts integer,
  deleted_installations integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  changed_rows bigint;
  pairing_candidate record;
  target_account_id text;
  target_account_ids text[];
BEGIN
  PERFORM viberacing_private.validate_maintenance_batch(p_batch_size, 1000);
  deleted_pairings := 0;
  deleted_accounts := 0;
  deleted_installations := 0;
  IF NOT viberacing_private.try_lock_maintenance('pairing_cleanup') THEN
    RETURN NEXT;
    RETURN;
  END IF;

  FOR pairing_candidate IN
    SELECT
      pairing.pairing_id,
      pairing.installation_id
    FROM viberacing_private.pairing_transactions AS pairing
    WHERE pairing.state IN ('pending', 'approved', 'rejected', 'expired')
      AND pairing.expires_at <= pg_catalog.clock_timestamp()
    ORDER BY pairing.expires_at, pairing.pairing_id
    LIMIT p_batch_size
    FOR UPDATE OF pairing SKIP LOCKED
  LOOP
    SELECT pg_catalog.array_agg(
      candidate.target_agent_account_id
      ORDER BY candidate.target_agent_account_id
    )
    INTO target_account_ids
    FROM (
      SELECT DISTINCT candidate.target_agent_account_id
      FROM viberacing_private.pairing_candidates AS candidate
      WHERE candidate.pairing_id = pairing_candidate.pairing_id
        AND candidate.decision = 'create'
        AND candidate.target_agent_account_id IS NOT NULL
    ) AS candidate;

    DELETE FROM viberacing_private.pairing_transactions
    WHERE pairing_id = pairing_candidate.pairing_id;
    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows <> 1 THEN
      PERFORM viberacing_private.operation_failed();
    END IF;
    deleted_pairings := deleted_pairings + 1;

    FOREACH target_account_id IN ARRAY coalesce(target_account_ids, ARRAY[]::text[])
    LOOP
      DELETE FROM viberacing_private.agent_accounts AS account
      WHERE account.agent_account_id = target_account_id
        AND NOT EXISTS (
          SELECT 1
          FROM viberacing_private.device_keys AS device
          WHERE device.agent_account_id = account.agent_account_id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM viberacing_private.agent_account_day_totals AS total
          WHERE total.agent_account_id = account.agent_account_id
        );
      GET DIAGNOSTICS changed_rows = ROW_COUNT;
      deleted_accounts := deleted_accounts + changed_rows::integer;
    END LOOP;

    DELETE FROM viberacing_private.connector_installations AS installation
    WHERE installation.installation_id = pairing_candidate.installation_id
      AND installation.state = 'pending'
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.pairing_transactions AS pairing
        WHERE pairing.installation_id = installation.installation_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.device_keys AS device
        WHERE device.installation_id = installation.installation_id
      );
    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    deleted_installations := deleted_installations + changed_rows::integer;
  END LOOP;

  RETURN NEXT;
END
$function$;

CREATE FUNCTION viberacing_api.cleanup_expired_usage_nonces(p_batch_size integer)
RETURNS TABLE (
  deleted_origin_nonces integer,
  deleted_device_nonces integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  PERFORM viberacing_private.validate_maintenance_batch(p_batch_size, 1000);
  deleted_origin_nonces := 0;
  deleted_device_nonces := 0;
  IF NOT viberacing_private.try_lock_maintenance('usage_nonce_cleanup') THEN
    RETURN NEXT;
    RETURN;
  END IF;

  WITH candidates AS MATERIALIZED (
    SELECT nonce.ctid
    FROM viberacing_private.origin_nonces AS nonce
    WHERE nonce.expires_at <= v_now
    ORDER BY nonce.expires_at, nonce.nonce_digest
    LIMIT p_batch_size
    FOR UPDATE OF nonce SKIP LOCKED
  ), deleted AS (
    DELETE FROM viberacing_private.origin_nonces AS nonce
    USING candidates
    WHERE nonce.ctid = candidates.ctid
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO deleted_origin_nonces
  FROM deleted;

  WITH candidates AS MATERIALIZED (
    SELECT nonce.ctid
    FROM viberacing_private.device_nonces AS nonce
    WHERE nonce.expires_at <= v_now
    ORDER BY nonce.expires_at, nonce.device_key_id, nonce.nonce_digest
    LIMIT p_batch_size
    FOR UPDATE OF nonce SKIP LOCKED
  ), deleted AS (
    DELETE FROM viberacing_private.device_nonces AS nonce
    USING candidates
    WHERE nonce.ctid = candidates.ctid
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO deleted_device_nonces
  FROM deleted;

  RETURN NEXT;
END
$function$;

CREATE FUNCTION viberacing_api.cleanup_expired_usage_history(p_batch_size integer)
RETURNS TABLE (
  redacted_day_totals integer,
  deleted_idempotency_records integer,
  deleted_observations integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  PERFORM viberacing_private.validate_maintenance_batch(p_batch_size, 1000);
  redacted_day_totals := 0;
  deleted_idempotency_records := 0;
  deleted_observations := 0;
  IF NOT viberacing_private.try_lock_maintenance('usage_history_cleanup') THEN
    RETURN NEXT;
    RETURN;
  END IF;

  PERFORM pg_catalog.set_config('viberacing.usage_retention', 'on', true);
  WITH candidates AS MATERIALIZED (
    SELECT observation.observation_id
    FROM viberacing_private.usage_observations AS observation
    WHERE observation.retention_expires_at <= v_now
    ORDER BY observation.retention_expires_at, observation.observation_id
    LIMIT p_batch_size
    FOR UPDATE OF observation SKIP LOCKED
  )
  UPDATE viberacing_private.agent_account_day_totals AS total
  SET accepted_observation_id = NULL,
      accepted_device_id = NULL,
      provenance_redacted_at = v_now
  FROM candidates
  WHERE total.accepted_observation_id = candidates.observation_id
    AND total.provenance_redacted_at IS NULL;
  GET DIAGNOSTICS redacted_day_totals = ROW_COUNT;

  WITH candidates AS MATERIALIZED (
    SELECT record.ctid
    FROM viberacing_private.usage_idempotency_records AS record
    WHERE record.retention_expires_at <= v_now
    ORDER BY record.retention_expires_at, record.device_key_id, record.sync_id
    LIMIT p_batch_size
    FOR UPDATE OF record SKIP LOCKED
  ), deleted AS (
    DELETE FROM viberacing_private.usage_idempotency_records AS record
    USING candidates
    WHERE record.ctid = candidates.ctid
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO deleted_idempotency_records
  FROM deleted;

  WITH candidates AS MATERIALIZED (
    SELECT observation.ctid
    FROM viberacing_private.usage_observations AS observation
    WHERE observation.retention_expires_at <= v_now
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.usage_idempotency_records AS record
        WHERE record.observation_id = observation.observation_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.agent_account_day_totals AS total
        WHERE total.accepted_observation_id = observation.observation_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.ranking_events AS event
        WHERE event.observation_id = observation.observation_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.ranking_refresh_outbox AS outbox
        WHERE outbox.last_observation_id = observation.observation_id
      )
    ORDER BY observation.retention_expires_at, observation.observation_id
    LIMIT p_batch_size
    FOR UPDATE OF observation SKIP LOCKED
  ), deleted AS (
    DELETE FROM viberacing_private.usage_observations AS observation
    USING candidates
    WHERE observation.ctid = candidates.ctid
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO deleted_observations
  FROM deleted;

  RETURN NEXT;
END
$function$;

CREATE FUNCTION viberacing_api.cleanup_expired_auth_state(p_batch_size integer)
RETURNS TABLE (
  deleted_challenges integer,
  deleted_sessions integer,
  deleted_invites integer,
  deleted_recovery_codes integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  PERFORM viberacing_private.validate_maintenance_batch(p_batch_size, 1000);
  deleted_challenges := 0;
  deleted_sessions := 0;
  deleted_invites := 0;
  deleted_recovery_codes := 0;
  IF NOT viberacing_private.try_lock_maintenance('auth_cleanup') THEN
    RETURN NEXT;
    RETURN;
  END IF;

  WITH candidates AS MATERIALIZED (
    SELECT challenge.ctid
    FROM viberacing_private.auth_challenges AS challenge
    WHERE challenge.expires_at <= v_now
      OR (
        challenge.state = 'consumed'
        AND challenge.consumed_at <= v_now - interval '30 days'
      )
    ORDER BY challenge.expires_at, challenge.challenge_id
    LIMIT p_batch_size
    FOR UPDATE OF challenge SKIP LOCKED
  ), deleted AS (
    DELETE FROM viberacing_private.auth_challenges AS challenge
    USING candidates
    WHERE challenge.ctid = candidates.ctid
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO deleted_challenges
  FROM deleted;

  WITH candidates AS MATERIALIZED (
    SELECT session.ctid
    FROM viberacing_private.sessions AS session
    WHERE (
      session.expires_at <= v_now
      OR (
        session.state = 'revoked'
        AND session.revoked_at <= v_now - interval '30 days'
      )
    )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.pairing_transactions AS pairing
        WHERE pairing.approved_by_session_id = session.session_id
      )
    ORDER BY session.expires_at, session.session_id
    LIMIT p_batch_size
    FOR UPDATE OF session SKIP LOCKED
  ), deleted AS (
    DELETE FROM viberacing_private.sessions AS session
    USING candidates
    WHERE session.ctid = candidates.ctid
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO deleted_sessions
  FROM deleted;

  WITH candidates AS MATERIALIZED (
    SELECT invite.ctid
    FROM viberacing_private.invites AS invite
    WHERE (
      invite.state = 'active'
      AND invite.expires_at <= v_now
    ) OR (
      invite.state = 'revoked'
      AND invite.issued_at <= v_now - interval '30 days'
    )
    ORDER BY invite.expires_at, invite.invite_id
    LIMIT p_batch_size
    FOR UPDATE OF invite SKIP LOCKED
  ), deleted AS (
    DELETE FROM viberacing_private.invites AS invite
    USING candidates
    WHERE invite.ctid = candidates.ctid
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO deleted_invites
  FROM deleted;

  WITH candidates AS MATERIALIZED (
    SELECT code.ctid
    FROM viberacing_private.recovery_codes AS code
    WHERE code.state = 'used'
      AND code.used_at <= v_now - interval '30 days'
    ORDER BY code.used_at, code.recovery_code_id
    LIMIT p_batch_size
    FOR UPDATE OF code SKIP LOCKED
  ), deleted AS (
    DELETE FROM viberacing_private.recovery_codes AS code
    USING candidates
    WHERE code.ctid = candidates.ctid
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO deleted_recovery_codes
  FROM deleted;

  RETURN NEXT;
END
$function$;

CREATE FUNCTION viberacing_api.cleanup_aged_revoked_authority(p_batch_size integer)
RETURNS TABLE (
  redacted_pairings integer,
  deleted_passkeys integer,
  deleted_device_keys integer,
  deleted_installations integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  PERFORM viberacing_private.validate_maintenance_batch(p_batch_size, 1000);
  redacted_pairings := 0;
  deleted_passkeys := 0;
  deleted_device_keys := 0;
  deleted_installations := 0;
  IF NOT viberacing_private.try_lock_maintenance('authority_cleanup') THEN
    RETURN NEXT;
    RETURN;
  END IF;

  WITH candidates AS MATERIALIZED (
    SELECT pairing.ctid
    FROM viberacing_private.pairing_transactions AS pairing
    WHERE pairing.state = 'activated'
      AND pairing.approved_at <= v_now - interval '180 days'
      AND pairing.approved_by_session_id IS NOT NULL
      AND pairing.approved_by_passkey_id IS NOT NULL
    ORDER BY pairing.approved_at, pairing.pairing_id
    LIMIT p_batch_size
    FOR UPDATE OF pairing SKIP LOCKED
  ), redacted AS (
    UPDATE viberacing_private.pairing_transactions AS pairing
    SET approved_by_session_id = NULL,
        approved_by_passkey_id = NULL
    FROM candidates
    WHERE pairing.ctid = candidates.ctid
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO redacted_pairings
  FROM redacted;

  WITH candidates AS MATERIALIZED (
    SELECT passkey.ctid
    FROM viberacing_private.passkeys AS passkey
    WHERE passkey.state = 'revoked'
      AND passkey.revoked_at <= v_now - interval '180 days'
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.sessions AS session
        WHERE session.authenticated_by_passkey_id = passkey.passkey_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.auth_challenges AS challenge
        WHERE challenge.verified_by_passkey_id = passkey.passkey_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.pairing_transactions AS pairing
        WHERE pairing.approved_by_passkey_id = passkey.passkey_id
      )
    ORDER BY passkey.revoked_at, passkey.passkey_id
    LIMIT p_batch_size
    FOR UPDATE OF passkey SKIP LOCKED
  ), deleted AS (
    DELETE FROM viberacing_private.passkeys AS passkey
    USING candidates
    WHERE passkey.ctid = candidates.ctid
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO deleted_passkeys
  FROM deleted;

  WITH candidates AS MATERIALIZED (
    SELECT device.ctid
    FROM viberacing_private.device_keys AS device
    WHERE device.state = 'revoked'
      AND device.revoked_at <= v_now - interval '180 days'
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.device_nonces AS nonce
        WHERE nonce.device_key_id = device.device_key_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.usage_idempotency_records AS record
        WHERE record.device_key_id = device.device_key_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.usage_observations AS observation
        WHERE observation.device_key_id = device.device_key_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.agent_account_day_totals AS total
        WHERE total.accepted_device_id = device.device_id
      )
    ORDER BY device.revoked_at, device.device_key_id
    LIMIT p_batch_size
    FOR UPDATE OF device SKIP LOCKED
  ), deleted AS (
    DELETE FROM viberacing_private.device_keys AS device
    USING candidates
    WHERE device.ctid = candidates.ctid
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO deleted_device_keys
  FROM deleted;

  WITH candidates AS MATERIALIZED (
    SELECT installation.ctid
    FROM viberacing_private.connector_installations AS installation
    WHERE installation.state = 'revoked'
      AND installation.revoked_at <= v_now - interval '180 days'
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.device_keys AS device
        WHERE device.installation_id = installation.installation_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.pairing_transactions AS pairing
        WHERE pairing.installation_id = installation.installation_id
      )
    ORDER BY installation.revoked_at, installation.installation_id
    LIMIT p_batch_size
    FOR UPDATE OF installation SKIP LOCKED
  ), deleted AS (
    DELETE FROM viberacing_private.connector_installations AS installation
    USING candidates
    WHERE installation.ctid = candidates.ctid
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO deleted_installations
  FROM deleted;

  RETURN NEXT;
END
$function$;

CREATE FUNCTION viberacing_api.cleanup_snapshot_history(p_batch_size integer)
RETURNS TABLE (
  deleted_snapshots integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  PERFORM viberacing_private.validate_maintenance_batch(p_batch_size, 1000);
  deleted_snapshots := 0;
  IF NOT viberacing_private.try_lock_maintenance('snapshot_cleanup') THEN
    RETURN NEXT;
    RETURN;
  END IF;

  WITH candidates AS MATERIALIZED (
    SELECT snapshot.ctid
    FROM viberacing_private.leaderboard_snapshots AS snapshot
    WHERE NOT snapshot.finalized
      AND (
        (
          snapshot.state = 'building'
          AND snapshot.generated_at <= v_now - interval '1 hour'
        )
        OR (
          snapshot.state = 'superseded'
          AND snapshot.generated_at <= v_now - interval '30 days'
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.leaderboard_published_snapshots AS published
        WHERE published.snapshot_id = snapshot.snapshot_id
      )
    ORDER BY snapshot.generated_at, snapshot.snapshot_id
    LIMIT p_batch_size
    FOR UPDATE OF snapshot SKIP LOCKED
  ), deleted AS (
    DELETE FROM viberacing_private.leaderboard_snapshots AS snapshot
    USING candidates
    WHERE snapshot.ctid = candidates.ctid
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO deleted_snapshots
  FROM deleted;

  RETURN NEXT;
END
$function$;

CREATE FUNCTION viberacing_api.cleanup_expired_ranking_events(p_batch_size integer)
RETURNS TABLE (
  deleted_events integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  PERFORM viberacing_private.validate_maintenance_batch(p_batch_size, 1000);
  deleted_events := 0;
  IF NOT viberacing_private.try_lock_maintenance('audit_cleanup') THEN
    RETURN NEXT;
    RETURN;
  END IF;

  WITH candidates AS MATERIALIZED (
    SELECT event.ctid
    FROM viberacing_private.ranking_events AS event
    WHERE event.occurred_at <= v_now - interval '180 days'
    ORDER BY event.occurred_at, event.event_id
    LIMIT p_batch_size
    FOR UPDATE OF event SKIP LOCKED
  ), deleted AS (
    DELETE FROM viberacing_private.ranking_events AS event
    USING candidates
    WHERE event.ctid = candidates.ctid
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO deleted_events
  FROM deleted;

  RETURN NEXT;
END
$function$;

CREATE FUNCTION viberacing_api.purge_profile_deletions(p_batch_size integer)
RETURNS TABLE (
  purged_profiles integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  candidate record;
  changed_rows bigint;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  PERFORM viberacing_private.validate_maintenance_batch(p_batch_size, 10);
  purged_profiles := 0;
  IF NOT viberacing_private.try_lock_maintenance('profile_purge') THEN
    RETURN NEXT;
    RETURN;
  END IF;

  FOR candidate IN
    SELECT
      job.profile_id,
      profile.handle
    FROM viberacing_private.profile_deletion_jobs AS job
    JOIN viberacing_private.profiles AS profile
      ON profile.profile_id = job.profile_id
    WHERE job.state = 'pending'
      AND profile.state = 'deletion_pending'
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.leaderboard_published_snapshots AS published
        JOIN viberacing_private.seasons AS season
          ON season.season_start = published.season_start
          AND season.trust_tier = published.trust_tier
        JOIN viberacing_private.leaderboard_snapshot_profiles AS snapshot_profile
          ON snapshot_profile.snapshot_id = published.snapshot_id
          AND snapshot_profile.handle = profile.handle
        WHERE season.state <> 'finalized'
      )
    ORDER BY job.requested_at, job.profile_id
    LIMIT p_batch_size
    FOR UPDATE OF job, profile SKIP LOCKED
  LOOP
    PERFORM pg_catalog.set_config(
      'viberacing.profile_purge',
      candidate.profile_id::text,
      true
    );

    DELETE FROM viberacing_private.season_profile_totals
    WHERE profile_id = candidate.profile_id;

    DELETE FROM viberacing_private.ranking_events AS event
    WHERE event.profile_id = candidate.profile_id
      OR event.agent_account_id IN (
        SELECT account.agent_account_id
        FROM viberacing_private.agent_accounts AS account
        WHERE account.profile_id = candidate.profile_id
      )
      OR event.observation_id IN (
        SELECT observation.observation_id
        FROM viberacing_private.usage_observations AS observation
        JOIN viberacing_private.agent_accounts AS account
          ON account.agent_account_id = observation.agent_account_id
        WHERE account.profile_id = candidate.profile_id
      );

    DELETE FROM viberacing_private.usage_idempotency_records AS record
    WHERE record.agent_account_id IN (
      SELECT account.agent_account_id
      FROM viberacing_private.agent_accounts AS account
      WHERE account.profile_id = candidate.profile_id
    );

    DELETE FROM viberacing_private.agent_account_day_totals AS total
    WHERE total.agent_account_id IN (
      SELECT account.agent_account_id
      FROM viberacing_private.agent_accounts AS account
      WHERE account.profile_id = candidate.profile_id
    );

    DELETE FROM viberacing_private.usage_observations AS observation
    WHERE observation.agent_account_id IN (
      SELECT account.agent_account_id
      FROM viberacing_private.agent_accounts AS account
      WHERE account.profile_id = candidate.profile_id
    );

    DELETE FROM viberacing_private.pairing_transactions AS pairing
    WHERE pairing.profile_id = candidate.profile_id
      OR pairing.installation_id IN (
        SELECT installation.installation_id
        FROM viberacing_private.connector_installations AS installation
        WHERE installation.profile_id = candidate.profile_id
      );

    DELETE FROM viberacing_private.invites
    WHERE redeemed_by_profile_id = candidate.profile_id;

    DELETE FROM viberacing_private.profiles
    WHERE profile_id = candidate.profile_id
      AND state = 'deletion_pending';
    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows <> 1 THEN
      PERFORM viberacing_private.operation_failed();
    END IF;

    UPDATE viberacing_private.profile_deletion_jobs
    SET state = 'completed',
        completed_at = v_now,
        retention_expires_at = v_now + interval '30 days'
    WHERE profile_id = candidate.profile_id
      AND state = 'pending';
    IF NOT FOUND THEN
      PERFORM viberacing_private.operation_failed();
    END IF;
    purged_profiles := purged_profiles + 1;
  END LOOP;

  RETURN NEXT;
END
$function$;

CREATE FUNCTION viberacing_api.cleanup_terminal_deletion_jobs(p_batch_size integer)
RETURNS TABLE (
  deleted_deletion_jobs integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
BEGIN
  PERFORM viberacing_private.validate_maintenance_batch(p_batch_size, 1000);
  deleted_deletion_jobs := 0;
  IF NOT viberacing_private.try_lock_maintenance('deletion_job_cleanup') THEN
    RETURN NEXT;
    RETURN;
  END IF;

  WITH candidates AS MATERIALIZED (
    SELECT job.ctid
    FROM viberacing_private.profile_deletion_jobs AS job
    WHERE job.state = 'completed'
      AND job.retention_expires_at <= pg_catalog.clock_timestamp()
    ORDER BY job.retention_expires_at, job.profile_id
    LIMIT p_batch_size
    FOR UPDATE OF job SKIP LOCKED
  ), deleted AS (
    DELETE FROM viberacing_private.profile_deletion_jobs AS job
    USING candidates
    WHERE job.ctid = candidates.ctid
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO deleted_deletion_jobs
  FROM deleted;

  RETURN NEXT;
END
$function$;

CREATE FUNCTION viberacing_api.reset_expired_pairing_request_windows()
RETURNS TABLE (
  reset_windows integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  candidate record;
  changed_rows bigint;
  cutoff_at timestamptz(3);
  inventory_count bigint;
BEGIN
  reset_windows := 0;
  IF NOT viberacing_private.try_lock_maintenance('pairing_rate_reset') THEN
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT pg_catalog.count(*)
  INTO inventory_count
  FROM viberacing_private.pairing_request_windows;
  IF inventory_count <> 130 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  cutoff_at := pg_catalog.clock_timestamp() - interval '1 hour';
  FOR candidate IN
    SELECT
      window_record.operation,
      window_record.bucket
    FROM viberacing_private.pairing_request_windows AS window_record
    WHERE window_record.attempt_count > 0
      AND window_record.window_started_at <= cutoff_at
    ORDER BY window_record.operation, window_record.bucket
    LIMIT 130
    FOR UPDATE OF window_record
  LOOP
    UPDATE viberacing_private.pairing_request_windows AS window_record
    SET window_started_at = TIMESTAMPTZ '1970-01-01 00:00:00+00',
        attempt_count = 0
    WHERE window_record.operation = candidate.operation
      AND window_record.bucket = candidate.bucket
      AND window_record.attempt_count > 0
      AND window_record.window_started_at <= cutoff_at;
    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows <> 1 THEN
      PERFORM viberacing_private.operation_failed();
    END IF;
    reset_windows := reset_windows + 1;
  END LOOP;

  RETURN NEXT;
END
$function$;

ALTER TABLE viberacing_private.profile_deletion_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.profile_deletion_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY profile_deletion_jobs_owner_only
  ON viberacing_private.profile_deletion_jobs
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

REVOKE ALL ON TABLE viberacing_private.profile_deletion_jobs
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA viberacing_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA viberacing_api FROM PUBLIC;

GRANT EXECUTE ON FUNCTION viberacing_api.cleanup_expired_pairing_state(integer)
  TO viberacing_jobs;
GRANT EXECUTE ON FUNCTION viberacing_api.cleanup_expired_usage_nonces(integer)
  TO viberacing_jobs;
GRANT EXECUTE ON FUNCTION viberacing_api.cleanup_expired_usage_history(integer)
  TO viberacing_jobs;
GRANT EXECUTE ON FUNCTION viberacing_api.cleanup_expired_auth_state(integer)
  TO viberacing_jobs;
GRANT EXECUTE ON FUNCTION viberacing_api.cleanup_aged_revoked_authority(integer)
  TO viberacing_jobs;
GRANT EXECUTE ON FUNCTION viberacing_api.cleanup_snapshot_history(integer)
  TO viberacing_jobs;
GRANT EXECUTE ON FUNCTION viberacing_api.cleanup_expired_ranking_events(integer)
  TO viberacing_jobs;
GRANT EXECUTE ON FUNCTION viberacing_api.purge_profile_deletions(integer)
  TO viberacing_jobs;
GRANT EXECUTE ON FUNCTION viberacing_api.cleanup_terminal_deletion_jobs(integer)
  TO viberacing_jobs;
GRANT EXECUTE ON FUNCTION viberacing_api.reset_expired_pairing_request_windows()
  TO viberacing_jobs;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (6, 'retention_deletion_admin_and_audit');

COMMIT;
