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
  EnrollmentDatabase,
  PasskeyInventoryItem,
  PasskeyLoginMaterial,
} from "./enrollment-database";
import {
  enrollmentPatterns,
  readEnrollmentSession,
  readPasskeyChallenge,
  readPendingEnrollment,
  type EnrollmentSession,
  type JoinRequest,
  type PasskeyRegistrationChallenge,
  type PendingEnrollment,
} from "./enrollment-domain";
import {
  createGithubOAuthMaterial,
  exchangeGithubUserId,
  githubAuthorizationUrl,
} from "./github-oauth";
import {
  createInitialPasskeyOptions,
  createPasskeyLoginOptions,
  passkeyChallengeDigest,
  passkeyContextDigest,
  passkeyLoginContextDigest,
  passkeyLoginCredentialId,
  verifyInitialPasskey,
  verifyPasskeyLogin,
  type RegisteredPasskey,
} from "./passkey-registration";
import { createPublicRequestId } from "./public-http-problem";

const oauthLifetimeSeconds = 600;
const passkeyLifetimeSeconds = 300;
const pendingSessionLifetimeSeconds = 15 * 60;
const activeSessionLifetimeSeconds = 30 * 24 * 60 * 60;
const base64Url32Pattern = /^[A-Za-z0-9_-]{43}$/;
const registrationBodyKeys = new Set(["label", "response"]);
const authenticationBodyKeys = new Set(["response"]);
const unsafeLabelPattern = /[\p{Cc}\p{Cf}\p{Cs}]/u;

export const enrollmentCookieNames = Object.freeze({
  login: "viberacing_login",
  oauth: "viberacing_oauth",
  passkey: "viberacing_passkey",
  session: "viberacing_session",
});

export interface EnrollmentStartDecision {
  readonly oauthCookie: string;
  readonly redirectUrl: string;
}

export interface EnrollmentCallbackDecision {
  readonly sessionCookie: string;
}

export interface PasskeyOptionsDecision {
  readonly options: Awaited<ReturnType<typeof createInitialPasskeyOptions>>;
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

export interface EnrollmentService {
  beginGithub(join: JoinRequest): EnrollmentStartDecision | undefined;
  beginLogin(): Promise<PasskeyLoginOptionsDecision | undefined>;
  beginPasskey(sessionCookie: string): Promise<PasskeyOptionsDecision | undefined>;
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
  logout(sessionCookie: string | undefined): Promise<boolean>;
  readPasskeyInventory(sessionCookie: string): Promise<readonly PasskeyInventoryItem[] | undefined>;
  readSession(sessionCookie: string | undefined): EnrollmentSession | undefined;
}

interface EnrollmentServiceDependencies {
  readonly config: EnrollmentConfig;
  readonly cookieCodec: EnrollmentCookieCodec;
  readonly createOptions?: typeof createInitialPasskeyOptions;
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
    typeof record.label !== "string" ||
    record.label.length < 1 ||
    record.label.length > 64 ||
    record.label !== record.label.trim() ||
    record.label !== record.label.normalize("NFC") ||
    unsafeLabelPattern.test(record.label) ||
    Array.from(record.label).length > 64 ||
    record.response === null ||
    typeof record.response !== "object" ||
    Array.isArray(record.response)
  ) {
    return undefined;
  }
  return Object.freeze({ label: record.label, response: record.response });
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
    createOptions = createInitialPasskeyOptions,
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
    readSession,
  });
}
