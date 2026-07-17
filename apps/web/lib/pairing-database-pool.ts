import "server-only";

import { Buffer } from "node:buffer";

import { Pool } from "pg";

import type { PairingDatabaseConfig } from "./pairing-database-config";

const runtimeBoundaryQuery = `SELECT
  CURRENT_USER = 'viberacing_web' AS role_ok,
  (
    SESSION_USER <> CURRENT_USER
    AND pg_catalog.pg_has_role(SESSION_USER, 'viberacing_web', 'SET')
    AND pg_catalog.has_database_privilege(SESSION_USER, pg_catalog.current_database(), 'CONNECT')
    AND NOT pg_catalog.has_database_privilege(
      SESSION_USER,
      pg_catalog.current_database(),
      'CREATE'
    )
    AND NOT pg_catalog.has_database_privilege(
      SESSION_USER,
      pg_catalog.current_database(),
      'TEMPORARY'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles AS login_role
      WHERE login_role.rolname = SESSION_USER
        AND login_role.rolcanlogin
        AND NOT login_role.rolsuper
        AND NOT login_role.rolcreatedb
        AND NOT login_role.rolcreaterole
        AND NOT login_role.rolreplication
        AND NOT login_role.rolbypassrls
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles AS granted_role
      WHERE granted_role.rolname <> SESSION_USER
        AND granted_role.rolname <> 'viberacing_web'
        AND pg_catalog.pg_has_role(SESSION_USER, granted_role.oid, 'MEMBER')
    )
  ) AS login_scope_ok,
  pg_catalog.current_setting('search_path') = 'pg_catalog,pg_temp' AS search_path_ok,
  pg_catalog.current_setting('default_transaction_read_only') = 'off' AS read_write_ok`;

const verificationMaterialQuery = `SELECT
  candidate.candidate_index,
  material.pairing_id::text AS pairing_id,
  material.pairing_challenge AS pairing_challenge,
  material.public_key AS public_key
FROM (
  VALUES
    (1, $1::bytea),
    (2, $2::bytea)
) AS candidate(candidate_index, poll_verifier_digest)
CROSS JOIN LATERAL viberacing_api.read_pairing_verification_material(
  candidate.poll_verifier_digest
) AS material
ORDER BY candidate.candidate_index`;

const activatePairingQuery = `WITH activation AS MATERIALIZED (
  SELECT viberacing_api.activate_pairing(
    $1::bytea,
    $2::uuid,
    $3::text,
    $4::uuid,
    $5::text
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS activated
FROM activation`;

const startPairingQuery = `WITH pairing_start AS MATERIALIZED (
  SELECT viberacing_api.start_pairing(
    $1::uuid,
    $2::bytea,
    $3::bytea,
    $4::bytea,
    $5::uuid,
    $6::bytea,
    $7::text,
    $8::text,
    $9::text,
    $10::text,
    $11::timestamptz
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS started
FROM pairing_start`;

const readPairingApprovalQuery = `SELECT
  approval.candidate_index::integer AS candidate_index,
  approval.pairing_id::text AS pairing_id,
  approval.device_label,
  approval.connector_version,
  approval.os_family,
  approval.architecture,
  approval.public_key,
  pg_catalog.to_char(
    approval.expires_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS expires_at
FROM viberacing_api.read_pairing_for_approval_limited(
  $1::uuid,
  $2::bytea,
  $3::bytea,
  $4::bytea,
  $5::boolean,
  $6::integer,
  $7::integer
) AS approval`;

const createPairingApprovalChallengeQuery = `WITH challenge_creation AS MATERIALIZED (
  SELECT viberacing_api.create_pairing_approval_challenge(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    $4::bytea,
    'new'::text,
    $5::text,
    $6::uuid,
    $7::bytea,
    $8::bytea,
    $9::timestamptz
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS created
FROM challenge_creation`;

const completePairingApprovalQuery = `WITH challenge_consumption AS MATERIALIZED (
  SELECT viberacing_api.consume_passkey_challenge(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    'pairing_approval'::text,
    $4::bytea,
    $5::bytea,
    $6::uuid,
    $7::bigint,
    $8::boolean
  ) AS consumed
), pairing_approval AS MATERIALIZED (
  SELECT viberacing_api.approve_pairing(
    $1::uuid,
    $2::bytea,
    $9::uuid,
    $3::uuid,
    $5::bytea,
    $10::uuid,
    $11::text
  ) AS ignored
  FROM challenge_consumption
  WHERE consumed
)
SELECT
  (SELECT consumed FROM challenge_consumption)
  AND pg_catalog.count(*) = 1 AS approved
FROM pairing_approval`;

const enrollProfileQuery = `WITH profile_enrollment AS MATERIALIZED (
  SELECT viberacing_api.enroll_profile(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    $4::bigint,
    $5::text,
    $6::text,
    $7::text,
    $8::text,
    $9::boolean,
    $10::uuid,
    $11::bytea,
    $12::timestamptz,
    $13::uuid,
    $14::text
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS enrolled
FROM profile_enrollment`;

const createPasskeyChallengeQuery = `WITH challenge_creation AS MATERIALIZED (
  SELECT viberacing_api.create_auth_challenge(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    'passkey_registration'::text,
    $4::bytea,
    $5::bytea,
    $6::timestamptz
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS created
FROM challenge_creation`;

const completeInitialPasskeyQuery = `WITH challenge_consumption AS MATERIALIZED (
  SELECT viberacing_api.consume_auth_challenge(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    'passkey_registration'::text,
    $4::bytea,
    $5::bytea
  ) AS consumed
), passkey_registration AS MATERIALIZED (
  SELECT viberacing_api.register_initial_passkey(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    $6::uuid,
    $7::bytea,
    $8::bytea,
    $9::text,
    $10::bigint,
    $11::boolean,
    $12::boolean,
    $13::uuid,
    $14::text
  ) AS ignored
  FROM challenge_consumption
  WHERE consumed
), session_rotation AS MATERIALIZED (
  SELECT viberacing_api.rotate_session(
    $1::uuid,
    $2::bytea,
    $15::uuid,
    $16::bytea,
    $17::timestamptz,
    $18::uuid,
    $14::text
  ) AS profile_id
  FROM passkey_registration
)
SELECT
  (SELECT consumed FROM challenge_consumption)
  AND pg_catalog.count(*) = 1 AS registered
FROM session_rotation`;

const revokeEnrollmentSessionQuery = `SELECT viberacing_api.revoke_session(
  $1::uuid,
  $2::bytea,
  $3::uuid,
  $4::text
) AS revoked`;

