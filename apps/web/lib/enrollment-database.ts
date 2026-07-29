import "server-only";

import { Buffer } from "node:buffer";

import { validateCarRecipeV1, type CarRecipeV1 } from "@viberacing/contracts";

import { resolvePairingDatabaseConfig } from "./pairing-database-config";
import {
  createPairingDatabasePool,
  type EnrollmentDatabaseAccountTargetChallenge,
  type EnrollmentDatabaseAccountTargetCompletion,
  type EnrollmentDatabaseAgentAccountPause,
  type EnrollmentDatabaseCarRecipeDecision,
  type EnrollmentDatabaseCarRecipeProposal,
  type EnrollmentDatabaseClient,
  type EnrollmentDatabaseInitialPasskey,
  type EnrollmentDatabaseLoginCompletion,
  type EnrollmentDatabasePasskeyAddition,
  type EnrollmentDatabasePasskeyAddChallenge,
  type EnrollmentDatabasePasskeyChallenge,
  type EnrollmentDatabasePasskeyInventoryRequest,
  type EnrollmentDatabasePasskeyRevocation,
  type EnrollmentDatabasePasskeyRevokeChallenge,
  type EnrollmentDatabasePool,
  type EnrollmentDatabaseProfile,
  type EnrollmentDatabaseProfileDeletion,
  type EnrollmentDatabaseProfileDeletionChallenge,
  type EnrollmentDatabaseProfileVisibilityRequest,
  type EnrollmentDatabaseProfileVisibilityUpdate,
  type EnrollmentDatabaseProviderBreakdownVisibilityUpdate,
  type EnrollmentDatabaseRecoveryCodeChallenge,
  type EnrollmentDatabaseRecoveryCodeReplacement,
  type EnrollmentDatabaseRecoveryCompletion,
  type EnrollmentDatabaseRecoveryStart,
  type EnrollmentDatabaseSessionRevocation,
  type PairingDatabasePoolSignalSink,
} from "./pairing-database-pool";
import { enrollmentPatterns } from "./enrollment-domain";

const runtimeColumns = new Set(["login_scope_ok", "read_write_ok", "role_ok", "search_path_ok"]);
const loginMaterialColumns = new Set([
  "backup_eligible",
  "backup_state",
  "cose_public_key",
  "passkey_id",
  "sign_count",
]);
const loginProfileColumns = new Set(["handle", "locale", "profile_id"]);
const recoveryMaterialColumns = new Set(["recovery_code_id", "verifier_phc"]);
const passkeyInventoryColumns = new Set([
  "created_on",
  "current_authenticator",
  "label",
  "passkey_id",
  "state",
]);
const privateDashboardRankingColumns = new Set([
  "participant_count",
  "provider_breakdown_visible",
  "public_visibility",
  "rank_position",
  "season_end",
  "season_start",
  "season_state",
  "snapshot_generated_at",
  "weekly_token_total",
]);
const agentAccountDashboardColumns = new Set([
  "account_state",
  "accounting_revision",
  "agent_account_id",
  "architecture",
  "connected_date",
  "connector_version",
  "device_id",
  "device_state",
  "expected_reader_version",
  "identity_assurance",
  "installation_id",
  "installation_label",
  "installation_state",
  "last_seen_date",
  "last_successful_sync_date",
  "observed_reader_version",
  "os_family",
  "private_label",
  "provider_code",
  "quarantine_reason",
  "status_code",
  "today_token_total",
  "weekly_token_total",
]);
const carRecipeStateColumns = new Set([
  "active_chassis",
  "active_cockpit",
  "active_nose",
  "active_palette",
  "active_schema_version",
  "active_seed",
  "active_trail",
  "active_wheels",
  "active_wing",
  "proposal_chassis",
  "proposal_cockpit",
  "proposal_expires_at",
  "proposal_id",
  "proposal_nose",
  "proposal_palette",
  "proposal_schema_version",
  "proposal_seed",
  "proposal_trail",
  "proposal_wheels",
  "proposal_wing",
]);
const canonicalDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const canonicalTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const canonicalMinutePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/;
const agentAccountIdPattern = /^acc_[A-Za-z0-9_-]{22}$/;
const installationIdPattern = /^ins_[A-Za-z0-9_-]{22}$/;
const deviceIdPattern = /^dev_[A-Za-z0-9_-]{22}$/;
const connectorVersionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const readerVersionPattern = /^[a-z][a-z0-9_]{2,63}$/;
const exactTokenTotalPattern = /^(?:0|[1-9][0-9]{0,59})$/;
const unsafeLabelPattern = /[\p{Cc}\p{Cf}\p{Cs}]/u;
const recoveryPhcPattern =
  /^\$argon2id\$v=19\$m=[1-9][0-9]{0,5},t=[1-9][0-9]?,p=[1-9][0-9]?\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/;

export type EnrollmentDatabaseErrorCode =
  | "connection_release_failed"
  | "connection_unavailable"
  | "pool_close_failed"
  | "query_failed"
  | "result_invalid"
  | "runtime_boundary_mismatch";

export class EnrollmentDatabaseError extends Error {
  readonly code: EnrollmentDatabaseErrorCode;

  constructor(code: EnrollmentDatabaseErrorCode) {
    super("Enrollment is unavailable.");
    this.name = "EnrollmentDatabaseError";
    this.code = code;
  }
}

