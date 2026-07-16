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
  readPasskeyRevokeChallenge,
  readPendingEnrollment,
  readProfileDeletionChallenge,
  readSourceActionChallenge,
  type EnrollmentSession,
  type JoinRequest,
  type PasskeyAddChallenge,
  type PasskeyRegistrationChallenge,
  type PasskeyRevokeChallenge,
  type PendingEnrollment,
  type ProfileDeletionChallenge,
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
  passkeyChallengeDigest,
  passkeyAddContextDigest,
  passkeyContextDigest,
  passkeyLoginContextDigest,
  passkeyLoginCredentialId,
  passkeyRevokeContextDigest,
  profileDeletionContextDigest,
  sourceReactivationContextDigest,
  sourceUnlinkContextDigest,
  verifyInitialPasskey,
  verifyPasskeyLogin,
  type RegisteredPasskey,
} from "./passkey-registration";
import { currentCommunitySeasonStart } from "./public-community-race";
import { createPublicRequestId } from "./public-http-problem";

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
const deviceIdPattern = /^dev_[A-Za-z0-9_-]{22}$/;
const sourceIdPattern = /^src_[A-Za-z0-9_-]{22}$/;
const sourceControlBodyKeys = new Set(["sourceControl"]);
const sourceControlKeys = new Set(["expiresAt", "sessionId", "sourceId", "version"]);
const unsafeLabelPattern = /[\p{Cc}\p{Cf}\p{Cs}]/u;

export const enrollmentCookieNames = Object.freeze({
  login: "viberacing_login",
  oauth: "viberacing_oauth",
  passkey: "viberacing_passkey",
  passkeyAdd: "viberacing_passkey_add",
  passkeyRevoke: "viberacing_passkey_revoke",
  profileDeletion: "viberacing_profile_deletion",
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

export interface AccountSourceDeviceInventoryItem {
  readonly devices: readonly ActiveDeviceInventoryItem[];
  readonly sourceControl: string;
  readonly state: SourceState;
}

export interface EnrollmentService {
  beginGithub(join: JoinRequest): EnrollmentStartDecision | undefined;
  beginLogin(): Promise<PasskeyLoginOptionsDecision | undefined>;
  beginPasskey(sessionCookie: string): Promise<PasskeyOptionsDecision | undefined>;
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
  ): Promise<EnrollmentCallbackDecision | undefined>;
  completeLogin(
    loginCookie: string,
    body: unknown,
  ): Promise<PasskeyLoginCompletionDecision | undefined>;
  completePasskey(
    sessionCookie: string,
    passkeyCookie: string,
    body: unknown,
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
  readonly createLoginOptions?: typeof createPasskeyLoginOptions;
  readonly createRequestId?: () => string;
  readonly database: EnrollmentDatabase;
  readonly exchangeGithub?: typeof exchangeGithubUserId;
  readonly now?: () => Date;
  readonly randomBytes?: EnrollmentRandomBytes;
  readonly randomUuid?: () => string;
  readonly verifyPasskey?: typeof verifyInitialPasskey;
  readonly verifyLogin?: typeof verifyPasskeyLogin;
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

interface SourceControlBody {
  readonly sourceControl: string;
}

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

export function createEnrollmentService(
  dependencies: EnrollmentServiceDependencies,
): EnrollmentService {
  const {
    config,
    cookieCodec,
    database,
    createLoginOptions = createPasskeyLoginOptions,
    createOptions = createPasskeyRegistrationOptions,
    createRequestId = () => createPublicRequestId().value,
    exchangeGithub = exchangeGithubUserId,
    now = () => new Date(),
    randomBytes = nodeRandomBytes,
    randomUuid = nodeRandomUUID,
    verifyPasskey = verifyInitialPasskey,
    verifyLogin = verifyPasskeyLogin,
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
    beginGithub(join: JoinRequest): EnrollmentStartDecision | undefined {
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
    async beginPasskey(sessionCookie: string): Promise<PasskeyOptionsDecision | undefined> {
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
    ): Promise<EnrollmentCallbackDecision | undefined> {
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
    async completePasskey(
      sessionCookie: string,
      passkeyCookie: string,
      body: unknown,
    ): Promise<PasskeyCompletionDecision | undefined> {
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