const readPasskeyLoginMaterialQuery = `SELECT
  material.passkey_id::text AS passkey_id,
  material.cose_public_key AS cose_public_key,
  material.sign_count::text AS sign_count,
  material.backup_eligible AS backup_eligible,
  material.backup_state AS backup_state
FROM viberacing_api.read_passkey_verification_material($1::bytea) AS material`;

const completePasskeyLoginQuery = `SELECT
  completed.profile_id::text AS profile_id,
  completed.handle AS handle,
  completed.locale AS locale
FROM viberacing_api.complete_passkey_login_session(
  $1::uuid,
  $2::bytea,
  $3::bytea,
  $4::timestamptz,
  $5::uuid,
  $6::bytea,
  $7::bigint,
  $8::boolean,
  $9::uuid,
  $10::bytea,
  $11::timestamptz,
  $12::uuid,
  $13::text
) AS completed`;

const readPasskeyInventoryQuery = `SELECT
  inventory.passkey_id::text AS passkey_id,
  inventory.label AS label,
  inventory.state AS state,
  (inventory.created_at AT TIME ZONE 'UTC')::date::text AS created_on,
  inventory.current_authenticator AS current_authenticator
FROM viberacing_api.read_passkey_inventory($1::uuid, $2::bytea) AS inventory
ORDER BY (inventory.created_at AT TIME ZONE 'UTC')::date, inventory.passkey_id`;

const readActiveDeviceInventoryQuery = `WITH inventory AS MATERIALIZED (
  SELECT *
  FROM viberacing_api.read_source_inventory($1::uuid, $2::bytea)
), active_devices AS (
  SELECT
    inventory.source_id,
    inventory.source_state,
    inventory.device_id,
    inventory.device_label,
    inventory.connector_version,
    inventory.os_family,
    inventory.architecture,
    inventory.device_state,
    (inventory.activated_at AT TIME ZONE 'UTC')::date::text AS activated_on
  FROM inventory
  WHERE inventory.device_state = 'active'
), sources_without_active_devices AS (
  SELECT
    inventory.source_id,
    inventory.source_state,
    NULL::text AS device_id,
    NULL::text AS device_label,
    NULL::text AS connector_version,
    NULL::text AS os_family,
    NULL::text AS architecture,
    NULL::text AS device_state,
    NULL::text AS activated_on
  FROM inventory
  GROUP BY inventory.source_id, inventory.source_state
  HAVING pg_catalog.count(*) FILTER (WHERE inventory.device_state = 'active') = 0
), bounded_inventory AS (
  SELECT * FROM active_devices
  UNION ALL
  SELECT * FROM sources_without_active_devices
)
SELECT *
FROM bounded_inventory
ORDER BY source_id, activated_on NULLS FIRST, device_id NULLS FIRST
LIMIT 96`;

const revokeDeviceQuery = `WITH device_revocation AS MATERIALIZED (
  SELECT viberacing_api.revoke_device(
    $1::uuid,
    $2::bytea,
    $3::text,
    $4::uuid,
    $5::text
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS revoked
FROM device_revocation`;

const pauseSourceQuery = `WITH source_pause AS MATERIALIZED (
  SELECT viberacing_api.pause_source(
    $1::uuid,
    $2::bytea,
    $3::text,
    $4::uuid,
    $5::text
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS paused
FROM source_pause`;

const createSourceReactivationChallengeQuery = `WITH challenge_creation AS MATERIALIZED (
  SELECT viberacing_api.create_source_action_challenge(
    $1::uuid,
    $2::bytea,
    $3::text,
    'source_reactivation'::text,
    $4::uuid,
    $5::bytea,
    $6::bytea,
    $7::timestamptz
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS created
FROM challenge_creation`;

const completeSourceReactivationQuery = `WITH challenge_consumption AS MATERIALIZED (
  SELECT viberacing_api.consume_passkey_challenge(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    'source_reactivation'::text,
    $4::bytea,
    $5::bytea,
    $6::uuid,
    $7::bigint,
    $8::boolean
  ) AS consumed
), source_reactivation AS MATERIALIZED (
  SELECT viberacing_api.reactivate_source(
    $1::uuid,
    $2::bytea,
    $9::text,
    $3::uuid,
    $5::bytea,
    $10::uuid,
    $11::text
  ) AS ignored
  FROM challenge_consumption
  WHERE consumed
)
SELECT
  (SELECT consumed FROM challenge_consumption)
  AND pg_catalog.count(*) = 1 AS reactivated
FROM source_reactivation`;

const createSourceUnlinkChallengeQuery = `WITH challenge_creation AS MATERIALIZED (
  SELECT viberacing_api.create_source_action_challenge(
    $1::uuid,
    $2::bytea,
    $3::text,
    'source_unlink'::text,
    $4::uuid,
    $5::bytea,
    $6::bytea,
    $7::timestamptz
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS created
FROM challenge_creation`;

const completeSourceUnlinkQuery = `WITH challenge_consumption AS MATERIALIZED (
  SELECT viberacing_api.consume_passkey_challenge(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    'source_unlink'::text,
    $4::bytea,
    $5::bytea,
    $6::uuid,
    $7::bigint,
    $8::boolean
  ) AS consumed
), source_unlink AS MATERIALIZED (
  SELECT viberacing_api.unlink_source(
    $1::uuid,
    $2::bytea,
    $9::text,
    $3::uuid,
    $5::bytea,
    $10::uuid,
    $11::text
  ) AS ignored
  FROM challenge_consumption
  WHERE consumed
)
SELECT
  (SELECT consumed FROM challenge_consumption)
  AND pg_catalog.count(*) = 1 AS unlinked
FROM source_unlink`;

const readProfileVisibilityQuery = `SELECT visibility.visibility
FROM viberacing_api.read_profile_visibility($1::uuid, $2::bytea) AS visibility`;

const readAccountOverviewQuery = `WITH visibility AS MATERIALIZED (
  SELECT visibility.visibility
  FROM viberacing_api.read_profile_visibility($1::uuid, $2::bytea) AS visibility
)
SELECT
  visibility.visibility,
  score.season_start::text AS season_start,
  score.season_end::text AS season_end,
  score.season_finalized,
  score.weekly_score,
  score.active_days,
  score.source_count,
  score.score_date::text AS score_date,
  score.daily_score
FROM visibility
LEFT JOIN LATERAL viberacing_api.read_profile_score(
  $1::uuid,
  $2::bytea,
  $3::date
) AS score ON TRUE
ORDER BY score.score_date NULLS FIRST`;

const setProfileVisibilityQuery = `SELECT viberacing_api.set_profile_visibility(
  $1::uuid,
  $2::bytea,
  $3::boolean
) AS visibility`;

