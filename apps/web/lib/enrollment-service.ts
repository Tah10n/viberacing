import "server-only";

import { Buffer } from "node:buffer";
import {
  createHash,
  randomBytes as nodeRandomBytes,
  randomUUID as nodeRandomUUID,
  timingSafeEqual,
} from "node:crypto";

import type { EnrollmentConfig } from "./enrollment-config";
import type { EnrollmentCookieCodec, EnrollmentRandomBytes } from "./enrollment-cookie";
import type {
  AgentAccountDashboardInventory,
  AgentAccountQuarantineReason,
  AgentAccountStatus,
  AgentProviderCode,
  EnrollmentDatabase,
  PasskeyInventoryItem,
  PasskeyLoginMaterial,
  PrivateDashboardRanking,
  ProfileVisibility,
} from "./enrollment-database";
import {
  enrollmentPatterns,
  readAccountTargetActionChallenge,
  readEnrollmentSession,
  readInitialPasskeyChallenge,
  readPasskeyAddChallenge,
  readPasskeyChallenge,
  readPasskeyRevokeChallenge,
  readPendingEnrollment,
  readProfileDeletionChallenge,
  readRecoveryAuthorityChallenge,
  type EnrollmentSession,
  type AccountTargetActionChallenge,
  type AccountTargetActionPurpose,
  type InitialPasskeyChallenge,
  type JoinRequest,
  type PasskeyAddChallenge,
  type PasskeyRegistrationChallenge,
  type PasskeyRevokeChallenge,
  type PendingEnrollment,
  type ProfileDeletionChallenge,
  type RecoveryAuthorityChallenge,
} from "./enrollment-domain";
import {
  createGithubOAuthMaterial,
  exchangeGithubUserId,
  githubAuthorizationUrl,
} from "./github-oauth";
import {
  accountTargetActionContextDigest,
  createPasskeyLoginOptions,
  createPasskeyRegistrationOptions,
  createRecoveryPasskeyRegistrationOptions,
  passkeyChallengeDigest,
  passkeyAddContextDigest,
  passkeyContextDigest,
  passkeyLoginContextDigest,
  passkeyLoginCredentialId,
  passkeyRevokeContextDigest,
  profileDeletionContextDigest,
  recoveryCodeRotationContextDigest,
  recoveryPasskeyContextDigest,
  verifyInitialPasskey,
  verifyPasskeyLogin,
  type RegisteredPasskey,
} from "./passkey-registration";
import {
  clearRecoveryCode,
  createRecoveryCodeGenerator,
  createRecoveryCodeVerifier,
  readRecoveryCode,
  type RecoveryCodeGenerator,
  type RecoveryCodeRecord,
  type RecoveryCodeVerifier,
} from "./recovery-code";

const oauthLifetimeSeconds = 600;
const passkeyLifetimeSeconds = 300;
const pendingSessionLifetimeSeconds = 15 * 60;
const activeSessionLifetimeSeconds = 30 * 24 * 60 * 60;
const accountTargetControlLifetimeSeconds = 15 * 60;
const base64Url32Pattern = /^[A-Za-z0-9_-]{43}$/;
const registrationBodyKeys = new Set(["response"]);
const initialPasskeyStartBodyKeys = new Set(["handle"]);
const authenticationBodyKeys = new Set(["response"]);
const addStartBodyKeys = new Set(["label"]);
const addBodyKeys = new Set(["authentication", "registration"]);
const revokeTargetBodyKeys = new Set(["passkeyId"]);
const profileDeletionStartBodyKeys = new Set(["handle"]);
const recoveryStartBodyKeys = new Set(["code", "label"]);
const accountTargetControlBodyKeys = new Set(["targetControl"]);
const accountTargetControlKeys = new Set([
  "expiresAt",
  "sessionId",
  "targetId",
  "targetKind",
  "version",
]);
const agentAccountIdPattern = /^acc_[A-Za-z0-9_-]{22}$/;
const deviceIdPattern = /^dev_[A-Za-z0-9_-]{22}$/;
const installationIdPattern = /^ins_[A-Za-z0-9_-]{22}$/;
const unsafeLabelPattern = /[\p{Cc}\p{Cf}\p{Cs}]/u;
const recoveryCodePattern =
  /^vrr1_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})_[A-Za-z0-9_-]{43}$/;
const dummyRecoveryCodeId = "00000000-0000-4000-8000-000000000000";

export const enrollmentCookieNames = Object.freeze({
  login: "viberacing_login",
  oauth: "viberacing_oauth",
  passkey: "viberacing_passkey",
  passkeyAdd: "viberacing_passkey_add",
  passkeyRevoke: "viberacing_passkey_revoke",
  profileDeletion: "viberacing_profile_deletion",
  recovery: "viberacing_recovery",
  recoveryCodes: "viberacing_recovery_codes",
  session: "viberacing_session",
  accountReactivation: "viberacing_account_reactivation",
  accountUnlink: "viberacing_account_unlink",
  deviceRevocation: "viberacing_device_revocation",
  installationRevocation: "viberacing_installation_revocation",
});

export interface EnrollmentStartDecision {
  readonly oauthCookie: string;
  readonly redirectUrl: string;
}

export type EnrollmentCallbackDecision =
  | Readonly<{ outcome: "existing_profile" }>
  | Readonly<{ outcome: "continue"; sessionCookie: string }>;

export interface PasskeyOptionsDecision {
  readonly options: Awaited<ReturnType<typeof createPasskeyRegistrationOptions>>;
  readonly passkeyCookie: string;
}

export interface PasskeyCompletionDecision {
  readonly sessionCookie: string;
}

export interface PasskeyLoginOptionsDecision {
  readonly loginCookie: string;
  readonly options: Awaited<ReturnType<typeof createPasskeyLoginOptions>>;
}

export interface PasskeyLoginCompletionDecision {
  readonly sessionCookie: string;
}

export interface PasskeyRevokeOptionsDecision {
  readonly options: Awaited<ReturnType<typeof createPasskeyLoginOptions>>;
  readonly passkeyRevokeCookie: string;
}

export interface PasskeyAddOptionsDecision {
  readonly authenticationOptions: Awaited<ReturnType<typeof createPasskeyLoginOptions>>;
  readonly passkeyAddCookie: string;
  readonly registrationOptions: Awaited<ReturnType<typeof createPasskeyRegistrationOptions>>;
}

export interface RecoveryCodeOptionsDecision {
  readonly options: Awaited<ReturnType<typeof createPasskeyLoginOptions>>;
  readonly recoveryCodeCookie: string;
}

export interface RecoveryCodeCompletionDecision {
  readonly recoveryCodes: readonly string[];
}

export interface RecoveryStartDecision {
  readonly options: Awaited<ReturnType<typeof createRecoveryPasskeyRegistrationOptions>>;
  readonly recoveryCookie: string;
}

export interface RecoveryCompletionDecision {
  readonly sessionCookie: string;
}

export interface ProfileDeletionOptionsDecision {
  readonly options: Awaited<ReturnType<typeof createPasskeyLoginOptions>>;
  readonly profileDeletionCookie: string;
}

export interface AccountTargetActionOptionsDecision {
  readonly actionCookie: string;
  readonly options: Awaited<ReturnType<typeof createPasskeyLoginOptions>>;
}

