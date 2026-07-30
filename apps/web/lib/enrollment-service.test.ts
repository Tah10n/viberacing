/* eslint-disable @typescript-eslint/unbound-method -- Vitest inspects injected method spies without invoking them. */

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import { describe, expect, it, vi } from "vitest";

import { resolveEnrollmentConfig } from "./enrollment-config";
import { createEnrollmentCookieCodec } from "./enrollment-cookie";
import type { EnrollmentDatabase } from "./enrollment-database";
import type { JoinRequest } from "./enrollment-domain";
import { createEnrollmentService } from "./enrollment-service";
import type { RegisteredPasskey } from "./passkey-registration";
import type { RecoveryCodeVerifier } from "./recovery-code";
import type {
  EnrollmentDatabaseAccountTargetChallenge,
  EnrollmentDatabaseAccountTargetCompletion,
  EnrollmentDatabaseAgentAccountPause,
  EnrollmentDatabaseLoginCompletion,
  EnrollmentDatabasePasskeyAddition,
  EnrollmentDatabasePasskeyAddChallenge,
  EnrollmentDatabasePasskeyChallenge,
  EnrollmentDatabasePasskeyInventoryRequest,
  EnrollmentDatabasePasskeyRevocation,
  EnrollmentDatabasePasskeyRevokeChallenge,
  EnrollmentDatabaseProfile,
  EnrollmentDatabaseProfileDeletion,
  EnrollmentDatabaseProfileDeletionChallenge,
  EnrollmentDatabaseProfileVisibilityRequest,
  EnrollmentDatabaseProfileVisibilityUpdate,
  EnrollmentDatabaseProviderBreakdownVisibilityUpdate,
  EnrollmentDatabaseRecoveryCodeChallenge,
  EnrollmentDatabaseRecoveryCodeReplacement,
  EnrollmentDatabaseRecoveryCompletion,
  EnrollmentDatabaseRecoveryStart,
} from "./pairing-database-pool";

const now = new Date("2026-07-16T10:00:00.000Z");
const profileHandle = "pixel_driver";
const activeProfileId = "00000000-0000-4000-8000-000000000501";
const config = resolveEnrollmentConfig({
  GITHUB_CLIENT_ID: "Ov23abcdefghijklmno",
  GITHUB_CLIENT_SECRET: "a".repeat(40),
  NODE_ENV: "test",
  SESSION_SECRET: Buffer.alloc(32, 0x31).toString("base64url"),
  VIBERACING_PUBLIC_ORIGIN: "https://race.example.com",
  VIBERACING_RECOVERY_ARGON2_MEMORY_KIB: "19456",
  VIBERACING_RECOVERY_ARGON2_PARALLELISM: "2",
  VIBERACING_RECOVERY_ARGON2_PASSES: "2",
  VIBERACING_RECOVERY_MINIMUM_RESPONSE_MS: "250",
  VIBERACING_RECOVERY_PEPPER: Buffer.alloc(32, 0x32).toString("base64url"),
  WEBAUTHN_ORIGIN: "https://race.example.com",
  WEBAUTHN_RP_ID: "race.example.com",
});
const join: JoinRequest = Object.freeze({
  inviteDigest: Buffer.alloc(32, 0x41).toString("base64url"),
  inviteId: activeProfileId,
  locale: "en",
});