export interface EnrollmentDatabase {
  approveCarRecipe(input: EnrollmentDatabaseCarRecipeDecision): Promise<boolean>;
  completeAgentAccountReactivation(
    input: EnrollmentDatabaseAccountTargetCompletion,
  ): Promise<boolean>;
  completeAgentAccountUnlink(input: EnrollmentDatabaseAccountTargetCompletion): Promise<boolean>;
  completeDeviceKeyRevocation(input: EnrollmentDatabaseAccountTargetCompletion): Promise<boolean>;
  completeInstallationRevocation(
    input: EnrollmentDatabaseAccountTargetCompletion,
  ): Promise<boolean>;
  completeInitialPasskey(input: EnrollmentDatabaseInitialPasskey): Promise<boolean>;
  completePasskeyAddition(input: EnrollmentDatabasePasskeyAddition): Promise<boolean>;
  completePasskeyLogin(input: EnrollmentDatabaseLoginCompletion): Promise<PasskeyLoginProfile>;
  completeRecoveryRegistration(
    input: EnrollmentDatabaseRecoveryCompletion,
  ): Promise<PasskeyLoginProfile>;
  completePasskeyRevocation(input: EnrollmentDatabasePasskeyRevocation): Promise<boolean>;
  completeProfileDeletion(input: EnrollmentDatabaseProfileDeletion): Promise<boolean>;
  completeRecoveryCodeReplacement(
    input: EnrollmentDatabaseRecoveryCodeReplacement,
  ): Promise<boolean>;
  createPasskeyAddChallenge(input: EnrollmentDatabasePasskeyAddChallenge): Promise<boolean>;
  createPasskeyChallenge(input: EnrollmentDatabasePasskeyChallenge): Promise<boolean>;
  createPasskeyRevokeChallenge(input: EnrollmentDatabasePasskeyRevokeChallenge): Promise<boolean>;
  createProfileDeletionChallenge(
    input: EnrollmentDatabaseProfileDeletionChallenge,
  ): Promise<boolean>;
  createAccountTargetChallenge(input: EnrollmentDatabaseAccountTargetChallenge): Promise<boolean>;
  createRecoveryCodeChallenge(input: EnrollmentDatabaseRecoveryCodeChallenge): Promise<boolean>;
  enrollProfile(input: EnrollmentDatabaseProfile): Promise<GithubProfileOpen>;
  pauseAgentAccount(input: EnrollmentDatabaseAgentAccountPause): Promise<boolean>;
  proposeCarRecipe(input: EnrollmentDatabaseCarRecipeProposal): Promise<boolean>;
  readAgentAccountDashboard(
    input: EnrollmentDatabaseProfileVisibilityRequest,
  ): Promise<AgentAccountDashboardInventory>;
  readCarRecipeState(input: EnrollmentDatabaseProfileVisibilityRequest): Promise<CarRecipeState>;
  readPasskeyInventory(
    input: EnrollmentDatabasePasskeyInventoryRequest,
  ): Promise<readonly PasskeyInventoryItem[]>;
  readPasskeyLoginMaterial(credentialId: Uint8Array): Promise<PasskeyLoginMaterial | undefined>;
  readPrivateDashboardRanking(
    input: EnrollmentDatabaseProfileVisibilityRequest,
  ): Promise<PrivateDashboardRanking>;
  readRecoveryCodeVerificationMaterial(
    recoveryCodeId: string,
  ): Promise<RecoveryCodeVerificationMaterial | undefined>;
  readProfileVisibility(
    input: EnrollmentDatabaseProfileVisibilityRequest,
  ): Promise<ProfileVisibility>;
  rejectCarRecipe(input: EnrollmentDatabaseCarRecipeDecision): Promise<boolean>;
  revokeSession(input: EnrollmentDatabaseSessionRevocation): Promise<boolean>;
  setProfileVisibility(
    input: EnrollmentDatabaseProfileVisibilityUpdate,
  ): Promise<ProfileVisibility>;
  setProviderBreakdownVisibility(
    input: EnrollmentDatabaseProviderBreakdownVisibilityUpdate,
  ): Promise<boolean>;
  startRecovery(input: EnrollmentDatabaseRecoveryStart): Promise<boolean>;
}

export type ProfileVisibility = "hidden" | "public";

export type AgentProviderCode =
  "aider" | "claude_code" | "cline" | "codex" | "opencode" | "qwen_code";

export type AgentAccountStatus =
  | "connected"
  | "needs_login"
  | "paused"
  | "quarantined"
  | "reader_outdated"
  | "removed"
  | "syncing"
  | "unsupported_agent_version";

export type AgentAccountQuarantineReason =
  | "account_state"
  | "accounting_revision_mismatch"
  | "anomaly_review"
  | "date_out_of_range"
  | "decrease"
  | "numeric_out_of_range"
  | "overlap_detected"
  | "season_closed";

export interface PrivateDashboardRanking {
  readonly participantCount: number | null;
  readonly providerBreakdownVisible: boolean;
  readonly publicVisibility: ProfileVisibility;
  readonly rankPosition: number | null;
  readonly seasonEnd: string;
  readonly seasonStart: string;
  readonly seasonState: "finalized" | "grace" | "open" | "pending";
  readonly snapshotGeneratedAt: string | null;
  readonly weeklyTokenTotal: string | null;
}

export interface AgentAccountDashboardDevice {
  readonly deviceId: string;
  readonly installationId: string;
  readonly state: "active" | "revoked";
}

export interface AgentAccountDashboardAccount {
  readonly accountingRevision: number;
  readonly agentAccountId: string;
  readonly devices: readonly AgentAccountDashboardDevice[];
  readonly expectedReaderVersion: string;
  readonly identityAssurance: "community_local" | "provider_verified";
  readonly lastSuccessfulSyncDate: string | null;
  readonly observedReaderVersion: string | null;
  readonly privateLabel: string;
  readonly provider: AgentProviderCode;
  readonly quarantineReason: AgentAccountQuarantineReason | null;
  readonly state: "active" | "paused" | "quarantined" | "unlinked";
  readonly status: AgentAccountStatus;
  readonly todayTokenTotal: string;
  readonly weeklyTokenTotal: string;
}

export interface AgentAccountDashboardInstallationAccount {
  readonly agentAccountId: string;
  readonly deviceId: string;
  readonly deviceState: "active" | "revoked";
  readonly privateLabel: string;
}

export interface AgentAccountDashboardInstallation {
  readonly accounts: readonly AgentAccountDashboardInstallationAccount[];
  readonly architecture: "aarch64" | "x86_64";
  readonly connectedDate: string;
  readonly connectorVersion: string;
  readonly installationId: string;
  readonly label: string;
  readonly lastSeenDate: string | null;
  readonly osFamily: "linux" | "macos" | "windows";
  readonly state: "active" | "revoked";
}

