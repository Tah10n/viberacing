import "server-only";

import { Buffer } from "node:buffer";

import { Pool } from "pg";

import type { CarRecipeV1 } from "@viberacing/contracts";

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

const enrollProfileQuery = `SELECT
  opened.profile_id,
  opened.handle,
  opened.locale,
  opened.profile_state,
  opened.created,
  opened.session_created
FROM viberacing_api.open_github_profile(
  $1::uuid,
  $2::bigint,
  $3::text,
  $4::text,
  $5::uuid,
  $6::bytea,
  $7::timestamptz,
  $8::uuid,
  $9::bytea,
  $10::boolean
) AS opened`;

const createPasskeyChallengeQuery = `WITH challenge_creation AS MATERIALIZED (
  SELECT viberacing_api.begin_initial_passkey(
    $1::uuid,
    $2::bytea,
    $3::text,
    $4::uuid,
    $5::bytea,
    $6::bytea,
    $7::timestamptz
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS created
FROM challenge_creation`;

const completeInitialPasskeyQuery = `WITH passkey_completion AS MATERIALIZED (
  SELECT viberacing_api.complete_initial_passkey(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    $4::bytea,
    $5::text,
    $6::uuid,
    $7::bytea,
    $8::bytea,
    $9::bigint,
    $10::boolean,
    $11::boolean,
    $12::uuid,
    $13::bytea,
    $14::timestamptz
  ) AS profile_id
)
SELECT pg_catalog.count(*) = 1 AS registered
FROM passkey_completion`;

const revokeEnrollmentSessionQuery = `SELECT viberacing_api.revoke_session(
  $1::uuid,
  $2::bytea
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
  $11::timestamptz
) AS completed`;

const readPasskeyInventoryQuery = `SELECT
  inventory.passkey_id::text AS passkey_id,
  inventory.label AS label,
  inventory.state AS state,
  (inventory.created_at AT TIME ZONE 'UTC')::date::text AS created_on,
  inventory.current_authenticator AS current_authenticator
FROM viberacing_api.read_passkey_inventory($1::uuid, $2::bytea) AS inventory
ORDER BY (inventory.created_at AT TIME ZONE 'UTC')::date, inventory.passkey_id`;

const readPrivateDashboardRankingQuery = `SELECT
  ranking.season_start::text AS season_start,
  ranking.season_end::text AS season_end,
  ranking.season_state,
  ranking.weekly_token_total,
  ranking.rank_position::text AS rank_position,
  ranking.participant_count,
  ranking.snapshot_generated_at,
  ranking.public_visibility,
  ranking.provider_breakdown_visible
FROM viberacing_api.read_private_dashboard_ranking($1::uuid, $2::bytea) AS ranking`;

const readAgentAccountDashboardQuery = `SELECT
  dashboard.agent_account_id,
  dashboard.provider_code,
  dashboard.private_label,
  dashboard.identity_assurance,
  dashboard.accounting_revision,
  dashboard.expected_reader_version,
  dashboard.observed_reader_version,
  dashboard.account_state,
  dashboard.status_code,
  dashboard.quarantine_reason,
  dashboard.weekly_token_total,
  dashboard.today_token_total,
  dashboard.last_successful_sync_date::text AS last_successful_sync_date,
  dashboard.installation_id,
  dashboard.installation_label,
  dashboard.connector_version,
  dashboard.os_family,
  dashboard.architecture,
  dashboard.installation_state,
  dashboard.connected_date::text AS connected_date,
  dashboard.last_seen_date::text AS last_seen_date,
  dashboard.device_id,
  dashboard.device_state
FROM viberacing_api.read_agent_account_dashboard($1::uuid, $2::bytea) AS dashboard`;

const pauseAgentAccountQuery = `WITH account_pause AS MATERIALIZED (
  SELECT viberacing_api.pause_agent_account(
    $1::uuid,
    $2::bytea,
    $3::text
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS paused
FROM account_pause`;

const createAccountTargetActionChallengeQuery = `WITH challenge_creation AS MATERIALIZED (
  SELECT viberacing_api.create_auth_challenge(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    $4::text,
    $5::bytea,
    $6::bytea,
    $7::timestamptz
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS created
FROM challenge_creation`;