const createProfileDeletionChallengeQuery = `WITH challenge_creation AS MATERIALIZED (
  SELECT viberacing_api.create_auth_challenge(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    'profile_deletion'::text,
    $4::bytea,
    $5::bytea,
    $6::timestamptz
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS created
FROM challenge_creation`;

const completeProfileDeletionQuery = `WITH challenge_consumption AS MATERIALIZED (
  SELECT viberacing_api.consume_passkey_challenge(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    'profile_deletion'::text,
    $4::bytea,
    $5::bytea,
    $6::uuid,
    $7::bigint,
    $8::boolean
  ) AS consumed
), profile_deletion AS MATERIALIZED (
  SELECT viberacing_api.request_profile_deletion(
    $1::uuid,
    $2::bytea,
    $9::text,
    $3::uuid,
    $10::uuid,
    $11::bytea,
    $12::uuid,
    $13::text
  ) AS ignored
  FROM challenge_consumption
  WHERE consumed
)
SELECT
  (SELECT consumed FROM challenge_consumption)
  AND pg_catalog.count(*) = 1 AS deleted
FROM profile_deletion`;

const createPasskeyAddChallengeQuery = `WITH challenge_creation AS MATERIALIZED (
  SELECT viberacing_api.create_passkey_change_challenge(
    $1::uuid,
    $2::bytea,
    'add'::text,
    NULL::uuid,
    $3::uuid,
    $4::bytea,
    $5::bytea,
    $6::timestamptz
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS created
FROM challenge_creation`;

const completePasskeyAdditionQuery = `WITH challenge_consumption AS MATERIALIZED (
  SELECT viberacing_api.consume_passkey_challenge(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    'passkey_change'::text,
    $4::bytea,
    $5::bytea,
    $6::uuid,
    $7::bigint,
    $8::boolean
  ) AS consumed
), passkey_addition AS MATERIALIZED (
  SELECT viberacing_api.add_passkey(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    $5::bytea,
    $9::uuid,
    $10::bytea,
    $11::bytea,
    $12::text,
    $13::bigint,
    $14::boolean,
    $15::boolean,
    $16::uuid,
    $17::text
  ) AS ignored
  FROM challenge_consumption
  WHERE consumed
)
SELECT
  (SELECT consumed FROM challenge_consumption)
  AND pg_catalog.count(*) = 1 AS added
FROM passkey_addition`;

const createPasskeyRevokeChallengeQuery = `WITH challenge_creation AS MATERIALIZED (
  SELECT viberacing_api.create_passkey_change_challenge(
    $1::uuid,
    $2::bytea,
    'revoke'::text,
    $3::uuid,
    $4::uuid,
    $5::bytea,
    $6::bytea,
    $7::timestamptz
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS created
FROM challenge_creation`;

const completePasskeyRevocationQuery = `WITH challenge_consumption AS MATERIALIZED (
  SELECT viberacing_api.consume_passkey_challenge(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    'passkey_change'::text,
    $4::bytea,
    $5::bytea,
    $6::uuid,
    $7::bigint,
    $8::boolean
  ) AS consumed
), passkey_revocation AS MATERIALIZED (
  SELECT viberacing_api.revoke_passkey(
    $1::uuid,
    $2::bytea,
    $9::uuid,
    $3::uuid,
    $5::bytea,
    $10::uuid,
    $11::text
  ) AS ignored
  FROM challenge_consumption
  WHERE consumed
)
SELECT
  (SELECT consumed FROM challenge_consumption)
  AND pg_catalog.count(*) = 1 AS revoked
FROM passkey_revocation`;

const createRecoveryCodeChallengeQuery = `WITH challenge_creation AS MATERIALIZED (
  SELECT viberacing_api.create_recovery_change_challenge(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    $4::bytea,
    $5::bytea,
    $6::timestamptz
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS created
FROM challenge_creation`;

const completeRecoveryCodeReplacementQuery = `WITH challenge_consumption AS MATERIALIZED (
  SELECT viberacing_api.consume_passkey_challenge(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    'recovery_change'::text,
    $4::bytea,
    $5::bytea,
    $6::uuid,
    $7::bigint,
    $8::boolean
  ) AS consumed
), recovery_code_replacement AS MATERIALIZED (
  SELECT viberacing_api.replace_recovery_codes(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    $5::bytea,
    $9::uuid,
    $10::uuid[],
    $11::text[],
    $12::uuid,
    $13::text
  ) AS ignored
  FROM challenge_consumption
  WHERE consumed
)
SELECT
  (SELECT consumed FROM challenge_consumption)
  AND pg_catalog.count(*) = 1 AS replaced
FROM recovery_code_replacement`;

const readRecoveryCodeVerificationMaterialQuery = `SELECT
  material.recovery_code_id::text AS recovery_code_id,
  material.verifier_phc AS verifier_phc
FROM viberacing_api.read_recovery_code_verification_material($1::uuid) AS material`;

const startRecoveryQuery = `WITH recovery_start AS MATERIALIZED (
  SELECT viberacing_api.start_recovery(
    $1::uuid,
    $2::uuid,
    $3::bytea,
    $4::bytea,
    $5::bytea,
    $6::timestamptz,
    $7::uuid,
    $8::text
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS started
FROM recovery_start`;

const completeRecoveryRegistrationQuery = `SELECT
  completed.profile_id::text AS profile_id,
  completed.handle AS handle,
  completed.locale AS locale
FROM viberacing_api.complete_recovery_registration_session(
  $1::uuid,
  $2::bytea,
  $3::bytea,
  $4::bytea,
  $5::uuid,
  $6::bytea,
  $7::bytea,
  $8::text,
  $9::bigint,
  $10::boolean,
  $11::boolean,
  $12::uuid,
  $13::bytea,
  $14::timestamptz,
  $15::uuid,
  $16::text
) AS completed`;

export interface PairingDatabaseActivation {
  readonly auditEventId: string;
  readonly deviceId: string;
  readonly pairingId: string;
  readonly pollVerifierDigest: Uint8Array;
  readonly requestId: string;
}

export interface PairingDatabaseStart {
  readonly architecture: string;
  readonly connectorVersion: string;
  readonly deviceKeyId: string;
  readonly deviceLabel: string;
  readonly expiresAt: string;
  readonly osFamily: string;
  readonly pairingChallenge: Uint8Array;
  readonly pairingId: string;
  readonly pollVerifierDigest: Uint8Array;
  readonly publicKey: Uint8Array;
  readonly userCodeDigest: Uint8Array;
}