export interface AgentAccountDashboardInventory {
  readonly accounts: readonly AgentAccountDashboardAccount[];
  readonly installations: readonly AgentAccountDashboardInstallation[];
}

export interface CarRecipeProposalState {
  readonly expiresAt: string;
  readonly proposalId: string;
  readonly recipe: CarRecipeV1;
}

export interface CarRecipeState {
  readonly active: CarRecipeV1 | null;
  readonly proposal: CarRecipeProposalState | null;
}

export interface PasskeyLoginMaterial {
  readonly backupEligible: boolean;
  readonly backupState: boolean;
  readonly cosePublicKey: Buffer;
  readonly passkeyId: string;
  readonly signCount: number;
}

export interface PasskeyLoginProfile {
  readonly handle: string;
  readonly locale: "en" | "ru";
  readonly profileId: string;
}

export interface GithubProfileOpen {
  readonly created: boolean;
  readonly handle: string;
  readonly locale: "en" | "ru";
  readonly profileId: string;
  readonly profileState: "active" | "enrolling";
  readonly sessionCreated: boolean;
}

export interface RecoveryCodeVerificationMaterial {
  readonly recoveryCodeId: string;
  readonly verifierPhc: string;
}

export interface PasskeyInventoryItem {
  readonly createdOn: string;
  readonly currentAuthenticator: boolean;
  readonly label: string;
  readonly passkeyId: string;
  readonly state: "active" | "revoked";
}

export interface ConfiguredEnrollmentDatabase extends EnrollmentDatabase {
  close(): Promise<void>;
}

function fail(code: EnrollmentDatabaseErrorCode): never {
  throw new EnrollmentDatabaseError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactBooleanRow(value: unknown, key: string): boolean {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    fail("result_invalid");
  }
  const row = value[0];
  const keys = Object.keys(row);
  if (keys.length !== 1 || keys[0] !== key || typeof row[key] !== "boolean") {
    fail("result_invalid");
  }
  return row[key];
}

function exactGithubProfileOpen(value: unknown): GithubProfileOpen {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    fail("result_invalid");
  }
  const row = value[0];
  const expected = new Set([
    "created",
    "handle",
    "locale",
    "profile_id",
    "profile_state",
    "session_created",
  ]);
  const keys = Object.keys(row);
  if (
    keys.length !== expected.size ||
    keys.some((key) => !expected.has(key)) ||
    typeof row.created !== "boolean" ||
    typeof row.handle !== "string" ||
    !enrollmentPatterns.handle.test(row.handle) ||
    (row.locale !== "en" && row.locale !== "ru") ||
    typeof row.profile_id !== "string" ||
    !enrollmentPatterns.uuidV4.test(row.profile_id) ||
    (row.profile_state !== "active" && row.profile_state !== "enrolling") ||
    typeof row.session_created !== "boolean" ||
    (row.profile_state === "active" && (row.created || row.session_created)) ||
    (row.profile_state === "enrolling" && !row.session_created) ||
    (row.created && !row.handle.startsWith("pending_"))
  ) {
    fail("result_invalid");
  }
  return Object.freeze({
    created: row.created,
    handle: row.handle,
    locale: row.locale,
    profileId: row.profile_id,
    profileState: row.profile_state,
    sessionCreated: row.session_created,
  });
}

function exactProfileVisibility(value: unknown): ProfileVisibility {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    fail("result_invalid");
  }
  const row = value[0];
  const keys = Object.keys(row);
  if (
    keys.length !== 1 ||
    keys[0] !== "visibility" ||
    (row.visibility !== "hidden" && row.visibility !== "public")
  ) {
    fail("result_invalid");
  }
  return row.visibility;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  );
}

function decimalGreaterThan(left: string, right: string): boolean {
  return left.length > right.length || (left.length === right.length && left > right);
}

function dateAfter(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function validPrivateLabel(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const length = Array.from(value).length;
  return (
    length >= 1 &&
    length <= 64 &&
    value.length <= 128 &&
    value === value.trim() &&
    value === value.normalize("NFC") &&
    !unsafeLabelPattern.test(value)
  );
}

function exactPrivateDashboardRanking(value: unknown): PrivateDashboardRanking {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    fail("result_invalid");
  }
  const row = value[0];
  const keys = Object.keys(row);
  if (
    keys.length !== privateDashboardRankingColumns.size ||
    keys.some((key) => !privateDashboardRankingColumns.has(key)) ||
    !canonicalDate(row.season_start) ||
    new Date(`${row.season_start}T00:00:00.000Z`).getUTCDay() !== 1 ||
    !canonicalDate(row.season_end) ||
    row.season_end !== dateAfter(row.season_start, 6) ||
    (row.season_state !== "pending" &&
      row.season_state !== "open" &&
      row.season_state !== "grace" &&
      row.season_state !== "finalized") ||
    (row.public_visibility !== "hidden" && row.public_visibility !== "public") ||
    typeof row.provider_breakdown_visible !== "boolean"
  ) {
    fail("result_invalid");
  }
  if (row.season_state === "pending") {
    if (
      row.weekly_token_total !== null ||
      row.rank_position !== null ||
      row.participant_count !== null ||
      row.snapshot_generated_at !== null
    ) {
      fail("result_invalid");
    }
    return Object.freeze({
      participantCount: null,
      providerBreakdownVisible: row.provider_breakdown_visible,
      publicVisibility: row.public_visibility,
      rankPosition: null,
      seasonEnd: row.season_end,
      seasonStart: row.season_start,
      seasonState: row.season_state,
      snapshotGeneratedAt: null,
      weeklyTokenTotal: null,
    });
  }
  if (
    typeof row.weekly_token_total !== "string" ||
    !exactTokenTotalPattern.test(row.weekly_token_total) ||
    !boundedInteger(row.participant_count, 0, 1_000_000) ||
    typeof row.snapshot_generated_at !== "string" ||
    !canonicalMinutePattern.test(row.snapshot_generated_at) ||
    (row.rank_position !== null &&
      (typeof row.rank_position !== "string" ||
        !/^[1-9][0-9]{0,6}$/.test(row.rank_position) ||
        Number(row.rank_position) > row.participant_count))
  ) {
    fail("result_invalid");
  }
  const rankPosition = row.rank_position === null ? null : Number(row.rank_position);
  return Object.freeze({
    participantCount: row.participant_count,
    providerBreakdownVisible: row.provider_breakdown_visible,
    publicVisibility: row.public_visibility,
    rankPosition,
    seasonEnd: row.season_end,
    seasonStart: row.season_start,
    seasonState: row.season_state,
    snapshotGeneratedAt: row.snapshot_generated_at,
    weeklyTokenTotal: row.weekly_token_total,
  });
}