const completeAgentAccountReactivationQuery = `WITH account_reactivation AS MATERIALIZED (
  SELECT viberacing_api.reactivate_agent_account(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    $4::bytea,
    $5::uuid,
    $6::bigint,
    $7::boolean,
    $8::text
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS completed
FROM account_reactivation`;

const completeAgentAccountUnlinkQuery = `WITH account_unlink AS MATERIALIZED (
  SELECT viberacing_api.unlink_agent_account(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    $4::bytea,
    $5::uuid,
    $6::bigint,
    $7::boolean,
    $8::text
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS completed
FROM account_unlink`;

const completeDeviceKeyRevocationQuery = `WITH device_revocation AS MATERIALIZED (
  SELECT viberacing_api.revoke_device_key(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    $4::bytea,
    $5::uuid,
    $6::bigint,
    $7::boolean,
    $8::text
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS completed
FROM device_revocation`;

const completeInstallationRevocationQuery = `WITH installation_revocation AS MATERIALIZED (
  SELECT viberacing_api.revoke_connector_installation(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    $4::bytea,
    $5::uuid,
    $6::bigint,
    $7::boolean,
    $8::text
  ) AS revoked_device_count
)
SELECT pg_catalog.count(*) = 1 AS completed
FROM installation_revocation`;

const readProfileVisibilityQuery = `SELECT profile.public_visibility AS visibility
FROM viberacing_api.read_private_profile($1::uuid, $2::bytea) AS profile`;

const setProfileVisibilityQuery = `SELECT viberacing_api.set_profile_visibility(
  $1::uuid,
  $2::bytea,
  $3::text
) AS visibility`;

const setProviderBreakdownVisibilityQuery = `SELECT viberacing_api.set_provider_breakdown_visibility(
    $1::uuid,
    $2::bytea,
    $3::boolean
  ) AS provider_breakdown_visible`;

const proposeCarRecipeQuery = `SELECT viberacing_api.propose_car_recipe(
  $1::uuid,
  $2::bytea,
  $3::uuid,
  $4::integer,
  $5::text,
  $6::text,
  $7::text,
  $8::text,
  $9::text,
  $10::text,
  $11::text,
  $12::integer,
  $13::timestamptz
) AS proposed`;

const readCarProposalDeviceMaterialQuery = `SELECT
  material.device_key_id::text AS device_key_id,
  material.public_key
FROM viberacing_api.read_car_proposal_device_material($1::text) AS material`;

const proposeCarRecipeFromDeviceQuery = `SELECT viberacing_api.propose_car_recipe_from_device(
  $1::text,
  $2::text,
  $3::timestamptz,
  $4::bytea,
  $5::uuid,
  $6::integer,
  $7::text,
  $8::text,
  $9::text,
  $10::text,
  $11::text,
  $12::text,
  $13::text,
  $14::integer
) AS proposed`;

const readCarRecipeStateQuery = `SELECT
  state.active_schema_version,
  state.active_chassis,
  state.active_nose,
  state.active_cockpit,
  state.active_wing,
  state.active_wheels,
  state.active_palette,
  state.active_trail,
  state.active_seed,
  state.proposal_id::text AS proposal_id,
  state.proposal_schema_version,
  state.proposal_chassis,
  state.proposal_nose,
  state.proposal_cockpit,
  state.proposal_wing,
  state.proposal_wheels,
  state.proposal_palette,
  state.proposal_trail,
  state.proposal_seed,
  CASE
    WHEN state.proposal_expires_at IS NULL THEN NULL
    ELSE pg_catalog.to_char(
      state.proposal_expires_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  END AS proposal_expires_at
FROM viberacing_api.read_car_recipe_state($1::uuid, $2::bytea) AS state`;

const approveCarRecipeQuery = `SELECT viberacing_api.approve_car_recipe(
  $1::uuid,
  $2::bytea,
  $3::uuid
) AS approved`;

const rejectCarRecipeQuery = `SELECT viberacing_api.reject_car_recipe(
  $1::uuid,
  $2::bytea,
  $3::uuid
) AS rejected`;

const createProfileDeletionChallengeQuery = `WITH challenge_creation AS MATERIALIZED (
  SELECT viberacing_api.create_auth_challenge(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    'profile_delete'::text,
    $4::bytea,
    $5::bytea,
    $6::timestamptz
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS created
FROM challenge_creation`;