export interface AccountDashboardAccount {
  readonly accountingRevision: number;
  readonly connectedDeviceCount: number;
  readonly control: string;
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

export interface AccountDashboardInstallationAccount {
  readonly deviceControl: string | null;
  readonly deviceState: "active" | "revoked";
  readonly privateLabel: string;
}

export interface AccountDashboardInstallation {
  readonly accounts: readonly AccountDashboardInstallationAccount[];
  readonly architecture: "aarch64" | "x86_64";
  readonly connectedDate: string;
  readonly connectorVersion: string;
  readonly control: string;
  readonly label: string;
  readonly lastSeenDate: string | null;
  readonly osFamily: "linux" | "macos" | "windows";
  readonly state: "active" | "revoked";
}

export interface AccountDashboard {
  readonly accounts: readonly AccountDashboardAccount[];
  readonly installations: readonly AccountDashboardInstallation[];
  readonly ranking: PrivateDashboardRanking;
}

export interface EnrollmentService {
  beginAccountTargetAction(
    sessionCookie: string,
    body: unknown,
    purpose: AccountTargetActionPurpose,
  ): Promise<AccountTargetActionOptionsDecision | undefined>;
  beginGithub(join: JoinRequest, enrollmentEnabled: unknown): EnrollmentStartDecision | undefined;
  beginLogin(): Promise<PasskeyLoginOptionsDecision | undefined>;
  beginPasskey(
    sessionCookie: string,
    body: unknown,
    enrollmentEnabled: unknown,
  ): Promise<PasskeyOptionsDecision | undefined>;
  beginPasskeyAdd(
    sessionCookie: string,
    body: unknown,
  ): Promise<PasskeyAddOptionsDecision | undefined>;
  beginPasskeyRevoke(
    sessionCookie: string,
    body: unknown,
  ): Promise<PasskeyRevokeOptionsDecision | undefined>;
  beginProfileDeletion(
    sessionCookie: string,
    body: unknown,
  ): Promise<ProfileDeletionOptionsDecision | undefined>;
  beginRecoveryCodeRotation(
    sessionCookie: string,
  ): Promise<RecoveryCodeOptionsDecision | undefined>;
  beginRecovery(body: unknown): Promise<RecoveryStartDecision | undefined>;
  cancelGithub(state: string, oauthCookie: string): boolean;
  completeGithub(
    code: string,
    state: string,
    oauthCookie: string,
    signal: AbortSignal,
    enrollmentEnabled: unknown,
    inviteGateEnabled: unknown,
  ): Promise<EnrollmentCallbackDecision | undefined>;
  completeLogin(
    loginCookie: string,
    body: unknown,
  ): Promise<PasskeyLoginCompletionDecision | undefined>;
  completePasskey(
    sessionCookie: string,
    passkeyCookie: string,
    body: unknown,
    enrollmentEnabled: unknown,
  ): Promise<PasskeyCompletionDecision | undefined>;
  completePasskeyAdd(
    sessionCookie: string,
    passkeyAddCookie: string,
    body: unknown,
  ): Promise<boolean>;
  completePasskeyRevoke(
    sessionCookie: string,
    passkeyRevokeCookie: string,
    body: unknown,
  ): Promise<boolean>;
  completeProfileDeletion(
    sessionCookie: string,
    profileDeletionCookie: string,
    body: unknown,
  ): Promise<boolean>;
  completeRecoveryCodeRotation(
    sessionCookie: string,
    recoveryCodeCookie: string,
    body: unknown,
  ): Promise<RecoveryCodeCompletionDecision | undefined>;
  completeRecovery(
    recoveryCookie: string,
    body: unknown,
  ): Promise<RecoveryCompletionDecision | undefined>;
  completeAccountTargetAction(
    sessionCookie: string,
    actionCookie: string,
    body: unknown,
    purpose: AccountTargetActionPurpose,
  ): Promise<boolean>;
  logout(sessionCookie: string | undefined): Promise<boolean>;
  pauseAgentAccount(sessionCookie: string, targetControl: string): Promise<boolean>;
  readAccountDashboard(sessionCookie: string): Promise<AccountDashboard | undefined>;
  readPasskeyInventory(sessionCookie: string): Promise<readonly PasskeyInventoryItem[] | undefined>;
  readProfileVisibility(sessionCookie: string): Promise<ProfileVisibility | undefined>;
  readSession(sessionCookie: string | undefined): EnrollmentSession | undefined;
  setProfileVisibility(
    sessionCookie: string,
    publiclyVisible: boolean,
  ): Promise<ProfileVisibility | undefined>;
  setProviderBreakdownVisibility(
    sessionCookie: string,
    providerBreakdownVisible: boolean,
  ): Promise<boolean | undefined>;
}

interface EnrollmentServiceDependencies {
  readonly config: EnrollmentConfig;
  readonly cookieCodec: EnrollmentCookieCodec;
  readonly createOptions?: typeof createPasskeyRegistrationOptions;
  readonly createRecoveryOptions?: typeof createRecoveryPasskeyRegistrationOptions;
  readonly createLoginOptions?: typeof createPasskeyLoginOptions;
  readonly database: EnrollmentDatabase;
  readonly exchangeGithub?: typeof exchangeGithubUserId;
  readonly generateRecoveryCodes?: RecoveryCodeGenerator;
  readonly now?: () => Date;
  readonly randomBytes?: EnrollmentRandomBytes;
  readonly randomUuid?: () => string;
  readonly verifyPasskey?: typeof verifyInitialPasskey;
  readonly verifyLogin?: typeof verifyPasskeyLogin;
  readonly verifyRecoveryCode?: RecoveryCodeVerifier;
}

interface RegistrationBody {
  readonly response: unknown;
}

interface InitialPasskeyStartBody {
  readonly handle: string;
}

interface AuthenticationBody {
  readonly response: unknown;
}

interface PasskeyAddBody {
  readonly authentication: unknown;
  readonly registration: unknown;
}

interface PasskeyAddStartBody {
  readonly label: string;
}

interface PasskeyRevokeTargetBody {
  readonly passkeyId: string;
}

interface ProfileDeletionStartBody {
  readonly handle: string;
}

interface RecoveryStartBody {
  readonly code: string;
  readonly label: string;
}

type AccountTargetKind = "agent_account" | "device" | "installation";

interface AccountTargetControl {
  readonly expiresAt: number;
  readonly sessionId: string;
  readonly targetId: string;
  readonly targetKind: AccountTargetKind;
  readonly version: 1;
}

interface AccountTargetControlBody {
  readonly targetControl: string;
}

function nowSeconds(now: Date): number | undefined {
  const milliseconds = now.valueOf();
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined;
}

function digestBase64Url(value: string): Buffer | undefined {
  if (!base64Url32Pattern.test(value)) {
    return undefined;
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== value) {
    decoded.fill(0);
    return undefined;
  }
  return decoded;
}

function randomSecret(randomBytes: EnrollmentRandomBytes): Buffer | undefined {
  const secret = Buffer.from(randomBytes(32));
  if (secret.length !== 32) {
    secret.fill(0);
    return undefined;
  }
  return secret;
}

function sameState(expected: string, received: string): boolean {
  const expectedBytes = digestBase64Url(expected);
  const receivedBytes = digestBase64Url(received);
  try {
    return (
      expectedBytes !== undefined &&
      receivedBytes !== undefined &&
      timingSafeEqual(expectedBytes, receivedBytes)
    );
  } finally {
    expectedBytes?.fill(0);
    receivedBytes?.fill(0);
  }
}

function readPasskeyLabel(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 64 ||
    value !== value.trim() ||
    value !== value.normalize("NFC") ||
    unsafeLabelPattern.test(value) ||
    Array.from(value).length > 64
  ) {
    return undefined;
  }
  return value;
}

function readRegistrationBody(value: unknown): RegistrationBody | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== registrationBodyKeys.size ||
    keys.some((key) => !registrationBodyKeys.has(key)) ||
    record.response === null ||
    typeof record.response !== "object" ||
    Array.isArray(record.response)
  ) {
    return undefined;
  }
  return Object.freeze({ response: record.response });
}

function readInitialPasskeyStartBody(value: unknown): InitialPasskeyStartBody | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== initialPasskeyStartBodyKeys.size ||
    keys.some((key) => !initialPasskeyStartBodyKeys.has(key)) ||
    typeof record.handle !== "string" ||
    !enrollmentPatterns.handle.test(record.handle) ||
    record.handle.startsWith("pending_")
  ) {
    return undefined;
  }
  return Object.freeze({ handle: record.handle });
}

function readAuthenticationBody(value: unknown): AuthenticationBody | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== authenticationBodyKeys.size ||
    keys.some((key) => !authenticationBodyKeys.has(key)) ||
    record.response === null ||
    typeof record.response !== "object" ||
    Array.isArray(record.response)
  ) {
    return undefined;
  }
  return Object.freeze({ response: record.response });
}

function readPasskeyAddBody(value: unknown): PasskeyAddBody | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== addBodyKeys.size || keys.some((key) => !addBodyKeys.has(key))) {
    return undefined;
  }
  const authentication = readAuthenticationBody({ response: record.authentication });
  const registration = readAuthenticationBody({ response: record.registration });
  if (authentication === undefined || registration === undefined) {
    return undefined;
  }
  return Object.freeze({
    authentication: authentication.response,
    registration: registration.response,
  });
}

function readPasskeyAddStartBody(value: unknown): PasskeyAddStartBody | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const label = readPasskeyLabel(record.label);
  if (
    keys.length !== addStartBodyKeys.size ||
    keys.some((key) => !addStartBodyKeys.has(key)) ||
    label === undefined
  ) {
    return undefined;
  }
  return Object.freeze({ label });
}

function readPasskeyRevokeTargetBody(value: unknown): PasskeyRevokeTargetBody | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== revokeTargetBodyKeys.size ||
    keys.some((key) => !revokeTargetBodyKeys.has(key)) ||
    typeof record.passkeyId !== "string" ||
    !enrollmentPatterns.uuidV4.test(record.passkeyId)
  ) {
    return undefined;
  }
  return Object.freeze({ passkeyId: record.passkeyId });
}

function readProfileDeletionStartBody(value: unknown): ProfileDeletionStartBody | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== profileDeletionStartBodyKeys.size ||
    keys.some((key) => !profileDeletionStartBodyKeys.has(key)) ||
    typeof record.handle !== "string" ||
    !enrollmentPatterns.handle.test(record.handle)
  ) {
    return undefined;
  }
  return Object.freeze({ handle: record.handle });
}

function readRecoveryStartBody(value: unknown): RecoveryStartBody | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const label = readPasskeyLabel(record.label);
  if (
    keys.length !== recoveryStartBodyKeys.size ||
    keys.some((key) => !recoveryStartBodyKeys.has(key)) ||
    typeof record.code !== "string" ||
    record.code.length < 1 ||
    record.code.length > 128 ||
    label === undefined
  ) {
    return undefined;
  }
  return Object.freeze({ code: record.code, label });
}

function readAccountTargetControlBody(value: unknown): AccountTargetControlBody | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== accountTargetControlBodyKeys.size ||
    keys.some((key) => !accountTargetControlBodyKeys.has(key)) ||
    typeof record.targetControl !== "string" ||
    record.targetControl.length < 1 ||
    record.targetControl.length > 512
  ) {
    return undefined;
  }
  return Object.freeze({ targetControl: record.targetControl });
}

function expectedTargetKind(purpose: AccountTargetActionPurpose): AccountTargetKind {
  return purpose === "device_revoke"
    ? "device"
    : purpose === "installation_revoke"
      ? "installation"
      : "agent_account";
}

function validAccountTargetId(
  targetKind: AccountTargetKind,
  targetId: unknown,
): targetId is string {
  return (
    typeof targetId === "string" &&
    ((targetKind === "agent_account" && agentAccountIdPattern.test(targetId)) ||
      (targetKind === "device" && deviceIdPattern.test(targetId)) ||
      (targetKind === "installation" && installationIdPattern.test(targetId)))
  );
}

function readAccountTargetControl(
  value: unknown,
  nowSeconds: number,
  sessionId: string,
  targetKind?: AccountTargetKind,
): AccountTargetControl | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== accountTargetControlKeys.size ||
    keys.some((key) => !accountTargetControlKeys.has(key)) ||
    record.version !== 1 ||
    record.sessionId !== sessionId ||
    (record.targetKind !== "agent_account" &&
      record.targetKind !== "device" &&
      record.targetKind !== "installation") ||
    (targetKind !== undefined && record.targetKind !== targetKind) ||
    !validAccountTargetId(record.targetKind, record.targetId) ||
    !Number.isSafeInteger(record.expiresAt) ||
    Number(record.expiresAt) <= nowSeconds ||
    Number(record.expiresAt) > nowSeconds + accountTargetControlLifetimeSeconds
  ) {
    return undefined;
  }
  return Object.freeze(record as unknown as AccountTargetControl);
}