function agentProvider(value: unknown): AgentProviderCode | undefined {
  return value === "aider" ||
    value === "claude_code" ||
    value === "cline" ||
    value === "codex" ||
    value === "opencode" ||
    value === "qwen_code"
    ? value
    : undefined;
}

function accountStatus(value: unknown): AgentAccountStatus | undefined {
  return value === "connected" ||
    value === "needs_login" ||
    value === "paused" ||
    value === "quarantined" ||
    value === "reader_outdated" ||
    value === "removed" ||
    value === "syncing" ||
    value === "unsupported_agent_version"
    ? value
    : undefined;
}

function quarantineReason(value: unknown): AgentAccountQuarantineReason | null | undefined {
  return value === null ||
    value === "account_state" ||
    value === "accounting_revision_mismatch" ||
    value === "anomaly_review" ||
    value === "date_out_of_range" ||
    value === "decrease" ||
    value === "numeric_out_of_range" ||
    value === "overlap_detected" ||
    value === "season_closed"
    ? value
    : undefined;
}

function exactAgentAccountDashboard(value: unknown): AgentAccountDashboardInventory {
  if (!Array.isArray(value) || value.length > 128) {
    fail("result_invalid");
  }
  type MutableAccount = Omit<AgentAccountDashboardAccount, "devices"> & {
    devices: AgentAccountDashboardDevice[];
  };
  type MutableInstallation = Omit<AgentAccountDashboardInstallation, "accounts"> & {
    accounts: AgentAccountDashboardInstallationAccount[];
  };
  const accountMap = new Map<string, MutableAccount>();
  const installationMap = new Map<string, MutableInstallation>();
  const deviceIds = new Set<string>();
  let previousSortKey: string | undefined;
  for (const candidate of value as unknown[]) {
    if (!isRecord(candidate)) {
      fail("result_invalid");
    }
    const row = candidate;
    const keys = Object.keys(row);
    const provider = agentProvider(row.provider_code);
    const status = accountStatus(row.status_code);
    const reason = quarantineReason(row.quarantine_reason);
    if (
      keys.length !== agentAccountDashboardColumns.size ||
      keys.some((key) => !agentAccountDashboardColumns.has(key)) ||
      typeof row.agent_account_id !== "string" ||
      !agentAccountIdPattern.test(row.agent_account_id) ||
      provider === undefined ||
      !validPrivateLabel(row.private_label) ||
      (row.identity_assurance !== "community_local" &&
        row.identity_assurance !== "provider_verified") ||
      !boundedInteger(row.accounting_revision, 1, 2_147_483_647) ||
      typeof row.expected_reader_version !== "string" ||
      !readerVersionPattern.test(row.expected_reader_version) ||
      (row.observed_reader_version !== null &&
        (typeof row.observed_reader_version !== "string" ||
          !readerVersionPattern.test(row.observed_reader_version))) ||
      (row.account_state !== "active" &&
        row.account_state !== "paused" &&
        row.account_state !== "quarantined" &&
        row.account_state !== "unlinked") ||
      status === undefined ||
      reason === undefined ||
      typeof row.weekly_token_total !== "string" ||
      !exactTokenTotalPattern.test(row.weekly_token_total) ||
      typeof row.today_token_total !== "string" ||
      !exactTokenTotalPattern.test(row.today_token_total) ||
      decimalGreaterThan(row.today_token_total, row.weekly_token_total) ||
      (row.last_successful_sync_date !== null && !canonicalDate(row.last_successful_sync_date)) ||
      (row.account_state === "unlinked" && status !== "removed") ||
      (row.account_state === "paused" && status !== "paused") ||
      (row.account_state === "quarantined" && (status !== "quarantined" || reason === null)) ||
      (row.account_state !== "quarantined" && reason !== null) ||
      (row.account_state === "active" &&
        status !== "connected" &&
        status !== "needs_login" &&
        status !== "reader_outdated" &&
        status !== "syncing" &&
        status !== "unsupported_agent_version")
    ) {
      fail("result_invalid");
    }
    const installationMissing = row.installation_id === null;
    if (
      installationMissing !==
        [
          row.installation_label,
          row.connector_version,
          row.os_family,
          row.architecture,
          row.installation_state,
          row.connected_date,
          row.last_seen_date,
          row.device_id,
          row.device_state,
        ].every((entry) => entry === null) ||
      (!installationMissing &&
        (typeof row.installation_id !== "string" ||
          !installationIdPattern.test(row.installation_id) ||
          !validPrivateLabel(row.installation_label) ||
          typeof row.connector_version !== "string" ||
          !connectorVersionPattern.test(row.connector_version) ||
          (row.os_family !== "linux" && row.os_family !== "macos" && row.os_family !== "windows") ||
          (row.architecture !== "aarch64" && row.architecture !== "x86_64") ||
          (row.installation_state !== "active" && row.installation_state !== "revoked") ||
          !canonicalDate(row.connected_date) ||
          (row.last_seen_date !== null &&
            (!canonicalDate(row.last_seen_date) || row.last_seen_date < row.connected_date)) ||
          typeof row.device_id !== "string" ||
          !deviceIdPattern.test(row.device_id) ||
          (row.device_state !== "active" && row.device_state !== "revoked")))
    ) {
      fail("result_invalid");
    }
    const installationId = typeof row.installation_id === "string" ? row.installation_id : "";
    const deviceId = typeof row.device_id === "string" ? row.device_id : "";
    const sortKey = `${provider}\n${row.agent_account_id}\n${installationId}\n${deviceId}`;
    if (previousSortKey !== undefined && sortKey <= previousSortKey) {
      fail("result_invalid");
    }
    previousSortKey = sortKey;

    const existingAccount = accountMap.get(row.agent_account_id);
    if (existingAccount === undefined) {
      accountMap.set(row.agent_account_id, {
        accountingRevision: row.accounting_revision,
        agentAccountId: row.agent_account_id,
        devices: [],
        expectedReaderVersion: row.expected_reader_version,
        identityAssurance: row.identity_assurance,
        lastSuccessfulSyncDate: row.last_successful_sync_date,
        observedReaderVersion: row.observed_reader_version,
        privateLabel: row.private_label,
        provider,
        quarantineReason: reason,
        state: row.account_state,
        status,
        todayTokenTotal: row.today_token_total,
        weeklyTokenTotal: row.weekly_token_total,
      });
    } else if (
      existingAccount.accountingRevision !== row.accounting_revision ||
      existingAccount.expectedReaderVersion !== row.expected_reader_version ||
      existingAccount.identityAssurance !== row.identity_assurance ||
      existingAccount.lastSuccessfulSyncDate !== row.last_successful_sync_date ||
      existingAccount.observedReaderVersion !== row.observed_reader_version ||
      existingAccount.privateLabel !== row.private_label ||
      existingAccount.provider !== provider ||
      existingAccount.quarantineReason !== reason ||
      existingAccount.state !== row.account_state ||
      existingAccount.status !== status ||
      existingAccount.todayTokenTotal !== row.today_token_total ||
      existingAccount.weeklyTokenTotal !== row.weekly_token_total
    ) {
      fail("result_invalid");
    }
    if (!installationMissing) {
      const installationId = row.installation_id as string;
      const deviceId = row.device_id as string;
      const deviceState = row.device_state as "active" | "revoked";
      if (deviceIds.has(deviceId)) {
        fail("result_invalid");
      }
      deviceIds.add(deviceId);
      accountMap
        .get(row.agent_account_id)
        ?.devices.push(Object.freeze({ deviceId, installationId, state: deviceState }));
      const existingInstallation = installationMap.get(installationId);
      if (existingInstallation === undefined) {
        installationMap.set(installationId, {
          accounts: [],
          architecture: row.architecture as "aarch64" | "x86_64",
          connectedDate: row.connected_date as string,
          connectorVersion: row.connector_version as string,
          installationId,
          label: row.installation_label as string,
          lastSeenDate: row.last_seen_date as string | null,
          osFamily: row.os_family as "linux" | "macos" | "windows",
          state: row.installation_state as "active" | "revoked",
        });
      } else if (
        existingInstallation.architecture !== row.architecture ||
        existingInstallation.connectedDate !== row.connected_date ||
        existingInstallation.connectorVersion !== row.connector_version ||
        existingInstallation.label !== row.installation_label ||
        existingInstallation.lastSeenDate !== row.last_seen_date ||
        existingInstallation.osFamily !== row.os_family ||
        existingInstallation.state !== row.installation_state
      ) {
        fail("result_invalid");
      }
      installationMap.get(installationId)?.accounts.push(
        Object.freeze({
          agentAccountId: row.agent_account_id,
          deviceId,
          deviceState,
          privateLabel: row.private_label,
        }),
      );
    }
  }
  if (accountMap.size > 32 || installationMap.size > 32 || deviceIds.size > 64) {
    fail("result_invalid");
  }
  for (const account of accountMap.values()) {
    const hasActiveDevice = account.devices.some(
      (device) =>
        device.state === "active" && installationMap.get(device.installationId)?.state === "active",
    );
    if (
      (account.status === "connected" &&
        (!hasActiveDevice ||
          account.observedReaderVersion === null ||
          account.observedReaderVersion !== account.expectedReaderVersion)) ||
      (account.status === "needs_login" && hasActiveDevice) ||
      (account.status === "syncing" &&
        (!hasActiveDevice || account.observedReaderVersion !== null)) ||
      (account.status === "reader_outdated" &&
        (!hasActiveDevice ||
          account.observedReaderVersion === null ||
          account.observedReaderVersion === account.expectedReaderVersion))
    ) {
      fail("result_invalid");
    }
  }
  const accounts = [...accountMap.values()].map((account) =>
    Object.freeze({
      ...account,
      devices: Object.freeze(account.devices),
    }),
  );
  const installations = [...installationMap.values()].map((installation) =>
    Object.freeze({
      ...installation,
      accounts: Object.freeze(installation.accounts),
    }),
  );
  return Object.freeze({
    accounts: Object.freeze(accounts),
    installations: Object.freeze(installations),
  });
}

