\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824762001);

CREATE TABLE viberacing_private.invites (
  invite_id uuid PRIMARY KEY,
  verifier_digest bytea NOT NULL UNIQUE,
  state varchar(12) NOT NULL DEFAULT 'active',
  reason_code varchar(32) NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz,
  redeemed_by_profile_id uuid REFERENCES viberacing_private.profiles(profile_id)
    ON DELETE SET NULL,
  CONSTRAINT invites_verifier_digest_exact CHECK (pg_catalog.octet_length(verifier_digest) = 32),
  CONSTRAINT invites_state_closed CHECK (state IN ('active', 'redeemed', 'revoked')),
  CONSTRAINT invites_reason_canonical CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,31}$'),
  CONSTRAINT invites_time_order CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '90 days'),
  CONSTRAINT invites_terminal_shape CHECK (
    (state = 'redeemed' AND redeemed_at IS NOT NULL AND redeemed_by_profile_id IS NOT NULL)
    OR (state <> 'redeemed' AND redeemed_at IS NULL AND redeemed_by_profile_id IS NULL)
  )
);

CREATE TABLE viberacing_private.passkeys (
  passkey_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES viberacing_private.profiles(profile_id) ON DELETE CASCADE,
  credential_id bytea NOT NULL UNIQUE,
  cose_public_key bytea NOT NULL,
  sign_count bigint NOT NULL DEFAULT 0,
  backup_eligible boolean NOT NULL,
  backup_state boolean NOT NULL,
  label varchar(48) NOT NULL,
  state varchar(8) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT passkeys_credential_id_bounded
    CHECK (pg_catalog.octet_length(credential_id) BETWEEN 16 AND 1024),
  CONSTRAINT passkeys_public_key_bounded
    CHECK (pg_catalog.octet_length(cose_public_key) BETWEEN 16 AND 4096),
  CONSTRAINT passkeys_sign_count_nonnegative CHECK (sign_count >= 0),
  CONSTRAINT passkeys_label_bounded CHECK (
    pg_catalog.length(label) BETWEEN 1 AND 48
    AND label !~ '[[:cntrl:]]'
  ),
  CONSTRAINT passkeys_state_closed CHECK (state IN ('active', 'revoked')),
  CONSTRAINT passkeys_revocation_shape CHECK (
    (state = 'active' AND revoked_at IS NULL)
    OR (state = 'revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX passkeys_one_active_label_per_profile_idx
  ON viberacing_private.passkeys (profile_id, pg_catalog.lower(label))
  WHERE state = 'active';

ALTER TABLE viberacing_private.passkeys
  ADD CONSTRAINT passkeys_profile_id_id_unique UNIQUE (profile_id, passkey_id);

CREATE TABLE viberacing_private.sessions (
  session_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES viberacing_private.profiles(profile_id) ON DELETE CASCADE,
  verifier_digest bytea NOT NULL UNIQUE,
  authenticated_by_passkey_id uuid REFERENCES viberacing_private.passkeys(passkey_id),
  authentication_kind varchar(12) NOT NULL,
  state varchar(8) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  revoked_at timestamptz,
  CONSTRAINT sessions_verifier_digest_exact CHECK (pg_catalog.octet_length(verifier_digest) = 32),
  CONSTRAINT sessions_authentication_kind_closed
    CHECK (authentication_kind IN ('github', 'passkey', 'recovery')),
  CONSTRAINT sessions_state_closed CHECK (state IN ('active', 'revoked')),
  CONSTRAINT sessions_time_order CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '30 days'
    AND last_used_at >= created_at
  ),
  CONSTRAINT sessions_passkey_shape CHECK (
    (authentication_kind = 'github' AND authenticated_by_passkey_id IS NULL)
    OR (authentication_kind IN ('passkey', 'recovery') AND authenticated_by_passkey_id IS NOT NULL)
  ),
  CONSTRAINT sessions_revocation_shape CHECK (
    (state = 'active' AND revoked_at IS NULL)
    OR (state = 'revoked' AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT sessions_passkey_profile_fk
    FOREIGN KEY (profile_id, authenticated_by_passkey_id)
    REFERENCES viberacing_private.passkeys(profile_id, passkey_id)
    DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX sessions_profile_active_idx
  ON viberacing_private.sessions (profile_id, expires_at)
  WHERE state = 'active';

ALTER TABLE viberacing_private.sessions
  ADD CONSTRAINT sessions_id_profile_unique UNIQUE (session_id, profile_id);

CREATE TABLE viberacing_private.auth_challenges (
  challenge_id uuid PRIMARY KEY,
  session_id uuid REFERENCES viberacing_private.sessions(session_id) ON DELETE CASCADE,
  profile_id uuid REFERENCES viberacing_private.profiles(profile_id) ON DELETE CASCADE,
  purpose varchar(32) NOT NULL,
  challenge_digest bytea NOT NULL,
  context_digest bytea NOT NULL,
  state varchar(10) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  verified_by_passkey_id uuid REFERENCES viberacing_private.passkeys(passkey_id),
  CONSTRAINT auth_challenges_purpose_closed CHECK (
    purpose IN (
      'initial_passkey',
      'passkey_login',
      'pairing_batch_approval',
      'account_reactivate',
      'account_unlink',
      'device_revoke',
      'installation_revoke',
      'passkey_change',
      'recovery_change',
      'profile_delete'
    )
  ),
  CONSTRAINT auth_challenges_digest_exact CHECK (
    pg_catalog.octet_length(challenge_digest) = 32
    AND pg_catalog.octet_length(context_digest) = 32
  ),
  CONSTRAINT auth_challenges_state_closed CHECK (state IN ('pending', 'consumed')),
  CONSTRAINT auth_challenges_time_order CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '5 minutes'
  ),
  CONSTRAINT auth_challenges_session_shape CHECK (
    (purpose = 'passkey_login' AND session_id IS NULL AND profile_id IS NULL)
    OR (purpose <> 'passkey_login' AND session_id IS NOT NULL AND profile_id IS NOT NULL)
  ),
  CONSTRAINT auth_challenges_consumed_shape CHECK (
    (state = 'pending' AND consumed_at IS NULL AND verified_by_passkey_id IS NULL)
    OR (state = 'consumed' AND consumed_at IS NOT NULL)
  ),
  CONSTRAINT auth_challenges_session_profile_fk
    FOREIGN KEY (session_id, profile_id)
    REFERENCES viberacing_private.sessions(session_id, profile_id)
    DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE viberacing_private.recovery_codes (
  recovery_code_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES viberacing_private.profiles(profile_id) ON DELETE CASCADE,
  batch_id uuid NOT NULL,
  position smallint NOT NULL,
  verifier_phc varchar(256) UNIQUE,
  state varchar(8) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  used_at timestamptz,
  CONSTRAINT recovery_codes_position_bounded CHECK (position BETWEEN 0 AND 9),
  CONSTRAINT recovery_codes_phc_canonical CHECK (
    verifier_phc IS NULL
    OR verifier_phc ~ '^\$argon2id\$v=[0-9]+\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$'
  ),
  CONSTRAINT recovery_codes_state_closed CHECK (state IN ('active', 'used')),
  CONSTRAINT recovery_codes_used_shape CHECK (
    (state = 'active' AND verifier_phc IS NOT NULL AND used_at IS NULL)
    OR (state = 'used' AND verifier_phc IS NULL AND used_at >= created_at)
  ),
  CONSTRAINT recovery_codes_batch_position_unique UNIQUE (batch_id, position)
);

CREATE TABLE viberacing_private.recovery_authorities (
  recovery_authority_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES viberacing_private.profiles(profile_id) ON DELETE CASCADE,
  source_recovery_code_id uuid NOT NULL,
  verifier_digest bytea NOT NULL UNIQUE,
  challenge_digest bytea NOT NULL,
  context_digest bytea NOT NULL,
  state varchar(9) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT recovery_authorities_digest_shape CHECK (
    pg_catalog.octet_length(verifier_digest) = 32
    AND pg_catalog.octet_length(challenge_digest) = 32
    AND pg_catalog.octet_length(context_digest) = 32
  ),
  CONSTRAINT recovery_authorities_state_closed
    CHECK (state IN ('active', 'completed', 'revoked')),
  CONSTRAINT recovery_authorities_expiry_bounded CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '10 minutes'
  ),
  CONSTRAINT recovery_authorities_lifecycle_shape CHECK (
    (state = 'active' AND completed_at IS NULL AND revoked_at IS NULL)
    OR (
      state = 'completed'
      AND completed_at >= created_at
      AND revoked_at IS NULL
    )
    OR (
      state = 'revoked'
      AND revoked_at >= created_at
      AND completed_at IS NULL
    )
  )
);

CREATE UNIQUE INDEX recovery_authorities_one_active_per_profile_idx
  ON viberacing_private.recovery_authorities (profile_id)
  WHERE state = 'active';

CREATE INDEX recovery_authorities_expiry_idx
  ON viberacing_private.recovery_authorities (expires_at, recovery_authority_id)
  WHERE state = 'active';

CREATE FUNCTION viberacing_private.authenticate_session(
  p_session_id uuid,
  p_verifier_digest bytea
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_profile_id uuid;
BEGIN
  IF p_session_id IS NULL OR pg_catalog.octet_length(p_verifier_digest) <> 32 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT session.profile_id
  INTO v_profile_id
  FROM viberacing_private.sessions AS session
  JOIN viberacing_private.profiles AS profile
    ON profile.profile_id = session.profile_id
  WHERE session.session_id = p_session_id
    AND session.verifier_digest = p_verifier_digest
    AND session.state = 'active'
    AND session.expires_at > pg_catalog.transaction_timestamp()
    AND profile.state IN ('enrolling', 'active');

  IF v_profile_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
  RETURN v_profile_id;
END
$function$;

CREATE FUNCTION viberacing_api.issue_invite(
  p_invite_id uuid,
  p_verifier_digest bytea,
  p_reason_code text,
  p_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF p_invite_id IS NULL
    OR pg_catalog.octet_length(p_verifier_digest) <> 32
    OR p_reason_code !~ '^[A-Z][A-Z0-9_]{2,31}$'
    OR p_expires_at <= pg_catalog.transaction_timestamp()
    OR p_expires_at > pg_catalog.transaction_timestamp() + interval '90 days'
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  INSERT INTO viberacing_private.invites (
    invite_id,
    verifier_digest,
    reason_code,
    expires_at
  )
  VALUES (p_invite_id, p_verifier_digest, p_reason_code, p_expires_at);
EXCEPTION
  WHEN unique_violation OR check_violation OR foreign_key_violation THEN
    PERFORM viberacing_private.operation_failed();
END
$function$;

CREATE FUNCTION viberacing_api.open_github_profile(
  p_profile_id uuid,
  p_github_user_id bigint,
  p_provisional_handle text,
  p_locale text,
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_session_expires_at timestamptz,
  p_invite_id uuid,
  p_invite_verifier_digest bytea,
  p_invite_required boolean
)
RETURNS TABLE (
  profile_id uuid,
  handle text,
  locale text,
  profile_state text,
  created boolean,
  session_created boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_profile viberacing_private.profiles%ROWTYPE;
  v_created boolean := false;
  v_session_created boolean := false;
BEGIN
  IF p_profile_id IS NULL
    OR p_github_user_id IS NULL
    OR p_github_user_id <= 0
    OR p_provisional_handle IS NULL
    OR p_provisional_handle !~ '^pending_[a-f0-9]{16}$'
    OR p_locale NOT IN ('en', 'ru')
    OR p_session_id IS NULL
    OR p_session_verifier_digest IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) <> 32
    OR p_session_expires_at <= v_now
    OR p_session_expires_at > v_now + interval '24 hours'
    OR p_invite_required IS NULL
    OR (
      p_invite_required
      AND (
        p_invite_id IS NULL
        OR p_invite_verifier_digest IS NULL
        OR pg_catalog.octet_length(p_invite_verifier_digest) <> 32
      )
    )
    OR (
      NOT p_invite_required
      AND (p_invite_id IS NOT NULL OR p_invite_verifier_digest IS NOT NULL)
    )
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  -- Serialize only completions for the same immutable upstream identity. This makes a repeated or
  -- concurrent OAuth callback converge before independent handle uniqueness is evaluated.
  PERFORM pg_catalog.pg_advisory_xact_lock(p_github_user_id);

  SELECT profile.*
  INTO v_profile
  FROM viberacing_private.profiles AS profile
  WHERE profile.github_user_id = p_github_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF p_invite_required THEN
      PERFORM 1
      FROM viberacing_private.invites AS invite
      WHERE invite.invite_id = p_invite_id
        AND invite.verifier_digest = p_invite_verifier_digest
        AND invite.state = 'active'
        AND invite.expires_at > v_now
      FOR UPDATE;
      IF NOT FOUND THEN
        PERFORM viberacing_private.operation_failed();
      END IF;
    END IF;

    INSERT INTO viberacing_private.profiles (
      profile_id,
      github_user_id,
      handle,
      locale,
      hidden_at
    )
    VALUES (p_profile_id, p_github_user_id, p_provisional_handle, p_locale, v_now);

    SELECT profile.*
    INTO v_profile
    FROM viberacing_private.profiles AS profile
    WHERE profile.github_user_id = p_github_user_id
    FOR UPDATE;

    IF v_profile.profile_id = p_profile_id THEN
      v_created := true;
      IF p_invite_required THEN
        UPDATE viberacing_private.invites
        SET state = 'redeemed',
            redeemed_at = v_now,
            redeemed_by_profile_id = v_profile.profile_id
        WHERE invite_id = p_invite_id
          AND verifier_digest = p_invite_verifier_digest
          AND state = 'active';
        IF NOT FOUND THEN
          PERFORM viberacing_private.operation_failed();
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_profile.profile_id IS NULL OR v_profile.state = 'deletion_pending' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  IF v_profile.state = 'enrolling' THEN
    INSERT INTO viberacing_private.sessions (
      session_id,
      profile_id,
      verifier_digest,
      authentication_kind,
      expires_at
    )
    VALUES (
      p_session_id,
      v_profile.profile_id,
      p_session_verifier_digest,
      'github',
      p_session_expires_at
    );
    v_session_created := true;
  END IF;

  RETURN QUERY
  SELECT
    v_profile.profile_id,
    v_profile.handle::text,
    v_profile.locale::text,
    v_profile.state::text,
    v_created,
    v_session_created;
EXCEPTION
  WHEN unique_violation OR check_violation OR foreign_key_violation THEN
    PERFORM viberacing_private.operation_failed();
END
$function$;

CREATE FUNCTION viberacing_api.begin_initial_passkey(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_handle text,
  p_challenge_id uuid,
  p_challenge_digest bytea,
  p_context_digest bytea,
  p_expires_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_profile_id uuid;
BEGIN
  v_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest
  );
  IF p_handle IS NULL
    OR p_handle !~ '^[a-z0-9](?:[a-z0-9_-]{1,22}[a-z0-9])$'
    OR p_handle ~ '^pending_'
    OR p_challenge_id IS NULL
    OR pg_catalog.octet_length(p_challenge_digest) <> 32
    OR pg_catalog.octet_length(p_context_digest) <> 32
    OR p_expires_at <= pg_catalog.transaction_timestamp()
    OR p_expires_at > pg_catalog.transaction_timestamp() + interval '5 minutes'
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.profiles
  SET handle = p_handle
  WHERE profile_id = v_profile_id
    AND state = 'enrolling';
  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  INSERT INTO viberacing_private.auth_challenges (
    challenge_id,
    session_id,
    profile_id,
    purpose,
    challenge_digest,
    context_digest,
    expires_at
  )
  VALUES (
    p_challenge_id,
    p_session_id,
    v_profile_id,
    'initial_passkey',
    p_challenge_digest,
    p_context_digest,
    p_expires_at
  );
  RETURN p_challenge_id;
EXCEPTION
  WHEN unique_violation OR check_violation OR foreign_key_violation THEN
    PERFORM viberacing_private.operation_failed();
END
$function$;

CREATE FUNCTION viberacing_api.create_auth_challenge(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_challenge_id uuid,
  p_purpose text,
  p_challenge_digest bytea,
  p_context_digest bytea,
  p_expires_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_profile_id uuid;
BEGIN
  v_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest
  );
  IF p_challenge_id IS NULL
    OR p_purpose = 'passkey_login'
    OR p_purpose NOT IN (
      'initial_passkey',
      'pairing_batch_approval',
      'account_reactivate',
      'account_unlink',
      'device_revoke',
      'installation_revoke',
      'passkey_change',
      'recovery_change',
      'profile_delete'
    )
    OR pg_catalog.octet_length(p_challenge_digest) <> 32
    OR pg_catalog.octet_length(p_context_digest) <> 32
    OR p_expires_at <= pg_catalog.transaction_timestamp()
    OR p_expires_at > pg_catalog.transaction_timestamp() + interval '5 minutes'
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  INSERT INTO viberacing_private.auth_challenges (
    challenge_id,
    session_id,
    profile_id,
    purpose,
    challenge_digest,
    context_digest,
    expires_at
  )
  VALUES (
    p_challenge_id,
    p_session_id,
    v_profile_id,
    p_purpose,
    p_challenge_digest,
    p_context_digest,
    p_expires_at
  );
  RETURN p_challenge_id;
EXCEPTION
  WHEN unique_violation OR check_violation OR foreign_key_violation THEN
    PERFORM viberacing_private.operation_failed();
END
$function$;

CREATE FUNCTION viberacing_api.consume_auth_challenge(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_challenge_id uuid,
  p_purpose text,
  p_context_digest bytea,
  p_verified_passkey_id uuid,
  p_new_sign_count bigint,
  p_backup_state boolean
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_profile_id uuid;
BEGIN
  v_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest
  );
  IF (
      p_purpose = 'initial_passkey'
      AND (
        p_verified_passkey_id IS NOT NULL
        OR p_new_sign_count IS NOT NULL
        OR p_backup_state IS NOT NULL
      )
    )
    OR (
      p_purpose <> 'initial_passkey'
      AND (
        p_verified_passkey_id IS NULL
        OR p_new_sign_count IS NULL
        OR p_new_sign_count < 0
        OR p_backup_state IS NULL
      )
    )
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.auth_challenges AS challenge
  SET state = 'consumed',
      consumed_at = pg_catalog.transaction_timestamp(),
      verified_by_passkey_id = p_verified_passkey_id
  WHERE challenge.challenge_id = p_challenge_id
    AND challenge.session_id = p_session_id
    AND challenge.profile_id = v_profile_id
    AND challenge.purpose = p_purpose
    AND challenge.context_digest = p_context_digest
    AND challenge.state = 'pending'
    AND challenge.expires_at > pg_catalog.transaction_timestamp()
    AND (
      (p_purpose = 'initial_passkey' AND p_verified_passkey_id IS NULL)
      OR EXISTS (
        SELECT 1
        FROM viberacing_private.passkeys AS passkey
        WHERE passkey.passkey_id = p_verified_passkey_id
          AND passkey.profile_id = v_profile_id
          AND passkey.state = 'active'
      )
    );
  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  IF p_purpose <> 'initial_passkey' THEN
    UPDATE viberacing_private.passkeys
    SET sign_count = p_new_sign_count,
        backup_state = p_backup_state,
        last_used_at = pg_catalog.transaction_timestamp()
    WHERE passkey_id = p_verified_passkey_id
      AND profile_id = v_profile_id
      AND state = 'active'
      AND p_new_sign_count >= sign_count
      AND (NOT p_backup_state OR backup_eligible);
    IF NOT FOUND THEN
      PERFORM viberacing_private.operation_failed();
    END IF;
  END IF;
  RETURN v_profile_id;
END
$function$;

CREATE FUNCTION viberacing_api.complete_initial_passkey(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_challenge_id uuid,
  p_context_digest bytea,
  p_handle text,
  p_passkey_id uuid,
  p_credential_id bytea,
  p_cose_public_key bytea,
  p_sign_count bigint,
  p_backup_eligible boolean,
  p_backup_state boolean,
  p_rotated_session_id uuid,
  p_rotated_session_verifier_digest bytea,
  p_rotated_session_expires_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_profile_id uuid;
  v_now timestamptz := pg_catalog.transaction_timestamp();
BEGIN
  v_profile_id := viberacing_api.consume_auth_challenge(
    p_session_id,
    p_session_verifier_digest,
    p_challenge_id,
    'initial_passkey',
    p_context_digest,
    NULL,
    NULL,
    NULL
  );

  IF p_handle IS NULL
    OR p_handle !~ '^[a-z0-9](?:[a-z0-9_-]{1,22}[a-z0-9])$'
    OR p_handle ~ '^pending_'
    OR p_passkey_id IS NULL
    OR p_sign_count < 0
    OR p_rotated_session_id IS NULL
    OR p_rotated_session_id = p_session_id
    OR pg_catalog.octet_length(p_rotated_session_verifier_digest) <> 32
    OR p_rotated_session_expires_at <= v_now
    OR p_rotated_session_expires_at > v_now + interval '31 days'
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  PERFORM 1
  FROM viberacing_private.profiles
  WHERE profile_id = v_profile_id
    AND state = 'enrolling'
    AND handle = p_handle
  FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  INSERT INTO viberacing_private.passkeys (
    passkey_id,
    profile_id,
    credential_id,
    cose_public_key,
    sign_count,
    backup_eligible,
    backup_state,
    label
  )
  VALUES (
    p_passkey_id,
    v_profile_id,
    p_credential_id,
    p_cose_public_key,
    p_sign_count,
    p_backup_eligible,
    p_backup_state,
    'This device'
  );

  UPDATE viberacing_private.profiles
  SET state = 'active'
  WHERE profile_id = v_profile_id
    AND state = 'enrolling';

  UPDATE viberacing_private.sessions
  SET state = 'revoked',
      revoked_at = v_now
  WHERE session_id = p_session_id
    AND profile_id = v_profile_id
    AND state = 'active';
  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  INSERT INTO viberacing_private.sessions (
    session_id,
    profile_id,
    verifier_digest,
    authentication_kind,
    authenticated_by_passkey_id,
    expires_at
  )
  VALUES (
    p_rotated_session_id,
    v_profile_id,
    p_rotated_session_verifier_digest,
    'passkey',
    p_passkey_id,
    p_rotated_session_expires_at
  );
  RETURN v_profile_id;
EXCEPTION
  WHEN unique_violation OR check_violation OR foreign_key_violation THEN
    PERFORM viberacing_private.operation_failed();
END
$function$;

CREATE FUNCTION viberacing_api.read_passkey_verification_material(p_credential_id bytea)
RETURNS TABLE (
  passkey_id uuid,
  cose_public_key bytea,
  sign_count bigint,
  backup_eligible boolean,
  backup_state boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT
    passkey.passkey_id,
    passkey.cose_public_key,
    passkey.sign_count,
    passkey.backup_eligible,
    passkey.backup_state
  FROM viberacing_private.passkeys AS passkey
  JOIN viberacing_private.profiles AS profile
    ON profile.profile_id = passkey.profile_id
  WHERE passkey.credential_id = p_credential_id
    AND passkey.state = 'active'
    AND profile.state = 'active'
  LIMIT 1
$function$;

CREATE FUNCTION viberacing_api.complete_passkey_login_session(
  p_challenge_id uuid,
  p_challenge_digest bytea,
  p_context_digest bytea,
  p_challenge_expires_at timestamptz,
  p_passkey_id uuid,
  p_credential_id bytea,
  p_new_sign_count bigint,
  p_backup_state boolean,
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_session_expires_at timestamptz
)
RETURNS TABLE (profile_id uuid, handle text, locale text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_profile_id uuid;
BEGIN
  IF p_challenge_id IS NULL
    OR pg_catalog.octet_length(p_challenge_digest) <> 32
    OR pg_catalog.octet_length(p_context_digest) <> 32
    OR p_challenge_expires_at <= pg_catalog.transaction_timestamp()
    OR p_challenge_expires_at > pg_catalog.transaction_timestamp() + interval '5 minutes'
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  INSERT INTO viberacing_private.auth_challenges (
    challenge_id,
    purpose,
    challenge_digest,
    context_digest,
    expires_at
  )
  VALUES (
    p_challenge_id,
    'passkey_login',
    p_challenge_digest,
    p_context_digest,
    p_challenge_expires_at
  );

  UPDATE viberacing_private.auth_challenges AS challenge
  SET state = 'consumed',
      consumed_at = pg_catalog.transaction_timestamp(),
      verified_by_passkey_id = p_passkey_id
  WHERE challenge.challenge_id = p_challenge_id
    AND challenge.purpose = 'passkey_login'
    AND challenge.context_digest = p_context_digest
    AND challenge.state = 'pending'
    AND challenge.expires_at > pg_catalog.transaction_timestamp();
  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.passkeys AS passkey
  SET sign_count = p_new_sign_count,
      backup_state = p_backup_state,
      last_used_at = pg_catalog.transaction_timestamp()
  FROM viberacing_private.profiles AS profile
  WHERE passkey.passkey_id = p_passkey_id
    AND passkey.credential_id = p_credential_id
    AND passkey.profile_id = profile.profile_id
    AND passkey.state = 'active'
    AND profile.state = 'active'
    AND p_new_sign_count >= passkey.sign_count
  RETURNING passkey.profile_id INTO v_profile_id;
  IF v_profile_id IS NULL
    OR p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) <> 32
    OR p_session_expires_at <= pg_catalog.transaction_timestamp()
    OR p_session_expires_at > pg_catalog.transaction_timestamp() + interval '30 days'
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  INSERT INTO viberacing_private.sessions (
    session_id,
    profile_id,
    verifier_digest,
    authenticated_by_passkey_id,
    authentication_kind,
    expires_at
  )
  VALUES (
    p_session_id,
    v_profile_id,
    p_session_verifier_digest,
    p_passkey_id,
    'passkey',
    p_session_expires_at
  );

  RETURN QUERY
  SELECT profile.profile_id, profile.handle::text, profile.locale::text
  FROM viberacing_private.profiles AS profile
  WHERE profile.profile_id = v_profile_id;
EXCEPTION
  WHEN unique_violation OR check_violation OR foreign_key_violation THEN
    PERFORM viberacing_private.operation_failed();
END
$function$;

CREATE FUNCTION viberacing_api.revoke_session(
  p_session_id uuid,
  p_session_verifier_digest bytea
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_profile_id uuid;
BEGIN
  v_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest
  );
  UPDATE viberacing_private.sessions
  SET state = 'revoked',
      revoked_at = pg_catalog.transaction_timestamp()
  WHERE session_id = p_session_id
    AND profile_id = v_profile_id
    AND state = 'active';
  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
  RETURN true;
END
$function$;

CREATE FUNCTION viberacing_api.read_passkey_inventory(
  p_session_id uuid,
  p_session_verifier_digest bytea
)
RETURNS TABLE (
  passkey_id uuid,
  label text,
  state text,
  created_at timestamptz,
  current_authenticator boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_profile_id uuid;
BEGIN
  v_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest
  );
  RETURN QUERY
  SELECT
    passkey.passkey_id,
    passkey.label::text,
    passkey.state::text,
    passkey.created_at,
    session.authenticated_by_passkey_id = passkey.passkey_id
  FROM viberacing_private.passkeys AS passkey
  JOIN viberacing_private.sessions AS session
    ON session.session_id = p_session_id
    AND session.profile_id = v_profile_id
    AND session.state = 'active'
  WHERE passkey.profile_id = v_profile_id
    AND passkey.state = 'active'
  ORDER BY passkey.created_at, passkey.passkey_id;
END
$function$;

CREATE FUNCTION viberacing_api.add_passkey(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_challenge_id uuid,
  p_context_digest bytea,
  p_verified_passkey_id uuid,
  p_new_sign_count bigint,
  p_verified_backup_state boolean,
  p_passkey_id uuid,
  p_credential_id bytea,
  p_cose_public_key bytea,
  p_label text,
  p_sign_count bigint,
  p_backup_eligible boolean,
  p_backup_state boolean
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_profile_id uuid;
BEGIN
  v_profile_id := viberacing_api.consume_auth_challenge(
    p_session_id,
    p_session_verifier_digest,
    p_challenge_id,
    'passkey_change',
    p_context_digest,
    p_verified_passkey_id,
    p_new_sign_count,
    p_verified_backup_state
  );
  IF p_passkey_id IS NULL
    OR p_passkey_id = p_verified_passkey_id
    OR p_sign_count < 0
    OR p_label IS NULL
    OR pg_catalog.length(p_label) NOT BETWEEN 1 AND 48
    OR p_label <> pg_catalog.btrim(p_label)
    OR p_label ~ '[[:cntrl:]]'
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
  INSERT INTO viberacing_private.passkeys (
    passkey_id,
    profile_id,
    credential_id,
    cose_public_key,
    sign_count,
    backup_eligible,
    backup_state,
    label
  )
  VALUES (
    p_passkey_id,
    v_profile_id,
    p_credential_id,
    p_cose_public_key,
    p_sign_count,
    p_backup_eligible,
    p_backup_state,
    p_label
  );
EXCEPTION
  WHEN unique_violation OR check_violation OR foreign_key_violation THEN
    PERFORM viberacing_private.operation_failed();
END
$function$;

CREATE FUNCTION viberacing_api.revoke_passkey(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_challenge_id uuid,
  p_context_digest bytea,
  p_verified_passkey_id uuid,
  p_new_sign_count bigint,
  p_backup_state boolean,
  p_target_passkey_id uuid
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_profile_id uuid;
BEGIN
  v_profile_id := viberacing_api.consume_auth_challenge(
    p_session_id,
    p_session_verifier_digest,
    p_challenge_id,
    'passkey_change',
    p_context_digest,
    p_verified_passkey_id,
    p_new_sign_count,
    p_backup_state
  );
  IF p_target_passkey_id IS NULL
    OR p_target_passkey_id = p_verified_passkey_id
    OR (
      SELECT pg_catalog.count(*)
      FROM viberacing_private.passkeys
      WHERE profile_id = v_profile_id
        AND state = 'active'
    ) < 2
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
  UPDATE viberacing_private.passkeys
  SET state = 'revoked',
      revoked_at = pg_catalog.transaction_timestamp()
  WHERE passkey_id = p_target_passkey_id
    AND profile_id = v_profile_id
    AND state = 'active';
  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
END
$function$;

CREATE FUNCTION viberacing_api.replace_recovery_codes(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_challenge_id uuid,
  p_context_digest bytea,
  p_verified_passkey_id uuid,
  p_new_sign_count bigint,
  p_backup_state boolean,
  p_batch_id uuid,
  p_recovery_code_ids uuid[],
  p_verifier_phcs text[]
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_profile_id uuid;
BEGIN
  v_profile_id := viberacing_api.consume_auth_challenge(
    p_session_id,
    p_session_verifier_digest,
    p_challenge_id,
    'recovery_change',
    p_context_digest,
    p_verified_passkey_id,
    p_new_sign_count,
    p_backup_state
  );
  IF p_batch_id IS NULL
    OR pg_catalog.cardinality(p_recovery_code_ids) <> 10
    OR pg_catalog.cardinality(p_verifier_phcs) <> 10
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(p_recovery_code_ids) AS code_id
      WHERE code_id IS NULL
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(p_verifier_phcs) AS verifier_phc
      WHERE verifier_phc IS NULL
    )
    OR (
      SELECT pg_catalog.count(DISTINCT code_id)
      FROM pg_catalog.unnest(p_recovery_code_ids) AS code_id
    ) <> 10
    OR (
      SELECT pg_catalog.count(DISTINCT verifier_phc)
      FROM pg_catalog.unnest(p_verifier_phcs) AS verifier_phc
    ) <> 10
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.recovery_authorities
  SET state = 'revoked',
      revoked_at = pg_catalog.transaction_timestamp()
  WHERE profile_id = v_profile_id
    AND state = 'active';

  DELETE FROM viberacing_private.recovery_codes
  WHERE profile_id = v_profile_id;

  INSERT INTO viberacing_private.recovery_codes (
    recovery_code_id,
    profile_id,
    batch_id,
    position,
    verifier_phc
  )
  SELECT
    code.recovery_code_id,
    v_profile_id,
    p_batch_id,
    (code.ordinality - 1)::smallint,
    p_verifier_phcs[code.ordinality]
  FROM pg_catalog.unnest(p_recovery_code_ids)
    WITH ORDINALITY AS code(recovery_code_id, ordinality);
EXCEPTION
  WHEN unique_violation OR check_violation OR foreign_key_violation THEN
    PERFORM viberacing_private.operation_failed();
END
$function$;

CREATE FUNCTION viberacing_api.read_recovery_code_verification_material(
  p_recovery_code_id uuid
)
RETURNS TABLE (
  recovery_code_id uuid,
  verifier_phc text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT code.recovery_code_id, code.verifier_phc::text
  FROM viberacing_private.recovery_codes AS code
  JOIN viberacing_private.profiles AS profile
    ON profile.profile_id = code.profile_id
  WHERE code.recovery_code_id = p_recovery_code_id
    AND code.state = 'active'
    AND code.verifier_phc IS NOT NULL
    AND profile.state = 'active'
  LIMIT 1
$function$;

CREATE FUNCTION viberacing_api.start_recovery(
  p_recovery_code_id uuid,
  p_recovery_authority_id uuid,
  p_authority_verifier_digest bytea,
  p_challenge_digest bytea,
  p_context_digest bytea,
  p_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_profile_id uuid;
BEGIN
  IF p_recovery_authority_id IS NULL
    OR pg_catalog.octet_length(p_authority_verifier_digest) <> 32
    OR pg_catalog.octet_length(p_challenge_digest) <> 32
    OR pg_catalog.octet_length(p_context_digest) <> 32
    OR p_expires_at <= pg_catalog.transaction_timestamp()
    OR p_expires_at > pg_catalog.transaction_timestamp() + interval '10 minutes'
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT code.profile_id
  INTO v_profile_id
  FROM viberacing_private.recovery_codes AS code
  JOIN viberacing_private.profiles AS profile
    ON profile.profile_id = code.profile_id
  WHERE code.recovery_code_id = p_recovery_code_id
    AND code.state = 'active'
    AND code.verifier_phc IS NOT NULL
    AND profile.state = 'active'
  FOR UPDATE OF code;
  IF v_profile_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.recovery_codes
  SET state = 'used',
      verifier_phc = NULL,
      used_at = pg_catalog.transaction_timestamp()
  WHERE recovery_code_id = p_recovery_code_id
    AND profile_id = v_profile_id
    AND state = 'active';
  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.recovery_authorities
  SET state = 'revoked',
      revoked_at = pg_catalog.transaction_timestamp()
  WHERE profile_id = v_profile_id
    AND state = 'active';

  INSERT INTO viberacing_private.recovery_authorities (
    recovery_authority_id,
    profile_id,
    source_recovery_code_id,
    verifier_digest,
    challenge_digest,
    context_digest,
    expires_at
  )
  VALUES (
    p_recovery_authority_id,
    v_profile_id,
    p_recovery_code_id,
    p_authority_verifier_digest,
    p_challenge_digest,
    p_context_digest,
    p_expires_at
  );
EXCEPTION
  WHEN unique_violation OR check_violation OR foreign_key_violation THEN
    PERFORM viberacing_private.operation_failed();
END
$function$;

CREATE FUNCTION viberacing_api.complete_recovery_registration_session(
  p_recovery_authority_id uuid,
  p_authority_verifier_digest bytea,
  p_challenge_digest bytea,
  p_context_digest bytea,
  p_passkey_id uuid,
  p_credential_id bytea,
  p_cose_public_key bytea,
  p_label text,
  p_sign_count bigint,
  p_backup_eligible boolean,
  p_backup_state boolean,
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_session_expires_at timestamptz
)
RETURNS TABLE (profile_id uuid, handle text, locale text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_profile_id uuid;
BEGIN
  IF p_passkey_id IS NULL
    OR p_session_id IS NULL
    OR p_sign_count < 0
    OR p_label IS NULL
    OR pg_catalog.length(p_label) NOT BETWEEN 1 AND 48
    OR p_label <> pg_catalog.btrim(p_label)
    OR p_label ~ '[[:cntrl:]]'
    OR pg_catalog.octet_length(p_session_verifier_digest) <> 32
    OR p_session_expires_at <= v_now
    OR p_session_expires_at > v_now + interval '30 days'
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.recovery_authorities AS authority
  SET state = 'completed',
      completed_at = v_now
  FROM viberacing_private.profiles AS profile
  WHERE authority.recovery_authority_id = p_recovery_authority_id
    AND authority.verifier_digest = p_authority_verifier_digest
    AND authority.challenge_digest = p_challenge_digest
    AND authority.context_digest = p_context_digest
    AND authority.state = 'active'
    AND authority.expires_at > v_now
    AND profile.profile_id = authority.profile_id
    AND profile.state = 'active'
  RETURNING authority.profile_id INTO v_profile_id;
  IF v_profile_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.sessions AS session
  SET state = 'revoked',
      revoked_at = v_now
  WHERE session.profile_id = v_profile_id
    AND session.state = 'active';

  UPDATE viberacing_private.passkeys AS passkey
  SET state = 'revoked',
      revoked_at = v_now
  WHERE passkey.profile_id = v_profile_id
    AND passkey.state = 'active';

  INSERT INTO viberacing_private.passkeys (
    passkey_id,
    profile_id,
    credential_id,
    cose_public_key,
    sign_count,
    backup_eligible,
    backup_state,
    label
  )
  VALUES (
    p_passkey_id,
    v_profile_id,
    p_credential_id,
    p_cose_public_key,
    p_sign_count,
    p_backup_eligible,
    p_backup_state,
    p_label
  );

  INSERT INTO viberacing_private.sessions (
    session_id,
    profile_id,
    verifier_digest,
    authenticated_by_passkey_id,
    authentication_kind,
    expires_at
  )
  VALUES (
    p_session_id,
    v_profile_id,
    p_session_verifier_digest,
    p_passkey_id,
    'recovery',
    p_session_expires_at
  );

  RETURN QUERY
  SELECT profile.profile_id, profile.handle::text, profile.locale::text
  FROM viberacing_private.profiles AS profile
  WHERE profile.profile_id = v_profile_id;
EXCEPTION
  WHEN unique_violation OR check_violation OR foreign_key_violation THEN
    PERFORM viberacing_private.operation_failed();
END
$function$;

CREATE FUNCTION viberacing_private.revoke_recovery_authority_on_profile_deletion()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.state = 'deletion_pending' AND OLD.state <> 'deletion_pending' THEN
    UPDATE viberacing_private.recovery_authorities
    SET state = 'revoked',
        revoked_at = pg_catalog.transaction_timestamp()
    WHERE profile_id = NEW.profile_id
      AND state = 'active';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER profiles_revoke_recovery_authority
AFTER UPDATE OF state ON viberacing_private.profiles
FOR EACH ROW EXECUTE FUNCTION viberacing_private.revoke_recovery_authority_on_profile_deletion();

CREATE FUNCTION viberacing_api.read_private_profile(
  p_session_id uuid,
  p_session_verifier_digest bytea
)
RETURNS TABLE (
  profile_id uuid,
  github_user_id bigint,
  handle text,
  locale text,
  theme text,
  motion_preference text,
  public_visibility text,
  provider_breakdown_visible boolean,
  profile_state text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_profile_id uuid;
BEGIN
  v_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest
  );
  RETURN QUERY
  SELECT
    profile.profile_id,
    profile.github_user_id,
    profile.handle::text,
    profile.locale::text,
    profile.theme::text,
    profile.motion_preference::text,
    profile.public_visibility::text,
    profile.provider_breakdown_visible,
    profile.state::text
  FROM viberacing_private.profiles AS profile
  WHERE profile.profile_id = v_profile_id;
END
$function$;

CREATE FUNCTION viberacing_api.set_profile_visibility(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_visibility text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_profile_id uuid;
BEGIN
  v_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest
  );
  IF p_visibility NOT IN ('public', 'hidden') THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
  UPDATE viberacing_private.profiles
  SET public_visibility = p_visibility
  WHERE profile_id = v_profile_id
    AND state = 'active';
  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
  RETURN p_visibility;
END
$function$;

CREATE FUNCTION viberacing_api.set_provider_breakdown_visibility(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_visible boolean
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_profile_id uuid;
BEGIN
  v_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest
  );
  IF p_visible IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
  UPDATE viberacing_private.profiles
  SET provider_breakdown_visible = p_visible
  WHERE profile_id = v_profile_id
    AND state = 'active';
  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
  RETURN p_visible;
END
$function$;

CREATE FUNCTION viberacing_api.request_profile_deletion(
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

  UPDATE viberacing_private.sessions
  SET state = 'revoked',
      revoked_at = pg_catalog.transaction_timestamp()
  WHERE profile_id = v_profile_id
    AND state = 'active';

  UPDATE viberacing_private.passkeys
  SET state = 'revoked',
      revoked_at = pg_catalog.transaction_timestamp()
  WHERE profile_id = v_profile_id
    AND state = 'active';
END
$function$;

ALTER TABLE viberacing_private.invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.invites FORCE ROW LEVEL SECURITY;
CREATE POLICY invites_owner_only ON viberacing_private.invites
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.passkeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.passkeys FORCE ROW LEVEL SECURITY;
CREATE POLICY passkeys_owner_only ON viberacing_private.passkeys
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY sessions_owner_only ON viberacing_private.sessions
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.auth_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.auth_challenges FORCE ROW LEVEL SECURITY;
CREATE POLICY auth_challenges_owner_only ON viberacing_private.auth_challenges
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.recovery_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY recovery_codes_owner_only ON viberacing_private.recovery_codes
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.recovery_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.recovery_authorities FORCE ROW LEVEL SECURITY;
CREATE POLICY recovery_authorities_owner_only ON viberacing_private.recovery_authorities
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

REVOKE ALL ON ALL TABLES IN SCHEMA viberacing_private FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA viberacing_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA viberacing_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA viberacing_api FROM PUBLIC;

GRANT EXECUTE ON FUNCTION viberacing_api.issue_invite(uuid, bytea, text, timestamptz)
  TO viberacing_admin;
GRANT EXECUTE ON FUNCTION viberacing_api.open_github_profile(
  uuid, bigint, text, text, uuid, bytea, timestamptz, uuid, bytea, boolean
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.begin_initial_passkey(
  uuid, bytea, text, uuid, bytea, bytea, timestamptz
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.create_auth_challenge(
  uuid, bytea, uuid, text, bytea, bytea, timestamptz
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.consume_auth_challenge(
  uuid, bytea, uuid, text, bytea, uuid, bigint, boolean
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.complete_initial_passkey(
  uuid, bytea, uuid, bytea, text, uuid, bytea, bytea, bigint, boolean, boolean,
  uuid, bytea, timestamptz
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_passkey_verification_material(bytea)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.complete_passkey_login_session(
  uuid, bytea, bytea, timestamptz, uuid, bytea, bigint, boolean, uuid, bytea, timestamptz
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.revoke_session(uuid, bytea)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_passkey_inventory(uuid, bytea)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.add_passkey(
  uuid, bytea, uuid, bytea, uuid, bigint, boolean, uuid, bytea, bytea, text,
  bigint, boolean, boolean
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.revoke_passkey(
  uuid, bytea, uuid, bytea, uuid, bigint, boolean, uuid
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.replace_recovery_codes(
  uuid, bytea, uuid, bytea, uuid, bigint, boolean, uuid, uuid[], text[]
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_recovery_code_verification_material(uuid)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.start_recovery(
  uuid, uuid, bytea, bytea, bytea, timestamptz
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.complete_recovery_registration_session(
  uuid, bytea, bytea, bytea, uuid, bytea, bytea, text, bigint, boolean, boolean,
  uuid, bytea, timestamptz
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_private_profile(uuid, bytea)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.set_profile_visibility(uuid, bytea, text)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.set_provider_breakdown_visibility(
  uuid, bytea, boolean
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.request_profile_deletion(
  uuid, bytea, uuid, bytea, uuid, bigint, boolean, text
) TO viberacing_web;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (2, 'authentication_passkeys_and_recovery');

COMMIT;