function clearRegisteredPasskey(passkey: RegisteredPasskey | undefined): void {
  if (passkey !== undefined) {
    passkey.credentialId.fill(0);
    passkey.cosePublicKey.fill(0);
  }
}

function clearLoginMaterial(material: PasskeyLoginMaterial | undefined): void {
  material?.cosePublicKey.fill(0);
}

function validRecoveryCodeBatch(
  records: unknown,
  config: EnrollmentConfig,
): records is readonly RecoveryCodeRecord[] {
  if (!Array.isArray(records) || records.length !== 10) {
    return false;
  }
  const candidates = records as readonly unknown[];
  const ids = new Set<string>();
  const plaintexts = new Set<string>();
  const phcs = new Set<string>();
  const expectedPhcPrefix =
    `$argon2id$v=19$m=${String(config.recoveryArgon2.memoryKib)},` +
    `t=${String(config.recoveryArgon2.passes)},p=${String(config.recoveryArgon2.parallelism)}$`;
  for (const candidate of candidates) {
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      Array.isArray(candidate) ||
      Object.getPrototypeOf(candidate) !== Object.prototype
    ) {
      return false;
    }
    const record = candidate as Record<string, unknown>;
    const codeId = record.codeId;
    const plaintext = record.plaintext;
    const verifierPhc = record.verifierPhc;
    const plaintextMatch =
      typeof plaintext === "string" ? recoveryCodePattern.exec(plaintext) : null;
    if (
      Object.keys(record).length !== 3 ||
      !Object.hasOwn(record, "codeId") ||
      !Object.hasOwn(record, "plaintext") ||
      !Object.hasOwn(record, "verifierPhc") ||
      typeof codeId !== "string" ||
      !enrollmentPatterns.uuidV4.test(codeId) ||
      typeof plaintext !== "string" ||
      plaintextMatch?.[1] !== codeId ||
      typeof verifierPhc !== "string" ||
      !verifierPhc.startsWith(expectedPhcPrefix) ||
      !/^\$argon2id\$v=19\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/.test(
        verifierPhc,
      ) ||
      verifierPhc.length > 255 ||
      ids.has(codeId) ||
      plaintexts.has(plaintext) ||
      phcs.has(verifierPhc)
    ) {
      return false;
    }
    ids.add(codeId);
    plaintexts.add(plaintext);
    phcs.add(verifierPhc);
  }
  return true;
}

function provisionalHandle(profileId: string): string | undefined {
  if (!enrollmentPatterns.uuidV4.test(profileId)) {
    return undefined;
  }
  const value = `pending_${profileId.replaceAll("-", "").slice(0, 16)}`;
  return enrollmentPatterns.handle.test(value) ? value : undefined;
}