function exactCarRecipeFromRow(
  row: Readonly<Record<string, unknown>>,
  prefix: "active" | "proposal",
): CarRecipeV1 | null {
  const fields = [
    "schema_version",
    "chassis",
    "nose",
    "cockpit",
    "wing",
    "wheels",
    "palette",
    "trail",
    "seed",
  ] as const;
  const values = fields.map((field) => row[`${prefix}_${field}`]);
  if (values.every((value) => value === null)) {
    return null;
  }
  if (values.some((value) => value === null)) {
    fail("result_invalid");
  }
  const candidate = {
    schemaVersion: row[`${prefix}_schema_version`],
    chassis: row[`${prefix}_chassis`],
    nose: row[`${prefix}_nose`],
    cockpit: row[`${prefix}_cockpit`],
    wing: row[`${prefix}_wing`],
    wheels: row[`${prefix}_wheels`],
    palette: row[`${prefix}_palette`],
    trail: row[`${prefix}_trail`],
    seed: row[`${prefix}_seed`],
  };
  const result = validateCarRecipeV1(candidate);
  if (!result.ok) {
    fail("result_invalid");
  }
  return Object.freeze({ ...result.value });
}

function exactCarRecipeState(value: unknown): CarRecipeState {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    fail("result_invalid");
  }
  const row = value[0];
  const keys = Object.keys(row);
  if (
    keys.length !== carRecipeStateColumns.size ||
    keys.some((key) => !carRecipeStateColumns.has(key))
  ) {
    fail("result_invalid");
  }
  const active = exactCarRecipeFromRow(row, "active");
  const proposalRecipe = exactCarRecipeFromRow(row, "proposal");
  let proposal: CarRecipeProposalState | null = null;
  if (proposalRecipe === null) {
    if (row.proposal_id !== null || row.proposal_expires_at !== null) {
      fail("result_invalid");
    }
  } else {
    const expiresAt = typeof row.proposal_expires_at === "string" ? row.proposal_expires_at : "";
    const expires = new Date(expiresAt);
    if (
      typeof row.proposal_id !== "string" ||
      !enrollmentPatterns.uuidV4.test(row.proposal_id) ||
      !canonicalTimestampPattern.test(expiresAt) ||
      !Number.isFinite(expires.valueOf()) ||
      expires.toISOString() !== expiresAt
    ) {
      fail("result_invalid");
    }
    proposal = Object.freeze({
      expiresAt,
      proposalId: row.proposal_id,
      recipe: proposalRecipe,
    });
  }
  return Object.freeze({ active, proposal });
}