export interface EnrollmentDatabaseProfile {
  readonly auditEventId: string;
  readonly githubUserId: number;
  readonly handle: string;
  readonly inviteId: string;
  readonly inviteVerifierDigest: Uint8Array;
  readonly locale: "en" | "ru";
  readonly motionPreference: "off" | "on" | "system";
  readonly profileId: string;
  readonly requestId: string;
  readonly sessionExpiresAt: string;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
  readonly streakVisible: boolean;
  readonly theme: "classic-grand-prix" | "cyber-rally" | "neon-night";
}

export interface EnrollmentDatabasePasskeyChallenge {
  readonly challengeDigest: Uint8Array;
  readonly challengeId: string;
  readonly contextDigest: Uint8Array;
  readonly expiresAt: string;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
}

export interface EnrollmentDatabaseInitialPasskey {
  readonly auditEventId: string;
  readonly backupEligible: boolean;
  readonly backupState: boolean;
  readonly challengeDigest: Uint8Array;
  readonly challengeId: string;
  readonly contextDigest: Uint8Array;
  readonly cosePublicKey: Uint8Array;
  readonly credentialId: Uint8Array;
  readonly label: string;
  readonly passkeyId: string;
  readonly requestId: string;
  readonly rotatedSessionExpiresAt: string;
  readonly rotatedSessionId: string;
  readonly rotatedSessionVerifierDigest: Uint8Array;
  readonly rotationAuditEventId: string;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
  readonly signCount: number;
}

export interface EnrollmentDatabaseSessionRevocation {
  readonly auditEventId: string;
  readonly requestId: string;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
}

export interface EnrollmentDatabaseLoginCompletion {
  readonly auditEventId: string;
  readonly backupState: boolean;
  readonly challengeDigest: Uint8Array;
  readonly challengeExpiresAt: string;
  readonly challengeId: string;
  readonly contextDigest: Uint8Array;
  readonly credentialId: Uint8Array;
  readonly observedSignCount: number;
  readonly passkeyId: string;
  readonly requestId: string;
  readonly sessionExpiresAt: string;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
}

export interface EnrollmentDatabasePasskeyInventoryRequest {
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
}

export interface EnrollmentDatabaseSourceDeviceInventoryRequest {
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
}

export interface EnrollmentDatabaseDeviceRevocation {
  readonly auditEventId: string;
  readonly deviceId: string;
  readonly requestId: string;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
}

export interface EnrollmentDatabaseSourcePause {
  readonly auditEventId: string;
  readonly requestId: string;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
  readonly sourceId: string;
}

export interface EnrollmentDatabasePairingApprovalRead {
  readonly attemptLimit: number;
  readonly codeDigests: readonly [Uint8Array, Uint8Array];
  readonly secondaryActive: boolean;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
  readonly windowSeconds: number;
}

export interface EnrollmentDatabasePairingApprovalChallenge {
  readonly challengeDigest: Uint8Array;
  readonly challengeId: string;
  readonly contextDigest: Uint8Array;
  readonly expiresAt: string;
  readonly pairingId: string;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
  readonly sourceId: string;
  readonly userCodeDigest: Uint8Array;
}

export interface EnrollmentDatabasePairingApproval {
  readonly auditEventId: string;
  readonly backupState: boolean;
  readonly challengeDigest: Uint8Array;
  readonly challengeId: string;
  readonly contextDigest: Uint8Array;
  readonly observedSignCount: number;
  readonly pairingId: string;
  readonly requestId: string;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
  readonly verifiedPasskeyId: string;
}

export interface EnrollmentDatabaseSourceReactivationChallenge {
  readonly challengeDigest: Uint8Array;
  readonly challengeId: string;
  readonly contextDigest: Uint8Array;
  readonly expiresAt: string;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
  readonly sourceId: string;
}

export interface EnrollmentDatabaseSourceReactivation {
  readonly auditEventId: string;
  readonly backupState: boolean;
  readonly challengeDigest: Uint8Array;
  readonly challengeId: string;
  readonly contextDigest: Uint8Array;
  readonly observedSignCount: number;
  readonly requestId: string;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
  readonly sourceId: string;
  readonly verifiedPasskeyId: string;
}

export type EnrollmentDatabaseSourceUnlinkChallenge = EnrollmentDatabaseSourceReactivationChallenge;

export type EnrollmentDatabaseSourceUnlink = EnrollmentDatabaseSourceReactivation;

export interface EnrollmentDatabaseProfileVisibilityRequest {
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
}

export interface EnrollmentDatabaseAccountOverviewRequest extends EnrollmentDatabaseProfileVisibilityRequest {
  readonly seasonStart: string;
}

export interface EnrollmentDatabaseProfileVisibilityUpdate extends EnrollmentDatabaseProfileVisibilityRequest {
  readonly publiclyVisible: boolean;
}

export interface EnrollmentDatabaseProfileDeletionChallenge {
  readonly challengeDigest: Uint8Array;
  readonly challengeId: string;
  readonly contextDigest: Uint8Array;
  readonly expiresAt: string;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
}

export interface EnrollmentDatabaseProfileDeletion {
  readonly auditEventId: string;
  readonly backupState: boolean;
  readonly challengeDigest: Uint8Array;
  readonly challengeId: string;
  readonly contextDigest: Uint8Array;
  readonly deletionJobId: string;
  readonly observedSignCount: number;
  readonly profileRefDigest: Uint8Array;
  readonly requestId: string;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
  readonly typedHandle: string;
  readonly verifiedPasskeyId: string;
}

export interface EnrollmentDatabasePasskeyAddChallenge {
  readonly challengeDigest: Uint8Array;
  readonly challengeId: string;
  readonly contextDigest: Uint8Array;
  readonly expiresAt: string;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
}

export interface EnrollmentDatabasePasskeyAddition {
  readonly auditEventId: string;
  readonly backupEligible: boolean;
  readonly backupState: boolean;
  readonly challengeDigest: Uint8Array;
  readonly challengeId: string;
  readonly contextDigest: Uint8Array;
  readonly cosePublicKey: Uint8Array;
  readonly credentialId: Uint8Array;
  readonly label: string;
  readonly observedSignCount: number;
  readonly passkeyId: string;
  readonly requestId: string;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
  readonly signCount: number;
  readonly verifiedBackupState: boolean;
  readonly verifiedPasskeyId: string;
}

export interface EnrollmentDatabasePasskeyRevokeChallenge {
  readonly challengeDigest: Uint8Array;
  readonly challengeId: string;
  readonly contextDigest: Uint8Array;
  readonly expiresAt: string;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
  readonly targetPasskeyId: string;
}

export interface EnrollmentDatabasePasskeyRevocation {
  readonly auditEventId: string;
  readonly backupState: boolean;
  readonly challengeDigest: Uint8Array;
  readonly challengeId: string;
  readonly contextDigest: Uint8Array;
  readonly observedSignCount: number;
  readonly requestId: string;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
  readonly targetPasskeyId: string;
  readonly verifiedPasskeyId: string;
}