const completeProfileDeletionQuery = `WITH profile_deletion AS MATERIALIZED (
  SELECT viberacing_api.request_profile_deletion(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    $4::bytea,
    $5::uuid,
    $6::bigint,
    $7::boolean,
    $8::text
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS deleted
FROM profile_deletion`;

const createPasskeyAddChallengeQuery = `WITH challenge_creation AS MATERIALIZED (
  SELECT viberacing_api.create_auth_challenge(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    'passkey_change'::text,
    $4::bytea,
    $5::bytea,
    $6::timestamptz
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS created
FROM challenge_creation`;

const completePasskeyAdditionQuery = `WITH passkey_addition AS MATERIALIZED (
  SELECT viberacing_api.add_passkey(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    $4::bytea,
    $5::uuid,
    $6::bigint,
    $7::boolean,
    $8::uuid,
    $9::bytea,
    $10::bytea,
    $11::text,
    $12::bigint,
    $13::boolean,
    $14::boolean
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS added
FROM passkey_addition`;

const createPasskeyRevokeChallengeQuery = `WITH challenge_creation AS MATERIALIZED (
  SELECT viberacing_api.create_auth_challenge(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    'passkey_change'::text,
    $4::bytea,
    $5::bytea,
    $6::timestamptz
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS created
FROM challenge_creation`;

const completePasskeyRevocationQuery = `WITH passkey_revocation AS MATERIALIZED (
  SELECT viberacing_api.revoke_passkey(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    $4::bytea,
    $5::uuid,
    $6::bigint,
    $7::boolean,
    $8::uuid
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS revoked
FROM passkey_revocation`;

const createRecoveryCodeChallengeQuery = `WITH challenge_creation AS MATERIALIZED (
  SELECT viberacing_api.create_auth_challenge(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    'recovery_change'::text,
    $4::bytea,
    $5::bytea,
    $6::timestamptz
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS created
FROM challenge_creation`;

const completeRecoveryCodeReplacementQuery = `WITH recovery_code_replacement AS MATERIALIZED (
  SELECT viberacing_api.replace_recovery_codes(
    $1::uuid,
    $2::bytea,
    $3::uuid,
    $4::bytea,
    $5::uuid,
    $6::bigint,
    $7::boolean,
    $8::uuid,
    $9::uuid[],
    $10::text[]
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS replaced
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
    $6::timestamptz
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
  $14::timestamptz
) AS completed`;

export interface EnrollmentDatabaseProfile {
  readonly githubUserId: number;
  readonly handle: string;
  readonly inviteId?: string;
  readonly inviteRequired: boolean;
  readonly inviteVerifierDigest?: Uint8Array;
  readonly locale: "en" | "ru";
  readonly profileId: string;
  readonly sessionExpiresAt: string;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
}

export interface EnrollmentDatabasePasskeyChallenge {
  readonly challengeDigest: Uint8Array;
  readonly challengeId: string;
  readonly contextDigest: Uint8Array;
  readonly expiresAt: string;
  readonly handle: string;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
}

export interface EnrollmentDatabaseInitialPasskey {
  readonly backupEligible: boolean;
  readonly backupState: boolean;
  readonly challengeId: string;
  readonly contextDigest: Uint8Array;
  readonly cosePublicKey: Uint8Array;
  readonly credentialId: Uint8Array;
  readonly handle: string;
  readonly passkeyId: string;
  readonly rotatedSessionExpiresAt: string;
  readonly rotatedSessionId: string;
  readonly rotatedSessionVerifierDigest: Uint8Array;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
  readonly signCount: number;
}

export interface EnrollmentDatabaseSessionRevocation {
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
}

export interface EnrollmentDatabaseLoginCompletion {
  readonly backupState: boolean;
  readonly challengeDigest: Uint8Array;
  readonly challengeExpiresAt: string;
  readonly challengeId: string;
  readonly contextDigest: Uint8Array;
  readonly credentialId: Uint8Array;
  readonly observedSignCount: number;
  readonly passkeyId: string;
  readonly sessionExpiresAt: string;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
}

export interface EnrollmentDatabasePasskeyInventoryRequest {
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
}

export interface EnrollmentDatabaseAgentAccountPause {
  readonly agentAccountId: string;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
}