function copyBoundedBytes(value: unknown, minimum: number, maximum: number): Buffer | undefined {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    return undefined;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (
    (prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) ||
    value.byteLength < minimum ||
    value.byteLength > maximum
  ) {
    return undefined;
  }
  return Buffer.from(value);
}

function exactLoginMaterial(value: unknown): PasskeyLoginMaterial | undefined {
  let publicKey: Buffer | undefined;
  try {
    if (!Array.isArray(value) || value.length > 1) {
      fail("result_invalid");
    }
    if (value.length === 0) {
      return undefined;
    }
    const row: unknown = value[0];
    if (!isRecord(row)) {
      fail("result_invalid");
    }
    const keys = Object.keys(row);
    publicKey = copyBoundedBytes(row.cose_public_key, 32, 4096);
    if (
      keys.length !== loginMaterialColumns.size ||
      keys.some((key) => !loginMaterialColumns.has(key)) ||
      typeof row.passkey_id !== "string" ||
      !enrollmentPatterns.uuidV4.test(row.passkey_id) ||
      typeof row.sign_count !== "string" ||
      !/^(?:0|[1-9]\d{0,15})$/.test(row.sign_count) ||
      !Number.isSafeInteger(Number(row.sign_count)) ||
      typeof row.backup_eligible !== "boolean" ||
      typeof row.backup_state !== "boolean" ||
      (row.backup_state && !row.backup_eligible) ||
      publicKey === undefined
    ) {
      fail("result_invalid");
    }
    return Object.freeze({
      backupEligible: row.backup_eligible,
      backupState: row.backup_state,
      cosePublicKey: publicKey,
      passkeyId: row.passkey_id,
      signCount: Number(row.sign_count),
    });
  } catch (error) {
    publicKey?.fill(0);
    if (error instanceof EnrollmentDatabaseError) {
      throw error;
    }
    fail("result_invalid");
  }
}

function exactLoginProfile(value: unknown): PasskeyLoginProfile {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    fail("result_invalid");
  }
  const row = value[0];
  const keys = Object.keys(row);
  if (
    keys.length !== loginProfileColumns.size ||
    keys.some((key) => !loginProfileColumns.has(key)) ||
    typeof row.profile_id !== "string" ||
    !enrollmentPatterns.uuidV4.test(row.profile_id) ||
    typeof row.handle !== "string" ||
    !enrollmentPatterns.handle.test(row.handle) ||
    (row.locale !== "en" && row.locale !== "ru")
  ) {
    fail("result_invalid");
  }
  return Object.freeze({ handle: row.handle, locale: row.locale, profileId: row.profile_id });
}

function exactRecoveryMaterial(
  value: unknown,
  expectedRecoveryCodeId: string,
): RecoveryCodeVerificationMaterial | undefined {
  if (!Array.isArray(value) || value.length > 1) {
    fail("result_invalid");
  }
  if (value.length === 0) {
    return undefined;
  }
  const row: unknown = value[0];
  if (!isRecord(row)) {
    fail("result_invalid");
  }
  const keys = Object.keys(row);
  if (
    keys.length !== recoveryMaterialColumns.size ||
    keys.some((key) => !recoveryMaterialColumns.has(key)) ||
    row.recovery_code_id !== expectedRecoveryCodeId ||
    typeof row.verifier_phc !== "string" ||
    !recoveryPhcPattern.test(row.verifier_phc) ||
    row.verifier_phc.length > 255
  ) {
    fail("result_invalid");
  }
  return Object.freeze({
    recoveryCodeId: expectedRecoveryCodeId,
    verifierPhc: row.verifier_phc,
  });
}