export interface EnrollmentDatabaseRecoveryCodeChallenge {
  readonly challengeDigest: Uint8Array;
  readonly challengeId: string;
  readonly contextDigest: Uint8Array;
  readonly expiresAt: string;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
}

export interface EnrollmentDatabaseRecoveryCodeReplacement {
  readonly auditEventId: string;
  readonly backupState: boolean;
  readonly batchId: string;
  readonly challengeDigest: Uint8Array;
  readonly challengeId: string;
  readonly contextDigest: Uint8Array;
  readonly observedSignCount: number;
  readonly recoveryCodeIds: readonly string[];
  readonly requestId: string;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
  readonly verifierPhcs: readonly string[];
  readonly verifiedPasskeyId: string;
}

export interface EnrollmentDatabaseRecoveryStart {
  readonly auditEventId: string;
  readonly authorityId: string;
  readonly authorityVerifierDigest: Uint8Array;
  readonly challengeDigest: Uint8Array;
  readonly contextDigest: Uint8Array;
  readonly expiresAt: string;
  readonly recoveryCodeId: string;
  readonly requestId: string;
}

export interface EnrollmentDatabaseRecoveryCompletion {
  readonly auditEventId: string;
  readonly authorityId: string;
  readonly authorityVerifierDigest: Uint8Array;
  readonly backupEligible: boolean;
  readonly backupState: boolean;
  readonly challengeDigest: Uint8Array;
  readonly contextDigest: Uint8Array;
  readonly cosePublicKey: Uint8Array;
  readonly credentialId: Uint8Array;
  readonly label: string;
  readonly passkeyId: string;
  readonly requestId: string;
  readonly sessionExpiresAt: string;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
  readonly signCount: number;
}

export type PairingDatabasePoolSignal = "idle_client_error";
export type PairingDatabasePoolSignalSink = (
  signal: PairingDatabasePoolSignal,
) => Promise<void> | void;

export interface PairingDatabaseClient {
  activatePairing(input: PairingDatabaseActivation): Promise<unknown>;
  readVerificationMaterial(
    pollVerifierDigests: readonly [Uint8Array, Uint8Array],
  ): Promise<unknown>;
  release(destroy?: boolean): void;
  startPairing(input: PairingDatabaseStart): Promise<unknown>;
  verifyRuntimeBoundary(): Promise<unknown>;
}

export interface EnrollmentDatabaseClient {
  completePairingApproval(input: EnrollmentDatabasePairingApproval): Promise<unknown>;
  completeInitialPasskey(input: EnrollmentDatabaseInitialPasskey): Promise<unknown>;
  completePasskeyAddition(input: EnrollmentDatabasePasskeyAddition): Promise<unknown>;
  completePasskeyLogin(input: EnrollmentDatabaseLoginCompletion): Promise<unknown>;
  completeRecoveryRegistration(input: EnrollmentDatabaseRecoveryCompletion): Promise<unknown>;
  completePasskeyRevocation(input: EnrollmentDatabasePasskeyRevocation): Promise<unknown>;
  completeRecoveryCodeReplacement(
    input: EnrollmentDatabaseRecoveryCodeReplacement,
  ): Promise<unknown>;
  completeProfileDeletion(input: EnrollmentDatabaseProfileDeletion): Promise<unknown>;
  completeSourceReactivation(input: EnrollmentDatabaseSourceReactivation): Promise<unknown>;
  completeSourceUnlink(input: EnrollmentDatabaseSourceUnlink): Promise<unknown>;
  createPasskeyAddChallenge(input: EnrollmentDatabasePasskeyAddChallenge): Promise<unknown>;
  createPairingApprovalChallenge(
    input: EnrollmentDatabasePairingApprovalChallenge,
  ): Promise<unknown>;
  createPasskeyChallenge(input: EnrollmentDatabasePasskeyChallenge): Promise<unknown>;
  createPasskeyRevokeChallenge(input: EnrollmentDatabasePasskeyRevokeChallenge): Promise<unknown>;
  createProfileDeletionChallenge(
    input: EnrollmentDatabaseProfileDeletionChallenge,
  ): Promise<unknown>;
  createRecoveryCodeChallenge(input: EnrollmentDatabaseRecoveryCodeChallenge): Promise<unknown>;
  createSourceReactivationChallenge(
    input: EnrollmentDatabaseSourceReactivationChallenge,
  ): Promise<unknown>;
  createSourceUnlinkChallenge(input: EnrollmentDatabaseSourceUnlinkChallenge): Promise<unknown>;
  enrollProfile(input: EnrollmentDatabaseProfile): Promise<unknown>;
  pauseSource(input: EnrollmentDatabaseSourcePause): Promise<unknown>;
  readAccountOverview(input: EnrollmentDatabaseAccountOverviewRequest): Promise<unknown>;
  readActiveDeviceInventory(
    input: EnrollmentDatabaseSourceDeviceInventoryRequest,
  ): Promise<unknown>;
  readPasskeyInventory(input: EnrollmentDatabasePasskeyInventoryRequest): Promise<unknown>;
  readPairingApproval(input: EnrollmentDatabasePairingApprovalRead): Promise<unknown>;
  readPasskeyLoginMaterial(credentialId: Uint8Array): Promise<unknown>;
  readRecoveryCodeVerificationMaterial(recoveryCodeId: string): Promise<unknown>;
  readProfileVisibility(input: EnrollmentDatabaseProfileVisibilityRequest): Promise<unknown>;
  release(destroy?: boolean): void;
  revokeDevice(input: EnrollmentDatabaseDeviceRevocation): Promise<unknown>;
  revokeEnrollmentSession(input: EnrollmentDatabaseSessionRevocation): Promise<unknown>;
  setProfileVisibility(input: EnrollmentDatabaseProfileVisibilityUpdate): Promise<unknown>;
  startRecovery(input: EnrollmentDatabaseRecoveryStart): Promise<unknown>;
  verifyRuntimeBoundary(): Promise<unknown>;
}

export interface PairingDatabasePool {
  close(): Promise<void>;
  connect(): Promise<PairingDatabaseClient>;
}

export interface EnrollmentDatabasePool {
  close(): Promise<void>;
  connect(): Promise<EnrollmentDatabaseClient>;
}

export interface WebAuthDatabaseClient extends PairingDatabaseClient, EnrollmentDatabaseClient {}

export interface WebAuthDatabasePool extends PairingDatabasePool, EnrollmentDatabasePool {
  connect(): Promise<WebAuthDatabaseClient>;
}

