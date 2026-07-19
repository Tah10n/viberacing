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
  AccountOverview,
  ActiveDeviceInventoryItem,
  EnrollmentDatabase,
  PairingApprovalMaterial,
  PasskeyInventoryItem,
  PasskeyLoginMaterial,
  ProfileVisibility,
  SourceState,
} from "./enrollment-database";
import {
  enrollmentPatterns,
  readEnrollmentSession,
  readPasskeyAddChallenge,
  readPasskeyChallenge,
  readPairingApprovalChallenge,
  readPasskeyRevokeChallenge,
  readPendingEnrollment,
  readProfileDeletionChallenge,
  readRecoveryAuthorityChallenge,
  readSourceActionChallenge,
  type EnrollmentSession,
  type JoinRequest,
  type PasskeyAddChallenge,
  type PairingApprovalChallenge,
  type PasskeyRegistrationChallenge,
  type PasskeyRevokeChallenge,
  type PendingEnrollment,
  type ProfileDeletionChallenge,
  type RecoveryAuthorityChallenge,
  type SourceActionChallenge,
} from "./enrollment-domain";
import {
  createGithubOAuthMaterial,
  exchangeGithubUserId,
  githubAuthorizationUrl,
} from "./github-oauth";
import {
  createPasskeyLoginOptions,
  createPasskeyRegistrationOptions,
  createRecoveryPasskeyRegistrationOptions,
  passkeyChallengeDigest,
  passkeyAddContextDigest,
  pairingApprovalContextDigest,
  passkeyContextDigest,
  passkeyLoginContextDigest,
  passkeyLoginCredentialId,
  passkeyRevokeContextDigest,
  profileDeletionContextDigest,
  recoveryCodeRotationContextDigest,
  recoveryPasskeyContextDigest,
  sourceReactivationContextDigest,
  sourceUnlinkContextDigest,
  verifyInitialPasskey,
  verifyPasskeyLogin,
  type RegisteredPasskey,
} from "./passkey-registration";
import { currentCommunitySeasonStart } from "./public-community-race";
import { createPublicRequestId } from "./public-http-problem";
import type { PairingUserCodeVerifier } from "./pairing-user-code-verifier";
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
const sourceControlLifetimeSeconds = 15 * 60;
const base64Url32Pattern = /^[A-Za-z0-9_-]{43}$/;
const registrationBodyKeys = new Set(["label", "response"]);
const authenticationBodyKeys = new Set(["response"]);
const addStartBodyKeys = new Set(["label"]);
const addBodyKeys = new Set(["authentication", "registration"]);
const revokeTargetBodyKeys = new Set(["passkeyId"]);
const profileDeletionStartBodyKeys = new Set(["handle"]);
const recoveryStartBodyKeys = new Set(["code", "label"]);
const deviceIdPattern = /^dev_[A-Za-z0-9_-]{22}$/;
const sourceIdPattern = /^src_[A-Za-z0-9_-]{22}$/;
const sourceControlBodyKeys = new Set(["sourceControl"]);
const pairingNewSourceBodyKeys = new Set(["sourceChoice", "userCode"]);
const pairingExistingSourceBodyKeys = new Set(["sourceChoice", "sourceControl", "userCode"]);
const sourceControlKeys = new Set(["expiresAt", "sessionId", "sourceId", "version"]);
const unsafeLabelPattern = /[\p{Cc}\p{Cf}\p{Cs}]/u;
const recoveryCodePattern =
  /^vrr1_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})_[A-Za-z0-9_-]{43}$/;
const dummyRecoveryCodeId = "00000000-0000-4000-8000-000000000000";

export const enrollmentCookieNames = Object.freeze({
  login: "viberacing_login",
  oauth: "viberacing_oauth",
  pairingApproval: "viberacing_pairing_approval",
  passkey: "viberacing_passkey",
  passkeyAdd: "viberacing_passkey_add",
  passkeyRevoke: "viberacing_passkey_revoke",
  profileDeletion: "viberacing_profile_deletion",
  recovery: "viberacing_recovery",
  recoveryCodes: "viberacing_recovery_codes",
  session: "viberacing_session",
  sourceReactivation: "viberacing_source_reactivation",
  sourceUnlink: "viberacing_source_unlink",
});

export interface EnrollmentStartDecision {
  readonly oauthCookie: string;
  readonly redirectUrl: string;
}