export function createEnrollmentService(
  dependencies: EnrollmentServiceDependencies,
): EnrollmentService {
  const {
    config,
    cookieCodec,
    database,
    createLoginOptions = createPasskeyLoginOptions,
    createOptions = createPasskeyRegistrationOptions,
    createRecoveryOptions = createRecoveryPasskeyRegistrationOptions,
    exchangeGithub = exchangeGithubUserId,
    generateRecoveryCodes = createRecoveryCodeGenerator(
      config.recoveryArgon2,
      config.recoveryPepper,
    ),
    now = () => new Date(),
    randomBytes = nodeRandomBytes,
    randomUuid = nodeRandomUUID,
    verifyPasskey = verifyInitialPasskey,
    verifyLogin = verifyPasskeyLogin,
    verifyRecoveryCode = createRecoveryCodeVerifier(config.recoveryArgon2, config.recoveryPepper),
  } = dependencies;

  function currentSeconds(): number | undefined {
    return nowSeconds(now());
  }

  function readSession(sessionCookie: string | undefined): EnrollmentSession | undefined {
    const seconds = currentSeconds();
    return sessionCookie === undefined || seconds === undefined
      ? undefined
      : readEnrollmentSession(cookieCodec.open("session", sessionCookie), seconds);
  }

  async function beginAccountTargetAction(
    sessionCookie: string,
    body: unknown,
    purpose: AccountTargetActionPurpose,
  ): Promise<AccountTargetActionOptionsDecision | undefined> {
    const session = readSession(sessionCookie);
    const target = readAccountTargetControlBody(body);
    const seconds = currentSeconds();
    if (!session?.passkeyRegistered || target === undefined || seconds === undefined) {
      return undefined;
    }
    const control = readAccountTargetControl(
      cookieCodec.open("passkey", target.targetControl),
      seconds,
      session.sessionId,
      expectedTargetKind(purpose),
    );
    if (control === undefined) {
      return undefined;
    }
    let sessionVerifier: Buffer | undefined;
    let sessionDigest: Buffer | undefined;
    let challengeDigest: Buffer | undefined;
    let contextDigest: Buffer | undefined;
    try {
      sessionVerifier = digestBase64Url(session.sessionVerifier);
      if (sessionVerifier === undefined) {
        return undefined;
      }
      const options = await createLoginOptions(config.webauthnRpId);
      if (!base64Url32Pattern.test(options.challenge)) {
        return undefined;
      }
      const challengeId = randomUuid();
      if (!enrollmentPatterns.uuidV4.test(challengeId)) {
        return undefined;
      }
      const expiresAt = seconds + passkeyLifetimeSeconds;
      sessionDigest = createHash("sha256").update(sessionVerifier).digest();
      challengeDigest = passkeyChallengeDigest(options.challenge);
      contextDigest = accountTargetActionContextDigest(
        session.sessionId,
        purpose,
        control.targetId,
        config.webauthnRpId,
        config.webauthnOrigin,
      );
      const challenge: AccountTargetActionChallenge = Object.freeze({
        challenge: options.challenge,
        challengeId,
        expiresAt,
        purpose,
        targetId: control.targetId,
        version: 1,
      });
      const actionCookie = cookieCodec.seal("passkey", challenge);
      const created = await database.createAccountTargetChallenge({
        challengeDigest,
        challengeId,
        contextDigest,
        expiresAt: new Date(expiresAt * 1000).toISOString(),
        purpose,
        sessionId: session.sessionId,
        sessionVerifierDigest: sessionDigest,
      });
      return created ? Object.freeze({ actionCookie, options }) : undefined;
    } catch {
      return undefined;
    } finally {
      sessionVerifier?.fill(0);
      sessionDigest?.fill(0);
      challengeDigest?.fill(0);
      contextDigest?.fill(0);
    }
  }

  async function completeAccountTargetAction(
    sessionCookie: string,
    actionCookie: string,
    body: unknown,
    purpose: AccountTargetActionPurpose,
  ): Promise<boolean> {
    const session = readSession(sessionCookie);
    const seconds = currentSeconds();
    const authentication = readAuthenticationBody(body);
    const challenge =
      seconds === undefined
        ? undefined
        : readAccountTargetActionChallenge(cookieCodec.open("passkey", actionCookie), seconds);
    if (
      !session?.passkeyRegistered ||
      authentication === undefined ||
      challenge?.purpose !== purpose
    ) {
      return false;
    }
    let credentialId: Buffer | undefined;
    let material: PasskeyLoginMaterial | undefined;
    let sessionVerifier: Buffer | undefined;
    let sessionDigest: Buffer | undefined;
    let contextDigest: Buffer | undefined;
    try {
      credentialId = passkeyLoginCredentialId(authentication.response);
      sessionVerifier = digestBase64Url(session.sessionVerifier);
      if (credentialId === undefined || sessionVerifier === undefined) {
        return false;
      }
      material = await database.readPasskeyLoginMaterial(credentialId);
      if (material === undefined) {
        return false;
      }
      const verified = await verifyLogin(
        authentication.response,
        challenge.challenge,
        config.webauthnOrigin,
        config.webauthnRpId,
        {
          backupEligible: material.backupEligible,
          cosePublicKey: material.cosePublicKey,
          credentialId,
          signCount: material.signCount,
        },
      );
      if (verified === undefined) {
        return false;
      }
      sessionDigest = createHash("sha256").update(sessionVerifier).digest();
      contextDigest = accountTargetActionContextDigest(
        session.sessionId,
        purpose,
        challenge.targetId,
        config.webauthnRpId,
        config.webauthnOrigin,
      );
      const completion = {
        backupState: verified.backupState,
        challengeId: challenge.challengeId,
        contextDigest,
        observedSignCount: verified.signCount,
        sessionId: session.sessionId,
        sessionVerifierDigest: sessionDigest,
        targetId: challenge.targetId,
        verifiedPasskeyId: material.passkeyId,
      };
      switch (purpose) {
        case "account_reactivate":
          return await database.completeAgentAccountReactivation(completion);
        case "account_unlink":
          return await database.completeAgentAccountUnlink(completion);
        case "device_revoke":
          return await database.completeDeviceKeyRevocation(completion);
        case "installation_revoke":
          return await database.completeInstallationRevocation(completion);
      }
      return false;
    } catch {
      return false;
    } finally {
      credentialId?.fill(0);
      clearLoginMaterial(material);
      sessionVerifier?.fill(0);
      sessionDigest?.fill(0);
      contextDigest?.fill(0);
    }
  }

  return Object.freeze({
    beginAccountTargetAction,
    beginGithub(
      join: JoinRequest,
      enrollmentEnabled: unknown,
    ): EnrollmentStartDecision | undefined {
      if (enrollmentEnabled !== true) {
        return undefined;
      }
      const seconds = currentSeconds();
      if (seconds === undefined) {
        return undefined;
      }
      try {
        const material = createGithubOAuthMaterial(randomBytes);
        const pending: PendingEnrollment = Object.freeze({
          ...join,
          codeVerifier: material.codeVerifier,
          expiresAt: seconds + oauthLifetimeSeconds,
          state: material.state,
          version: 1,
        });
        return Object.freeze({
          oauthCookie: cookieCodec.seal("oauth", pending),
          redirectUrl: githubAuthorizationUrl(config, material),
        });
      } catch {
        return undefined;
      }
    },
    async beginLogin(): Promise<PasskeyLoginOptionsDecision | undefined> {
      const seconds = currentSeconds();
      if (seconds === undefined) {
        return undefined;
      }
      try {
        const options = await createLoginOptions(config.webauthnRpId);
        if (!base64Url32Pattern.test(options.challenge)) {
          return undefined;
        }
        const challengeId = randomUuid();
        if (!enrollmentPatterns.uuidV4.test(challengeId)) {
          return undefined;
        }
        const expiresAt = seconds + passkeyLifetimeSeconds;
        const challenge: PasskeyRegistrationChallenge = Object.freeze({
          challenge: options.challenge,
          challengeId,
          expiresAt,
          version: 1,
        });
        const loginCookie = cookieCodec.seal("login", challenge);
        return Object.freeze({ loginCookie, options });
      } catch {
        return undefined;
      }
    },
    async beginRecovery(body: unknown): Promise<RecoveryStartDecision | undefined> {
      const seconds = currentSeconds();
      const input = readRecoveryStartBody(body);
      const recoveryCode = readRecoveryCode(input?.code);
      let authoritySecret: Buffer | undefined;
      let authorityVerifierDigest: Buffer | undefined;
      let challengeDigest: Buffer | undefined;
      let contextDigest: Buffer | undefined;
      try {
        const material = await database.readRecoveryCodeVerificationMaterial(
          recoveryCode?.codeId ?? dummyRecoveryCodeId,
        );
        const verified = await verifyRecoveryCode(recoveryCode?.secret, material?.verifierPhc);
        if (
          !verified ||
          input === undefined ||
          recoveryCode === undefined ||
          seconds === undefined
        ) {
          return undefined;
        }
        const authorityId = randomUuid();
        if (!enrollmentPatterns.uuidV4.test(authorityId)) {
          return undefined;
        }
        authoritySecret = randomSecret(randomBytes);
        if (authoritySecret === undefined) {
          return undefined;
        }
        const options = await createRecoveryOptions(authorityId, config.webauthnRpId);
        if (!base64Url32Pattern.test(options.challenge)) {
          return undefined;
        }
        const expiresAt = seconds + passkeyLifetimeSeconds;
        authorityVerifierDigest = createHash("sha256").update(authoritySecret).digest();
        challengeDigest = passkeyChallengeDigest(options.challenge);
        contextDigest = recoveryPasskeyContextDigest(
          authorityId,
          input.label,
          options.challenge,
          config.webauthnRpId,
          config.webauthnOrigin,
        );
        const challenge: RecoveryAuthorityChallenge = Object.freeze({
          authorityId,
          authoritySecret: authoritySecret.toString("base64url"),
          challenge: options.challenge,
          expiresAt,
          label: input.label,
          version: 1,
        });
        const recoveryCookie = cookieCodec.seal("recovery", challenge);
        const started = await database.startRecovery({
          authorityId,
          authorityVerifierDigest,
          challengeDigest,
          contextDigest,
          expiresAt: new Date(expiresAt * 1000).toISOString(),
          recoveryCodeId: recoveryCode.codeId,
        });
        return started ? Object.freeze({ options, recoveryCookie }) : undefined;
      } catch {
        return undefined;
      } finally {
        clearRecoveryCode(recoveryCode);
        authoritySecret?.fill(0);
        authorityVerifierDigest?.fill(0);
        challengeDigest?.fill(0);
        contextDigest?.fill(0);
      }
    },
    async beginPasskey(
      sessionCookie: string,
      body: unknown,
      enrollmentEnabled: unknown,
    ): Promise<PasskeyOptionsDecision | undefined> {
      if (enrollmentEnabled !== true) {
        return undefined;
      }
      const session = readSession(sessionCookie);
      const start = readInitialPasskeyStartBody(body);
      const seconds = currentSeconds();
      if (
        session === undefined ||
        session.passkeyRegistered ||
        start === undefined ||
        seconds === undefined
      ) {
        return undefined;
      }
      let sessionVerifier: Buffer | undefined;
      let sessionDigest: Buffer | undefined;
      let challengeDigest: Buffer | undefined;
      let contextDigest: Buffer | undefined;
      try {
        const options = await createOptions(session.profileId, start.handle, config.webauthnRpId);
        if (!base64Url32Pattern.test(options.challenge)) {
          return undefined;
        }
        sessionVerifier = digestBase64Url(session.sessionVerifier);
        if (sessionVerifier === undefined) {
          return undefined;
        }
        sessionDigest = createHash("sha256").update(sessionVerifier).digest();
        challengeDigest = passkeyChallengeDigest(options.challenge);
        contextDigest = passkeyContextDigest(
          session.profileId,
          start.handle,
          config.webauthnRpId,
          config.webauthnOrigin,
        );
        const challengeId = randomUuid();
        if (!enrollmentPatterns.uuidV4.test(challengeId)) {
          return undefined;
        }
        const expiresAt = seconds + passkeyLifetimeSeconds;
        const challenge: InitialPasskeyChallenge = Object.freeze({
          challenge: options.challenge,
          challengeId,
          expiresAt,
          handle: start.handle,
          version: 1,
        });
        const sealedChallenge = cookieCodec.seal("passkey", challenge);
        const created = await database.createPasskeyChallenge({
          challengeDigest,
          challengeId,
          contextDigest,
          expiresAt: new Date(expiresAt * 1000).toISOString(),
          handle: start.handle,
          sessionId: session.sessionId,
          sessionVerifierDigest: sessionDigest,
        });
        if (!created) {
          return undefined;
        }
        return Object.freeze({
          options,
          passkeyCookie: sealedChallenge,
        });
      } catch {
        return undefined;
      } finally {
        sessionVerifier?.fill(0);
        sessionDigest?.fill(0);
        challengeDigest?.fill(0);
        contextDigest?.fill(0);
      }
    },
    async beginPasskeyAdd(
      sessionCookie: string,
      body: unknown,
    ): Promise<PasskeyAddOptionsDecision | undefined> {
      const session = readSession(sessionCookie);
      const addition = readPasskeyAddStartBody(body);
      const seconds = currentSeconds();
      if (!session?.passkeyRegistered || addition === undefined || seconds === undefined) {
        return undefined;
      }
      let sessionVerifier: Buffer | undefined;
      let sessionDigest: Buffer | undefined;
      let challengeDigest: Buffer | undefined;
      let contextDigest: Buffer | undefined;
      try {
        const authenticationOptions = await createLoginOptions(config.webauthnRpId);
        const registrationOptions = await createOptions(
          session.profileId,
          session.handle,
          config.webauthnRpId,
        );
        if (
          !base64Url32Pattern.test(authenticationOptions.challenge) ||
          !base64Url32Pattern.test(registrationOptions.challenge) ||
          authenticationOptions.challenge === registrationOptions.challenge
        ) {
          return undefined;
        }
        sessionVerifier = digestBase64Url(session.sessionVerifier);
        if (sessionVerifier === undefined) {
          return undefined;
        }
        sessionDigest = createHash("sha256").update(sessionVerifier).digest();
        challengeDigest = passkeyChallengeDigest(authenticationOptions.challenge);
        contextDigest = passkeyAddContextDigest(
          session.sessionId,
          session.profileId,
          session.handle,
          addition.label,
          registrationOptions.challenge,
          config.webauthnRpId,
          config.webauthnOrigin,
        );
        const challengeId = randomUuid();
        if (!enrollmentPatterns.uuidV4.test(challengeId)) {
          return undefined;
        }
        const expiresAt = seconds + passkeyLifetimeSeconds;
        const challenge: PasskeyAddChallenge = Object.freeze({
          authenticationChallenge: authenticationOptions.challenge,
          challengeId,
          expiresAt,
          label: addition.label,
          registrationChallenge: registrationOptions.challenge,
          version: 1,
        });
        const passkeyAddCookie = cookieCodec.seal("passkey", challenge);
        const created = await database.createPasskeyAddChallenge({
          challengeDigest,
          challengeId,
          contextDigest,
          expiresAt: new Date(expiresAt * 1000).toISOString(),
          sessionId: session.sessionId,
          sessionVerifierDigest: sessionDigest,
        });
        return created
          ? Object.freeze({ authenticationOptions, passkeyAddCookie, registrationOptions })
          : undefined;
      } catch {
        return undefined;
      } finally {
        sessionVerifier?.fill(0);
        sessionDigest?.fill(0);
        challengeDigest?.fill(0);
        contextDigest?.fill(0);
      }
    },
    async beginPasskeyRevoke(
      sessionCookie: string,
      body: unknown,
    ): Promise<PasskeyRevokeOptionsDecision | undefined> {
      const session = readSession(sessionCookie);
      const target = readPasskeyRevokeTargetBody(body);
      const seconds = currentSeconds();
      if (!session?.passkeyRegistered || target === undefined || seconds === undefined) {
        return undefined;
      }
      let sessionVerifier: Buffer | undefined;
      let sessionDigest: Buffer | undefined;
      let challengeDigest: Buffer | undefined;
      let contextDigest: Buffer | undefined;
      try {
        sessionVerifier = digestBase64Url(session.sessionVerifier);
        if (sessionVerifier === undefined) {
          return undefined;
        }
        sessionDigest = createHash("sha256").update(sessionVerifier).digest();
        const inventory = await database.readPasskeyInventory({
          sessionId: session.sessionId,
          sessionVerifierDigest: sessionDigest,
        });
        const targetPasskey = inventory.find((passkey) => passkey.passkeyId === target.passkeyId);
        if (targetPasskey?.state !== "active" || targetPasskey.currentAuthenticator) {
          return undefined;
        }
        const options = await createLoginOptions(config.webauthnRpId);
        if (!base64Url32Pattern.test(options.challenge)) {
          return undefined;
        }
        const challengeId = randomUuid();
        if (!enrollmentPatterns.uuidV4.test(challengeId)) {
          return undefined;
        }
        const expiresAt = seconds + passkeyLifetimeSeconds;
        challengeDigest = passkeyChallengeDigest(options.challenge);
        contextDigest = passkeyRevokeContextDigest(
          session.sessionId,
          target.passkeyId,
          config.webauthnRpId,
          config.webauthnOrigin,
        );
        const challenge: PasskeyRevokeChallenge = Object.freeze({
          challenge: options.challenge,
          challengeId,
          expiresAt,
          targetPasskeyId: target.passkeyId,
          version: 1,
        });
        const passkeyRevokeCookie = cookieCodec.seal("passkey", challenge);
        const created = await database.createPasskeyRevokeChallenge({
          challengeDigest,
          challengeId,
          contextDigest,
          expiresAt: new Date(expiresAt * 1000).toISOString(),
          sessionId: session.sessionId,
          sessionVerifierDigest: sessionDigest,
        });
        return created ? Object.freeze({ options, passkeyRevokeCookie }) : undefined;
      } catch {
        return undefined;
      } finally {
        sessionVerifier?.fill(0);
        sessionDigest?.fill(0);
        challengeDigest?.fill(0);
        contextDigest?.fill(0);
      }
    },
    async beginRecoveryCodeRotation(
      sessionCookie: string,
    ): Promise<RecoveryCodeOptionsDecision | undefined> {
      const session = readSession(sessionCookie);
      const seconds = currentSeconds();
      if (!session?.passkeyRegistered || seconds === undefined) {
        return undefined;
      }
      let sessionVerifier: Buffer | undefined;
      let sessionDigest: Buffer | undefined;
      let challengeDigest: Buffer | undefined;
      let contextDigest: Buffer | undefined;
      try {
        const options = await createLoginOptions(config.webauthnRpId);
        if (!base64Url32Pattern.test(options.challenge)) {
          return undefined;
        }
        sessionVerifier = digestBase64Url(session.sessionVerifier);
        if (sessionVerifier === undefined) {
          return undefined;
        }
        const challengeId = randomUuid();
        if (!enrollmentPatterns.uuidV4.test(challengeId)) {
          return undefined;
        }
        const expiresAt = seconds + passkeyLifetimeSeconds;
        sessionDigest = createHash("sha256").update(sessionVerifier).digest();
        challengeDigest = passkeyChallengeDigest(options.challenge);
        contextDigest = recoveryCodeRotationContextDigest(
          session.sessionId,
          session.profileId,
          config.webauthnRpId,
          config.webauthnOrigin,
        );
        const recoveryCodeCookie = cookieCodec.seal("passkey", {
          challenge: options.challenge,
          challengeId,
          expiresAt,
          version: 1,
        } satisfies PasskeyRegistrationChallenge);
        const created = await database.createRecoveryCodeChallenge({
          challengeDigest,
          challengeId,
          contextDigest,
          expiresAt: new Date(expiresAt * 1000).toISOString(),
          sessionId: session.sessionId,
          sessionVerifierDigest: sessionDigest,
        });
        return created ? Object.freeze({ options, recoveryCodeCookie }) : undefined;
      } catch {
        return undefined;
      } finally {
        sessionVerifier?.fill(0);
        sessionDigest?.fill(0);
        challengeDigest?.fill(0);
        contextDigest?.fill(0);
      }
    },
    async beginProfileDeletion(
      sessionCookie: string,
      body: unknown,
    ): Promise<ProfileDeletionOptionsDecision | undefined> {
      const session = readSession(sessionCookie);
      const target = readProfileDeletionStartBody(body);
      const seconds = currentSeconds();
      if (
        !session?.passkeyRegistered ||
        target?.handle !== session.handle ||
        seconds === undefined
      ) {
        return undefined;
      }
      let sessionVerifier: Buffer | undefined;
      let sessionDigest: Buffer | undefined;
      let challengeDigest: Buffer | undefined;
      let contextDigest: Buffer | undefined;
      try {
        sessionVerifier = digestBase64Url(session.sessionVerifier);
        if (sessionVerifier === undefined) {
          return undefined;
        }
        const options = await createLoginOptions(config.webauthnRpId);
        if (!base64Url32Pattern.test(options.challenge)) {
          return undefined;
        }
        const challengeId = randomUuid();
        if (!enrollmentPatterns.uuidV4.test(challengeId)) {
          return undefined;
        }
        const expiresAt = seconds + passkeyLifetimeSeconds;
        sessionDigest = createHash("sha256").update(sessionVerifier).digest();
        challengeDigest = passkeyChallengeDigest(options.challenge);
        contextDigest = profileDeletionContextDigest(
          session.sessionId,
          session.profileId,
          session.handle,
          config.webauthnRpId,
          config.webauthnOrigin,
        );
        const challenge: ProfileDeletionChallenge = Object.freeze({
          challenge: options.challenge,
          challengeId,
          expiresAt,
          handle: session.handle,
          version: 1,
        });
        const profileDeletionCookie = cookieCodec.seal("passkey", challenge);
        const created = await database.createProfileDeletionChallenge({
          challengeDigest,
          challengeId,
          contextDigest,
          expiresAt: new Date(expiresAt * 1000).toISOString(),
          sessionId: session.sessionId,
          sessionVerifierDigest: sessionDigest,
        });
        return created ? Object.freeze({ options, profileDeletionCookie }) : undefined;
      } catch {
        return undefined;
      } finally {
        sessionVerifier?.fill(0);
        sessionDigest?.fill(0);
        challengeDigest?.fill(0);
        contextDigest?.fill(0);
      }
    },
    cancelGithub(state: string, oauthCookie: string): boolean {
      const seconds = currentSeconds();
      if (seconds === undefined) {
        return false;
      }
      try {
        const pending = readPendingEnrollment(cookieCodec.open("oauth", oauthCookie), seconds);
        return pending !== undefined && sameState(pending.state, state);
      } catch {
        return false;
      }
    },
    async completeGithub(
      code: string,
      state: string,
      oauthCookie: string,
      signal: AbortSignal,
      enrollmentEnabled: unknown,
      inviteGateEnabled: unknown,
    ): Promise<EnrollmentCallbackDecision | undefined> {
      if (enrollmentEnabled !== true) {
        return undefined;
      }
      const seconds = currentSeconds();
      if (seconds === undefined) {
        return undefined;
      }
      const pending = readPendingEnrollment(cookieCodec.open("oauth", oauthCookie), seconds);
      if (pending === undefined || !sameState(pending.state, state)) {
        return undefined;
      }
      let inviteDigest: Buffer | undefined;
      let sessionSecret: Buffer | undefined;
      let sessionDigest: Buffer | undefined;
      try {
        const githubUserId = await exchangeGithub(config, code, pending.codeVerifier, signal);
        if (githubUserId === undefined) {
          return undefined;
        }
        inviteDigest =
          pending.inviteDigest === undefined ? undefined : digestBase64Url(pending.inviteDigest);
        sessionSecret = randomSecret(randomBytes);
        if (
          sessionSecret === undefined ||
          (inviteGateEnabled === true) !== (inviteDigest !== undefined) ||
          (inviteGateEnabled === true) !== (pending.inviteId !== undefined)
        ) {
          return undefined;
        }
        sessionDigest = createHash("sha256").update(sessionSecret).digest();
        const profileId = randomUuid();
        const handle = provisionalHandle(profileId);
        const sessionId = randomUuid();
        if (
          !enrollmentPatterns.uuidV4.test(profileId) ||
          handle === undefined ||
          !enrollmentPatterns.uuidV4.test(sessionId)
        ) {
          return undefined;
        }
        const expiresAt = seconds + pendingSessionLifetimeSeconds;
        const provisionalSession: EnrollmentSession = Object.freeze({
          expiresAt,
          handle,
          locale: pending.locale,
          passkeyRegistered: false,
          profileId,
          sessionId,
          sessionVerifier: sessionSecret.toString("base64url"),
          version: 1,
        });
        const provisionalSessionCookie = cookieCodec.seal("session", provisionalSession);
        const opened = await database.enrollProfile({
          githubUserId,
          handle,
          ...(pending.inviteId === undefined ? {} : { inviteId: pending.inviteId }),
          inviteRequired: inviteGateEnabled === true,
          ...(inviteDigest === undefined ? {} : { inviteVerifierDigest: inviteDigest }),
          locale: pending.locale,
          profileId,
          sessionExpiresAt: new Date(expiresAt * 1000).toISOString(),
          sessionId,
          sessionVerifierDigest: sessionDigest,
        });
        if (!opened.sessionCreated) {
          return opened.profileState === "active"
            ? Object.freeze({ outcome: "existing_profile" })
            : undefined;
        }
        const session: EnrollmentSession = Object.freeze({
          expiresAt,
          handle: opened.handle,
          locale: opened.locale,
          passkeyRegistered: false,
          profileId: opened.profileId,
          sessionId,
          sessionVerifier: sessionSecret.toString("base64url"),
          version: 1,
        });
        return Object.freeze({
          outcome: "continue",
          sessionCookie:
            opened.profileId === profileId &&
            opened.handle === handle &&
            opened.locale === pending.locale
              ? provisionalSessionCookie
              : cookieCodec.seal("session", session),
        });
      } catch {
        return undefined;
      } finally {
        inviteDigest?.fill(0);
        sessionSecret?.fill(0);
        sessionDigest?.fill(0);
      }
    },
    async completeLogin(
      loginCookie: string,
      body: unknown,
    ): Promise<PasskeyLoginCompletionDecision | undefined> {
      const seconds = currentSeconds();
      const authentication = readAuthenticationBody(body);
      const challenge =
        seconds === undefined
          ? undefined
          : readPasskeyChallenge(cookieCodec.open("login", loginCookie), seconds);
      if (seconds === undefined || authentication === undefined || challenge === undefined) {
        return undefined;
      }
      let credentialId: Buffer | undefined;
      let material: PasskeyLoginMaterial | undefined;
      let sessionSecret: Buffer | undefined;
      let sessionDigest: Buffer | undefined;
      let challengeDigest: Buffer | undefined;
      let contextDigest: Buffer | undefined;
      try {
        credentialId = passkeyLoginCredentialId(authentication.response);
        if (credentialId === undefined) {
          return undefined;
        }
        material = await database.readPasskeyLoginMaterial(credentialId);
        if (material === undefined) {
          return undefined;
        }
        const verified = await verifyLogin(
          authentication.response,
          challenge.challenge,
          config.webauthnOrigin,
          config.webauthnRpId,
          {
            backupEligible: material.backupEligible,
            cosePublicKey: material.cosePublicKey,
            credentialId,
            signCount: material.signCount,
          },
        );
        if (verified === undefined) {
          return undefined;
        }
        sessionSecret = randomSecret(randomBytes);
        if (sessionSecret === undefined) {
          return undefined;
        }
        sessionDigest = createHash("sha256").update(sessionSecret).digest();
        challengeDigest = passkeyChallengeDigest(challenge.challenge);
        contextDigest = passkeyLoginContextDigest(config.webauthnRpId, config.webauthnOrigin);
        const sessionId = randomUuid();
        if (!enrollmentPatterns.uuidV4.test(sessionId)) {
          return undefined;
        }
        const expiresAt = seconds + activeSessionLifetimeSeconds;
        const profile = await database.completePasskeyLogin({
          backupState: verified.backupState,
          challengeDigest,
          challengeExpiresAt: new Date(challenge.expiresAt * 1000).toISOString(),
          challengeId: challenge.challengeId,
          contextDigest,
          credentialId,
          observedSignCount: verified.signCount,
          passkeyId: material.passkeyId,
          sessionExpiresAt: new Date(expiresAt * 1000).toISOString(),
          sessionId,
          sessionVerifierDigest: sessionDigest,
        });
        const session: EnrollmentSession = Object.freeze({
          expiresAt,
          handle: profile.handle,
          locale: profile.locale,
          passkeyRegistered: true,
          profileId: profile.profileId,
          sessionId,
          sessionVerifier: sessionSecret.toString("base64url"),
          version: 1,
        });
        try {
          return Object.freeze({ sessionCookie: cookieCodec.seal("session", session) });
        } catch {
          await database.revokeSession({
            sessionId,
            sessionVerifierDigest: sessionDigest,
          });
          return undefined;
        }
      } catch {
        return undefined;
      } finally {
        credentialId?.fill(0);
        clearLoginMaterial(material);
        sessionSecret?.fill(0);
        sessionDigest?.fill(0);
        challengeDigest?.fill(0);
        contextDigest?.fill(0);
      }
    },
    async completeRecovery(
      recoveryCookie: string,
      body: unknown,
    ): Promise<RecoveryCompletionDecision | undefined> {
      const seconds = currentSeconds();
      const registration = readAuthenticationBody(body);
      const challenge =
        seconds === undefined
          ? undefined
          : readRecoveryAuthorityChallenge(cookieCodec.open("recovery", recoveryCookie), seconds);
      if (seconds === undefined || registration === undefined || challenge === undefined) {
        return undefined;
      }
      let registered: RegisteredPasskey | undefined;
      let authoritySecret: Buffer | undefined;
      let authorityVerifierDigest: Buffer | undefined;
      let sessionSecret: Buffer | undefined;
      let sessionDigest: Buffer | undefined;
      let challengeDigest: Buffer | undefined;
      let contextDigest: Buffer | undefined;
      try {
        registered = await verifyPasskey(
          registration.response,
          challenge.challenge,
          config.webauthnOrigin,
          config.webauthnRpId,
        );
        authoritySecret = digestBase64Url(challenge.authoritySecret);
        sessionSecret = randomSecret(randomBytes);
        if (
          registered === undefined ||
          authoritySecret === undefined ||
          sessionSecret === undefined
        ) {
          return undefined;
        }
        const passkeyId = randomUuid();
        const sessionId = randomUuid();
        const generatedIds = [passkeyId, sessionId];
        if (
          generatedIds.some((id) => !enrollmentPatterns.uuidV4.test(id)) ||
          new Set([...generatedIds, challenge.authorityId]).size !== generatedIds.length + 1
        ) {
          return undefined;
        }
        const expiresAt = seconds + activeSessionLifetimeSeconds;
        authorityVerifierDigest = createHash("sha256").update(authoritySecret).digest();
        sessionDigest = createHash("sha256").update(sessionSecret).digest();
        challengeDigest = passkeyChallengeDigest(challenge.challenge);
        contextDigest = recoveryPasskeyContextDigest(
          challenge.authorityId,
          challenge.label,
          challenge.challenge,
          config.webauthnRpId,
          config.webauthnOrigin,
        );
        const profile = await database.completeRecoveryRegistration({
          authorityId: challenge.authorityId,
          authorityVerifierDigest,
          backupEligible: registered.backupEligible,
          backupState: registered.backupState,
          challengeDigest,
          contextDigest,
          cosePublicKey: registered.cosePublicKey,
          credentialId: registered.credentialId,
          label: challenge.label,
          passkeyId,
          sessionExpiresAt: new Date(expiresAt * 1000).toISOString(),
          sessionId,
          sessionVerifierDigest: sessionDigest,
          signCount: registered.signCount,
        });
        const session: EnrollmentSession = Object.freeze({
          expiresAt,
          handle: profile.handle,
          locale: profile.locale,
          passkeyRegistered: true,
          profileId: profile.profileId,
          sessionId,
          sessionVerifier: sessionSecret.toString("base64url"),
          version: 1,
        });
        try {
          return Object.freeze({ sessionCookie: cookieCodec.seal("session", session) });
        } catch {
          await database.revokeSession({
            sessionId,
            sessionVerifierDigest: sessionDigest,
          });
          return undefined;
        }
      } catch {
        return undefined;
      } finally {
        clearRegisteredPasskey(registered);
        authoritySecret?.fill(0);
        authorityVerifierDigest?.fill(0);
        sessionSecret?.fill(0);
        sessionDigest?.fill(0);
        challengeDigest?.fill(0);
        contextDigest?.fill(0);
      }
    },
    async completePasskey(
      sessionCookie: string,
      passkeyCookie: string,
      body: unknown,
      enrollmentEnabled: unknown,
    ): Promise<PasskeyCompletionDecision | undefined> {
      if (enrollmentEnabled !== true) {
        return undefined;
      }
      const session = readSession(sessionCookie);
      const seconds = currentSeconds();
      const registration = readRegistrationBody(body);
      const challenge =
        seconds === undefined
          ? undefined
          : readInitialPasskeyChallenge(cookieCodec.open("passkey", passkeyCookie), seconds);
      if (
        session === undefined ||
        session.passkeyRegistered ||
        seconds === undefined ||
        registration === undefined ||
        challenge === undefined
      ) {
        return undefined;
      }
      let passkey: RegisteredPasskey | undefined;
      let sessionVerifier: Buffer | undefined;
      let sessionDigest: Buffer | undefined;
      let rotatedSessionSecret: Buffer | undefined;
      let rotatedSessionDigest: Buffer | undefined;
      let challengeDigest: Buffer | undefined;
      let contextDigest: Buffer | undefined;
      try {
        passkey = await verifyPasskey(
          registration.response,
          challenge.challenge,
          config.webauthnOrigin,
          config.webauthnRpId,
        );
        sessionVerifier = digestBase64Url(session.sessionVerifier);
        if (passkey === undefined || sessionVerifier === undefined) {
          return undefined;
        }
        sessionDigest = createHash("sha256").update(sessionVerifier).digest();
        rotatedSessionSecret = randomSecret(randomBytes);
        if (
          rotatedSessionSecret === undefined ||
          timingSafeEqual(sessionVerifier, rotatedSessionSecret)
        ) {
          return undefined;
        }
        rotatedSessionDigest = createHash("sha256").update(rotatedSessionSecret).digest();
        challengeDigest = passkeyChallengeDigest(challenge.challenge);
        contextDigest = passkeyContextDigest(
          session.profileId,
          challenge.handle,
          config.webauthnRpId,
          config.webauthnOrigin,
        );
        const passkeyId = randomUuid();
        const rotatedSessionId = randomUuid();
        const generatedIds = [passkeyId, rotatedSessionId];
        if (
          generatedIds.some((id) => !enrollmentPatterns.uuidV4.test(id)) ||
          new Set(generatedIds).size !== generatedIds.length ||
          rotatedSessionId === session.sessionId
        ) {
          return undefined;
        }
        const activeSessionExpiresAt = seconds + activeSessionLifetimeSeconds;
        const sealedSession = cookieCodec.seal("session", {
          ...session,
          expiresAt: activeSessionExpiresAt,
          handle: challenge.handle,
          passkeyRegistered: true,
          sessionId: rotatedSessionId,
          sessionVerifier: rotatedSessionSecret.toString("base64url"),
        } satisfies EnrollmentSession);
        const completed = await database.completeInitialPasskey({
          backupEligible: passkey.backupEligible,
          backupState: passkey.backupState,
          challengeId: challenge.challengeId,
          contextDigest,
          cosePublicKey: passkey.cosePublicKey,
          credentialId: passkey.credentialId,
          handle: challenge.handle,
          passkeyId,
          rotatedSessionExpiresAt: new Date(activeSessionExpiresAt * 1000).toISOString(),
          rotatedSessionId,
          rotatedSessionVerifierDigest: rotatedSessionDigest,
          sessionId: session.sessionId,
          sessionVerifierDigest: sessionDigest,
          signCount: passkey.signCount,
        });
        return completed ? Object.freeze({ sessionCookie: sealedSession }) : undefined;
      } catch {
        return undefined;
      } finally {
        clearRegisteredPasskey(passkey);
        sessionVerifier?.fill(0);
        sessionDigest?.fill(0);
        rotatedSessionSecret?.fill(0);
        rotatedSessionDigest?.fill(0);
        challengeDigest?.fill(0);
        contextDigest?.fill(0);
      }
    },
    async completePasskeyAdd(
      sessionCookie: string,
      passkeyAddCookie: string,
      body: unknown,
    ): Promise<boolean> {
      const session = readSession(sessionCookie);
      const seconds = currentSeconds();
      const addition = readPasskeyAddBody(body);
      const challenge =
        seconds === undefined
          ? undefined
          : readPasskeyAddChallenge(cookieCodec.open("passkey", passkeyAddCookie), seconds);
      if (
        !session?.passkeyRegistered ||
        seconds === undefined ||
        addition === undefined ||
        challenge === undefined
      ) {
        return false;
      }
      let authenticationCredentialId: Buffer | undefined;
      let material: PasskeyLoginMaterial | undefined;
      let passkey: RegisteredPasskey | undefined;
      let sessionVerifier: Buffer | undefined;
      let sessionDigest: Buffer | undefined;
      let challengeDigest: Buffer | undefined;
      let contextDigest: Buffer | undefined;
      try {
        authenticationCredentialId = passkeyLoginCredentialId(addition.authentication);
        sessionVerifier = digestBase64Url(session.sessionVerifier);
        if (authenticationCredentialId === undefined || sessionVerifier === undefined) {
          return false;
        }
        material = await database.readPasskeyLoginMaterial(authenticationCredentialId);
        if (material === undefined) {
          return false;
        }
        const verified = await verifyLogin(
          addition.authentication,
          challenge.authenticationChallenge,
          config.webauthnOrigin,
          config.webauthnRpId,
          {
            backupEligible: material.backupEligible,
            cosePublicKey: material.cosePublicKey,
            credentialId: authenticationCredentialId,
            signCount: material.signCount,
          },
        );
        if (verified === undefined) {
          return false;
        }
        passkey = await verifyPasskey(
          addition.registration,
          challenge.registrationChallenge,
          config.webauthnOrigin,
          config.webauthnRpId,
        );
        if (passkey === undefined) {
          return false;
        }
        const passkeyId = randomUuid();
        if (!enrollmentPatterns.uuidV4.test(passkeyId)) {
          return false;
        }
        sessionDigest = createHash("sha256").update(sessionVerifier).digest();
        challengeDigest = passkeyChallengeDigest(challenge.authenticationChallenge);
        contextDigest = passkeyAddContextDigest(
          session.sessionId,
          session.profileId,
          session.handle,
          challenge.label,
          challenge.registrationChallenge,
          config.webauthnRpId,
          config.webauthnOrigin,
        );
        return await database.completePasskeyAddition({
          backupEligible: passkey.backupEligible,
          backupState: passkey.backupState,
          challengeId: challenge.challengeId,
          contextDigest,
          cosePublicKey: passkey.cosePublicKey,
          credentialId: passkey.credentialId,
          label: challenge.label,
          observedSignCount: verified.signCount,
          passkeyId,
          sessionId: session.sessionId,
          sessionVerifierDigest: sessionDigest,
          signCount: passkey.signCount,
          verifiedBackupState: verified.backupState,
          verifiedPasskeyId: material.passkeyId,
        });
      } catch {
        return false;
      } finally {
        authenticationCredentialId?.fill(0);
        clearLoginMaterial(material);
        clearRegisteredPasskey(passkey);
        sessionVerifier?.fill(0);
        sessionDigest?.fill(0);
        challengeDigest?.fill(0);
        contextDigest?.fill(0);
      }
    },
    async completePasskeyRevoke(
      sessionCookie: string,
      passkeyRevokeCookie: string,
      body: unknown,
    ): Promise<boolean> {
      const session = readSession(sessionCookie);
      const seconds = currentSeconds();
      const authentication = readAuthenticationBody(body);
      const challenge =
        seconds === undefined
          ? undefined
          : readPasskeyRevokeChallenge(cookieCodec.open("passkey", passkeyRevokeCookie), seconds);
      if (
        !session?.passkeyRegistered ||
        seconds === undefined ||
        authentication === undefined ||
        challenge === undefined
      ) {
        return false;
      }
      let credentialId: Buffer | undefined;
      let material: PasskeyLoginMaterial | undefined;
      let sessionVerifier: Buffer | undefined;
      let sessionDigest: Buffer | undefined;
      let challengeDigest: Buffer | undefined;
      let contextDigest: Buffer | undefined;
      try {
        credentialId = passkeyLoginCredentialId(authentication.response);
        sessionVerifier = digestBase64Url(session.sessionVerifier);
        if (credentialId === undefined || sessionVerifier === undefined) {
          return false;
        }
        material = await database.readPasskeyLoginMaterial(credentialId);
        if (material === undefined) {
          return false;
        }
        const verified = await verifyLogin(
          authentication.response,
          challenge.challenge,
          config.webauthnOrigin,
          config.webauthnRpId,
          {
            backupEligible: material.backupEligible,
            cosePublicKey: material.cosePublicKey,
            credentialId,
            signCount: material.signCount,
          },
        );
        if (verified === undefined) {
          return false;
        }
        sessionDigest = createHash("sha256").update(sessionVerifier).digest();
        challengeDigest = passkeyChallengeDigest(challenge.challenge);
        contextDigest = passkeyRevokeContextDigest(
          session.sessionId,
          challenge.targetPasskeyId,
          config.webauthnRpId,
          config.webauthnOrigin,
        );
        return await database.completePasskeyRevocation({
          backupState: verified.backupState,
          challengeId: challenge.challengeId,
          contextDigest,
          observedSignCount: verified.signCount,
          sessionId: session.sessionId,
          sessionVerifierDigest: sessionDigest,
          targetPasskeyId: challenge.targetPasskeyId,
          verifiedPasskeyId: material.passkeyId,
        });
      } catch {
        return false;
      } finally {
        credentialId?.fill(0);
        clearLoginMaterial(material);
        sessionVerifier?.fill(0);
        sessionDigest?.fill(0);
        challengeDigest?.fill(0);
        contextDigest?.fill(0);
      }
    },
    async completeRecoveryCodeRotation(
      sessionCookie: string,
      recoveryCodeCookie: string,
      body: unknown,
    ): Promise<RecoveryCodeCompletionDecision | undefined> {
      const session = readSession(sessionCookie);
      const seconds = currentSeconds();
      const authentication = readAuthenticationBody(body);
      const challenge =
        seconds === undefined
          ? undefined
          : readPasskeyChallenge(cookieCodec.open("passkey", recoveryCodeCookie), seconds);
      if (
        !session?.passkeyRegistered ||
        seconds === undefined ||
        authentication === undefined ||
        challenge === undefined
      ) {
        return undefined;
      }
      let credentialId: Buffer | undefined;
      let material: PasskeyLoginMaterial | undefined;
      let sessionVerifier: Buffer | undefined;
      let sessionDigest: Buffer | undefined;
      let challengeDigest: Buffer | undefined;
      let contextDigest: Buffer | undefined;
      try {
        credentialId = passkeyLoginCredentialId(authentication.response);
        sessionVerifier = digestBase64Url(session.sessionVerifier);
        if (credentialId === undefined || sessionVerifier === undefined) {
          return undefined;
        }
        material = await database.readPasskeyLoginMaterial(credentialId);
        if (material === undefined) {
          return undefined;
        }
        const verified = await verifyLogin(
          authentication.response,
          challenge.challenge,
          config.webauthnOrigin,
          config.webauthnRpId,
          {
            backupEligible: material.backupEligible,
            cosePublicKey: material.cosePublicKey,
            credentialId,
            signCount: material.signCount,
          },
        );
        if (verified === undefined) {
          return undefined;
        }
        const records = await generateRecoveryCodes();
        if (!validRecoveryCodeBatch(records, config)) {
          return undefined;
        }
        const batchId = randomUuid();
        const codeIds = new Set(records.map(({ codeId }) => codeId));
        if (
          !enrollmentPatterns.uuidV4.test(batchId) ||
          batchId === challenge.challengeId ||
          codeIds.has(batchId)
        ) {
          return undefined;
        }
        sessionDigest = createHash("sha256").update(sessionVerifier).digest();
        challengeDigest = passkeyChallengeDigest(challenge.challenge);
        contextDigest = recoveryCodeRotationContextDigest(
          session.sessionId,
          session.profileId,
          config.webauthnRpId,
          config.webauthnOrigin,
        );
        const replaced = await database.completeRecoveryCodeReplacement({
          backupState: verified.backupState,
          batchId,
          challengeId: challenge.challengeId,
          contextDigest,
          observedSignCount: verified.signCount,
          recoveryCodeIds: records.map(({ codeId }) => codeId),
          sessionId: session.sessionId,
          sessionVerifierDigest: sessionDigest,
          verifierPhcs: records.map(({ verifierPhc }) => verifierPhc),
          verifiedPasskeyId: material.passkeyId,
        });
        return replaced
          ? Object.freeze({
              recoveryCodes: Object.freeze(records.map(({ plaintext }) => plaintext)),
            })
          : undefined;
      } catch {
        return undefined;
      } finally {
        credentialId?.fill(0);
        clearLoginMaterial(material);
        sessionVerifier?.fill(0);
        sessionDigest?.fill(0);
        challengeDigest?.fill(0);
        contextDigest?.fill(0);
      }
    },
    async completeProfileDeletion(
      sessionCookie: string,
      profileDeletionCookie: string,
      body: unknown,
    ): Promise<boolean> {
      const session = readSession(sessionCookie);
      const seconds = currentSeconds();
      const authentication = readAuthenticationBody(body);
      const challenge =
        seconds === undefined
          ? undefined
          : readProfileDeletionChallenge(
              cookieCodec.open("passkey", profileDeletionCookie),
              seconds,
            );
      if (
        !session?.passkeyRegistered ||
        seconds === undefined ||
        authentication === undefined ||
        challenge?.handle !== session.handle
      ) {
        return false;
      }
      let credentialId: Buffer | undefined;
      let material: PasskeyLoginMaterial | undefined;
      let sessionVerifier: Buffer | undefined;
      let sessionDigest: Buffer | undefined;
      let challengeDigest: Buffer | undefined;
      let contextDigest: Buffer | undefined;
      try {
        credentialId = passkeyLoginCredentialId(authentication.response);
        sessionVerifier = digestBase64Url(session.sessionVerifier);
        if (credentialId === undefined || sessionVerifier === undefined) {
          return false;
        }
        material = await database.readPasskeyLoginMaterial(credentialId);
        if (material === undefined) {
          return false;
        }
        const verified = await verifyLogin(
          authentication.response,
          challenge.challenge,
          config.webauthnOrigin,
          config.webauthnRpId,
          {
            backupEligible: material.backupEligible,
            cosePublicKey: material.cosePublicKey,
            credentialId,
            signCount: material.signCount,
          },
        );
        if (verified === undefined) {
          return false;
        }
        sessionDigest = createHash("sha256").update(sessionVerifier).digest();
        challengeDigest = passkeyChallengeDigest(challenge.challenge);
        contextDigest = profileDeletionContextDigest(
          session.sessionId,
          session.profileId,
          session.handle,
          config.webauthnRpId,
          config.webauthnOrigin,
        );
        return await database.completeProfileDeletion({
          backupState: verified.backupState,
          challengeId: challenge.challengeId,
          contextDigest,
          observedSignCount: verified.signCount,
          sessionId: session.sessionId,
          sessionVerifierDigest: sessionDigest,
          typedHandle: challenge.handle,
          verifiedPasskeyId: material.passkeyId,
        });
      } catch {
        return false;
      } finally {
        credentialId?.fill(0);
        clearLoginMaterial(material);
        sessionVerifier?.fill(0);
        sessionDigest?.fill(0);
        challengeDigest?.fill(0);
        contextDigest?.fill(0);
      }
    },
    completeAccountTargetAction,
    async logout(sessionCookie: string | undefined): Promise<boolean> {
      const session = readSession(sessionCookie);
      if (session === undefined) {
        return true;
      }
      let sessionVerifier: Buffer | undefined;
      let sessionDigest: Buffer | undefined;
      try {
        sessionVerifier = digestBase64Url(session.sessionVerifier);
        if (sessionVerifier === undefined) {
          return true;
        }
        sessionDigest = createHash("sha256").update(sessionVerifier).digest();
        return await database.revokeSession({
          sessionId: session.sessionId,
          sessionVerifierDigest: sessionDigest,
        });
      } catch {
        return false;
      } finally {
        sessionVerifier?.fill(0);
        sessionDigest?.fill(0);
      }
    },
    async readAccountDashboard(sessionCookie: string): Promise<AccountDashboard | undefined> {
      const session = readSession(sessionCookie);
      const seconds = currentSeconds();
      if (!session?.passkeyRegistered || seconds === undefined) {
        return undefined;
      }
      let sessionVerifier: Buffer | undefined;
      let sessionDigest: Buffer | undefined;
      try {
        sessionVerifier = digestBase64Url(session.sessionVerifier);
        if (sessionVerifier === undefined) {
          return undefined;
        }
        sessionDigest = createHash("sha256").update(sessionVerifier).digest();
        const request = {
          sessionId: session.sessionId,
          sessionVerifierDigest: sessionDigest,
        };
        const [ranking, inventory]: [PrivateDashboardRanking, AgentAccountDashboardInventory] =
          await Promise.all([
            database.readPrivateDashboardRanking(request),
            database.readAgentAccountDashboard(request),
          ]);
        const expiresAt = Math.min(
          session.expiresAt,
          seconds + accountTargetControlLifetimeSeconds,
        );
        const sealControl = (targetKind: AccountTargetKind, targetId: string): string =>
          cookieCodec.seal("passkey", {
            expiresAt,
            sessionId: session.sessionId,
            targetId,
            targetKind,
            version: 1,
          } satisfies AccountTargetControl);
        const activeInstallationIds = new Set(
          inventory.installations
            .filter(({ state }) => state === "active")
            .map(({ installationId }) => installationId),
        );
        const accounts = inventory.accounts.map((account) =>
          Object.freeze({
            accountingRevision: account.accountingRevision,
            connectedDeviceCount: account.devices.filter(
              ({ installationId, state }) =>
                state === "active" && activeInstallationIds.has(installationId),
            ).length,
            control: sealControl("agent_account", account.agentAccountId),
            expectedReaderVersion: account.expectedReaderVersion,
            identityAssurance: account.identityAssurance,
            lastSuccessfulSyncDate: account.lastSuccessfulSyncDate,
            observedReaderVersion: account.observedReaderVersion,
            privateLabel: account.privateLabel,
            provider: account.provider,
            quarantineReason: account.quarantineReason,
            state: account.state,
            status: account.status,
            todayTokenTotal: account.todayTokenTotal,
            weeklyTokenTotal: account.weeklyTokenTotal,
          }),
        );
        const installations = inventory.installations.map((installation) =>
          Object.freeze({
            accounts: Object.freeze(
              installation.accounts.map((account) =>
                Object.freeze({
                  deviceControl:
                    installation.state === "active" && account.deviceState === "active"
                      ? sealControl("device", account.deviceId)
                      : null,
                  deviceState: account.deviceState,
                  privateLabel: account.privateLabel,
                }),
              ),
            ),
            architecture: installation.architecture,
            connectedDate: installation.connectedDate,
            connectorVersion: installation.connectorVersion,
            control: sealControl("installation", installation.installationId),
            label: installation.label,
            lastSeenDate: installation.lastSeenDate,
            osFamily: installation.osFamily,
            state: installation.state,
          }),
        );
        return Object.freeze({
          accounts: Object.freeze(accounts),
          installations: Object.freeze(installations),
          ranking,
        });
      } catch {
        return undefined;
      } finally {
        sessionVerifier?.fill(0);
        sessionDigest?.fill(0);
      }
    },
    async readPasskeyInventory(
      sessionCookie: string,
    ): Promise<readonly PasskeyInventoryItem[] | undefined> {
      const session = readSession(sessionCookie);
      if (!session?.passkeyRegistered) {
        return undefined;
      }
      let sessionVerifier: Buffer | undefined;
      let sessionDigest: Buffer | undefined;
      try {
        sessionVerifier = digestBase64Url(session.sessionVerifier);
        if (sessionVerifier === undefined) {
          return undefined;
        }
        sessionDigest = createHash("sha256").update(sessionVerifier).digest();
        return await database.readPasskeyInventory({
          sessionId: session.sessionId,
          sessionVerifierDigest: sessionDigest,
        });
      } catch {
        return undefined;
      } finally {
        sessionVerifier?.fill(0);
        sessionDigest?.fill(0);
      }
    },
    async readProfileVisibility(sessionCookie: string): Promise<ProfileVisibility | undefined> {
      const session = readSession(sessionCookie);
      if (!session?.passkeyRegistered) {
        return undefined;
      }
      let sessionVerifier: Buffer | undefined;
      let sessionDigest: Buffer | undefined;
      try {
        sessionVerifier = digestBase64Url(session.sessionVerifier);
        if (sessionVerifier === undefined) {
          return undefined;
        }
        sessionDigest = createHash("sha256").update(sessionVerifier).digest();
        return await database.readProfileVisibility({
          sessionId: session.sessionId,
          sessionVerifierDigest: sessionDigest,
        });
      } catch {
        return undefined;
      } finally {
        sessionVerifier?.fill(0);
        sessionDigest?.fill(0);
      }
    },
    readSession,
    async pauseAgentAccount(sessionCookie: string, targetControl: string): Promise<boolean> {
      const session = readSession(sessionCookie);
      const seconds = currentSeconds();
      if (!session?.passkeyRegistered || seconds === undefined) {
        return false;
      }
      const control = readAccountTargetControl(
        cookieCodec.open("passkey", targetControl),
        seconds,
        session.sessionId,
        "agent_account",
      );
      if (control === undefined) {
        return false;
      }
      let sessionVerifier: Buffer | undefined;
      let sessionDigest: Buffer | undefined;
      try {
        sessionVerifier = digestBase64Url(session.sessionVerifier);
        if (sessionVerifier === undefined) {
          return false;
        }
        sessionDigest = createHash("sha256").update(sessionVerifier).digest();
        return await database.pauseAgentAccount({
          agentAccountId: control.targetId,
          sessionId: session.sessionId,
          sessionVerifierDigest: sessionDigest,
        });
      } catch {
        return false;
      } finally {
        sessionVerifier?.fill(0);
        sessionDigest?.fill(0);
      }
    },
    async setProfileVisibility(
      sessionCookie: string,
      publiclyVisible: boolean,
    ): Promise<ProfileVisibility | undefined> {
      const session = readSession(sessionCookie);
      if (!session?.passkeyRegistered || typeof publiclyVisible !== "boolean") {
        return undefined;
      }
      let sessionVerifier: Buffer | undefined;
      let sessionDigest: Buffer | undefined;
      try {
        sessionVerifier = digestBase64Url(session.sessionVerifier);
        if (sessionVerifier === undefined) {
          return undefined;
        }
        sessionDigest = createHash("sha256").update(sessionVerifier).digest();
        return await database.setProfileVisibility({
          publiclyVisible,
          sessionId: session.sessionId,
          sessionVerifierDigest: sessionDigest,
        });
      } catch {
        return undefined;
      } finally {
        sessionVerifier?.fill(0);
        sessionDigest?.fill(0);
      }
    },
    async setProviderBreakdownVisibility(
      sessionCookie: string,
      providerBreakdownVisible: boolean,
    ): Promise<boolean | undefined> {
      const session = readSession(sessionCookie);
      if (!session?.passkeyRegistered || typeof providerBreakdownVisible !== "boolean") {
        return undefined;
      }
      let sessionVerifier: Buffer | undefined;
      let sessionDigest: Buffer | undefined;
      try {
        sessionVerifier = digestBase64Url(session.sessionVerifier);
        if (sessionVerifier === undefined) {
          return undefined;
        }
        sessionDigest = createHash("sha256").update(sessionVerifier).digest();
        return await database.setProviderBreakdownVisibility({
          providerBreakdownVisible,
          sessionId: session.sessionId,
          sessionVerifierDigest: sessionDigest,
        });
      } catch {
        return undefined;
      } finally {
        sessionVerifier?.fill(0);
        sessionDigest?.fill(0);
      }
    },
  });
}