interface NodePostgresPool {
  connect(): Promise<NodePostgresClient>;
  end(): Promise<void>;
  on(event: "error", listener: (error: Error) => void): this;
}

interface NodePostgresClient {
  query(query: { text: string; values: unknown[] }): Promise<{ rows: unknown }>;
  release(destroy?: boolean): void;
}

type NodePostgresPoolFactory = (config: PairingDatabaseConfig) => NodePostgresPool;

function defaultPoolFactory(config: PairingDatabaseConfig): NodePostgresPool {
  return new Pool(config);
}

function signalSafely(
  sink: PairingDatabasePoolSignalSink | undefined,
  signal: PairingDatabasePoolSignal,
): void {
  try {
    const result = sink?.(signal);
    if (result !== undefined) {
      void result.catch(() => undefined);
    }
  } catch {
    // Monitoring cannot turn an already-contained idle-client failure into a process crash.
  }
}

function wrapClient(client: NodePostgresClient): WebAuthDatabaseClient {
  async function fixedQuery(text: string, values: readonly unknown[] = []): Promise<unknown> {
    const result = await client.query({ text, values: [...values] });
    return result.rows;
  }

  return Object.freeze({
    async activatePairing(input: PairingDatabaseActivation): Promise<unknown> {
      const digest = Buffer.from(input.pollVerifierDigest);
      try {
        return await fixedQuery(activatePairingQuery, [
          digest,
          input.pairingId,
          input.deviceId,
          input.auditEventId,
          input.requestId,
        ]);
      } finally {
        digest.fill(0);
      }
    },
    async completePairingApproval(input: EnrollmentDatabasePairingApproval): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      const challengeDigest = Buffer.from(input.challengeDigest);
      const contextDigest = Buffer.from(input.contextDigest);
      try {
        return await fixedQuery(completePairingApprovalQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.challengeId,
          challengeDigest,
          contextDigest,
          input.verifiedPasskeyId,
          input.observedSignCount,
          input.backupState,
          input.pairingId,
          input.auditEventId,
          input.requestId,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
        challengeDigest.fill(0);
        contextDigest.fill(0);
      }
    },
    async completeInitialPasskey(input: EnrollmentDatabaseInitialPasskey): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      const challengeDigest = Buffer.from(input.challengeDigest);
      const contextDigest = Buffer.from(input.contextDigest);
      const credentialId = Buffer.from(input.credentialId);
      const cosePublicKey = Buffer.from(input.cosePublicKey);
      const rotatedSessionVerifierDigest = Buffer.from(input.rotatedSessionVerifierDigest);
      try {
        return await fixedQuery(completeInitialPasskeyQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.challengeId,
          challengeDigest,
          contextDigest,
          input.passkeyId,
          credentialId,
          cosePublicKey,
          input.label,
          input.signCount,
          input.backupEligible,
          input.backupState,
          input.auditEventId,
          input.requestId,
          input.rotatedSessionId,
          rotatedSessionVerifierDigest,
          input.rotatedSessionExpiresAt,
          input.rotationAuditEventId,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
        challengeDigest.fill(0);
        contextDigest.fill(0);
        credentialId.fill(0);
        cosePublicKey.fill(0);
        rotatedSessionVerifierDigest.fill(0);
      }
    },
    async completePasskeyAddition(input: EnrollmentDatabasePasskeyAddition): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      const challengeDigest = Buffer.from(input.challengeDigest);
      const contextDigest = Buffer.from(input.contextDigest);
      const credentialId = Buffer.from(input.credentialId);
      const cosePublicKey = Buffer.from(input.cosePublicKey);
      try {
        return await fixedQuery(completePasskeyAdditionQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.challengeId,
          challengeDigest,
          contextDigest,
          input.verifiedPasskeyId,
          input.observedSignCount,
          input.verifiedBackupState,
          input.passkeyId,
          credentialId,
          cosePublicKey,
          input.label,
          input.signCount,
          input.backupEligible,
          input.backupState,
          input.auditEventId,
          input.requestId,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
        challengeDigest.fill(0);
        contextDigest.fill(0);
        credentialId.fill(0);
        cosePublicKey.fill(0);
      }
    },
    async completePasskeyLogin(input: EnrollmentDatabaseLoginCompletion): Promise<unknown> {
      const challengeDigest = Buffer.from(input.challengeDigest);
      const contextDigest = Buffer.from(input.contextDigest);
      const credentialId = Buffer.from(input.credentialId);
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      try {
        return await fixedQuery(completePasskeyLoginQuery, [
          input.challengeId,
          challengeDigest,
          contextDigest,
          input.challengeExpiresAt,
          input.passkeyId,
          credentialId,
          input.observedSignCount,
          input.backupState,
          input.sessionId,
          sessionVerifierDigest,
          input.sessionExpiresAt,
          input.auditEventId,
          input.requestId,
        ]);
      } finally {
        challengeDigest.fill(0);
        contextDigest.fill(0);
        credentialId.fill(0);
        sessionVerifierDigest.fill(0);
      }
    },
    async completeRecoveryRegistration(
      input: EnrollmentDatabaseRecoveryCompletion,
    ): Promise<unknown> {
      const authorityVerifierDigest = Buffer.from(input.authorityVerifierDigest);
      const challengeDigest = Buffer.from(input.challengeDigest);
      const contextDigest = Buffer.from(input.contextDigest);
      const credentialId = Buffer.from(input.credentialId);
      const cosePublicKey = Buffer.from(input.cosePublicKey);
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      try {
        return await fixedQuery(completeRecoveryRegistrationQuery, [
          input.authorityId,
          authorityVerifierDigest,
          challengeDigest,
          contextDigest,
          input.passkeyId,
          credentialId,
          cosePublicKey,
          input.label,
          input.signCount,
          input.backupEligible,
          input.backupState,
          input.sessionId,
          sessionVerifierDigest,
          input.sessionExpiresAt,
          input.auditEventId,
          input.requestId,
        ]);
      } finally {
        authorityVerifierDigest.fill(0);
        challengeDigest.fill(0);
        contextDigest.fill(0);
        credentialId.fill(0);
        cosePublicKey.fill(0);
        sessionVerifierDigest.fill(0);
      }
    },
    async completePasskeyRevocation(input: EnrollmentDatabasePasskeyRevocation): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      const challengeDigest = Buffer.from(input.challengeDigest);
      const contextDigest = Buffer.from(input.contextDigest);
      try {
        return await fixedQuery(completePasskeyRevocationQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.challengeId,
          challengeDigest,
          contextDigest,
          input.verifiedPasskeyId,
          input.observedSignCount,
          input.backupState,
          input.targetPasskeyId,
          input.auditEventId,
          input.requestId,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
        challengeDigest.fill(0);
        contextDigest.fill(0);
      }
    },
    async completeRecoveryCodeReplacement(
      input: EnrollmentDatabaseRecoveryCodeReplacement,
    ): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      const challengeDigest = Buffer.from(input.challengeDigest);
      const contextDigest = Buffer.from(input.contextDigest);
      try {
        return await fixedQuery(completeRecoveryCodeReplacementQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.challengeId,
          challengeDigest,
          contextDigest,
          input.verifiedPasskeyId,
          input.observedSignCount,
          input.backupState,
          input.batchId,
          [...input.recoveryCodeIds],
          [...input.verifierPhcs],
          input.auditEventId,
          input.requestId,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
        challengeDigest.fill(0);
        contextDigest.fill(0);
      }
    },
    async completeProfileDeletion(input: EnrollmentDatabaseProfileDeletion): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      const challengeDigest = Buffer.from(input.challengeDigest);
      const contextDigest = Buffer.from(input.contextDigest);
      const profileRefDigest = Buffer.from(input.profileRefDigest);
      try {
        return await fixedQuery(completeProfileDeletionQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.challengeId,
          challengeDigest,
          contextDigest,
          input.verifiedPasskeyId,
          input.observedSignCount,
          input.backupState,
          input.typedHandle,
          input.deletionJobId,
          profileRefDigest,
          input.auditEventId,
          input.requestId,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
        challengeDigest.fill(0);
        contextDigest.fill(0);
        profileRefDigest.fill(0);
      }
    },
    async completeSourceReactivation(
      input: EnrollmentDatabaseSourceReactivation,
    ): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      const challengeDigest = Buffer.from(input.challengeDigest);
      const contextDigest = Buffer.from(input.contextDigest);
      try {
        return await fixedQuery(completeSourceReactivationQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.challengeId,
          challengeDigest,
          contextDigest,
          input.verifiedPasskeyId,
          input.observedSignCount,
          input.backupState,
          input.sourceId,
          input.auditEventId,
          input.requestId,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
        challengeDigest.fill(0);
        contextDigest.fill(0);
      }
    },
    async completeSourceUnlink(input: EnrollmentDatabaseSourceUnlink): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      const challengeDigest = Buffer.from(input.challengeDigest);
      const contextDigest = Buffer.from(input.contextDigest);
      try {
        return await fixedQuery(completeSourceUnlinkQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.challengeId,
          challengeDigest,
          contextDigest,
          input.verifiedPasskeyId,
          input.observedSignCount,
          input.backupState,
          input.sourceId,
          input.auditEventId,
          input.requestId,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
        challengeDigest.fill(0);
        contextDigest.fill(0);
      }
    },
    async createPasskeyAddChallenge(
      input: EnrollmentDatabasePasskeyAddChallenge,
    ): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      const challengeDigest = Buffer.from(input.challengeDigest);
      const contextDigest = Buffer.from(input.contextDigest);
      try {
        return await fixedQuery(createPasskeyAddChallengeQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.challengeId,
          challengeDigest,
          contextDigest,
          input.expiresAt,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
        challengeDigest.fill(0);
        contextDigest.fill(0);
      }
    },
    async createPairingApprovalChallenge(
      input: EnrollmentDatabasePairingApprovalChallenge,
    ): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      const userCodeDigest = Buffer.from(input.userCodeDigest);
      const challengeDigest = Buffer.from(input.challengeDigest);
      const contextDigest = Buffer.from(input.contextDigest);
      try {
        return await fixedQuery(createPairingApprovalChallengeQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.pairingId,
          userCodeDigest,
          input.sourceId,
          input.challengeId,
          challengeDigest,
          contextDigest,
          input.expiresAt,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
        userCodeDigest.fill(0);
        challengeDigest.fill(0);
        contextDigest.fill(0);
      }
    },
    async createPasskeyChallenge(input: EnrollmentDatabasePasskeyChallenge): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      const challengeDigest = Buffer.from(input.challengeDigest);
      const contextDigest = Buffer.from(input.contextDigest);
      try {
        return await fixedQuery(createPasskeyChallengeQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.challengeId,
          challengeDigest,
          contextDigest,
          input.expiresAt,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
        challengeDigest.fill(0);
        contextDigest.fill(0);
      }
    },
    async createPasskeyRevokeChallenge(
      input: EnrollmentDatabasePasskeyRevokeChallenge,
    ): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      const challengeDigest = Buffer.from(input.challengeDigest);
      const contextDigest = Buffer.from(input.contextDigest);
      try {
        return await fixedQuery(createPasskeyRevokeChallengeQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.targetPasskeyId,
          input.challengeId,
          challengeDigest,
          contextDigest,
          input.expiresAt,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
        challengeDigest.fill(0);
        contextDigest.fill(0);
      }
    },
    async createProfileDeletionChallenge(
      input: EnrollmentDatabaseProfileDeletionChallenge,
    ): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      const challengeDigest = Buffer.from(input.challengeDigest);
      const contextDigest = Buffer.from(input.contextDigest);
      try {
        return await fixedQuery(createProfileDeletionChallengeQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.challengeId,
          challengeDigest,
          contextDigest,
          input.expiresAt,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
        challengeDigest.fill(0);
        contextDigest.fill(0);
      }
    },
    async createRecoveryCodeChallenge(
      input: EnrollmentDatabaseRecoveryCodeChallenge,
    ): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      const challengeDigest = Buffer.from(input.challengeDigest);
      const contextDigest = Buffer.from(input.contextDigest);
      try {
        return await fixedQuery(createRecoveryCodeChallengeQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.challengeId,
          challengeDigest,
          contextDigest,
          input.expiresAt,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
        challengeDigest.fill(0);
        contextDigest.fill(0);
      }
    },
    async createSourceReactivationChallenge(
      input: EnrollmentDatabaseSourceReactivationChallenge,
    ): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      const challengeDigest = Buffer.from(input.challengeDigest);
      const contextDigest = Buffer.from(input.contextDigest);
      try {
        return await fixedQuery(createSourceReactivationChallengeQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.sourceId,
          input.challengeId,
          challengeDigest,
          contextDigest,
          input.expiresAt,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
        challengeDigest.fill(0);
        contextDigest.fill(0);
      }
    },
    async createSourceUnlinkChallenge(
      input: EnrollmentDatabaseSourceUnlinkChallenge,
    ): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      const challengeDigest = Buffer.from(input.challengeDigest);
      const contextDigest = Buffer.from(input.contextDigest);
      try {
        return await fixedQuery(createSourceUnlinkChallengeQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.sourceId,
          input.challengeId,
          challengeDigest,
          contextDigest,
          input.expiresAt,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
        challengeDigest.fill(0);
        contextDigest.fill(0);
      }
    },
    async enrollProfile(input: EnrollmentDatabaseProfile): Promise<unknown> {
      const inviteVerifierDigest = Buffer.from(input.inviteVerifierDigest);
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      try {
        return await fixedQuery(enrollProfileQuery, [
          input.inviteId,
          inviteVerifierDigest,
          input.profileId,
          input.githubUserId,
          input.handle,
          input.locale,
          input.theme,
          input.motionPreference,
          input.streakVisible,
          input.sessionId,
          sessionVerifierDigest,
          input.sessionExpiresAt,
          input.auditEventId,
          input.requestId,
        ]);
      } finally {
        inviteVerifierDigest.fill(0);
        sessionVerifierDigest.fill(0);
      }
    },
    async readVerificationMaterial(
      pollVerifierDigests: readonly [Uint8Array, Uint8Array],
    ): Promise<unknown> {
      const first = Buffer.from(pollVerifierDigests[0]);
      const second = Buffer.from(pollVerifierDigests[1]);
      try {
        return await fixedQuery(verificationMaterialQuery, [first, second]);
      } finally {
        first.fill(0);
        second.fill(0);
      }
    },
    async readPairingApproval(input: EnrollmentDatabasePairingApprovalRead): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      const primaryCodeDigest = Buffer.from(input.codeDigests[0]);
      const secondaryCodeDigest = Buffer.from(input.codeDigests[1]);
      try {
        return await fixedQuery(readPairingApprovalQuery, [
          input.sessionId,
          sessionVerifierDigest,
          primaryCodeDigest,
          secondaryCodeDigest,
          input.secondaryActive,
          input.attemptLimit,
          input.windowSeconds,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
        primaryCodeDigest.fill(0);
        secondaryCodeDigest.fill(0);
      }
    },
    async readPasskeyLoginMaterial(credentialId: Uint8Array): Promise<unknown> {
      const credential = Buffer.from(credentialId);
      try {
        return await fixedQuery(readPasskeyLoginMaterialQuery, [credential]);
      } finally {
        credential.fill(0);
      }
    },
    readRecoveryCodeVerificationMaterial(recoveryCodeId: string): Promise<unknown> {
      return fixedQuery(readRecoveryCodeVerificationMaterialQuery, [recoveryCodeId]);
    },
    async pauseSource(input: EnrollmentDatabaseSourcePause): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      try {
        return await fixedQuery(pauseSourceQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.sourceId,
          input.auditEventId,
          input.requestId,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
      }
    },
    async readActiveDeviceInventory(
      input: EnrollmentDatabaseSourceDeviceInventoryRequest,
    ): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      try {
        return await fixedQuery(readActiveDeviceInventoryQuery, [
          input.sessionId,
          sessionVerifierDigest,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
      }
    },
    async readAccountOverview(input: EnrollmentDatabaseAccountOverviewRequest): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      try {
        return await fixedQuery(readAccountOverviewQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.seasonStart,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
      }
    },
    async readPasskeyInventory(input: EnrollmentDatabasePasskeyInventoryRequest): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      try {
        return await fixedQuery(readPasskeyInventoryQuery, [
          input.sessionId,
          sessionVerifierDigest,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
      }
    },
    async readProfileVisibility(
      input: EnrollmentDatabaseProfileVisibilityRequest,
    ): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      try {
        return await fixedQuery(readProfileVisibilityQuery, [
          input.sessionId,
          sessionVerifierDigest,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
      }
    },
    release(destroy = false): void {
      client.release(destroy);
    },
    async revokeDevice(input: EnrollmentDatabaseDeviceRevocation): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      try {
        return await fixedQuery(revokeDeviceQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.deviceId,
          input.auditEventId,
          input.requestId,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
      }
    },
    async setProfileVisibility(input: EnrollmentDatabaseProfileVisibilityUpdate): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      try {
        return await fixedQuery(setProfileVisibilityQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.publiclyVisible,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
      }
    },
    async startPairing(input: PairingDatabaseStart): Promise<unknown> {
      const pollVerifierDigest = Buffer.from(input.pollVerifierDigest);
      const userCodeDigest = Buffer.from(input.userCodeDigest);
      const pairingChallenge = Buffer.from(input.pairingChallenge);
      const publicKey = Buffer.from(input.publicKey);
      try {
        return await fixedQuery(startPairingQuery, [
          input.pairingId,
          pollVerifierDigest,
          userCodeDigest,
          pairingChallenge,
          input.deviceKeyId,
          publicKey,
          input.deviceLabel,
          input.connectorVersion,
          input.osFamily,
          input.architecture,
          input.expiresAt,
        ]);
      } finally {
        pollVerifierDigest.fill(0);
        userCodeDigest.fill(0);
        pairingChallenge.fill(0);
        publicKey.fill(0);
      }
    },
    async startRecovery(input: EnrollmentDatabaseRecoveryStart): Promise<unknown> {
      const authorityVerifierDigest = Buffer.from(input.authorityVerifierDigest);
      const challengeDigest = Buffer.from(input.challengeDigest);
      const contextDigest = Buffer.from(input.contextDigest);
      try {
        return await fixedQuery(startRecoveryQuery, [
          input.recoveryCodeId,
          input.authorityId,
          authorityVerifierDigest,
          challengeDigest,
          contextDigest,
          input.expiresAt,
          input.auditEventId,
          input.requestId,
        ]);
      } finally {
        authorityVerifierDigest.fill(0);
        challengeDigest.fill(0);
        contextDigest.fill(0);
      }
    },
    async revokeEnrollmentSession(input: EnrollmentDatabaseSessionRevocation): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      try {
        return await fixedQuery(revokeEnrollmentSessionQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.auditEventId,
          input.requestId,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
      }
    },
    verifyRuntimeBoundary(): Promise<unknown> {
      return fixedQuery(runtimeBoundaryQuery);
    },
  });
}

export function createPairingDatabasePool(
  config: PairingDatabaseConfig,
  signalSink?: PairingDatabasePoolSignalSink,
  poolFactory: NodePostgresPoolFactory = defaultPoolFactory,
): WebAuthDatabasePool {
  const pool = poolFactory(config);
  pool.on("error", () => {
    signalSafely(signalSink, "idle_client_error");
  });

  return Object.freeze({
    async close(): Promise<void> {
      await pool.end();
    },
    async connect(): Promise<WebAuthDatabaseClient> {
      return wrapClient(await pool.connect());
    },
  });
}