export interface EnrollmentCallbackDecision {
  readonly sessionCookie: string;
}

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

export interface SourceReactivationOptionsDecision {
  readonly options: Awaited<ReturnType<typeof createPasskeyLoginOptions>>;
  readonly sourceReactivationCookie: string;
}

export interface SourceUnlinkOptionsDecision {
  readonly options: Awaited<ReturnType<typeof createPasskeyLoginOptions>>;
  readonly sourceUnlinkCookie: string;
}

export interface PairingApprovalDisplay {
  readonly architecture: "aarch64" | "x86_64";
  readonly connectorVersion: string;
  readonly deviceLabel: string;
  readonly expiresAt: string;
  readonly osFamily: "linux" | "macos" | "windows";
  readonly publicKeyFingerprint: string;
}

export interface PairingApprovalOptionsDecision {
  readonly options: Awaited<ReturnType<typeof createPasskeyLoginOptions>>;
  readonly pairing: PairingApprovalDisplay;
  readonly pairingApprovalCookie: string;
}

export interface AccountSourceDeviceInventoryItem {
  readonly devices: readonly ActiveDeviceInventoryItem[];
  readonly sourceControl: string;
  readonly state: SourceState;
}

export interface EnrollmentService {
  beginGithub(join: JoinRequest, enrollmentEnabled: unknown): EnrollmentStartDecision | undefined;
  beginLogin(): Promise<PasskeyLoginOptionsDecision | undefined>;
  beginPasskey(
    sessionCookie: string,
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
  beginPairingApproval(
    sessionCookie: string,
    body: unknown,
    sourceCreationEnabled: unknown,
  ): Promise<PairingApprovalOptionsDecision | undefined>;
  beginProfileDeletion(
    sessionCookie: string,
    body: unknown,
  ): Promise<ProfileDeletionOptionsDecision | undefined>;
  beginRecoveryCodeRotation(
    sessionCookie: string,
  ): Promise<RecoveryCodeOptionsDecision | undefined>;
  beginRecovery(body: unknown): Promise<RecoveryStartDecision | undefined>;
  beginSourceReactivation(
    sessionCookie: string,
    body: unknown,
  ): Promise<SourceReactivationOptionsDecision | undefined>;
  beginSourceUnlink(
    sessionCookie: string,
    body: unknown,
  ): Promise<SourceUnlinkOptionsDecision | undefined>;
  cancelGithub(state: string, oauthCookie: string): boolean;
  completeGithub(
    code: string,
    state: string,
    oauthCookie: string,
    signal: AbortSignal,
    enrollmentEnabled: unknown,
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
  completePairingApproval(
    sessionCookie: string,
    pairingApprovalCookie: string,
    body: unknown,
    sourceCreationEnabled: unknown,
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
  completeSourceReactivation(
    sessionCookie: string,
    sourceReactivationCookie: string,
    body: unknown,
  ): Promise<boolean>;
  completeSourceUnlink(
    sessionCookie: string,
    sourceUnlinkCookie: string,
    body: unknown,
  ): Promise<boolean>;
  logout(sessionCookie: string | undefined): Promise<boolean>;
  readAccountOverview(sessionCookie: string): Promise<AccountOverview | undefined>;
  readActiveDeviceInventory(
    sessionCookie: string,
  ): Promise<readonly AccountSourceDeviceInventoryItem[] | undefined>;
  readPasskeyInventory(sessionCookie: string): Promise<readonly PasskeyInventoryItem[] | undefined>;
  readProfileVisibility(sessionCookie: string): Promise<ProfileVisibility | undefined>;
  readSession(sessionCookie: string | undefined): EnrollmentSession | undefined;
  pauseSource(sessionCookie: string, sourceControl: string): Promise<boolean>;
  revokeDevice(sessionCookie: string, deviceId: string): Promise<boolean>;
  setProfileVisibility(
    sessionCookie: string,
    publiclyVisible: boolean,
  ): Promise<ProfileVisibility | undefined>;
}

interface EnrollmentServiceDependencies {
  readonly config: EnrollmentConfig;
  readonly cookieCodec: EnrollmentCookieCodec;
  readonly createOptions?: typeof createPasskeyRegistrationOptions;
  readonly createRecoveryOptions?: typeof createRecoveryPasskeyRegistrationOptions;
  readonly createLoginOptions?: typeof createPasskeyLoginOptions;
  readonly createRequestId?: () => string;
  readonly database: EnrollmentDatabase;
  readonly derivePairingCode: PairingUserCodeVerifier["derive"];
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
  readonly label: string;
  readonly response: unknown;
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

interface SourceControlBody {
  readonly sourceControl: string;
}

type PairingCodeBody =
  | Readonly<{
      sourceChoice: "new";
      userCode: unknown;
    }>
  | Readonly<{
      sourceChoice: "existing";
      sourceControl: string;
      userCode: unknown;
    }>;

interface SourceControl {
  readonly expiresAt: number;
  readonly sessionId: string;
  readonly sourceId: string;
  readonly version: 1;
}

type SourcePasskeyAction = "reactivation" | "unlink";

interface SourceActionOptionsDecision {
  readonly actionCookie: string;
  readonly options: Awaited<ReturnType<typeof createPasskeyLoginOptions>>;
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

function randomSourceId(randomBytes: EnrollmentRandomBytes): string | undefined {
  const entropy = Buffer.from(randomBytes(16));
  try {
    if (entropy.length !== 16) {
      return undefined;
    }
    const sourceId = `src_${entropy.toString("base64url")}`;
    return sourceIdPattern.test(sourceId) ? sourceId : undefined;
  } finally {
    entropy.fill(0);
  }
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
  const label = readPasskeyLabel(record.label);
  if (
    keys.length !== registrationBodyKeys.size ||
    keys.some((key) => !registrationBodyKeys.has(key)) ||
    label === undefined ||
    record.response === null ||
    typeof record.response !== "object" ||
    Array.isArray(record.response)
  ) {
    return undefined;
  }
  return Object.freeze({ label, response: record.response });
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

function readSourceControlBody(value: unknown): SourceControlBody | undefined {
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
    keys.length !== sourceControlBodyKeys.size ||
    keys.some((key) => !sourceControlBodyKeys.has(key)) ||
    typeof record.sourceControl !== "string" ||
    record.sourceControl.length < 1 ||
    record.sourceControl.length > 512
  ) {
    return undefined;
  }
  return Object.freeze({ sourceControl: record.sourceControl });
}

function readPairingCodeBody(value: unknown): PairingCodeBody | undefined {
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
  if (record.sourceChoice === "new") {
    return keys.length === pairingNewSourceBodyKeys.size &&
      keys.every((key) => pairingNewSourceBodyKeys.has(key))
      ? Object.freeze({ sourceChoice: "new", userCode: record.userCode })
      : undefined;
  }
  if (
    record.sourceChoice !== "existing" ||
    keys.length !== pairingExistingSourceBodyKeys.size ||
    keys.some((key) => !pairingExistingSourceBodyKeys.has(key)) ||
    typeof record.sourceControl !== "string" ||
    record.sourceControl.length < 1 ||
    record.sourceControl.length > 512
  ) {
    return undefined;
  }
  return Object.freeze({
    sourceChoice: "existing",
    sourceControl: record.sourceControl,
    userCode: record.userCode,
  });
}

function readSourceControl(
  value: unknown,
  nowSeconds: number,
  sessionId: string,
): SourceControl | undefined {
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
    keys.length !== sourceControlKeys.size ||
    keys.some((key) => !sourceControlKeys.has(key)) ||
    record.version !== 1 ||
    typeof record.sessionId !== "string" ||
    record.sessionId !== sessionId ||
    typeof record.sourceId !== "string" ||
    !sourceIdPattern.test(record.sourceId) ||
    !Number.isSafeInteger(record.expiresAt) ||
    Number(record.expiresAt) <= nowSeconds ||
    Number(record.expiresAt) > nowSeconds + sourceControlLifetimeSeconds
  ) {
    return undefined;
  }
  return Object.freeze(record as unknown as SourceControl);
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
    createRequestId = () => createPublicRequestId().value,
    derivePairingCode,
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

  async function beginPairingApproval(
    sessionCookie: string,
    body: unknown,
    sourceCreationEnabled: unknown,
  ): Promise<PairingApprovalOptionsDecision | undefined> {
    const session = readSession(sessionCookie);
    const pairingCode = readPairingCodeBody(body);
    const seconds = currentSeconds();
    if (
      !session?.passkeyRegistered ||
      pairingCode === undefined ||
      seconds === undefined ||
      (pairingCode.sourceChoice === "new" && sourceCreationEnabled !== true)
    ) {
      return undefined;
    }
    let candidates: ReturnType<PairingUserCodeVerifier["derive"]> | undefined;
    let material: PairingApprovalMaterial | undefined;
    let sessionVerifier: Buffer | undefined;
    let sessionDigest: Buffer | undefined;
    let challengeDigest: Buffer | undefined;
    let contextDigest: Buffer | undefined;
    try {
      candidates = derivePairingCode(pairingCode.userCode);
      sessionVerifier = digestBase64Url(session.sessionVerifier);
      if (sessionVerifier === undefined) {
        return undefined;
      }
      sessionDigest = createHash("sha256").update(sessionVerifier).digest();
      material = await database.readPairingApproval({
        attemptLimit: config.pairingApprovalAttemptLimit,
        codeDigests: candidates.digests,
        secondaryActive: candidates.secondaryActive,
        sessionId: session.sessionId,
        sessionVerifierDigest: sessionDigest,
        windowSeconds: config.pairingApprovalWindowSeconds,
      });
      if (!candidates.codeAccepted || material === undefined) {
        return undefined;
      }
      const pairingExpiresAtSeconds = Math.floor(new Date(material.expiresAt).valueOf() / 1_000);
      if (
        !Number.isSafeInteger(pairingExpiresAtSeconds) ||
        pairingExpiresAtSeconds <= seconds ||
        pairingExpiresAtSeconds > seconds + 9 * 60
      ) {
        return undefined;
      }
      const sourceId =
        pairingCode.sourceChoice === "new"
          ? randomSourceId(randomBytes)
          : readSourceControl(
              cookieCodec.open("passkey", pairingCode.sourceControl),
              seconds,
              session.sessionId,
            )?.sourceId;
      if (sourceId === undefined) {
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
      const expiresAt = Math.min(seconds + passkeyLifetimeSeconds, pairingExpiresAtSeconds);
      challengeDigest = passkeyChallengeDigest(options.challenge);
      contextDigest = pairingApprovalContextDigest(
        session.sessionId,
        material.pairingId,
        pairingCode.sourceChoice,
        sourceId,
        config.webauthnRpId,
        config.webauthnOrigin,
      );
      const challenge: PairingApprovalChallenge = Object.freeze({
        challenge: options.challenge,
        challengeId,
        expiresAt,
        pairingId: material.pairingId,
        sourceChoice: pairingCode.sourceChoice,
        sourceId,
        version: 1,
      });
      const pairingApprovalCookie = cookieCodec.seal("passkey", challenge);
      const selectedCodeDigest = candidates.digests[material.candidateIndex - 1];
      if (selectedCodeDigest === undefined) {
        return undefined;
      }
      const created = await database.createPairingApprovalChallenge({
        challengeDigest,
        challengeId,
        contextDigest,
        expiresAt: new Date(expiresAt * 1_000).toISOString(),
        pairingId: material.pairingId,
        sessionId: session.sessionId,
        sessionVerifierDigest: sessionDigest,
        sourceChoice: pairingCode.sourceChoice,
        sourceId,
        userCodeDigest: selectedCodeDigest,
      });
      if (!created) {
        return undefined;
      }
      const publicKeyFingerprint = `SHA256:${createHash("sha256")
        .update(material.publicKey)
        .digest("base64url")}`;
      return Object.freeze({
        options,
        pairing: Object.freeze({
          architecture: material.architecture,
          connectorVersion: material.connectorVersion,
          deviceLabel: material.deviceLabel,
          expiresAt: material.expiresAt,
          osFamily: material.osFamily,
          publicKeyFingerprint,
        }),
        pairingApprovalCookie,
      });
    } catch {
      return undefined;
    } finally {
      candidates?.clear();
      material?.publicKey.fill(0);
      sessionVerifier?.fill(0);
      sessionDigest?.fill(0);
      challengeDigest?.fill(0);
      contextDigest?.fill(0);
    }
  }

  async function completePairingApproval(
    sessionCookie: string,
    pairingApprovalCookie: string,
    body: unknown,
    sourceCreationEnabled: unknown,
  ): Promise<boolean> {
    const session = readSession(sessionCookie);
    const seconds = currentSeconds();
    const challenge =
      seconds === undefined
        ? undefined
        : readPairingApprovalChallenge(cookieCodec.open("passkey", pairingApprovalCookie), seconds);
    if (
      !session?.passkeyRegistered ||
      seconds === undefined ||
      challenge === undefined ||
      (challenge.sourceChoice === "new" && sourceCreationEnabled !== true)
    ) {
      return false;
    }
    const authentication = readAuthenticationBody(body);
    if (authentication === undefined) {
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
      const auditEventId = randomUuid();
      if (!enrollmentPatterns.uuidV4.test(auditEventId)) {
        return false;
      }
      sessionDigest = createHash("sha256").update(sessionVerifier).digest();
      challengeDigest = passkeyChallengeDigest(challenge.challenge);
      contextDigest = pairingApprovalContextDigest(
        session.sessionId,
        challenge.pairingId,
        challenge.sourceChoice,
        challenge.sourceId,
        config.webauthnRpId,
        config.webauthnOrigin,
      );
      return await database.completePairingApproval({
        auditEventId,
        backupState: verified.backupState,
        challengeDigest,
        challengeId: challenge.challengeId,
        contextDigest,
        observedSignCount: verified.signCount,
        pairingId: challenge.pairingId,
        requestId: createRequestId(),
        sessionId: session.sessionId,
        sessionVerifierDigest: sessionDigest,
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
  }

  async function beginSourceAction(
    sessionCookie: string,
    body: unknown,
    action: SourcePasskeyAction,
  ): Promise<SourceActionOptionsDecision | undefined> {
    const session = readSession(sessionCookie);
    const target = readSourceControlBody(body);
    const seconds = currentSeconds();
    if (!session?.passkeyRegistered || target === undefined || seconds === undefined) {
      return undefined;
    }
    const sourceControl = readSourceControl(
      cookieCodec.open("passkey", target.sourceControl),
      seconds,
      session.sessionId,
    );
    if (sourceControl === undefined) {
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
      contextDigest =
        action === "reactivation"
          ? sourceReactivationContextDigest(
              session.sessionId,
              sourceControl.sourceId,
              config.webauthnRpId,
              config.webauthnOrigin,
            )
          : sourceUnlinkContextDigest(
              session.sessionId,
              sourceControl.sourceId,
              config.webauthnRpId,
              config.webauthnOrigin,
            );
      const challenge: SourceActionChallenge = Object.freeze({
        challenge: options.challenge,
        challengeId,
        expiresAt,
        sourceId: sourceControl.sourceId,
        version: 1,
      });
      const actionCookie = cookieCodec.seal("passkey", challenge);
      const challengeInput = {
        challengeDigest,
        challengeId,
        contextDigest,
        expiresAt: new Date(expiresAt * 1000).toISOString(),
        sessionId: session.sessionId,
        sessionVerifierDigest: sessionDigest,
        sourceId: sourceControl.sourceId,
      };
      const created =
        action === "reactivation"
          ? await database.createSourceReactivationChallenge(challengeInput)
          : await database.createSourceUnlinkChallenge(challengeInput);
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

  async function completeSourceAction(
    sessionCookie: string,
    actionCookie: string,
    body: unknown,
    action: SourcePasskeyAction,
  ): Promise<boolean> {
    const session = readSession(sessionCookie);
    const seconds = currentSeconds();
    const authentication = readAuthenticationBody(body);
    const challenge =
      seconds === undefined
        ? undefined
        : readSourceActionChallenge(cookieCodec.open("passkey", actionCookie), seconds);
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
      const auditEventId = randomUuid();
      if (!enrollmentPatterns.uuidV4.test(auditEventId)) {
        return false;
      }
      sessionDigest = createHash("sha256").update(sessionVerifier).digest();
      challengeDigest = passkeyChallengeDigest(challenge.challenge);
      contextDigest =
        action === "reactivation"
          ? sourceReactivationContextDigest(
              session.sessionId,
              challenge.sourceId,
              config.webauthnRpId,
              config.webauthnOrigin,
            )
          : sourceUnlinkContextDigest(
              session.sessionId,
              challenge.sourceId,
              config.webauthnRpId,
              config.webauthnOrigin,
            );
      const completionInput = {
        auditEventId,
        backupState: verified.backupState,
        challengeDigest,
        challengeId: challenge.challengeId,
        contextDigest,
        observedSignCount: verified.signCount,
        requestId: createRequestId(),
        sessionId: session.sessionId,
        sessionVerifierDigest: sessionDigest,
        sourceId: challenge.sourceId,
        verifiedPasskeyId: material.passkeyId,
      };
      return action === "reactivation"
        ? await database.completeSourceReactivation(completionInput)
        : await database.completeSourceUnlink(completionInput);
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
  }

  return Object.freeze({
    beginPairingApproval,
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
        const auditEventId = randomUuid();
        if (
          !enrollmentPatterns.uuidV4.test(authorityId) ||
          !enrollmentPatterns.uuidV4.test(auditEventId) ||
          authorityId === auditEventId
        ) {
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
          auditEventId,
          authorityId,
          authorityVerifierDigest,
          challengeDigest,
          contextDigest,
          expiresAt: new Date(expiresAt * 1000).toISOString(),
          recoveryCodeId: recoveryCode.codeId,
          requestId: createRequestId(),
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
      enrollmentEnabled: unknown,
    ): Promise<PasskeyOptionsDecision | undefined> {
      if (enrollmentEnabled !== true) {
        return undefined;
      }
      const session = readSession(sessionCookie);
      const seconds = currentSeconds();
      if (session === undefined || session.passkeyRegistered || seconds === undefined) {
        return undefined;
      }
      let sessionVerifier: Buffer | undefined;
      let sessionDigest: Buffer | undefined;
      let challengeDigest: Buffer | undefined;
      let contextDigest: Buffer | undefined;
      try {
        const options = await createOptions(session.profileId, session.handle, config.webauthnRpId);
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
          session.handle,
          config.webauthnRpId,
          config.webauthnOrigin,
        );
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
        const sealedChallenge = cookieCodec.seal("passkey", challenge);
        const created = await database.createPasskeyChallenge({
          challengeDigest,
          challengeId,
          contextDigest,
          expiresAt: new Date(expiresAt * 1000).toISOString(),
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
          targetPasskeyId: target.passkeyId,
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
    async beginSourceReactivation(
      sessionCookie: string,
      body: unknown,
    ): Promise<SourceReactivationOptionsDecision | undefined> {
      const decision = await beginSourceAction(sessionCookie, body, "reactivation");
      return decision === undefined
        ? undefined
        : Object.freeze({
            options: decision.options,
            sourceReactivationCookie: decision.actionCookie,
          });
    },
    async beginSourceUnlink(
      sessionCookie: string,
      body: unknown,
    ): Promise<SourceUnlinkOptionsDecision | undefined> {
      const decision = await beginSourceAction(sessionCookie, body, "unlink");
      return decision === undefined
        ? undefined
        : Object.freeze({ options: decision.options, sourceUnlinkCookie: decision.actionCookie });
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
        inviteDigest = digestBase64Url(pending.inviteDigest);
        sessionSecret = randomSecret(randomBytes);
        if (inviteDigest === undefined || sessionSecret === undefined) {
          return undefined;
        }
        sessionDigest = createHash("sha256").update(sessionSecret).digest();
        const profileId = randomUuid();
        const sessionId = randomUuid();
        const auditEventId = randomUuid();
        if (
          !enrollmentPatterns.uuidV4.test(profileId) ||
          !enrollmentPatterns.uuidV4.test(sessionId) ||
          !enrollmentPatterns.uuidV4.test(auditEventId)
        ) {
          return undefined;
        }
        const expiresAt = seconds + pendingSessionLifetimeSeconds;
        const session: EnrollmentSession = Object.freeze({
          expiresAt,
          handle: pending.handle,
          locale: pending.locale,
          passkeyRegistered: false,
          profileId,
          sessionId,
          sessionVerifier: sessionSecret.toString("base64url"),
          version: 1,
        });
        const sealedSession = cookieCodec.seal("session", session);
        const enrolled = await database.enrollProfile({
          auditEventId,
          githubUserId,
          handle: pending.handle,
          inviteId: pending.inviteId,
          inviteVerifierDigest: inviteDigest,
          locale: pending.locale,
          motionPreference: pending.motionPreference,
          profileId,
          requestId: createRequestId(),
          sessionExpiresAt: new Date(expiresAt * 1000).toISOString(),
          sessionId,
          sessionVerifierDigest: sessionDigest,
          streakVisible: pending.streakVisible,
          theme: pending.theme,
        });
        if (!enrolled) {
          return undefined;
        }
        return Object.freeze({ sessionCookie: sealedSession });
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
        const auditEventId = randomUuid();
        const cleanupAuditEventId = randomUuid();
        const generatedIds = [sessionId, auditEventId, cleanupAuditEventId];
        if (
          generatedIds.some((id) => !enrollmentPatterns.uuidV4.test(id)) ||
          new Set(generatedIds).size !== generatedIds.length
        ) {
          return undefined;
        }
        const expiresAt = seconds + activeSessionLifetimeSeconds;
        const profile = await database.completePasskeyLogin({
          auditEventId,
          backupState: verified.backupState,
          challengeDigest,
          challengeExpiresAt: new Date(challenge.expiresAt * 1000).toISOString(),
          challengeId: challenge.challengeId,
          contextDigest,
          credentialId,
          observedSignCount: verified.signCount,
          passkeyId: material.passkeyId,
          requestId: createRequestId(),
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
            auditEventId: cleanupAuditEventId,
            requestId: createRequestId(),
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
        const auditEventId = randomUuid();
        const cleanupAuditEventId = randomUuid();
        const generatedIds = [passkeyId, sessionId, auditEventId, cleanupAuditEventId];
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
          auditEventId,
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
          requestId: createRequestId(),
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
            auditEventId: cleanupAuditEventId,
            requestId: createRequestId(),
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
          : readPasskeyChallenge(cookieCodec.open("passkey", passkeyCookie), seconds);
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
          session.handle,
          config.webauthnRpId,
          config.webauthnOrigin,
        );
        const passkeyId = randomUuid();
        const auditEventId = randomUuid();
        const rotatedSessionId = randomUuid();
        const rotationAuditEventId = randomUuid();
        const generatedIds = [passkeyId, auditEventId, rotatedSessionId, rotationAuditEventId];
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
          passkeyRegistered: true,
          sessionId: rotatedSessionId,
          sessionVerifier: rotatedSessionSecret.toString("base64url"),
        } satisfies EnrollmentSession);
        const completed = await database.completeInitialPasskey({
          auditEventId,
          backupEligible: passkey.backupEligible,
          backupState: passkey.backupState,
          challengeDigest,
          challengeId: challenge.challengeId,
          contextDigest,
          cosePublicKey: passkey.cosePublicKey,
          credentialId: passkey.credentialId,
          label: registration.label,
          passkeyId,
          requestId: createRequestId(),
          rotatedSessionExpiresAt: new Date(activeSessionExpiresAt * 1000).toISOString(),
          rotatedSessionId,
          rotatedSessionVerifierDigest: rotatedSessionDigest,
          rotationAuditEventId,
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
        const auditEventId = randomUuid();
        if (
          !enrollmentPatterns.uuidV4.test(passkeyId) ||
          !enrollmentPatterns.uuidV4.test(auditEventId) ||
          passkeyId === auditEventId
        ) {
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
          auditEventId,
          backupEligible: passkey.backupEligible,
          backupState: passkey.backupState,
          challengeDigest,
          challengeId: challenge.challengeId,
          contextDigest,
          cosePublicKey: passkey.cosePublicKey,
          credentialId: passkey.credentialId,
          label: challenge.label,
          observedSignCount: verified.signCount,
          passkeyId,
          requestId: createRequestId(),
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
        const auditEventId = randomUuid();
        if (!enrollmentPatterns.uuidV4.test(auditEventId)) {
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
          auditEventId,
          backupState: verified.backupState,
          challengeDigest,
          challengeId: challenge.challengeId,
          contextDigest,
          observedSignCount: verified.signCount,
          requestId: createRequestId(),
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
        const auditEventId = randomUuid();
        const codeIds = new Set(records.map(({ codeId }) => codeId));
        if (
          !enrollmentPatterns.uuidV4.test(batchId) ||
          !enrollmentPatterns.uuidV4.test(auditEventId) ||
          batchId === auditEventId ||
          batchId === challenge.challengeId ||
          auditEventId === challenge.challengeId ||
          codeIds.has(batchId) ||
          codeIds.has(auditEventId)
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
          auditEventId,
          backupState: verified.backupState,
          batchId,
          challengeDigest,
          challengeId: challenge.challengeId,
          contextDigest,
          observedSignCount: verified.signCount,
          recoveryCodeIds: records.map(({ codeId }) => codeId),
          requestId: createRequestId(),
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
      let profileRefDigest: Buffer | undefined;
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
        const deletionJobId = randomUuid();
        const auditEventId = randomUuid();
        if (
          !enrollmentPatterns.uuidV4.test(deletionJobId) ||
          !enrollmentPatterns.uuidV4.test(auditEventId) ||
          deletionJobId === auditEventId
        ) {
          return false;
        }
        profileRefDigest = randomSecret(randomBytes);
        if (profileRefDigest === undefined) {
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
          auditEventId,
          backupState: verified.backupState,
          challengeDigest,
          challengeId: challenge.challengeId,
          contextDigest,
          deletionJobId,
          observedSignCount: verified.signCount,
          profileRefDigest,
          requestId: createRequestId(),
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
        profileRefDigest?.fill(0);
      }
    },
    completePairingApproval,
    async completeSourceReactivation(
      sessionCookie: string,
      sourceReactivationCookie: string,
      body: unknown,
    ): Promise<boolean> {
      return completeSourceAction(sessionCookie, sourceReactivationCookie, body, "reactivation");
    },
    async completeSourceUnlink(
      sessionCookie: string,
      sourceUnlinkCookie: string,
      body: unknown,
    ): Promise<boolean> {
      return completeSourceAction(sessionCookie, sourceUnlinkCookie, body, "unlink");
    },
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
          auditEventId: randomUuid(),
          requestId: createRequestId(),
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
    async readAccountOverview(sessionCookie: string): Promise<AccountOverview | undefined> {
      const session = readSession(sessionCookie);
      if (!session?.passkeyRegistered) {
        return undefined;
      }
      let sessionVerifier: Buffer | undefined;
      let sessionDigest: Buffer | undefined;
      try {
        const seasonStart = currentCommunitySeasonStart(now());
        if (seasonStart === undefined) {
          return undefined;
        }
        sessionVerifier = digestBase64Url(session.sessionVerifier);
        if (sessionVerifier === undefined) {
          return undefined;
        }
        sessionDigest = createHash("sha256").update(sessionVerifier).digest();
        return await database.readAccountOverview({
          seasonStart,
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
    async readActiveDeviceInventory(
      sessionCookie: string,
    ): Promise<readonly AccountSourceDeviceInventoryItem[] | undefined> {
      const session = readSession(sessionCookie);
      if (!session?.passkeyRegistered) {
        return undefined;
      }
      const seconds = currentSeconds();
      if (seconds === undefined) {
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
        const inventory = await database.readActiveDeviceInventory({
          sessionId: session.sessionId,
          sessionVerifierDigest: sessionDigest,
        });
        const expiresAt = Math.min(session.expiresAt, seconds + sourceControlLifetimeSeconds);
        return Object.freeze(
          inventory.map((source) =>
            Object.freeze({
              devices: source.devices,
              sourceControl: cookieCodec.seal("passkey", {
                expiresAt,
                sessionId: session.sessionId,
                sourceId: source.sourceId,
                version: 1,
              } satisfies SourceControl),
              state: source.state,
            }),
          ),
        );
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
    async pauseSource(sessionCookie: string, sourceControlToken: string): Promise<boolean> {
      const session = readSession(sessionCookie);
      const seconds = currentSeconds();
      if (!session?.passkeyRegistered || seconds === undefined) {
        return false;
      }
      const sourceControl = readSourceControl(
        cookieCodec.open("passkey", sourceControlToken),
        seconds,
        session.sessionId,
      );
      if (sourceControl === undefined) {
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
        return await database.pauseSource({
          auditEventId: randomUuid(),
          requestId: createRequestId(),
          sessionId: session.sessionId,
          sessionVerifierDigest: sessionDigest,
          sourceId: sourceControl.sourceId,
        });
      } catch {
        return false;
      } finally {
        sessionVerifier?.fill(0);
        sessionDigest?.fill(0);
      }
    },
    async revokeDevice(sessionCookie: string, deviceId: string): Promise<boolean> {
      const session = readSession(sessionCookie);
      if (!session?.passkeyRegistered || !deviceIdPattern.test(deviceId)) {
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
        return await database.revokeDevice({
          auditEventId: randomUuid(),
          deviceId,
          requestId: createRequestId(),
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
  });
}