function createFixture() {
  let enrollmentWrite: EnrollmentDatabaseProfile | undefined;
  let challengeSessionDigest: Buffer | undefined;
  let challengeSessionDigestInput: Uint8Array | undefined;
  let loginCompletion: EnrollmentDatabaseLoginCompletion | undefined;
  let loginCredentialLookup: Buffer | undefined;
  let inventorySessionDigest: Buffer | undefined;
  let inventorySessionDigestInput: Uint8Array | undefined;
  let addChallengeWrite: EnrollmentDatabasePasskeyAddChallenge | undefined;
  let additionWrite: EnrollmentDatabasePasskeyAddition | undefined;
  let revokeChallengeWrite: EnrollmentDatabasePasskeyRevokeChallenge | undefined;
  let revocationWrite: EnrollmentDatabasePasskeyRevocation | undefined;
  let deletionChallengeWrite: EnrollmentDatabaseProfileDeletionChallenge | undefined;
  let deletionWrite: EnrollmentDatabaseProfileDeletion | undefined;
  let recoveryChallengeWrite: EnrollmentDatabaseRecoveryCodeChallenge | undefined;
  let recoveryReplacementWrite: EnrollmentDatabaseRecoveryCodeReplacement | undefined;
  let recoveryCompletionWrite: EnrollmentDatabaseRecoveryCompletion | undefined;
  let recoveryStartWrite: EnrollmentDatabaseRecoveryStart | undefined;
  let visibilityRead: EnrollmentDatabaseProfileVisibilityRequest | undefined;
  let visibilityReadDigestInput: Uint8Array | undefined;
  let visibilityWrite: EnrollmentDatabaseProfileVisibilityUpdate | undefined;
  let visibilityWriteDigestInput: Uint8Array | undefined;
  let providerBreakdownWrite: EnrollmentDatabaseProviderBreakdownVisibilityUpdate | undefined;
  let accountTargetChallengeWrite: EnrollmentDatabaseAccountTargetChallenge | undefined;
  const accountTargetCompletionWrites: EnrollmentDatabaseAccountTargetCompletion[] = [];
  let agentAccountPauseWrite: EnrollmentDatabaseAgentAccountPause | undefined;
  let verifiedLoginCredential: Buffer | undefined;
  const captureAccountTargetCompletion = (
    input: EnrollmentDatabaseAccountTargetCompletion,
  ): void => {
    accountTargetCompletionWrites.push({
      ...input,
      contextDigest: Buffer.from(input.contextDigest),
      sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
    });
  };
  const database: EnrollmentDatabase = {
    approveCarRecipe: vi.fn(() => Promise.resolve(true)),
    completeAgentAccountReactivation: vi.fn((input: EnrollmentDatabaseAccountTargetCompletion) => {
      captureAccountTargetCompletion(input);
      return Promise.resolve(true);
    }),
    completeAgentAccountUnlink: vi.fn((input: EnrollmentDatabaseAccountTargetCompletion) => {
      captureAccountTargetCompletion(input);
      return Promise.resolve(true);
    }),
    completeDeviceKeyRevocation: vi.fn((input: EnrollmentDatabaseAccountTargetCompletion) => {
      captureAccountTargetCompletion(input);
      return Promise.resolve(true);
    }),
    completeInstallationRevocation: vi.fn((input: EnrollmentDatabaseAccountTargetCompletion) => {
      captureAccountTargetCompletion(input);
      return Promise.resolve(true);
    }),
    completeInitialPasskey: vi.fn(() => Promise.resolve(true)),
    completePasskeyAddition: vi.fn((input: EnrollmentDatabasePasskeyAddition) => {
      additionWrite = {
        ...input,
        contextDigest: Buffer.from(input.contextDigest),
        cosePublicKey: Buffer.from(input.cosePublicKey),
        credentialId: Buffer.from(input.credentialId),
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
      };
      return Promise.resolve(true);
    }),
    completePasskeyLogin: vi.fn((input: EnrollmentDatabaseLoginCompletion) => {
      loginCompletion = input;
      return Promise.resolve({
        handle: "pixel_driver",
        locale: "en" as const,
        profileId: activeProfileId,
      });
    }),
    completeRecoveryRegistration: vi.fn((input: EnrollmentDatabaseRecoveryCompletion) => {
      recoveryCompletionWrite = {
        ...input,
        authorityVerifierDigest: Buffer.from(input.authorityVerifierDigest),
        challengeDigest: Buffer.from(input.challengeDigest),
        contextDigest: Buffer.from(input.contextDigest),
        cosePublicKey: Buffer.from(input.cosePublicKey),
        credentialId: Buffer.from(input.credentialId),
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
      };
      return Promise.resolve({
        handle: "pixel_driver",
        locale: "en" as const,
        profileId: activeProfileId,
      });
    }),
    completePasskeyRevocation: vi.fn((input: EnrollmentDatabasePasskeyRevocation) => {
      revocationWrite = {
        ...input,
        contextDigest: Buffer.from(input.contextDigest),
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
      };
      return Promise.resolve(true);
    }),
    completeProfileDeletion: vi.fn((input: EnrollmentDatabaseProfileDeletion) => {
      deletionWrite = {
        ...input,
        contextDigest: Buffer.from(input.contextDigest),
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
      };
      return Promise.resolve(true);
    }),
    completeRecoveryCodeReplacement: vi.fn((input: EnrollmentDatabaseRecoveryCodeReplacement) => {
      recoveryReplacementWrite = {
        ...input,
        contextDigest: Buffer.from(input.contextDigest),
        recoveryCodeIds: [...input.recoveryCodeIds],
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
        verifierPhcs: [...input.verifierPhcs],
      };
      return Promise.resolve(true);
    }),
    createPasskeyAddChallenge: vi.fn((input: EnrollmentDatabasePasskeyAddChallenge) => {
      addChallengeWrite = {
        ...input,
        challengeDigest: Buffer.from(input.challengeDigest),
        contextDigest: Buffer.from(input.contextDigest),
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
      };
      return Promise.resolve(true);
    }),
    createPasskeyChallenge: vi.fn((input: EnrollmentDatabasePasskeyChallenge) => {
      challengeSessionDigest = Buffer.from(input.sessionVerifierDigest);
      challengeSessionDigestInput = input.sessionVerifierDigest;
      return Promise.resolve(true);
    }),
    createPasskeyRevokeChallenge: vi.fn((input: EnrollmentDatabasePasskeyRevokeChallenge) => {
      revokeChallengeWrite = {
        ...input,
        challengeDigest: Buffer.from(input.challengeDigest),
        contextDigest: Buffer.from(input.contextDigest),
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
      };
      return Promise.resolve(true);
    }),
    createProfileDeletionChallenge: vi.fn((input: EnrollmentDatabaseProfileDeletionChallenge) => {
      deletionChallengeWrite = {
        ...input,
        challengeDigest: Buffer.from(input.challengeDigest),
        contextDigest: Buffer.from(input.contextDigest),
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
      };
      return Promise.resolve(true);
    }),
    createAccountTargetChallenge: vi.fn((input: EnrollmentDatabaseAccountTargetChallenge) => {
      accountTargetChallengeWrite = {
        ...input,
        challengeDigest: Buffer.from(input.challengeDigest),
        contextDigest: Buffer.from(input.contextDigest),
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
      };
      return Promise.resolve(true);
    }),
    createRecoveryCodeChallenge: vi.fn((input: EnrollmentDatabaseRecoveryCodeChallenge) => {
      recoveryChallengeWrite = {
        ...input,
        challengeDigest: Buffer.from(input.challengeDigest),
        contextDigest: Buffer.from(input.contextDigest),
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
      };
      return Promise.resolve(true);
    }),
    enrollProfile: vi.fn((input: EnrollmentDatabaseProfile) => {
      enrollmentWrite = {
        ...input,
        ...(input.inviteVerifierDigest === undefined
          ? {}
          : { inviteVerifierDigest: Buffer.from(input.inviteVerifierDigest) }),
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
      };
      return Promise.resolve({
        created: true,
        handle: input.handle,
        locale: input.locale,
        profileId: input.profileId,
        profileState: "enrolling" as const,
        sessionCreated: true,
      });
    }),
    proposeCarRecipe: vi.fn(() => Promise.resolve(true)),
    readAgentAccountDashboard: vi.fn(() => Promise.resolve({ accounts: [], installations: [] })),
    readCarRecipeState: vi.fn(() => Promise.resolve({ active: null, proposal: null })),
    readPasskeyInventory: vi.fn((input: EnrollmentDatabasePasskeyInventoryRequest) => {
      inventorySessionDigest = Buffer.from(input.sessionVerifierDigest);
      inventorySessionDigestInput = input.sessionVerifierDigest;
      return Promise.resolve([
        {
          createdOn: "2026-07-15",
          currentAuthenticator: true,
          label: "Primary passkey",
          passkeyId: "00000000-0000-4000-8000-000000000511",
          state: "active" as const,
        },
        {
          createdOn: "2026-07-16",
          currentAuthenticator: false,
          label: "Backup passkey",
          passkeyId: "00000000-0000-4000-8000-000000000512",
          state: "active" as const,
        },
      ]);
    }),
    readPasskeyLoginMaterial: vi.fn((credentialId: Uint8Array) => {
      loginCredentialLookup = Buffer.from(credentialId);
      return Promise.resolve({
        backupEligible: true,
        backupState: false,
        cosePublicKey: Buffer.alloc(77, 0x73),
        passkeyId: "00000000-0000-4000-8000-000000000511",
        signCount: 3,
      });
    }),
    readRecoveryCodeVerificationMaterial: vi.fn(() => Promise.resolve(undefined)),
    readProfileVisibility: vi.fn((input: EnrollmentDatabaseProfileVisibilityRequest) => {
      visibilityReadDigestInput = input.sessionVerifierDigest;
      visibilityRead = {
        ...input,
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
      };
      return Promise.resolve("public" as const);
    }),
    readPrivateDashboardRanking: vi.fn(() =>
      Promise.resolve({
        participantCount: 10,
        providerBreakdownVisible: false,
        publicVisibility: "public" as const,
        rankPosition: 2,
        seasonEnd: "2026-07-19",
        seasonStart: "2026-07-13",
        seasonState: "open" as const,
        snapshotGeneratedAt: "2026-07-16T10:00Z",
        weeklyTokenTotal: "2800",
      }),
    ),
    pauseAgentAccount: vi.fn((input: EnrollmentDatabaseAgentAccountPause) => {
      agentAccountPauseWrite = {
        ...input,
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
      };
      return Promise.resolve(true);
    }),
    rejectCarRecipe: vi.fn(() => Promise.resolve(true)),
    revokeSession: vi.fn(() => Promise.resolve(true)),
    setProfileVisibility: vi.fn((input: EnrollmentDatabaseProfileVisibilityUpdate) => {
      visibilityWriteDigestInput = input.sessionVerifierDigest;
      visibilityWrite = {
        ...input,
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
      };
      return Promise.resolve(input.publiclyVisible ? ("public" as const) : ("hidden" as const));
    }),
    setProviderBreakdownVisibility: vi.fn(
      (input: EnrollmentDatabaseProviderBreakdownVisibilityUpdate) => {
        providerBreakdownWrite = {
          ...input,
          sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
        };
        return Promise.resolve(input.providerBreakdownVisible);
      },
    ),
    startRecovery: vi.fn((input: EnrollmentDatabaseRecoveryStart) => {
      recoveryStartWrite = {
        ...input,
        authorityVerifierDigest: Buffer.from(input.authorityVerifierDigest),
        challengeDigest: Buffer.from(input.challengeDigest),
        contextDigest: Buffer.from(input.contextDigest),
      };
      return Promise.resolve(true);
    }),
  };
  const uuids = [
    "00000000-0000-4000-8000-000000000502",
    "00000000-0000-4000-8000-000000000503",
    "00000000-0000-4000-8000-000000000504",
    "00000000-0000-4000-8000-000000000505",
    "00000000-0000-4000-8000-000000000506",
    "00000000-0000-4000-8000-000000000507",
    "00000000-0000-4000-8000-000000000508",
    "00000000-0000-4000-8000-000000000509",
    "00000000-0000-4000-8000-000000000510",
    "00000000-0000-4000-8000-000000000520",
    "00000000-0000-4000-8000-000000000521",
    "00000000-0000-4000-8000-000000000522",
    "00000000-0000-4000-8000-000000000523",
    "00000000-0000-4000-8000-000000000524",
  ];
  const registrationChallenge = Buffer.alloc(32, 0x61).toString("base64url");
  const authenticationChallenge = Buffer.alloc(32, 0x62).toString("base64url");
  const options = { challenge: registrationChallenge } as PublicKeyCredentialCreationOptionsJSON;
  const loginOptions = {
    challenge: authenticationChallenge,
  } as PublicKeyCredentialRequestOptionsJSON;
  const exchangeGithub = vi.fn(() => Promise.resolve(123_456));
  const createOptions = vi.fn(() => Promise.resolve(options));
  const createRecoveryOptions = vi.fn(() => Promise.resolve(options));
  const createLoginOptions = vi.fn(() => Promise.resolve(loginOptions));
  const verifyPasskey = vi.fn((): Promise<RegisteredPasskey | undefined> =>
    Promise.resolve({
      backupEligible: true,
      backupState: false,
      cosePublicKey: Buffer.alloc(77, 0x71),
      credentialId: Buffer.alloc(32, 0x72),
      signCount: 3,
    }),
  );
  const verifyLogin = vi.fn(
    (
      _response: unknown,
      _challenge: string,
      _origin: string,
      _rpId: string,
      material: { readonly credentialId: Uint8Array },
    ) => {
      verifiedLoginCredential = Buffer.from(material.credentialId);
      return Promise.resolve({ backupState: true, signCount: 4 });
    },
  );
  const recoveryCodeRecords = Object.freeze(
    Array.from({ length: 10 }, (_, index) => {
      const codeId = `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      const suffix = Buffer.alloc(32, index + 1).toString("base64url");
      const salt = Buffer.alloc(16, index + 1)
        .toString("base64")
        .replace(/=+$/u, "");
      const tag = Buffer.alloc(32, index + 11)
        .toString("base64")
        .replace(/=+$/u, "");
      return Object.freeze({
        codeId,
        plaintext: `vrr1_${codeId}_${suffix}`,
        verifierPhc: `$argon2id$v=19$m=19456,t=2,p=2$${salt}$${tag}`,
      });
    }),
  );
  const generateRecoveryCodes = vi.fn(() => Promise.resolve(recoveryCodeRecords));
  const verifyRecoveryCode = vi.fn<RecoveryCodeVerifier>(() => Promise.resolve(true));
  let randomFill = 0x21;
  const cookieCodec = createEnrollmentCookieCodec(config.cookieKey, (size) =>
    Buffer.alloc(size, 0x21),
  );
  const service = createEnrollmentService({
    config,
    cookieCodec,
    createLoginOptions,
    createOptions,
    createRecoveryOptions,
    database,
    exchangeGithub,
    generateRecoveryCodes,
    now: () => now,
    randomBytes: (size) => Buffer.alloc(size, (randomFill += 1)),
    randomUuid: () => uuids.shift() ?? "invalid",
    verifyLogin,
    verifyPasskey,
    verifyRecoveryCode,
  });
  return {
    accountTargetChallengeWrite: () => accountTargetChallengeWrite,
    accountTargetCompletionWrites,
    agentAccountPauseWrite: () => agentAccountPauseWrite,
    addChallengeWrite: () => addChallengeWrite,
    additionWrite: () => additionWrite,
    authenticationChallenge,
    challengeSessionDigest: () => challengeSessionDigest,
    challengeSessionDigestInput: () => challengeSessionDigestInput,
    cookieCodec,
    createOptions,
    createRecoveryOptions,
    createLoginOptions,
    database,
    deletionChallengeWrite: () => deletionChallengeWrite,
    deletionWrite: () => deletionWrite,
    enrollmentWrite: () => enrollmentWrite,
    exchangeGithub,
    loginCredentialLookup: () => loginCredentialLookup,
    loginCompletion: () => loginCompletion,
    inventorySessionDigest: () => inventorySessionDigest,
    inventorySessionDigestInput: () => inventorySessionDigestInput,
    generateRecoveryCodes,
    recoveryChallengeWrite: () => recoveryChallengeWrite,
    recoveryCompletionWrite: () => recoveryCompletionWrite,
    recoveryCodeRecords,
    recoveryReplacementWrite: () => recoveryReplacementWrite,
    recoveryStartWrite: () => recoveryStartWrite,
    providerBreakdownWrite: () => providerBreakdownWrite,
    revokeChallengeWrite: () => revokeChallengeWrite,
    registrationChallenge,
    revocationWrite: () => revocationWrite,
    service,
    verifyPasskey,
    verifyLogin,
    verifyRecoveryCode,
    verifiedLoginCredential: () => verifiedLoginCredential,
    visibilityRead: () => visibilityRead,
    visibilityReadDigestInput: () => visibilityReadDigestInput,
    visibilityWrite: () => visibilityWrite,
    visibilityWriteDigestInput: () => visibilityWriteDigestInput,
  };
}

describe("enrollment service", () => {
  it("completes invite, OAuth, required passkey, active cookie, and logout as one flow", async () => {
    const {
      challengeSessionDigest,
      challengeSessionDigestInput,
      database,
      enrollmentWrite,
      exchangeGithub,
      service,
      verifyPasskey,
    } = createFixture();
    const start = service.beginGithub(join, true);
    expect(start).toBeDefined();
    const authorization = new URL(start?.redirectUrl ?? "invalid:");
    const state = authorization.searchParams.get("state");
    expect(state).toHaveLength(43);

    const callback = await service.completeGithub(
      "valid_code_123",
      state ?? "",
      start?.oauthCookie ?? "",
      new AbortController().signal,
      true,
      true,
    );
    expect(callback).toBeDefined();
    expect(callback?.outcome).toBe("continue");
    if (callback?.outcome !== "continue") {
      throw new Error("Expected enrollment continuation.");
    }
    expect(exchangeGithub).toHaveBeenCalledOnce();
    const enrollingSession = service.readSession(callback.sessionCookie);
    expect(enrollingSession).toMatchObject({
      expiresAt: Math.floor(now.valueOf() / 1000) + 15 * 60,
      handle: "pending_0000000000004000",
      locale: "en",
      passkeyRegistered: false,
    });
    expect(database.enrollProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        githubUserId: 123_456,
        handle: "pending_0000000000004000",
        inviteId: join.inviteId,
        inviteRequired: true,
        profileId: "00000000-0000-4000-8000-000000000502",
      }),
    );
    expect(enrollmentWrite()?.inviteVerifierDigest).toEqual(Buffer.alloc(32, 0x41));
    expect(enrollmentWrite()?.sessionVerifierDigest).toEqual(
      createHash("sha256")
        .update(Buffer.from(enrollingSession?.sessionVerifier ?? "", "base64url"))
        .digest(),
    );

    const passkeyStart = await service.beginPasskey(
      callback.sessionCookie,
      { handle: profileHandle },
      true,
    );
    expect(passkeyStart?.options.challenge).toHaveLength(43);
    expect(database.createPasskeyChallenge).toHaveBeenCalledOnce();
    expect(challengeSessionDigest()).toEqual(
      createHash("sha256")
        .update(Buffer.from(enrollingSession?.sessionVerifier ?? "", "base64url"))
        .digest(),
    );
    expect(challengeSessionDigestInput()).toEqual(Buffer.alloc(32));
    const completion = await service.completePasskey(
      callback.sessionCookie,
      passkeyStart?.passkeyCookie ?? "",
      { response: { id: "synthetic" } },
      true,
    );
    expect(completion).toBeDefined();
    expect(verifyPasskey).toHaveBeenCalledOnce();
    expect(database.completeInitialPasskey).toHaveBeenCalledWith(
      expect.objectContaining({
        challengeId: "00000000-0000-4000-8000-000000000504",
        handle: profileHandle,
        passkeyId: "00000000-0000-4000-8000-000000000505",
        rotatedSessionId: "00000000-0000-4000-8000-000000000506",
        rotatedSessionExpiresAt: new Date(now.valueOf() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        sessionId: "00000000-0000-4000-8000-000000000503",
        signCount: 3,
      }),
    );
    const activeSession = service.readSession(completion?.sessionCookie);
    expect(activeSession).toMatchObject({
      expiresAt: Math.floor(now.valueOf() / 1000) + 30 * 24 * 60 * 60,
      passkeyRegistered: true,
      sessionId: "00000000-0000-4000-8000-000000000506",
    });
    expect(activeSession?.sessionVerifier).not.toBe(enrollingSession?.sessionVerifier);
    await expect(service.logout(completion?.sessionCookie)).resolves.toBe(true);
    expect(database.revokeSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "00000000-0000-4000-8000-000000000506" }),
    );
  });

  it.each([false, undefined, "true", 1])(
    "requires literal enrollment enablement before all enrollment work for value %#",
    async (enrollmentEnabled) => {
      const { database, exchangeGithub, service, verifyPasskey } = createFixture();
      const hostileJoin = new Proxy(join, {
        get() {
          throw new Error("join-must-not-be-read");
        },
      });
      const inaccessible = new Proxy(
        {},
        {
          get() {
            throw new Error("enrollment-input-must-not-be-read");
          },
        },
      ) as unknown as string;
      const hostileBody = new Proxy(
        {},
        {
          ownKeys() {
            throw new Error("passkey-body-must-not-be-read");
          },
        },
      );

      expect(service.beginGithub(hostileJoin, enrollmentEnabled)).toBeUndefined();
      await expect(
        service.completeGithub(
          inaccessible,
          inaccessible,
          inaccessible,
          inaccessible as unknown as AbortSignal,
          enrollmentEnabled,
          enrollmentEnabled,
        ),
      ).resolves.toBeUndefined();
      await expect(
        service.beginPasskey(inaccessible, hostileBody, enrollmentEnabled),
      ).resolves.toBeUndefined();
      await expect(
        service.completePasskey(inaccessible, inaccessible, hostileBody, enrollmentEnabled),
      ).resolves.toBeUndefined();

      expect(exchangeGithub).not.toHaveBeenCalled();
      expect(verifyPasskey).not.toHaveBeenCalled();
      expect(database.enrollProfile).not.toHaveBeenCalled();
      expect(database.createPasskeyChallenge).not.toHaveBeenCalled();
      expect(database.completeInitialPasskey).not.toHaveBeenCalled();
    },
  );

  it("creates a profile-free challenge and mints a credential-derived passkey session", async () => {
    const {
      database,
      loginCompletion,
      loginCredentialLookup,
      service,
      verifiedLoginCredential,
      verifyLogin,
    } = createFixture();
    const start = await service.beginLogin();
    expect(start?.options.challenge).toHaveLength(43);

    const credentialId = Buffer.alloc(32, 0x74);
    const response = {
      clientExtensionResults: {},
      id: credentialId.toString("base64url"),
      rawId: credentialId.toString("base64url"),
      response: {},
      type: "public-key",
    };
    const completion = await service.completeLogin(start?.loginCookie ?? "", { response });
    expect(completion).toBeDefined();
    expect(database.readPasskeyLoginMaterial).toHaveBeenCalledWith(Buffer.alloc(32));
    expect(loginCredentialLookup()).toEqual(credentialId);
    expect(verifyLogin).toHaveBeenCalledWith(
      response,
      start?.options.challenge,
      "https://race.example.com",
      "race.example.com",
      expect.objectContaining({
        backupEligible: true,
        signCount: 3,
      }),
    );
    expect(verifiedLoginCredential()).toEqual(credentialId);
    expect(database.completePasskeyLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        backupState: true,
        challengeExpiresAt: new Date(now.valueOf() + 5 * 60 * 1000).toISOString(),
        challengeId: "00000000-0000-4000-8000-000000000502",
        observedSignCount: 4,
        passkeyId: "00000000-0000-4000-8000-000000000511",
        sessionExpiresAt: new Date(now.valueOf() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        sessionId: "00000000-0000-4000-8000-000000000503",
      }),
    );
    expect(loginCompletion()?.challengeDigest).toEqual(Buffer.alloc(32));
    expect(loginCompletion()?.contextDigest).toEqual(Buffer.alloc(32));
    expect(loginCompletion()?.credentialId).toEqual(Buffer.alloc(32));
    expect(loginCompletion()?.sessionVerifierDigest).toEqual(Buffer.alloc(32));
    expect(service.readSession(completion?.sessionCookie)).toMatchObject({
      handle: "pixel_driver",
      locale: "en",
      passkeyRegistered: true,
      profileId: join.inviteId,
      sessionId: "00000000-0000-4000-8000-000000000503",
    });
  });

  it("reads only the exact active session's bounded passkey inventory", async () => {
    const { cookieCodec, database, inventorySessionDigest, inventorySessionDigestInput, service } =
      createFixture();
    const verifier = Buffer.alloc(32, 0x45);
    const sessionCookie = cookieCodec.seal("session", {
      expiresAt: Math.floor(now.valueOf() / 1000) + 3600,
      handle: profileHandle,
      locale: join.locale,
      passkeyRegistered: true,
      profileId: join.inviteId,
      sessionId: "00000000-0000-4000-8000-000000000512",
      sessionVerifier: verifier.toString("base64url"),
      version: 1,
    });

    await expect(service.readPasskeyInventory(sessionCookie)).resolves.toEqual([
      expect.objectContaining({
        currentAuthenticator: true,
        label: "Primary passkey",
        state: "active",
      }),
      expect.objectContaining({
        currentAuthenticator: false,
        label: "Backup passkey",
        state: "active",
      }),
    ]);
    expect(database.readPasskeyInventory).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "00000000-0000-4000-8000-000000000512" }),
    );
    expect(inventorySessionDigest()).toEqual(createHash("sha256").update(verifier).digest());
    expect(inventorySessionDigestInput()).toEqual(Buffer.alloc(32));
    await expect(service.readPasskeyInventory("invalid")).resolves.toBeUndefined();
    expect(database.readPasskeyInventory).toHaveBeenCalledOnce();
  });

  it("builds one private dashboard and binds every account action to an opaque session control", async () => {
    const {
      accountTargetChallengeWrite,
      accountTargetCompletionWrites,
      agentAccountPauseWrite,
      cookieCodec,
      database,
      service,
      verifyLogin,
    } = createFixture();
    const verifier = Buffer.alloc(32, 0x4b);
    const sessionId = "00000000-0000-4000-8000-000000000517";
    const sessionCookie = cookieCodec.seal("session", {
      expiresAt: Math.floor(now.valueOf() / 1000) + 3600,
      handle: profileHandle,
      locale: join.locale,
      passkeyRegistered: true,
      profileId: join.inviteId,
      sessionId,
      sessionVerifier: verifier.toString("base64url"),
      version: 1,
    });
    const agentAccountId = `acc_${"A".repeat(22)}`;
    const installationId = `ins_${"B".repeat(22)}`;
    const deviceId = `dev_${"C".repeat(22)}`;
    vi.mocked(database.readAgentAccountDashboard).mockResolvedValueOnce({
      accounts: [
        {
          accountingRevision: 1,
          agentAccountId,
          devices: [{ deviceId, installationId, state: "active" }],
          expectedReaderVersion: "codex_daily_usage_v1",
          identityAssurance: "community_local",
          lastSuccessfulSyncDate: "2026-07-16",
          observedReaderVersion: "codex_daily_usage_v1",
          privateLabel: "Personal account",
          provider: "codex",
          quarantineReason: null,
          state: "paused",
          status: "paused",
          todayTokenTotal: "9007199254740993",
          weeklyTokenTotal: "999999999999999999999999999999999999999999999999999999999999",
        },
      ],
      installations: [
        {
          accounts: [
            {
              agentAccountId,
              deviceId,
              deviceState: "active",
              privateLabel: "Personal account",
            },
          ],
          architecture: "x86_64",
          connectedDate: "2026-07-14",
          connectorVersion: "1.2.3",
          installationId,
          label: "Studio PC",
          lastSeenDate: "2026-07-16",
          osFamily: "windows",
          state: "active",
        },
      ],
    });

    const dashboard = await service.readAccountDashboard(sessionCookie);
    expect(dashboard).toMatchObject({
      accounts: [
        {
          connectedDeviceCount: 1,
          privateLabel: "Personal account",
          status: "paused",
          todayTokenTotal: "9007199254740993",
        },
      ],
      installations: [
        {
          accounts: [{ deviceState: "active", privateLabel: "Personal account" }],
          label: "Studio PC",
        },
      ],
      ranking: { weeklyTokenTotal: "2800" },
    });
    expect(JSON.stringify(dashboard)).not.toContain(agentAccountId);
    expect(JSON.stringify(dashboard)).not.toContain(installationId);
    expect(JSON.stringify(dashboard)).not.toContain(deviceId);
    const accountControl = dashboard?.accounts[0]?.control ?? "";
    const installationControl = dashboard?.installations[0]?.control ?? "";
    const deviceControl = dashboard?.installations[0]?.accounts[0]?.deviceControl ?? "";
    expect(cookieCodec.open("passkey", accountControl)).toMatchObject({
      sessionId,
      targetId: agentAccountId,
      targetKind: "agent_account",
    });
    expect(cookieCodec.open("passkey", installationControl)).toMatchObject({
      sessionId,
      targetId: installationId,
      targetKind: "installation",
    });
    expect(cookieCodec.open("passkey", deviceControl)).toMatchObject({
      sessionId,
      targetId: deviceId,
      targetKind: "device",
    });

    await expect(service.pauseAgentAccount(sessionCookie, "invalid")).resolves.toBe(false);
    await expect(service.pauseAgentAccount(sessionCookie, accountControl)).resolves.toBe(true);
    expect(agentAccountPauseWrite()).toEqual({
      agentAccountId,
      sessionId,
      sessionVerifierDigest: createHash("sha256").update(verifier).digest(),
    });

    const credentialId = Buffer.alloc(32, 0x74);
    const response = {
      id: credentialId.toString("base64url"),
      rawId: credentialId.toString("base64url"),
      response: {},
      type: "public-key",
    };
    const actions = [
      {
        control: accountControl,
        databaseMethod: database.completeAgentAccountReactivation,
        purpose: "account_reactivate" as const,
        targetId: agentAccountId,
      },
      {
        control: accountControl,
        databaseMethod: database.completeAgentAccountUnlink,
        purpose: "account_unlink" as const,
        targetId: agentAccountId,
      },
      {
        control: deviceControl,
        databaseMethod: database.completeDeviceKeyRevocation,
        purpose: "device_revoke" as const,
        targetId: deviceId,
      },
      {
        control: installationControl,
        databaseMethod: database.completeInstallationRevocation,
        purpose: "installation_revoke" as const,
        targetId: installationId,
      },
    ];
    for (const action of actions) {
      const start = await service.beginAccountTargetAction(
        sessionCookie,
        { targetControl: action.control },
        action.purpose,
      );
      expect(start?.options.challenge).toHaveLength(43);
      expect(accountTargetChallengeWrite()).toMatchObject({
        purpose: action.purpose,
        sessionId,
      });
      expect(accountTargetChallengeWrite()?.contextDigest).toEqual(
        createHash("sha256")
          .update(
            `viberacing-account-target-action-v1\n${sessionId}\n${action.purpose}\n${action.targetId}\n${config.webauthnRpId}\n${config.webauthnOrigin}`,
            "utf8",
          )
          .digest(),
      );
      await expect(
        service.completeAccountTargetAction(
          sessionCookie,
          start?.actionCookie ?? "",
          { response },
          action.purpose,
        ),
      ).resolves.toBe(true);
      expect(action.databaseMethod).toHaveBeenCalledOnce();
    }
    expect(verifyLogin).toHaveBeenCalledTimes(4);
    expect(accountTargetCompletionWrites).toHaveLength(4);
    expect(accountTargetCompletionWrites.map(({ targetId }) => targetId)).toEqual(
      actions.map(({ targetId }) => targetId),
    );
    expect(accountTargetCompletionWrites[0]).toMatchObject({
      observedSignCount: 4,
      sessionId,
      verifiedPasskeyId: "00000000-0000-4000-8000-000000000511",
    });

    await expect(
      service.beginAccountTargetAction(
        sessionCookie,
        { targetControl: accountControl },
        "device_revoke",
      ),
    ).resolves.toBeUndefined();
    await expect(
      service.beginAccountTargetAction(
        sessionCookie,
        { extra: true, targetControl: accountControl },
        "account_unlink",
      ),
    ).resolves.toBeUndefined();
    const otherSessionCookie = cookieCodec.seal("session", {
      expiresAt: Math.floor(now.valueOf() / 1000) + 3600,
      handle: profileHandle,
      locale: join.locale,
      passkeyRegistered: true,
      profileId: join.inviteId,
      sessionId: "00000000-0000-4000-8000-000000000518",
      sessionVerifier: verifier.toString("base64url"),
      version: 1,
    });
    await expect(
      service.beginAccountTargetAction(
        otherSessionCookie,
        { targetControl: accountControl },
        "account_unlink",
      ),
    ).resolves.toBeUndefined();
  });

  it("reads and changes only the possessed session's public profile visibility", async () => {
    const {
      cookieCodec,
      database,
      providerBreakdownWrite,
      service,
      visibilityRead,
      visibilityReadDigestInput,
      visibilityWrite,
      visibilityWriteDigestInput,
    } = createFixture();
    const verifier = Buffer.alloc(32, 0x47);
    const sessionCookie = cookieCodec.seal("session", {
      expiresAt: Math.floor(now.valueOf() / 1000) + 3600,
      handle: profileHandle,
      locale: join.locale,
      passkeyRegistered: true,
      profileId: join.inviteId,
      sessionId: "00000000-0000-4000-8000-000000000513",
      sessionVerifier: verifier.toString("base64url"),
      version: 1,
    });

    await expect(service.readProfileVisibility(sessionCookie)).resolves.toBe("public");
    expect(visibilityRead()).toMatchObject({
      sessionId: "00000000-0000-4000-8000-000000000513",
      sessionVerifierDigest: createHash("sha256").update(verifier).digest(),
    });
    expect(visibilityReadDigestInput()).toEqual(Buffer.alloc(32));

    await expect(service.setProfileVisibility(sessionCookie, false)).resolves.toBe("hidden");
    expect(visibilityWrite()).toMatchObject({
      publiclyVisible: false,
      sessionId: "00000000-0000-4000-8000-000000000513",
      sessionVerifierDigest: createHash("sha256").update(verifier).digest(),
    });
    expect(visibilityWriteDigestInput()).toEqual(Buffer.alloc(32));

    await expect(service.setProviderBreakdownVisibility(sessionCookie, true)).resolves.toBe(true);
    expect(providerBreakdownWrite()).toEqual({
      providerBreakdownVisible: true,
      sessionId: "00000000-0000-4000-8000-000000000513",
      sessionVerifierDigest: createHash("sha256").update(verifier).digest(),
    });
    await expect(service.readProfileVisibility("invalid")).resolves.toBeUndefined();
    await expect(service.setProfileVisibility("invalid", true)).resolves.toBeUndefined();
    await expect(service.setProviderBreakdownVisibility("invalid", true)).resolves.toBeUndefined();
    expect(database.readProfileVisibility).toHaveBeenCalledOnce();
    expect(database.setProfileVisibility).toHaveBeenCalledOnce();
  });

  it("freshly authorizes and atomically adds one backup passkey", async () => {
    const {
      addChallengeWrite,
      additionWrite,
      authenticationChallenge,
      cookieCodec,
      database,
      registrationChallenge,
      service,
      verifyLogin,
      verifyPasskey,
    } = createFixture();
    const verifier = Buffer.alloc(32, 0x46);
    const sessionCookie = cookieCodec.seal("session", {
      expiresAt: Math.floor(now.valueOf() / 1000) + 3600,
      handle: profileHandle,
      locale: join.locale,
      passkeyRegistered: true,
      profileId: join.inviteId,
      sessionId: "00000000-0000-4000-8000-000000000520",
      sessionVerifier: verifier.toString("base64url"),
      version: 1,
    });
    const start = await service.beginPasskeyAdd(sessionCookie, { label: "Backup passkey" });
    expect(start?.authenticationOptions.challenge).toBe(authenticationChallenge);
    expect(start?.registrationOptions.challenge).toBe(registrationChallenge);
    expect(database.createPasskeyAddChallenge).toHaveBeenCalledOnce();
    expect(addChallengeWrite()).toMatchObject({
      challengeId: "00000000-0000-4000-8000-000000000502",
      sessionId: "00000000-0000-4000-8000-000000000520",
    });

    const credentialId = Buffer.alloc(32, 0x74);
    const authentication = {
      id: credentialId.toString("base64url"),
      rawId: credentialId.toString("base64url"),
      response: {},
      type: "public-key",
    };
    const body = {
      authentication,
      registration: { id: "synthetic-registration" },
    };
    await expect(
      service.completePasskeyAdd(sessionCookie, start?.passkeyAddCookie ?? "", body),
    ).resolves.toBe(true);
    expect(verifyLogin).toHaveBeenCalledWith(
      authentication,
      authenticationChallenge,
      config.webauthnOrigin,
      config.webauthnRpId,
      expect.any(Object),
    );
    expect(verifyPasskey).toHaveBeenCalledWith(
      body.registration,
      registrationChallenge,
      config.webauthnOrigin,
      config.webauthnRpId,
    );
    expect(additionWrite()).toMatchObject({
      challengeId: "00000000-0000-4000-8000-000000000502",
      label: "Backup passkey",
      observedSignCount: 4,
      passkeyId: "00000000-0000-4000-8000-000000000503",
      sessionId: "00000000-0000-4000-8000-000000000520",
      verifiedPasskeyId: "00000000-0000-4000-8000-000000000511",
    });

    vi.mocked(database.completePasskeyAddition).mockResolvedValueOnce(false);
    await expect(
      service.completePasskeyAdd(sessionCookie, start?.passkeyAddCookie ?? "", body),
    ).resolves.toBe(false);
    await expect(
      service.completePasskeyAdd(sessionCookie, start?.passkeyAddCookie ?? "", {
        ...body,
        label: "Changed label",
      }),
    ).resolves.toBe(false);
    await expect(
      service.beginPasskeyAdd(sessionCookie, { label: " Backup passkey" }),
    ).resolves.toBeUndefined();
    expect(database.createPasskeyAddChallenge).toHaveBeenCalledOnce();
  });

  it("authorizes and atomically revokes only a non-current owned passkey", async () => {
    const { cookieCodec, database, revokeChallengeWrite, revocationWrite, service, verifyLogin } =
      createFixture();
    const verifier = Buffer.alloc(32, 0x46);
    const sessionCookie = cookieCodec.seal("session", {
      expiresAt: Math.floor(now.valueOf() / 1000) + 3600,
      handle: profileHandle,
      locale: join.locale,
      passkeyRegistered: true,
      profileId: join.inviteId,
      sessionId: "00000000-0000-4000-8000-000000000520",
      sessionVerifier: verifier.toString("base64url"),
      version: 1,
    });
    const targetPasskeyId = "00000000-0000-4000-8000-000000000512";
    const start = await service.beginPasskeyRevoke(sessionCookie, { passkeyId: targetPasskeyId });
    expect(start?.options.challenge).toHaveLength(43);
    expect(database.createPasskeyRevokeChallenge).toHaveBeenCalledOnce();
    expect(revokeChallengeWrite()).toMatchObject({
      challengeId: "00000000-0000-4000-8000-000000000502",
      sessionId: "00000000-0000-4000-8000-000000000520",
    });

    const credentialId = Buffer.alloc(32, 0x74);
    const response = {
      id: credentialId.toString("base64url"),
      rawId: credentialId.toString("base64url"),
      response: {},
      type: "public-key",
    };
    await expect(
      service.completePasskeyRevoke(sessionCookie, start?.passkeyRevokeCookie ?? "", { response }),
    ).resolves.toBe(true);
    expect(verifyLogin).toHaveBeenCalledOnce();
    expect(revocationWrite()).toMatchObject({
      challengeId: "00000000-0000-4000-8000-000000000502",
      observedSignCount: 4,
      sessionId: "00000000-0000-4000-8000-000000000520",
      targetPasskeyId,
      verifiedPasskeyId: "00000000-0000-4000-8000-000000000511",
    });

    vi.mocked(database.completePasskeyRevocation).mockResolvedValueOnce(false);
    await expect(
      service.completePasskeyRevoke(sessionCookie, start?.passkeyRevokeCookie ?? "", { response }),
    ).resolves.toBe(false);
    await expect(
      service.beginPasskeyRevoke(sessionCookie, {
        passkeyId: "00000000-0000-4000-8000-000000000511",
      }),
    ).resolves.toBeUndefined();
    await expect(
      service.beginPasskeyRevoke(sessionCookie, { extra: true, passkeyId: targetPasskeyId }),
    ).resolves.toBeUndefined();
    expect(database.createPasskeyRevokeChallenge).toHaveBeenCalledOnce();
  });

  it("replaces one recovery-code batch only after an exact fresh passkey assertion", async () => {
    const {
      authenticationChallenge,
      cookieCodec,
      database,
      generateRecoveryCodes,
      recoveryChallengeWrite,
      recoveryCodeRecords,
      recoveryReplacementWrite,
      service,
      verifyLogin,
    } = createFixture();
    const verifier = Buffer.alloc(32, 0x49);
    const sessionId = "00000000-0000-4000-8000-000000000520";
    const sessionCookie = cookieCodec.seal("session", {
      expiresAt: Math.floor(now.valueOf() / 1000) + 3600,
      handle: profileHandle,
      locale: join.locale,
      passkeyRegistered: true,
      profileId: join.inviteId,
      sessionId,
      sessionVerifier: verifier.toString("base64url"),
      version: 1,
    });

    const start = await service.beginRecoveryCodeRotation(sessionCookie);
    expect(start?.options.challenge).toBe(authenticationChallenge);
    expect(recoveryChallengeWrite()).toMatchObject({
      challengeId: "00000000-0000-4000-8000-000000000502",
      sessionId,
      sessionVerifierDigest: createHash("sha256").update(verifier).digest(),
    });
    expect(recoveryChallengeWrite()?.contextDigest).toEqual(
      createHash("sha256")
        .update(
          `viberacing-recovery-code-rotation-v1\n${sessionId}\n${activeProfileId}\n${config.webauthnRpId}\n${config.webauthnOrigin}`,
          "utf8",
        )
        .digest(),
    );

    const credentialId = Buffer.alloc(32, 0x74);
    const response = {
      id: credentialId.toString("base64url"),
      rawId: credentialId.toString("base64url"),
      response: {},
      type: "public-key",
    };
    const completed = await service.completeRecoveryCodeRotation(
      sessionCookie,
      start?.recoveryCodeCookie ?? "",
      { response },
    );

    expect(completed).toEqual({
      recoveryCodes: recoveryCodeRecords.map(({ plaintext }) => plaintext),
    });
    expect(Object.isFrozen(completed)).toBe(true);
    expect(Object.isFrozen(completed?.recoveryCodes)).toBe(true);
    expect(verifyLogin).toHaveBeenCalledOnce();
    expect(generateRecoveryCodes).toHaveBeenCalledOnce();
    expect(recoveryReplacementWrite()).toMatchObject({
      backupState: true,
      batchId: "00000000-0000-4000-8000-000000000503",
      challengeId: "00000000-0000-4000-8000-000000000502",
      observedSignCount: 4,
      recoveryCodeIds: recoveryCodeRecords.map(({ codeId }) => codeId),
      sessionId,
      verifierPhcs: recoveryCodeRecords.map(({ verifierPhc }) => verifierPhc),
      verifiedPasskeyId: "00000000-0000-4000-8000-000000000511",
    });
    expect(recoveryReplacementWrite()?.contextDigest).toEqual(
      recoveryChallengeWrite()?.contextDigest,
    );

    vi.mocked(generateRecoveryCodes).mockResolvedValueOnce([]);
    await expect(
      service.completeRecoveryCodeRotation(sessionCookie, start?.recoveryCodeCookie ?? "", {
        response,
      }),
    ).resolves.toBeUndefined();
    vi.mocked(database.completeRecoveryCodeReplacement).mockResolvedValueOnce(false);
    await expect(
      service.completeRecoveryCodeRotation(sessionCookie, start?.recoveryCodeCookie ?? "", {
        response,
      }),
    ).resolves.toBeUndefined();
    await expect(
      service.completeRecoveryCodeRotation(sessionCookie, "invalid", { response }),
    ).resolves.toBeUndefined();
    await expect(service.beginRecoveryCodeRotation("invalid")).resolves.toBeUndefined();
    expect(database.createRecoveryCodeChallenge).toHaveBeenCalledOnce();
    expect(database.completeRecoveryCodeReplacement).toHaveBeenCalledTimes(2);
  });

  it("turns one verified recovery code into a replacement passkey before creating a session", async () => {
    const {
      cookieCodec,
      createRecoveryOptions,
      database,
      recoveryCodeRecords,
      recoveryCompletionWrite,
      recoveryStartWrite,
      registrationChallenge,
      service,
      verifyPasskey,
      verifyRecoveryCode,
    } = createFixture();
    const recoveryCode = recoveryCodeRecords[0];
    expect(recoveryCode).toBeDefined();
    vi.mocked(database.readRecoveryCodeVerificationMaterial).mockResolvedValue({
      recoveryCodeId: recoveryCode?.codeId ?? "",
      verifierPhc: recoveryCode?.verifierPhc ?? "",
    });
    let verifiedSecret: Buffer | undefined;
    vi.mocked(verifyRecoveryCode).mockImplementation((secret, verifierPhc) => {
      verifiedSecret = secret === undefined ? undefined : Buffer.from(secret);
      expect(verifierPhc).toBe(recoveryCode?.verifierPhc);
      return Promise.resolve(true);
    });

    const started = await service.beginRecovery({
      code: recoveryCode?.plaintext,
      label: "Replacement passkey",
    });

    expect(started?.options.challenge).toBe(registrationChallenge);
    expect(createRecoveryOptions).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000502",
      config.webauthnRpId,
    );
    expect(verifiedSecret).toEqual(
      Buffer.from(recoveryCode?.plaintext.split("_").at(-1) ?? "", "base64url"),
    );
    expect(recoveryStartWrite()).toMatchObject({
      authorityId: "00000000-0000-4000-8000-000000000502",
      expiresAt: "2026-07-16T10:05:00.000Z",
      recoveryCodeId: recoveryCode?.codeId,
    });
    expect(recoveryStartWrite()?.contextDigest).toEqual(
      createHash("sha256")
        .update(
          `viberacing-recovery-passkey-v1\n00000000-0000-4000-8000-000000000502\nReplacement passkey\n${registrationChallenge}\n${config.webauthnRpId}\n${config.webauthnOrigin}`,
          "utf8",
        )
        .digest(),
    );
    const sealed = cookieCodec.open("recovery", started?.recoveryCookie ?? "") as Record<
      string,
      unknown
    >;
    expect(sealed).toMatchObject({
      authorityId: "00000000-0000-4000-8000-000000000502",
      challenge: registrationChallenge,
      label: "Replacement passkey",
      version: 1,
    });
    expect(JSON.stringify(sealed)).not.toContain(recoveryCode?.plaintext ?? "missing");

    const completed = await service.completeRecovery(started?.recoveryCookie ?? "", {
      response: {},
    });

    expect(verifyPasskey).toHaveBeenCalledWith(
      {},
      registrationChallenge,
      config.webauthnOrigin,
      config.webauthnRpId,
    );
    expect(recoveryCompletionWrite()).toMatchObject({
      authorityId: "00000000-0000-4000-8000-000000000502",
      backupEligible: true,
      backupState: false,
      label: "Replacement passkey",
      passkeyId: "00000000-0000-4000-8000-000000000503",
      sessionExpiresAt: "2026-08-15T10:00:00.000Z",
      sessionId: "00000000-0000-4000-8000-000000000504",
      signCount: 3,
    });
    expect(service.readSession(completed?.sessionCookie)).toMatchObject({
      handle: profileHandle,
      passkeyRegistered: true,
      profileId: join.inviteId,
      sessionId: "00000000-0000-4000-8000-000000000504",
    });
  });

  it("creates no session or replacement key when recovery WebAuthn verification fails", async () => {
    const { cookieCodec, database, service, verifyPasskey } = createFixture();
    const recoveryCookie = cookieCodec.seal("recovery", {
      authorityId: "00000000-0000-4000-8000-000000000601",
      authoritySecret: Buffer.alloc(32, 0x61).toString("base64url"),
      challenge: Buffer.alloc(32, 0x62).toString("base64url"),
      expiresAt: Math.floor(now.valueOf() / 1000) + 300,
      label: "Replacement passkey",
      version: 1,
    });
    vi.mocked(verifyPasskey).mockResolvedValueOnce(undefined);

    await expect(
      service.completeRecovery(recoveryCookie, { response: { id: "invalid" } }),
    ).resolves.toBeUndefined();

    expect(verifyPasskey).toHaveBeenCalledOnce();
    expect(database.completeRecoveryRegistration).not.toHaveBeenCalled();
    expect(database.revokeSession).not.toHaveBeenCalled();
  });

  it("keeps unknown, wrong, and malformed recovery attempts outside restricted authority", async () => {
    const { database, recoveryCodeRecords, service, verifyRecoveryCode } = createFixture();
    const recoveryCode = recoveryCodeRecords[0];
    vi.mocked(verifyRecoveryCode).mockResolvedValue(false);

    await expect(
      service.beginRecovery({ code: recoveryCode?.plaintext, label: "Replacement passkey" }),
    ).resolves.toBeUndefined();
    await expect(service.beginRecovery({ code: "bad", extra: true })).resolves.toBeUndefined();

    expect(database.readRecoveryCodeVerificationMaterial).toHaveBeenNthCalledWith(
      1,
      recoveryCode?.codeId,
    );
    expect(database.readRecoveryCodeVerificationMaterial).toHaveBeenNthCalledWith(
      2,
      "00000000-0000-4000-8000-000000000000",
    );
    expect(verifyRecoveryCode).toHaveBeenCalledTimes(2);
    expect(database.startRecovery).not.toHaveBeenCalled();
    expect(database.completeRecoveryRegistration).not.toHaveBeenCalled();
  });

  it("requires an exact handle and fresh passkey before atomically requesting deletion", async () => {
    const {
      cookieCodec,
      database,
      deletionChallengeWrite,
      deletionWrite,
      authenticationChallenge,
      service,
      verifyLogin,
    } = createFixture();
    const verifier = Buffer.alloc(32, 0x48);
    const sessionId = "00000000-0000-4000-8000-000000000520";
    const sessionCookie = cookieCodec.seal("session", {
      expiresAt: Math.floor(now.valueOf() / 1000) + 3600,
      handle: profileHandle,
      locale: join.locale,
      passkeyRegistered: true,
      profileId: join.inviteId,
      sessionId,
      sessionVerifier: verifier.toString("base64url"),
      version: 1,
    });

    await expect(
      service.beginProfileDeletion(sessionCookie, { handle: "other_driver" }),
    ).resolves.toBeUndefined();
    const start = await service.beginProfileDeletion(sessionCookie, { handle: profileHandle });
    expect(start?.options.challenge).toBe(authenticationChallenge);
    expect(database.createProfileDeletionChallenge).toHaveBeenCalledOnce();
    expect(deletionChallengeWrite()).toMatchObject({
      challengeId: "00000000-0000-4000-8000-000000000502",
      sessionId,
      sessionVerifierDigest: createHash("sha256").update(verifier).digest(),
    });
    expect(deletionChallengeWrite()?.contextDigest).toEqual(
      createHash("sha256")
        .update(
          `viberacing-profile-deletion-v1\n${sessionId}\n${activeProfileId}\n${profileHandle}\n${config.webauthnRpId}\n${config.webauthnOrigin}`,
          "utf8",
        )
        .digest(),
    );

    const credentialId = Buffer.alloc(32, 0x74);
    const response = {
      id: credentialId.toString("base64url"),
      rawId: credentialId.toString("base64url"),
      response: {},
      type: "public-key",
    };
    await expect(
      service.completeProfileDeletion(sessionCookie, start?.profileDeletionCookie ?? "", {
        response,
      }),
    ).resolves.toBe(true);
    expect(verifyLogin).toHaveBeenCalledOnce();
    expect(deletionWrite()).toMatchObject({
      challengeId: "00000000-0000-4000-8000-000000000502",
      observedSignCount: 4,
      sessionId,
      typedHandle: profileHandle,
      verifiedPasskeyId: "00000000-0000-4000-8000-000000000511",
    });

    vi.mocked(database.completeProfileDeletion).mockResolvedValueOnce(false);
    await expect(
      service.completeProfileDeletion(sessionCookie, start?.profileDeletionCookie ?? "", {
        response,
      }),
    ).resolves.toBe(false);
    const wrongHandleCookie = cookieCodec.seal("passkey", {
      challenge: authenticationChallenge,
      challengeId: "00000000-0000-4000-8000-000000000522",
      expiresAt: Math.floor(now.valueOf() / 1000) + 300,
      handle: "other_driver",
      version: 1,
    });
    await expect(
      service.completeProfileDeletion(sessionCookie, wrongHandleCookie, { response }),
    ).resolves.toBe(false);
  });

  it("revokes a minted login session when its browser cookie cannot be sealed", async () => {
    const fixture = createFixture();
    const credentialId = Buffer.alloc(32, 0x74);
    const challenge = Buffer.alloc(32, 0x61).toString("base64url");
    const uuids = [
      "00000000-0000-4000-8000-000000000520",
      "00000000-0000-4000-8000-000000000521",
      "00000000-0000-4000-8000-000000000522",
    ];
    const service = createEnrollmentService({
      config,
      cookieCodec: {
        open: () => ({
          challenge,
          challengeId: "00000000-0000-4000-8000-000000000519",
          expiresAt: Math.floor(now.valueOf() / 1000) + 300,
          version: 1,
        }),
        seal: () => {
          throw new Error("cookie unavailable");
        },
      },
      database: fixture.database,
      now: () => now,
      randomBytes: (size) => Buffer.alloc(size, 0x31),
      randomUuid: () => uuids.shift() ?? "invalid",
      verifyLogin: () => Promise.resolve({ backupState: false, signCount: 4 }),
    });
    const response = {
      id: credentialId.toString("base64url"),
      rawId: credentialId.toString("base64url"),
      response: {},
      type: "public-key",
    };
    await expect(service.completeLogin("opaque", { response })).resolves.toBeUndefined();
    expect(fixture.database.completePasskeyLogin).toHaveBeenCalledOnce();
    expect(fixture.database.revokeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "00000000-0000-4000-8000-000000000520",
      }),
    );
  });

  it("fails closed for mismatched state, invalid cookies, repeated registration, and legacy labels", async () => {
    const { database, exchangeGithub, service, verifyPasskey } = createFixture();
    const start = service.beginGithub(join, true);
    const state = new URL(start?.redirectUrl ?? "invalid:").searchParams.get("state") ?? "";
    expect(service.cancelGithub(state, start?.oauthCookie ?? "")).toBe(true);
    expect(
      service.cancelGithub(Buffer.alloc(32, 9).toString("base64url"), start?.oauthCookie ?? ""),
    ).toBe(false);
    await expect(
      service.completeGithub(
        "valid_code_123",
        Buffer.alloc(32, 9).toString("base64url"),
        start?.oauthCookie ?? "",
        new AbortController().signal,
        true,
        true,
      ),
    ).resolves.toBeUndefined();
    expect(exchangeGithub).not.toHaveBeenCalled();
    await expect(
      service.beginPasskey("invalid", { handle: profileHandle }, true),
    ).resolves.toBeUndefined();
    await expect(service.completePasskey("invalid", "invalid", {}, true)).resolves.toBeUndefined();
    await expect(service.logout("invalid")).resolves.toBe(true);
    expect(database.enrollProfile).not.toHaveBeenCalled();

    const callback = await service.completeGithub(
      "valid_code_123",
      state,
      start?.oauthCookie ?? "",
      new AbortController().signal,
      true,
      true,
    );
    expect(callback?.outcome).toBe("continue");
    if (callback?.outcome !== "continue") {
      throw new Error("Expected enrollment continuation.");
    }
    await expect(
      service.beginPasskey(callback.sessionCookie, { handle: "pending_forbidden" }, true),
    ).resolves.toBeUndefined();
    const passkey = await service.beginPasskey(
      callback.sessionCookie,
      { handle: profileHandle },
      true,
    );
    await expect(
      service.completePasskey(
        callback.sessionCookie,
        passkey?.passkeyCookie ?? "",
        {
          label: "unsafe\nlabel",
          response: {},
        },
        true,
      ),
    ).resolves.toBeUndefined();
    expect(verifyPasskey).not.toHaveBeenCalled();

    const completed = await service.completePasskey(
      callback.sessionCookie,
      passkey?.passkeyCookie ?? "",
      { response: {} },
      true,
    );
    await expect(
      service.completePasskey(
        completed?.sessionCookie ?? "",
        passkey?.passkeyCookie ?? "",
        { response: {} },
        true,
      ),
    ).resolves.toBeUndefined();
    expect(database.completeInitialPasskey).toHaveBeenCalledOnce();
  });

  it("contains unavailable dependencies and invalid clocks", async () => {
    const fixture = createFixture();
    vi.mocked(fixture.database.enrollProfile).mockRejectedValue(new Error("database unavailable"));
    const start = fixture.service.beginGithub(join, true);
    const state = new URL(start?.redirectUrl ?? "invalid:").searchParams.get("state") ?? "";
    await expect(
      fixture.service.completeGithub(
        "valid_code_123",
        state,
        start?.oauthCookie ?? "",
        new AbortController().signal,
        true,
        true,
      ),
    ).resolves.toBeUndefined();

    const invalidClockService = createEnrollmentService({
      config,
      cookieCodec: createEnrollmentCookieCodec(config.cookieKey),
      database: fixture.database,
      now: () => new Date(Number.NaN),
    });
    expect(invalidClockService.beginGithub(join, true)).toBeUndefined();
    expect(invalidClockService.readSession(undefined)).toBeUndefined();
  });

  it("seals continuation cookies before consuming an invite or passkey challenge", async () => {
    const database: EnrollmentDatabase = {
      approveCarRecipe: vi.fn(() => Promise.resolve(true)),
      completeAgentAccountReactivation: vi.fn(() => Promise.resolve(true)),
      completeAgentAccountUnlink: vi.fn(() => Promise.resolve(true)),
      completeDeviceKeyRevocation: vi.fn(() => Promise.resolve(true)),
      completeInstallationRevocation: vi.fn(() => Promise.resolve(true)),
      completeInitialPasskey: vi.fn(() => Promise.resolve(true)),
      completePasskeyAddition: vi.fn(() => Promise.resolve(true)),
      completePasskeyLogin: vi.fn(() =>
        Promise.resolve({
          handle: "pixel_driver",
          locale: "en" as const,
          profileId: activeProfileId,
        }),
      ),
      completeRecoveryRegistration: vi.fn(() =>
        Promise.resolve({
          handle: "pixel_driver",
          locale: "en" as const,
          profileId: activeProfileId,
        }),
      ),
      completePasskeyRevocation: vi.fn(() => Promise.resolve(true)),
      completeProfileDeletion: vi.fn(() => Promise.resolve(true)),
      completeRecoveryCodeReplacement: vi.fn(() => Promise.resolve(true)),
      createPasskeyAddChallenge: vi.fn(() => Promise.resolve(true)),
      createPasskeyChallenge: vi.fn(() => Promise.resolve(true)),
      createPasskeyRevokeChallenge: vi.fn(() => Promise.resolve(true)),
      createProfileDeletionChallenge: vi.fn(() => Promise.resolve(true)),
      createAccountTargetChallenge: vi.fn(() => Promise.resolve(true)),
      createRecoveryCodeChallenge: vi.fn(() => Promise.resolve(true)),
      enrollProfile: vi.fn((input: EnrollmentDatabaseProfile) =>
        Promise.resolve({
          created: true,
          handle: input.handle,
          locale: input.locale,
          profileId: input.profileId,
          profileState: "enrolling" as const,
          sessionCreated: true,
        }),
      ),
      pauseAgentAccount: vi.fn(() => Promise.resolve(true)),
      proposeCarRecipe: vi.fn(() => Promise.resolve(true)),
      readAgentAccountDashboard: vi.fn(() => Promise.resolve({ accounts: [], installations: [] })),
      readCarRecipeState: vi.fn(() => Promise.resolve({ active: null, proposal: null })),
      readPasskeyInventory: vi.fn(() => Promise.resolve([])),
      readPasskeyLoginMaterial: vi.fn(() => Promise.resolve(undefined)),
      readRecoveryCodeVerificationMaterial: vi.fn(() => Promise.resolve(undefined)),
      readProfileVisibility: vi.fn(() => Promise.resolve("public" as const)),
      readPrivateDashboardRanking: vi.fn(() =>
        Promise.resolve({
          participantCount: 0,
          providerBreakdownVisible: false,
          publicVisibility: "public" as const,
          rankPosition: null,
          seasonEnd: "2026-07-19",
          seasonStart: "2026-07-13",
          seasonState: "open" as const,
          snapshotGeneratedAt: "2026-07-16T10:00Z",
          weeklyTokenTotal: "0",
        }),
      ),
      rejectCarRecipe: vi.fn(() => Promise.resolve(true)),
      revokeSession: vi.fn(() => Promise.resolve(true)),
      setProfileVisibility: vi.fn(() => Promise.resolve("hidden" as const)),
      setProviderBreakdownVisibility: vi.fn(() => Promise.resolve(false)),
      startRecovery: vi.fn(() => Promise.resolve(true)),
    };
    const seconds = Math.floor(now.valueOf() / 1000);
    const state = Buffer.alloc(32, 3).toString("base64url");
    const oauthService = createEnrollmentService({
      config,
      cookieCodec: {
        open: () => ({
          ...join,
          codeVerifier: Buffer.alloc(32, 4).toString("base64url"),
          expiresAt: seconds + 600,
          state,
          version: 1,
        }),
        seal: () => {
          throw new Error("cookie unavailable");
        },
      },
      database,
      exchangeGithub: () => Promise.resolve(123),
      now: () => now,
      randomBytes: (size) => Buffer.alloc(size, 5),
      randomUuid: () => "00000000-0000-4000-8000-000000000509",
    });
    await expect(
      oauthService.completeGithub(
        "valid_code_123",
        state,
        "opaque",
        new AbortController().signal,
        true,
        true,
      ),
    ).resolves.toBeUndefined();
    expect(database.enrollProfile).not.toHaveBeenCalled();

    const passkeyUuids = [
      "00000000-0000-4000-8000-000000000505",
      "00000000-0000-4000-8000-000000000506",
      "00000000-0000-4000-8000-000000000507",
      "00000000-0000-4000-8000-000000000508",
      "00000000-0000-4000-8000-000000000509",
    ];
    const passkeyService = createEnrollmentService({
      config,
      cookieCodec: {
        open: (kind) =>
          kind === "session"
            ? {
                expiresAt: seconds + 3600,
                handle: "pixel_driver",
                locale: "en",
                passkeyRegistered: false,
                profileId: "00000000-0000-4000-8000-000000000502",
                sessionId: "00000000-0000-4000-8000-000000000503",
                sessionVerifier: Buffer.alloc(32, 6).toString("base64url"),
                version: 1,
              }
            : {
                challenge: Buffer.alloc(32, 7).toString("base64url"),
                challengeId: "00000000-0000-4000-8000-000000000505",
                expiresAt: seconds + 300,
                handle: profileHandle,
                version: 1,
              },
        seal: () => {
          throw new Error("cookie unavailable");
        },
      },
      database,
      now: () => now,
      randomBytes: (size) => Buffer.alloc(size, 10),
      randomUuid: () => passkeyUuids.shift() ?? "invalid",
      verifyPasskey: () =>
        Promise.resolve({
          backupEligible: false,
          backupState: false,
          cosePublicKey: Buffer.alloc(77, 8),
          credentialId: Buffer.alloc(32, 9),
          signCount: 0,
        }),
    });
    await expect(
      passkeyService.beginPasskey("session", { handle: profileHandle }, true),
    ).resolves.toBeUndefined();
    expect(database.createPasskeyChallenge).not.toHaveBeenCalled();
    await expect(
      passkeyService.completePasskey("session", "passkey", { response: {} }, true),
    ).resolves.toBeUndefined();
    expect(database.completeInitialPasskey).not.toHaveBeenCalled();
  });
});