export type EnrollmentDatabaseAccountTargetPurpose =
  "account_reactivate" | "account_unlink" | "device_revoke" | "installation_revoke";

export interface EnrollmentDatabaseAccountTargetChallenge {
  readonly challengeDigest: Uint8Array;
  readonly challengeId: string;
  readonly contextDigest: Uint8Array;
  readonly expiresAt: string;
  readonly purpose: EnrollmentDatabaseAccountTargetPurpose;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
}

export interface EnrollmentDatabaseAccountTargetCompletion {
  readonly backupState: boolean;
  readonly challengeId: string;
  readonly contextDigest: Uint8Array;
  readonly observedSignCount: number;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
  readonly targetId: string;
  readonly verifiedPasskeyId: string;
}

export interface EnrollmentDatabaseProfileVisibilityRequest {
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
}

export interface EnrollmentDatabaseProfileVisibilityUpdate extends EnrollmentDatabaseProfileVisibilityRequest {
  readonly publiclyVisible: boolean;
}

export interface EnrollmentDatabaseProviderBreakdownVisibilityUpdate extends EnrollmentDatabaseProfileVisibilityRequest {
  readonly providerBreakdownVisible: boolean;
}

export interface EnrollmentDatabaseCarRecipeProposal extends EnrollmentDatabaseProfileVisibilityRequest {
  readonly expiresAt: string;
  readonly proposalId: string;
  readonly recipe: CarRecipeV1;
}

export interface EnrollmentDatabaseCarRecipeDecision extends EnrollmentDatabaseProfileVisibilityRequest {
  readonly proposalId: string;
}

export interface ConnectorCarProposalDatabaseMutation {
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly nonceDigest: Uint8Array;
  readonly observedAt: string;
  readonly proposalId: string;
  readonly recipe: CarRecipeV1;
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
  readonly backupState: boolean;
  readonly challengeId: string;
  readonly contextDigest: Uint8Array;
  readonly observedSignCount: number;
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
  readonly backupEligible: boolean;
  readonly backupState: boolean;
  readonly challengeId: string;
  readonly contextDigest: Uint8Array;
  readonly cosePublicKey: Uint8Array;
  readonly credentialId: Uint8Array;
  readonly label: string;
  readonly observedSignCount: number;
  readonly passkeyId: string;
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
}

export interface EnrollmentDatabasePasskeyRevocation {
  readonly backupState: boolean;
  readonly challengeId: string;
  readonly contextDigest: Uint8Array;
  readonly observedSignCount: number;
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
  readonly backupState: boolean;
  readonly batchId: string;
  readonly challengeId: string;
  readonly contextDigest: Uint8Array;
  readonly observedSignCount: number;
  readonly recoveryCodeIds: readonly string[];
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
  readonly verifierPhcs: readonly string[];
  readonly verifiedPasskeyId: string;
}

export interface EnrollmentDatabaseRecoveryStart {
  readonly authorityId: string;
  readonly authorityVerifierDigest: Uint8Array;
  readonly challengeDigest: Uint8Array;
  readonly contextDigest: Uint8Array;
  readonly expiresAt: string;
  readonly recoveryCodeId: string;
}

export interface EnrollmentDatabaseRecoveryCompletion {
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
  readonly sessionExpiresAt: string;
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
  readonly signCount: number;
}

export type PairingDatabasePoolSignal = "idle_client_error";
export type PairingDatabasePoolSignalSink = (
  signal: PairingDatabasePoolSignal,
) => Promise<void> | void;