function canonicalDate(value: unknown): value is string {
  if (typeof value !== "string" || !canonicalDatePattern.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function exactPasskeyInventory(value: unknown): readonly PasskeyInventoryItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    fail("result_invalid");
  }
  const passkeyIds = new Set<string>();
  let currentCount = 0;
  let previousSortKey: string | undefined;
  const result = value.map((row: unknown) => {
    if (!isRecord(row)) {
      fail("result_invalid");
    }
    const keys = Object.keys(row);
    const labelLength = typeof row.label === "string" ? Array.from(row.label).length : 0;
    if (
      keys.length !== passkeyInventoryColumns.size ||
      keys.some((key) => !passkeyInventoryColumns.has(key)) ||
      typeof row.passkey_id !== "string" ||
      !enrollmentPatterns.uuidV4.test(row.passkey_id) ||
      passkeyIds.has(row.passkey_id) ||
      typeof row.label !== "string" ||
      labelLength < 1 ||
      labelLength > 64 ||
      row.label !== row.label.trim() ||
      row.label !== row.label.normalize("NFC") ||
      unsafeLabelPattern.test(row.label) ||
      (row.state !== "active" && row.state !== "revoked") ||
      !canonicalDate(row.created_on) ||
      typeof row.current_authenticator !== "boolean" ||
      (row.current_authenticator && row.state !== "active")
    ) {
      fail("result_invalid");
    }
    const sortKey = `${row.created_on}\n${row.passkey_id}`;
    if (previousSortKey !== undefined && sortKey <= previousSortKey) {
      fail("result_invalid");
    }
    passkeyIds.add(row.passkey_id);
    previousSortKey = sortKey;
    if (row.current_authenticator) {
      currentCount += 1;
    }
    return Object.freeze({
      createdOn: row.created_on,
      currentAuthenticator: row.current_authenticator,
      label: row.label,
      passkeyId: row.passkey_id,
      state: row.state,
    });
  });
  if (currentCount !== 1) {
    fail("result_invalid");
  }
  return Object.freeze(result);
}

function verifyRuntimeBoundary(value: unknown): void {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    fail("runtime_boundary_mismatch");
  }
  const row = value[0];
  const keys = Object.keys(row);
  if (
    keys.length !== runtimeColumns.size ||
    keys.some((key) => !runtimeColumns.has(key)) ||
    keys.some((key) => row[key] !== true)
  ) {
    fail("runtime_boundary_mismatch");
  }
}

function releaseClient(client: EnrollmentDatabaseClient, destroy: boolean): void {
  try {
    client.release(destroy);
  } catch {
    fail("connection_release_failed");
  }
}

