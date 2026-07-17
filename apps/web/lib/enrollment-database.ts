import "server-only";

import { Buffer } from "node:buffer";

import { validateCarRecipeV1, type CarRecipeV1 } from "@viberacing/contracts";

import { resolvePairingDatabaseConfig } from "./pairing-database-config";
import {
  createPairingDatabasePool,
  type EnrollmentDatabaseAccountOverviewRequest,
  type EnrollmentDatabaseCarRecipeDecision,
  type EnrollmentDatabaseCarRecipeProposal,
  type EnrollmentDatabaseClient,
  type EnrollmentDatabaseDeviceRevocation,
  type EnrollmentDatabaseInitialPasskey,
  type EnrollmentDatabaseLoginCompletion,
  type EnrollmentDatabasePasskeyAddition,
  type EnrollmentDatabasePasskeyAddChallenge,
  type EnrollmentDatabasePasskeyChallenge,
  type EnrollmentDatabasePasskeyInventoryRequest,
  type EnrollmentDatabasePairingApproval,
  type EnrollmentDatabasePairingApprovalChallenge,
  type EnrollmentDatabasePairingApprovalRead,
  type EnrollmentDatabasePasskeyRevocation,
  type EnrollmentDatabasePasskeyRevokeChallenge,
  type EnrollmentDatabasePool,
  type EnrollmentDatabaseProfile,
  type EnrollmentDatabaseProfileDeletion,
  type EnrollmentDatabaseProfileDeletionChallenge,
  type EnrollmentDatabaseProfileVisibilityRequest,
  type EnrollmentDatabaseProfileVisibilityUpdate,
  type EnrollmentDatabaseRecoveryCodeChallenge,
  type EnrollmentDatabaseRecoveryCodeReplacement,
  type EnrollmentDatabaseRecoveryCompletion,
  type EnrollmentDatabaseRecoveryStart,
  type EnrollmentDatabaseSessionRevocation,
  type EnrollmentDatabaseSourcePause,
  type EnrollmentDatabaseSourceReactivation,
  type EnrollmentDatabaseSourceReactivationChallenge,
  type EnrollmentDatabaseSourceUnlink,
  type EnrollmentDatabaseSourceUnlinkChallenge,
  type EnrollmentDatabaseSourceDeviceInventoryRequest,
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
const pairingApprovalColumns = new Set([
  "architecture",
  "candidate_index",
  "connector_version",
  "device_label",
  "expires_at",
  "os_family",
  "pairing_id",
  "public_key",
]);
const passkeyInventoryColumns = new Set([
  "created_on",
  "current_authenticator",
  "label",
  "passkey_id",
  "state",
]);
const activeDeviceInventoryColumns = new Set([
  "activated_on",
  "architecture",
  "connector_version",
  "device_id",
  "device_label",
  "device_state",
  "os_family",
  "source_id",
  "source_state",
]);
const accountOverviewColumns = new Set([
  "active_days",
  "daily_score",
  "score_date",
  "season_end",
  "season_finalized",
  "season_start",
  "source_count",
  "visibility",
  "weekly_score",
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
const accountScoreColumns = [
  "active_days",
  "daily_score",
  "score_date",
  "season_end",
  "season_finalized",
  "season_start",
  "source_count",
  "weekly_score",
] as const;
const canonicalDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const canonicalTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const sourceIdPattern = /^src_[A-Za-z0-9_-]{22}$/;
const deviceIdPattern = /^dev_[A-Za-z0-9_-]{22}$/;
const connectorVersionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
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
  completePairingApproval(input: EnrollmentDatabasePairingApproval): Promise<boolean>;
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
  completeSourceReactivation(input: EnrollmentDatabaseSourceReactivation): Promise<boolean>;
  completeSourceUnlink(input: EnrollmentDatabaseSourceUnlink): Promise<boolean>;
  createPasskeyAddChallenge(input: EnrollmentDatabasePasskeyAddChallenge): Promise<boolean>;
  createPairingApprovalChallenge(
    input: EnrollmentDatabasePairingApprovalChallenge,
  ): Promise<boolean>;
  createPasskeyChallenge(input: EnrollmentDatabasePasskeyChallenge): Promise<boolean>;
  createPasskeyRevokeChallenge(input: EnrollmentDatabasePasskeyRevokeChallenge): Promise<boolean>;
  createProfileDeletionChallenge(
    input: EnrollmentDatabaseProfileDeletionChallenge,
  ): Promise<boolean>;
  createRecoveryCodeChallenge(input: EnrollmentDatabaseRecoveryCodeChallenge): Promise<boolean>;
  createSourceReactivationChallenge(
    input: EnrollmentDatabaseSourceReactivationChallenge,
  ): Promise<boolean>;
  createSourceUnlinkChallenge(input: EnrollmentDatabaseSourceUnlinkChallenge): Promise<boolean>;
  enrollProfile(input: EnrollmentDatabaseProfile): Promise<boolean>;
  pauseSource(input: EnrollmentDatabaseSourcePause): Promise<boolean>;
  proposeCarRecipe(input: EnrollmentDatabaseCarRecipeProposal): Promise<boolean>;
  readAccountOverview(input: EnrollmentDatabaseAccountOverviewRequest): Promise<AccountOverview>;
  readCarRecipeState(input: EnrollmentDatabaseProfileVisibilityRequest): Promise<CarRecipeState>;
  readActiveDeviceInventory(
    input: EnrollmentDatabaseSourceDeviceInventoryRequest,
  ): Promise<readonly SourceDeviceInventoryItem[]>;
  readPasskeyInventory(
    input: EnrollmentDatabasePasskeyInventoryRequest,
  ): Promise<readonly PasskeyInventoryItem[]>;
  readPasskeyLoginMaterial(credentialId: Uint8Array): Promise<PasskeyLoginMaterial | undefined>;
  readPairingApproval(
    input: EnrollmentDatabasePairingApprovalRead,
  ): Promise<PairingApprovalMaterial | undefined>;
  readRecoveryCodeVerificationMaterial(
    recoveryCodeId: string,
  ): Promise<RecoveryCodeVerificationMaterial | undefined>;
  readProfileVisibility(
    input: EnrollmentDatabaseProfileVisibilityRequest,
  ): Promise<ProfileVisibility>;
  revokeDevice(input: EnrollmentDatabaseDeviceRevocation): Promise<boolean>;
  rejectCarRecipe(input: EnrollmentDatabaseCarRecipeDecision): Promise<boolean>;
  revokeSession(input: EnrollmentDatabaseSessionRevocation): Promise<boolean>;
  setProfileVisibility(
    input: EnrollmentDatabaseProfileVisibilityUpdate,
  ): Promise<ProfileVisibility>;
  startRecovery(input: EnrollmentDatabaseRecoveryStart): Promise<boolean>;
}

export type ProfileVisibility = "hidden" | "public";

export interface AccountScore {
  readonly activeDays: number;
  readonly dailyScores: readonly number[];
  readonly seasonEnd: string;
  readonly seasonFinalized: boolean;
  readonly seasonStart: string;
  readonly sourceCount: number;
  readonly weeklyScore: number;
}

export interface AccountOverview {
  readonly score: AccountScore | null;
  readonly visibility: ProfileVisibility;
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

export interface PairingApprovalMaterial {
  readonly architecture: "aarch64" | "x86_64";
  readonly candidateIndex: 1 | 2;
  readonly connectorVersion: string;
  readonly deviceLabel: string;
  readonly expiresAt: string;
  readonly osFamily: "linux" | "macos" | "windows";
  readonly pairingId: string;
  readonly publicKey: Buffer;
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

export type SourceState = "active" | "paused" | "quarantined" | "unlinked";

export interface ActiveDeviceInventoryItem {
  readonly activatedOn: string;
  readonly architecture: "aarch64" | "x86_64";
  readonly connectorVersion: string;
  readonly deviceId: string;
  readonly label: string;
  readonly osFamily: "linux" | "macos" | "windows";
}

export interface SourceDeviceInventoryItem {
  readonly devices: readonly ActiveDeviceInventoryItem[];
  readonly sourceId: string;
  readonly state: SourceState;
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

function dateAfter(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function exactAccountOverview(value: unknown, expectedSeasonStart: string): AccountOverview {
  if (!Array.isArray(value) || (value.length !== 1 && value.length !== 7)) {
    fail("result_invalid");
  }
  const rows = value.map((row: unknown) => {
    if (!isRecord(row)) {
      fail("result_invalid");
    }
    const keys = Object.keys(row);
    if (
      keys.length !== accountOverviewColumns.size ||
      keys.some((key) => !accountOverviewColumns.has(key)) ||
      (row.visibility !== "hidden" && row.visibility !== "public")
    ) {
      fail("result_invalid");
    }
    return row;
  });
  const first = rows[0];
  if (first === undefined) {
    fail("result_invalid");
  }
  const visibility = first.visibility as ProfileVisibility;
  const nullScore = accountScoreColumns.every((column) => first[column] === null);
  if (nullScore) {
    if (rows.length !== 1) {
      fail("result_invalid");
    }
    return Object.freeze({ score: null, visibility });
  }
  if (
    rows.length !== 7 ||
    visibility !== "public" ||
    !canonicalDate(first.season_start) ||
    first.season_start !== expectedSeasonStart ||
    !canonicalDate(first.season_end) ||
    first.season_end !== dateAfter(first.season_start, 6) ||
    typeof first.season_finalized !== "boolean" ||
    !boundedInteger(first.weekly_score, 0, 7000) ||
    !boundedInteger(first.active_days, 0, 7) ||
    !boundedInteger(first.source_count, 0, 32)
  ) {
    fail("result_invalid");
  }
  const dailyScores: number[] = [];
  for (const [index, row] of rows.entries()) {
    if (
      row.visibility !== visibility ||
      row.season_start !== first.season_start ||
      row.season_end !== first.season_end ||
      row.season_finalized !== first.season_finalized ||
      row.weekly_score !== first.weekly_score ||
      row.active_days !== first.active_days ||
      row.source_count !== first.source_count ||
      row.score_date !== dateAfter(first.season_start, index) ||
      !boundedInteger(row.daily_score, 0, 1000)
    ) {
      fail("result_invalid");
    }
    dailyScores.push(row.daily_score);
  }
  if (dailyScores.reduce((total, score) => total + score, 0) !== first.weekly_score) {
    fail("result_invalid");
  }
  return Object.freeze({
    score: Object.freeze({
      activeDays: first.active_days,
      dailyScores: Object.freeze(dailyScores),
      seasonEnd: first.season_end,
      seasonFinalized: first.season_finalized,
      seasonStart: first.season_start,
      sourceCount: first.source_count,
      weeklyScore: first.weekly_score,
    }),
    visibility,
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

function exactPairingApprovalMaterial(value: unknown): PairingApprovalMaterial | undefined {
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
    publicKey = copyBoundedBytes(row.public_key, 32, 32);
    const labelLength =
      typeof row.device_label === "string" ? Array.from(row.device_label).length : 0;
    const expiresAt = typeof row.expires_at === "string" ? new Date(row.expires_at) : undefined;
    if (
      keys.length !== pairingApprovalColumns.size ||
      keys.some((key) => !pairingApprovalColumns.has(key)) ||
      (row.candidate_index !== 1 && row.candidate_index !== 2) ||
      typeof row.pairing_id !== "string" ||
      !enrollmentPatterns.uuidV4.test(row.pairing_id) ||
      typeof row.device_label !== "string" ||
      row.device_label.length < 1 ||
      row.device_label.length > 128 ||
      labelLength < 1 ||
      labelLength > 64 ||
      row.device_label !== row.device_label.trim() ||
      row.device_label !== row.device_label.normalize("NFC") ||
      unsafeLabelPattern.test(row.device_label) ||
      typeof row.connector_version !== "string" ||
      row.connector_version.length > 64 ||
      !connectorVersionPattern.test(row.connector_version) ||
      (row.os_family !== "linux" && row.os_family !== "macos" && row.os_family !== "windows") ||
      (row.architecture !== "aarch64" && row.architecture !== "x86_64") ||
      typeof row.expires_at !== "string" ||
      !canonicalTimestampPattern.test(row.expires_at) ||
      expiresAt === undefined ||
      !Number.isFinite(expiresAt.valueOf()) ||
      expiresAt.toISOString() !== row.expires_at ||
      publicKey === undefined ||
      publicKey.every((byte) => byte === 0)
    ) {
      fail("result_invalid");
    }
    return Object.freeze({
      architecture: row.architecture,
      candidateIndex: row.candidate_index,
      connectorVersion: row.connector_version,
      deviceLabel: row.device_label,
      expiresAt: row.expires_at,
      osFamily: row.os_family,
      pairingId: row.pairing_id,
      publicKey,
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

function exactActiveDeviceInventory(value: unknown): readonly SourceDeviceInventoryItem[] {
  if (!Array.isArray(value) || value.length > 95) {
    fail("result_invalid");
  }
  const deviceIds = new Set<string>();
  const sources: {
    devices: ActiveDeviceInventoryItem[];
    sourceId: string;
    state: SourceState;
  }[] = [];
  let currentSource:
    | {
        devices: ActiveDeviceInventoryItem[];
        sourceId: string;
        state: SourceState;
      }
    | undefined;
  let currentSourceHasEmptyMarker = false;
  for (const row of value as unknown[]) {
    if (!isRecord(row)) {
      fail("result_invalid");
    }
    const keys = Object.keys(row);
    if (
      keys.length !== activeDeviceInventoryColumns.size ||
      keys.some((key) => !activeDeviceInventoryColumns.has(key)) ||
      typeof row.source_id !== "string" ||
      !sourceIdPattern.test(row.source_id) ||
      (row.source_state !== "active" &&
        row.source_state !== "paused" &&
        row.source_state !== "quarantined" &&
        row.source_state !== "unlinked")
    ) {
      fail("result_invalid");
    }
    if (currentSource?.sourceId !== row.source_id) {
      if (currentSource !== undefined && row.source_id <= currentSource.sourceId) {
        fail("result_invalid");
      }
      currentSource = {
        devices: [],
        sourceId: row.source_id,
        state: row.source_state,
      };
      currentSourceHasEmptyMarker = false;
      sources.push(currentSource);
      if (sources.length > 32) {
        fail("result_invalid");
      }
    } else if (currentSource.state !== row.source_state) {
      fail("result_invalid");
    }
    if (row.device_id === null) {
      if (
        currentSourceHasEmptyMarker ||
        currentSource.devices.length !== 0 ||
        row.device_label !== null ||
        row.connector_version !== null ||
        row.os_family !== null ||
        row.architecture !== null ||
        row.device_state !== null ||
        row.activated_on !== null
      ) {
        fail("result_invalid");
      }
      currentSourceHasEmptyMarker = true;
      continue;
    }
    const labelLength =
      typeof row.device_label === "string" ? Array.from(row.device_label).length : 0;
    if (
      currentSourceHasEmptyMarker ||
      typeof row.device_id !== "string" ||
      !deviceIdPattern.test(row.device_id) ||
      deviceIds.has(row.device_id) ||
      typeof row.device_label !== "string" ||
      labelLength < 1 ||
      labelLength > 64 ||
      row.device_label !== row.device_label.trim() ||
      row.device_label !== row.device_label.normalize("NFC") ||
      unsafeLabelPattern.test(row.device_label) ||
      typeof row.connector_version !== "string" ||
      row.connector_version.length < 5 ||
      row.connector_version.length > 64 ||
      !connectorVersionPattern.test(row.connector_version) ||
      (row.os_family !== "linux" && row.os_family !== "macos" && row.os_family !== "windows") ||
      (row.architecture !== "aarch64" && row.architecture !== "x86_64") ||
      row.device_state !== "active" ||
      !canonicalDate(row.activated_on)
    ) {
      fail("result_invalid");
    }
    deviceIds.add(row.device_id);
    if (deviceIds.size > 64) {
      fail("result_invalid");
    }
    currentSource.devices.push(
      Object.freeze({
        activatedOn: row.activated_on,
        architecture: row.architecture,
        connectorVersion: row.connector_version,
        deviceId: row.device_id,
        label: row.device_label,
        osFamily: row.os_family,
      }),
    );
  }
  return Object.freeze(
    sources.map((source) =>
      Object.freeze({
        devices: Object.freeze(source.devices),
        sourceId: source.sourceId,
        state: source.state,
      }),
    ),
  );
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
    completePairingApproval(input: EnrollmentDatabasePairingApproval): Promise<boolean> {
      return execute(
        (client) => client.completePairingApproval(input),
        (value) => exactBooleanRow(value, "approved"),
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
    completeSourceReactivation(input: EnrollmentDatabaseSourceReactivation): Promise<boolean> {
      return execute(
        (client) => client.completeSourceReactivation(input),
        (value) => exactBooleanRow(value, "reactivated"),
      );
    },
    completeSourceUnlink(input: EnrollmentDatabaseSourceUnlink): Promise<boolean> {
      return execute(
        (client) => client.completeSourceUnlink(input),
        (value) => exactBooleanRow(value, "unlinked"),
      );
    },
    createPasskeyAddChallenge(input: EnrollmentDatabasePasskeyAddChallenge): Promise<boolean> {
      return execute(
        (client) => client.createPasskeyAddChallenge(input),
        (value) => exactBooleanRow(value, "created"),
      );
    },
    createPairingApprovalChallenge(
      input: EnrollmentDatabasePairingApprovalChallenge,
    ): Promise<boolean> {
      return execute(
        (client) => client.createPairingApprovalChallenge(input),
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
    createRecoveryCodeChallenge(input: EnrollmentDatabaseRecoveryCodeChallenge): Promise<boolean> {
      return execute(
        (client) => client.createRecoveryCodeChallenge(input),
        (value) => exactBooleanRow(value, "created"),
      );
    },
    createSourceReactivationChallenge(
      input: EnrollmentDatabaseSourceReactivationChallenge,
    ): Promise<boolean> {
      return execute(
        (client) => client.createSourceReactivationChallenge(input),
        (value) => exactBooleanRow(value, "created"),
      );
    },
    createSourceUnlinkChallenge(input: EnrollmentDatabaseSourceUnlinkChallenge): Promise<boolean> {
      return execute(
        (client) => client.createSourceUnlinkChallenge(input),
        (value) => exactBooleanRow(value, "created"),
      );
    },
    enrollProfile(input: EnrollmentDatabaseProfile): Promise<boolean> {
      return execute(
        (client) => client.enrollProfile(input),
        (value) => exactBooleanRow(value, "enrolled"),
      );
    },
    pauseSource(input: EnrollmentDatabaseSourcePause): Promise<boolean> {
      return execute(
        (client) => client.pauseSource(input),
        (value) => exactBooleanRow(value, "paused"),
      );
    },
    proposeCarRecipe(input: EnrollmentDatabaseCarRecipeProposal): Promise<boolean> {
      return execute(
        (client) => client.proposeCarRecipe(input),
        (value) => exactBooleanRow(value, "proposed"),
      );
    },
    readAccountOverview(input: EnrollmentDatabaseAccountOverviewRequest): Promise<AccountOverview> {
      return execute(
        (client) => client.readAccountOverview(input),
        (value) => exactAccountOverview(value, input.seasonStart),
      );
    },
    readCarRecipeState(input: EnrollmentDatabaseProfileVisibilityRequest): Promise<CarRecipeState> {
      return execute((client) => client.readCarRecipeState(input), exactCarRecipeState);
    },
    readActiveDeviceInventory(
      input: EnrollmentDatabaseSourceDeviceInventoryRequest,
    ): Promise<readonly SourceDeviceInventoryItem[]> {
      return execute(
        (client) => client.readActiveDeviceInventory(input),
        exactActiveDeviceInventory,
      );
    },
    readPasskeyInventory(
      input: EnrollmentDatabasePasskeyInventoryRequest,
    ): Promise<readonly PasskeyInventoryItem[]> {
      return execute((client) => client.readPasskeyInventory(input), exactPasskeyInventory);
    },
    readPasskeyLoginMaterial(credentialId: Uint8Array): Promise<PasskeyLoginMaterial | undefined> {
      return execute((client) => client.readPasskeyLoginMaterial(credentialId), exactLoginMaterial);
    },
    readPairingApproval(
      input: EnrollmentDatabasePairingApprovalRead,
    ): Promise<PairingApprovalMaterial | undefined> {
      return execute((client) => client.readPairingApproval(input), exactPairingApprovalMaterial);
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
    revokeDevice(input: EnrollmentDatabaseDeviceRevocation): Promise<boolean> {
      return execute(
        (client) => client.revokeDevice(input),
        (value) => exactBooleanRow(value, "revoked"),
      );
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