export interface EnrollmentDatabaseClient {
  approveCarRecipe(input: EnrollmentDatabaseCarRecipeDecision): Promise<unknown>;
  completeAgentAccountReactivation(
    input: EnrollmentDatabaseAccountTargetCompletion,
  ): Promise<unknown>;
  completeAgentAccountUnlink(input: EnrollmentDatabaseAccountTargetCompletion): Promise<unknown>;
  completeDeviceKeyRevocation(input: EnrollmentDatabaseAccountTargetCompletion): Promise<unknown>;
  completeInstallationRevocation(
    input: EnrollmentDatabaseAccountTargetCompletion,
  ): Promise<unknown>;
  completeInitialPasskey(input: EnrollmentDatabaseInitialPasskey): Promise<unknown>;
  completePasskeyAddition(input: EnrollmentDatabasePasskeyAddition): Promise<unknown>;
  completePasskeyLogin(input: EnrollmentDatabaseLoginCompletion): Promise<unknown>;
  completeRecoveryRegistration(input: EnrollmentDatabaseRecoveryCompletion): Promise<unknown>;
  completePasskeyRevocation(input: EnrollmentDatabasePasskeyRevocation): Promise<unknown>;
  completeRecoveryCodeReplacement(
    input: EnrollmentDatabaseRecoveryCodeReplacement,
  ): Promise<unknown>;
  completeProfileDeletion(input: EnrollmentDatabaseProfileDeletion): Promise<unknown>;
  createPasskeyAddChallenge(input: EnrollmentDatabasePasskeyAddChallenge): Promise<unknown>;
  createPasskeyChallenge(input: EnrollmentDatabasePasskeyChallenge): Promise<unknown>;
  createPasskeyRevokeChallenge(input: EnrollmentDatabasePasskeyRevokeChallenge): Promise<unknown>;
  createProfileDeletionChallenge(
    input: EnrollmentDatabaseProfileDeletionChallenge,
  ): Promise<unknown>;
  createAccountTargetChallenge(input: EnrollmentDatabaseAccountTargetChallenge): Promise<unknown>;
  createRecoveryCodeChallenge(input: EnrollmentDatabaseRecoveryCodeChallenge): Promise<unknown>;
  enrollProfile(input: EnrollmentDatabaseProfile): Promise<unknown>;
  pauseAgentAccount(input: EnrollmentDatabaseAgentAccountPause): Promise<unknown>;
  proposeCarRecipe(input: EnrollmentDatabaseCarRecipeProposal): Promise<unknown>;
  readCarRecipeState(input: EnrollmentDatabaseProfileVisibilityRequest): Promise<unknown>;
  readAgentAccountDashboard(input: EnrollmentDatabaseProfileVisibilityRequest): Promise<unknown>;
  readPrivateDashboardRanking(input: EnrollmentDatabaseProfileVisibilityRequest): Promise<unknown>;
  readPasskeyInventory(input: EnrollmentDatabasePasskeyInventoryRequest): Promise<unknown>;
  readPasskeyLoginMaterial(credentialId: Uint8Array): Promise<unknown>;
  readRecoveryCodeVerificationMaterial(recoveryCodeId: string): Promise<unknown>;
  readProfileVisibility(input: EnrollmentDatabaseProfileVisibilityRequest): Promise<unknown>;
  release(destroy?: boolean): void;
  rejectCarRecipe(input: EnrollmentDatabaseCarRecipeDecision): Promise<unknown>;
  revokeEnrollmentSession(input: EnrollmentDatabaseSessionRevocation): Promise<unknown>;
  setProfileVisibility(input: EnrollmentDatabaseProfileVisibilityUpdate): Promise<unknown>;
  setProviderBreakdownVisibility(
    input: EnrollmentDatabaseProviderBreakdownVisibilityUpdate,
  ): Promise<unknown>;
  startRecovery(input: EnrollmentDatabaseRecoveryStart): Promise<unknown>;
  verifyRuntimeBoundary(): Promise<unknown>;
}

export interface ConnectorCarProposalDatabaseClient {
  proposeCarRecipeFromDevice(input: ConnectorCarProposalDatabaseMutation): Promise<unknown>;
  readCarProposalDeviceMaterial(deviceId: string): Promise<unknown>;
  release(destroy?: boolean): void;
  verifyRuntimeBoundary(): Promise<unknown>;
}

export interface EnrollmentDatabasePool {
  close(): Promise<void>;
  connect(): Promise<EnrollmentDatabaseClient>;
}

export interface ConnectorCarProposalDatabasePool {
  close(): Promise<void>;
  connect(): Promise<ConnectorCarProposalDatabaseClient>;
}

export interface WebAuthDatabaseClient
  extends EnrollmentDatabaseClient, ConnectorCarProposalDatabaseClient {}