export function createEnrollmentDatabase(pool: EnrollmentDatabasePool): EnrollmentDatabase {
  async function execute<Result>(
    operation: (client: EnrollmentDatabaseClient) => Promise<unknown>,
    readResult: (value: unknown) => Result,
  ): Promise<Result> {
    let client: EnrollmentDatabaseClient;
    try {
      client = await pool.connect();
    } catch {
      fail("connection_unavailable");
    }
    let destroy = false;
    try {
      verifyRuntimeBoundary(await client.verifyRuntimeBoundary());
      return readResult(await operation(client));
    } catch (error) {
      destroy = true;
      if (error instanceof EnrollmentDatabaseError) {
        throw error;
      }
      fail("query_failed");
    } finally {
      releaseClient(client, destroy);
    }
  }

  return Object.freeze({
    approveCarRecipe(input: EnrollmentDatabaseCarRecipeDecision): Promise<boolean> {
      return execute(
        (client) => client.approveCarRecipe(input),
        (value) => exactBooleanRow(value, "approved"),
      );
    },
    completeAgentAccountReactivation(
      input: EnrollmentDatabaseAccountTargetCompletion,
    ): Promise<boolean> {
      return execute(
        (client) => client.completeAgentAccountReactivation(input),
        (value) => exactBooleanRow(value, "completed"),
      );
    },
    completeAgentAccountUnlink(input: EnrollmentDatabaseAccountTargetCompletion): Promise<boolean> {
      return execute(
        (client) => client.completeAgentAccountUnlink(input),
        (value) => exactBooleanRow(value, "completed"),
      );
    },
    completeDeviceKeyRevocation(
      input: EnrollmentDatabaseAccountTargetCompletion,
    ): Promise<boolean> {
      return execute(
        (client) => client.completeDeviceKeyRevocation(input),
        (value) => exactBooleanRow(value, "completed"),
      );
    },
    completeInstallationRevocation(
      input: EnrollmentDatabaseAccountTargetCompletion,
    ): Promise<boolean> {
      return execute(
        (client) => client.completeInstallationRevocation(input),
        (value) => exactBooleanRow(value, "completed"),
      );
    },
    completeInitialPasskey(input: EnrollmentDatabaseInitialPasskey): Promise<boolean> {
      return execute(
        (client) => client.completeInitialPasskey(input),
        (value) => exactBooleanRow(value, "registered"),
      );
    },
    completePasskeyAddition(input: EnrollmentDatabasePasskeyAddition): Promise<boolean> {
      return execute(
        (client) => client.completePasskeyAddition(input),
        (value) => exactBooleanRow(value, "added"),
      );
    },
    completePasskeyLogin(input: EnrollmentDatabaseLoginCompletion): Promise<PasskeyLoginProfile> {
      return execute((client) => client.completePasskeyLogin(input), exactLoginProfile);
    },
    completeRecoveryRegistration(
      input: EnrollmentDatabaseRecoveryCompletion,
    ): Promise<PasskeyLoginProfile> {
      return execute((client) => client.completeRecoveryRegistration(input), exactLoginProfile);
    },
    completePasskeyRevocation(input: EnrollmentDatabasePasskeyRevocation): Promise<boolean> {
      return execute(
        (client) => client.completePasskeyRevocation(input),
        (value) => exactBooleanRow(value, "revoked"),
      );
    },
    completeProfileDeletion(input: EnrollmentDatabaseProfileDeletion): Promise<boolean> {
      return execute(
        (client) => client.completeProfileDeletion(input),
        (value) => exactBooleanRow(value, "deleted"),
      );
    },
    completeRecoveryCodeReplacement(
      input: EnrollmentDatabaseRecoveryCodeReplacement,
    ): Promise<boolean> {
      return execute(
        (client) => client.completeRecoveryCodeReplacement(input),
        (value) => exactBooleanRow(value, "replaced"),
      );
    },
    createPasskeyAddChallenge(input: EnrollmentDatabasePasskeyAddChallenge): Promise<boolean> {
      return execute(
        (client) => client.createPasskeyAddChallenge(input),
        (value) => exactBooleanRow(value, "created"),
      );
    },
    createPasskeyChallenge(input: EnrollmentDatabasePasskeyChallenge): Promise<boolean> {
      return execute(
        (client) => client.createPasskeyChallenge(input),
        (value) => exactBooleanRow(value, "created"),
      );
    },
    createPasskeyRevokeChallenge(
      input: EnrollmentDatabasePasskeyRevokeChallenge,
    ): Promise<boolean> {
      return execute(
        (client) => client.createPasskeyRevokeChallenge(input),
        (value) => exactBooleanRow(value, "created"),
      );
    },
    createProfileDeletionChallenge(
      input: EnrollmentDatabaseProfileDeletionChallenge,
    ): Promise<boolean> {
      return execute(
        (client) => client.createProfileDeletionChallenge(input),
        (value) => exactBooleanRow(value, "created"),
      );
    },
    createAccountTargetChallenge(
      input: EnrollmentDatabaseAccountTargetChallenge,
    ): Promise<boolean> {
      return execute(
        (client) => client.createAccountTargetChallenge(input),
        (value) => exactBooleanRow(value, "created"),
      );
    },
    createRecoveryCodeChallenge(input: EnrollmentDatabaseRecoveryCodeChallenge): Promise<boolean> {
      return execute(
        (client) => client.createRecoveryCodeChallenge(input),
        (value) => exactBooleanRow(value, "created"),
      );
    },
    enrollProfile(input: EnrollmentDatabaseProfile): Promise<GithubProfileOpen> {
      return execute((client) => client.enrollProfile(input), exactGithubProfileOpen);
    },
    pauseAgentAccount(input: EnrollmentDatabaseAgentAccountPause): Promise<boolean> {
      return execute(
        (client) => client.pauseAgentAccount(input),
        (value) => exactBooleanRow(value, "paused"),
      );
    },
    proposeCarRecipe(input: EnrollmentDatabaseCarRecipeProposal): Promise<boolean> {
      return execute(
        (client) => client.proposeCarRecipe(input),
        (value) => exactBooleanRow(value, "proposed"),
      );
    },
    readAgentAccountDashboard(
      input: EnrollmentDatabaseProfileVisibilityRequest,
    ): Promise<AgentAccountDashboardInventory> {
      return execute(
        (client) => client.readAgentAccountDashboard(input),
        exactAgentAccountDashboard,
      );
    },
    readCarRecipeState(input: EnrollmentDatabaseProfileVisibilityRequest): Promise<CarRecipeState> {
      return execute((client) => client.readCarRecipeState(input), exactCarRecipeState);
    },
    readPasskeyInventory(
      input: EnrollmentDatabasePasskeyInventoryRequest,
    ): Promise<readonly PasskeyInventoryItem[]> {
      return execute((client) => client.readPasskeyInventory(input), exactPasskeyInventory);
    },
    readPrivateDashboardRanking(
      input: EnrollmentDatabaseProfileVisibilityRequest,
    ): Promise<PrivateDashboardRanking> {
      return execute(
        (client) => client.readPrivateDashboardRanking(input),
        exactPrivateDashboardRanking,
      );
    },
    readPasskeyLoginMaterial(credentialId: Uint8Array): Promise<PasskeyLoginMaterial | undefined> {
      return execute((client) => client.readPasskeyLoginMaterial(credentialId), exactLoginMaterial);
    },
    readRecoveryCodeVerificationMaterial(
      recoveryCodeId: string,
    ): Promise<RecoveryCodeVerificationMaterial | undefined> {
      return execute(
        (client) => client.readRecoveryCodeVerificationMaterial(recoveryCodeId),
        (value) => exactRecoveryMaterial(value, recoveryCodeId),
      );
    },
    readProfileVisibility(
      input: EnrollmentDatabaseProfileVisibilityRequest,
    ): Promise<ProfileVisibility> {
      return execute((client) => client.readProfileVisibility(input), exactProfileVisibility);
    },
    rejectCarRecipe(input: EnrollmentDatabaseCarRecipeDecision): Promise<boolean> {
      return execute(
        (client) => client.rejectCarRecipe(input),
        (value) => exactBooleanRow(value, "rejected"),
      );
    },
    revokeSession(input: EnrollmentDatabaseSessionRevocation): Promise<boolean> {
      return execute(
        (client) => client.revokeEnrollmentSession(input),
        (value) => exactBooleanRow(value, "revoked"),
      );
    },
    setProfileVisibility(
      input: EnrollmentDatabaseProfileVisibilityUpdate,
    ): Promise<ProfileVisibility> {
      return execute(
        (client) => client.setProfileVisibility(input),
        (value) => {
          const visibility = exactProfileVisibility(value);
          if ((visibility === "public") !== input.publiclyVisible) {
            fail("result_invalid");
          }
          return visibility;
        },
      );
    },
    setProviderBreakdownVisibility(
      input: EnrollmentDatabaseProviderBreakdownVisibilityUpdate,
    ): Promise<boolean> {
      return execute(
        (client) => client.setProviderBreakdownVisibility(input),
        (value) => {
          const visible = exactBooleanRow(value, "provider_breakdown_visible");
          if (visible !== input.providerBreakdownVisible) {
            fail("result_invalid");
          }
          return visible;
        },
      );
    },
    startRecovery(input: EnrollmentDatabaseRecoveryStart): Promise<boolean> {
      return execute(
        (client) => client.startRecovery(input),
        (value) => exactBooleanRow(value, "started"),
      );
    },
  });
}

export function createConfiguredEnrollmentDatabase(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  signalSink?: PairingDatabasePoolSignalSink,
): ConfiguredEnrollmentDatabase {
  const pool = createPairingDatabasePool(resolvePairingDatabaseConfig(environment), signalSink);
  const database = createEnrollmentDatabase(pool);
  return Object.freeze({
    ...database,
    async close(): Promise<void> {
      try {
        await pool.close();
      } catch {
        fail("pool_close_failed");
      }
    },
  });
}