export interface WebAuthDatabasePool
  extends EnrollmentDatabasePool, ConnectorCarProposalDatabasePool {
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

  async function completeAccountTarget(
    query: string,
    input: EnrollmentDatabaseAccountTargetCompletion,
  ): Promise<unknown> {
    const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
    const contextDigest = Buffer.from(input.contextDigest);
    try {
      return await fixedQuery(query, [
        input.sessionId,
        sessionVerifierDigest,
        input.challengeId,
        contextDigest,
        input.verifiedPasskeyId,
        input.observedSignCount,
        input.backupState,
        input.targetId,
      ]);
    } finally {
      sessionVerifierDigest.fill(0);
      contextDigest.fill(0);
    }
  }

  return Object.freeze({
    async approveCarRecipe(input: EnrollmentDatabaseCarRecipeDecision): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      try {
        return await fixedQuery(approveCarRecipeQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.proposalId,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
      }
    },
    completeAgentAccountReactivation(
      input: EnrollmentDatabaseAccountTargetCompletion,
    ): Promise<unknown> {
      return completeAccountTarget(completeAgentAccountReactivationQuery, input);
    },
    completeAgentAccountUnlink(input: EnrollmentDatabaseAccountTargetCompletion): Promise<unknown> {
      return completeAccountTarget(completeAgentAccountUnlinkQuery, input);
    },
    completeDeviceKeyRevocation(
      input: EnrollmentDatabaseAccountTargetCompletion,
    ): Promise<unknown> {
      return completeAccountTarget(completeDeviceKeyRevocationQuery, input);
    },
    completeInstallationRevocation(
      input: EnrollmentDatabaseAccountTargetCompletion,
    ): Promise<unknown> {
      return completeAccountTarget(completeInstallationRevocationQuery, input);
    },
    async completeInitialPasskey(input: EnrollmentDatabaseInitialPasskey): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      const contextDigest = Buffer.from(input.contextDigest);
      const credentialId = Buffer.from(input.credentialId);
      const cosePublicKey = Buffer.from(input.cosePublicKey);
      const rotatedSessionVerifierDigest = Buffer.from(input.rotatedSessionVerifierDigest);
      try {
        return await fixedQuery(completeInitialPasskeyQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.challengeId,
          contextDigest,
          input.handle,
          input.passkeyId,
          credentialId,
          cosePublicKey,
          input.signCount,
          input.backupEligible,
          input.backupState,
          input.rotatedSessionId,
          rotatedSessionVerifierDigest,
          input.rotatedSessionExpiresAt,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
        contextDigest.fill(0);
        credentialId.fill(0);
        cosePublicKey.fill(0);
        rotatedSessionVerifierDigest.fill(0);
      }
    },
    async completePasskeyAddition(input: EnrollmentDatabasePasskeyAddition): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      const contextDigest = Buffer.from(input.contextDigest);
      const credentialId = Buffer.from(input.credentialId);
      const cosePublicKey = Buffer.from(input.cosePublicKey);
      try {
        return await fixedQuery(completePasskeyAdditionQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.challengeId,
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
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
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
      const contextDigest = Buffer.from(input.contextDigest);
      try {
        return await fixedQuery(completePasskeyRevocationQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.challengeId,
          contextDigest,
          input.verifiedPasskeyId,
          input.observedSignCount,
          input.backupState,
          input.targetPasskeyId,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
        contextDigest.fill(0);
      }
    },
    async completeRecoveryCodeReplacement(
      input: EnrollmentDatabaseRecoveryCodeReplacement,
    ): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      const contextDigest = Buffer.from(input.contextDigest);
      try {
        return await fixedQuery(completeRecoveryCodeReplacementQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.challengeId,
          contextDigest,
          input.verifiedPasskeyId,
          input.observedSignCount,
          input.backupState,
          input.batchId,
          [...input.recoveryCodeIds],
          [...input.verifierPhcs],
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
        contextDigest.fill(0);
      }
    },
    async completeProfileDeletion(input: EnrollmentDatabaseProfileDeletion): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      const contextDigest = Buffer.from(input.contextDigest);
      try {
        return await fixedQuery(completeProfileDeletionQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.challengeId,
          contextDigest,
          input.verifiedPasskeyId,
          input.observedSignCount,
          input.backupState,
          input.typedHandle,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
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
    async createPasskeyChallenge(input: EnrollmentDatabasePasskeyChallenge): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      const challengeDigest = Buffer.from(input.challengeDigest);
      const contextDigest = Buffer.from(input.contextDigest);
      try {
        return await fixedQuery(createPasskeyChallengeQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.handle,
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
    async createAccountTargetChallenge(
      input: EnrollmentDatabaseAccountTargetChallenge,
    ): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      const challengeDigest = Buffer.from(input.challengeDigest);
      const contextDigest = Buffer.from(input.contextDigest);
      try {
        return await fixedQuery(createAccountTargetActionChallengeQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.challengeId,
          input.purpose,
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
    async enrollProfile(input: EnrollmentDatabaseProfile): Promise<unknown> {
      const inviteVerifierDigest =
        input.inviteVerifierDigest === undefined
          ? undefined
          : Buffer.from(input.inviteVerifierDigest);
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      try {
        return await fixedQuery(enrollProfileQuery, [
          input.profileId,
          input.githubUserId,
          input.handle,
          input.locale,
          input.sessionId,
          sessionVerifierDigest,
          input.sessionExpiresAt,
          input.inviteId ?? null,
          inviteVerifierDigest ?? null,
          input.inviteRequired,
        ]);
      } finally {
        inviteVerifierDigest?.fill(0);
        sessionVerifierDigest.fill(0);
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
    async pauseAgentAccount(input: EnrollmentDatabaseAgentAccountPause): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      try {
        return await fixedQuery(pauseAgentAccountQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.agentAccountId,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
      }
    },
    async proposeCarRecipe(input: EnrollmentDatabaseCarRecipeProposal): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      try {
        return await fixedQuery(proposeCarRecipeQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.proposalId,
          input.recipe.schemaVersion,
          input.recipe.chassis,
          input.recipe.nose,
          input.recipe.cockpit,
          input.recipe.wing,
          input.recipe.wheels,
          input.recipe.palette,
          input.recipe.trail,
          input.recipe.seed,
          input.expiresAt,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
      }
    },
    async proposeCarRecipeFromDevice(
      input: ConnectorCarProposalDatabaseMutation,
    ): Promise<unknown> {
      const nonceDigest = Buffer.from(input.nonceDigest);
      try {
        return await fixedQuery(proposeCarRecipeFromDeviceQuery, [
          input.deviceKeyId,
          input.deviceId,
          input.observedAt,
          nonceDigest,
          input.proposalId,
          input.recipe.schemaVersion,
          input.recipe.chassis,
          input.recipe.nose,
          input.recipe.cockpit,
          input.recipe.wing,
          input.recipe.wheels,
          input.recipe.palette,
          input.recipe.trail,
          input.recipe.seed,
        ]);
      } finally {
        nonceDigest.fill(0);
      }
    },
    async readAgentAccountDashboard(
      input: EnrollmentDatabaseProfileVisibilityRequest,
    ): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      try {
        return await fixedQuery(readAgentAccountDashboardQuery, [
          input.sessionId,
          sessionVerifierDigest,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
      }
    },
    async readCarRecipeState(input: EnrollmentDatabaseProfileVisibilityRequest): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      try {
        return await fixedQuery(readCarRecipeStateQuery, [input.sessionId, sessionVerifierDigest]);
      } finally {
        sessionVerifierDigest.fill(0);
      }
    },
    readCarProposalDeviceMaterial(deviceId: string): Promise<unknown> {
      return fixedQuery(readCarProposalDeviceMaterialQuery, [deviceId]);
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
    async readPrivateDashboardRanking(
      input: EnrollmentDatabaseProfileVisibilityRequest,
    ): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      try {
        return await fixedQuery(readPrivateDashboardRankingQuery, [
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
    async rejectCarRecipe(input: EnrollmentDatabaseCarRecipeDecision): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      try {
        return await fixedQuery(rejectCarRecipeQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.proposalId,
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
          input.publiclyVisible ? "public" : "hidden",
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
      }
    },
    async setProviderBreakdownVisibility(
      input: EnrollmentDatabaseProviderBreakdownVisibilityUpdate,
    ): Promise<unknown> {
      const sessionVerifierDigest = Buffer.from(input.sessionVerifierDigest);
      try {
        return await fixedQuery(setProviderBreakdownVisibilityQuery, [
          input.sessionId,
          sessionVerifierDigest,
          input.providerBreakdownVisible,
        ]);
      } finally {
        sessionVerifierDigest.fill(0);
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
