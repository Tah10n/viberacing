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
  EnrollmentDatabaseLoginCompletion,
  EnrollmentDatabaseAccountOverviewRequest,
  EnrollmentDatabaseDeviceRevocation,
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
  EnrollmentDatabaseRecoveryCodeChallenge,
  EnrollmentDatabaseRecoveryCodeReplacement,
  EnrollmentDatabaseRecoveryCompletion,
  EnrollmentDatabaseRecoveryStart,
  EnrollmentDatabaseSourcePause,
  EnrollmentDatabaseSourceReactivation,
  EnrollmentDatabaseSourceReactivationChallenge,
  EnrollmentDatabaseSourceUnlink,
  EnrollmentDatabaseSourceUnlinkChallenge,
  EnrollmentDatabaseSourceDeviceInventoryRequest,
} from "./pairing-database-pool";

const now = new Date("2026-07-16T10:00:00.000Z");
const config = resolveEnrollmentConfig({
  GITHUB_CLIENT_ID: "Ov23abcdefghijklmno",
  GITHUB_CLIENT_SECRET: "a".repeat(40),
  NODE_ENV: "test",
  SESSION_SECRET: Buffer.alloc(32, 0x31).toString("base64url"),
  VIBERACING_PAIRING_APPROVAL_ATTEMPT_LIMIT: "6",
  VIBERACING_PAIRING_APPROVAL_WINDOW_SECONDS: "600",
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
  handle: "pixel_driver",
  inviteDigest: Buffer.alloc(32, 0x41).toString("base64url"),
  inviteId: "00000000-0000-4000-8000-000000000501",
  locale: "en",
  motionPreference: "system",
  streakVisible: false,
  theme: "neon-night",
});

const derivePairingCode = vi.fn((code: unknown) => {
  const primary = Buffer.alloc(32, 0x45);
  const secondary = Buffer.alloc(32, 0x46);
  const digests = Object.freeze([primary, secondary] as const);
  return Object.freeze({
    clear(): void {
      primary.fill(0);
      secondary.fill(0);
    },
    codeAccepted: code === "7K9M-P2QR-W4XY",
    digests,
    secondaryActive: false,
  });
});

function createFixture() {
  let enrollmentWrite: EnrollmentDatabaseProfile | undefined;
  let challengeSessionDigest: Buffer | undefined;
  let challengeSessionDigestInput: Uint8Array | undefined;
  let loginCompletion: EnrollmentDatabaseLoginCompletion | undefined;
  let loginCredentialLookup: Buffer | undefined;
  let inventorySessionDigest: Buffer | undefined;
  let inventorySessionDigestInput: Uint8Array | undefined;
  let activeDeviceInventoryRead: EnrollmentDatabaseSourceDeviceInventoryRequest | undefined;
  let activeDeviceInventoryDigestInput: Uint8Array | undefined;
  let accountOverviewRead: EnrollmentDatabaseAccountOverviewRequest | undefined;
  let accountOverviewDigestInput: Uint8Array | undefined;
  let deviceRevocationWrite: EnrollmentDatabaseDeviceRevocation | undefined;
  let deviceRevocationDigestInput: Uint8Array | undefined;
  let sourcePauseWrite: EnrollmentDatabaseSourcePause | undefined;
  let sourceReactivationChallengeWrite: EnrollmentDatabaseSourceReactivationChallenge | undefined;
  let sourceReactivationWrite: EnrollmentDatabaseSourceReactivation | undefined;
  let sourceUnlinkChallengeWrite: EnrollmentDatabaseSourceUnlinkChallenge | undefined;
  let sourceUnlinkWrite: EnrollmentDatabaseSourceUnlink | undefined;
  let addChallengeWrite: EnrollmentDatabasePasskeyAddChallenge | undefined;
  let additionWrite: EnrollmentDatabasePasskeyAddition | undefined;
  let revokeChallengeWrite: EnrollmentDatabasePasskeyRevokeChallenge | undefined;
  let revocationWrite: EnrollmentDatabasePasskeyRevocation | undefined;
  let deletionChallengeWrite: EnrollmentDatabaseProfileDeletionChallenge | undefined;
  let deletionWrite: EnrollmentDatabaseProfileDeletion | undefined;
  let deletionProfileRefDigestInput: Uint8Array | undefined;
  let recoveryChallengeWrite: EnrollmentDatabaseRecoveryCodeChallenge | undefined;
  let recoveryReplacementWrite: EnrollmentDatabaseRecoveryCodeReplacement | undefined;
  let recoveryCompletionWrite: EnrollmentDatabaseRecoveryCompletion | undefined;
  let recoveryStartWrite: EnrollmentDatabaseRecoveryStart | undefined;
  let visibilityRead: EnrollmentDatabaseProfileVisibilityRequest | undefined;
  let visibilityReadDigestInput: Uint8Array | undefined;
  let visibilityWrite: EnrollmentDatabaseProfileVisibilityUpdate | undefined;
  let visibilityWriteDigestInput: Uint8Array | undefined;
  let verifiedLoginCredential: Buffer | undefined;
  const database: EnrollmentDatabase = {
    completePairingApproval: vi.fn(() => Promise.resolve(true)),
    completeInitialPasskey: vi.fn(() => Promise.resolve(true)),
    completePasskeyAddition: vi.fn((input: EnrollmentDatabasePasskeyAddition) => {
      additionWrite = {
        ...input,
        challengeDigest: Buffer.from(input.challengeDigest),
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
        profileId: join.inviteId,
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
        profileId: join.inviteId,
      });
    }),
    completePasskeyRevocation: vi.fn((input: EnrollmentDatabasePasskeyRevocation) => {
      revocationWrite = {
        ...input,
        challengeDigest: Buffer.from(input.challengeDigest),
        contextDigest: Buffer.from(input.contextDigest),
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
      };
      return Promise.resolve(true);
    }),
    completeProfileDeletion: vi.fn((input: EnrollmentDatabaseProfileDeletion) => {
      deletionProfileRefDigestInput = input.profileRefDigest;
      deletionWrite = {
        ...input,
        challengeDigest: Buffer.from(input.challengeDigest),
        contextDigest: Buffer.from(input.contextDigest),
        profileRefDigest: Buffer.from(input.profileRefDigest),
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
      };
      return Promise.resolve(true);
    }),
    completeRecoveryCodeReplacement: vi.fn((input: EnrollmentDatabaseRecoveryCodeReplacement) => {
      recoveryReplacementWrite = {
        ...input,
        challengeDigest: Buffer.from(input.challengeDigest),
        contextDigest: Buffer.from(input.contextDigest),
        recoveryCodeIds: [...input.recoveryCodeIds],
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
        verifierPhcs: [...input.verifierPhcs],
      };
      return Promise.resolve(true);
    }),
    completeSourceReactivation: vi.fn((input: EnrollmentDatabaseSourceReactivation) => {
      sourceReactivationWrite = {
        ...input,
        challengeDigest: Buffer.from(input.challengeDigest),
        contextDigest: Buffer.from(input.contextDigest),
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
      };
      return Promise.resolve(true);
    }),
    completeSourceUnlink: vi.fn((input: EnrollmentDatabaseSourceUnlink) => {
      sourceUnlinkWrite = {
        ...input,
        challengeDigest: Buffer.from(input.challengeDigest),
        contextDigest: Buffer.from(input.contextDigest),
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
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
    createPairingApprovalChallenge: vi.fn(() => Promise.resolve(true)),
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
    createRecoveryCodeChallenge: vi.fn((input: EnrollmentDatabaseRecoveryCodeChallenge) => {
      recoveryChallengeWrite = {
        ...input,
        challengeDigest: Buffer.from(input.challengeDigest),
        contextDigest: Buffer.from(input.contextDigest),
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
      };
      return Promise.resolve(true);
    }),
    createSourceReactivationChallenge: vi.fn(
      (input: EnrollmentDatabaseSourceReactivationChallenge) => {
        sourceReactivationChallengeWrite = {
          ...input,
          challengeDigest: Buffer.from(input.challengeDigest),
          contextDigest: Buffer.from(input.contextDigest),
          sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
        };
        return Promise.resolve(true);
      },
    ),
    createSourceUnlinkChallenge: vi.fn((input: EnrollmentDatabaseSourceUnlinkChallenge) => {
      sourceUnlinkChallengeWrite = {
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
        inviteVerifierDigest: Buffer.from(input.inviteVerifierDigest),
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
      };
      return Promise.resolve(true);
    }),
    readAccountOverview: vi.fn((input: EnrollmentDatabaseAccountOverviewRequest) => {
      accountOverviewDigestInput = input.sessionVerifierDigest;
      accountOverviewRead = {
        ...input,
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
      };
      return Promise.resolve({ score: null, visibility: "public" as const });
    }),
    readActiveDeviceInventory: vi.fn((input: EnrollmentDatabaseSourceDeviceInventoryRequest) => {
      activeDeviceInventoryDigestInput = input.sessionVerifierDigest;
      activeDeviceInventoryRead = {
        ...input,
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
      };
      return Promise.resolve([
        {
          devices: [
            {
              activatedOn: "2026-07-14",
              architecture: "x86_64" as const,
              connectorVersion: "1.2.3",
              deviceId: `dev_${"A".repeat(22)}`,
              label: "Studio PC",
              osFamily: "windows" as const,
            },
          ],
          sourceId: `src_${"B".repeat(22)}`,
          state: "active" as const,
        },
      ]);
    }),
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
    readPairingApproval: vi.fn(() => Promise.resolve(undefined)),
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
    pauseSource: vi.fn((input: EnrollmentDatabaseSourcePause) => {
      sourcePauseWrite = {
        ...input,
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
      };
      return Promise.resolve(true);
    }),
    revokeDevice: vi.fn((input: EnrollmentDatabaseDeviceRevocation) => {
      deviceRevocationDigestInput = input.sessionVerifierDigest;
      deviceRevocationWrite = {
        ...input,
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
      };
      return Promise.resolve(true);
    }),
    revokeSession: vi.fn(() => Promise.resolve(true)),
    setProfileVisibility: vi.fn((input: EnrollmentDatabaseProfileVisibilityUpdate) => {
      visibilityWriteDigestInput = input.sessionVerifierDigest;
      visibilityWrite = {
        ...input,
        sessionVerifierDigest: Buffer.from(input.sessionVerifierDigest),
      };
      return Promise.resolve(input.publiclyVisible ? ("public" as const) : ("hidden" as const));
    }),
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
    createRequestId: () => "req_AAAAAAAAAAAAAAAAAAAAAA",
    database,
    derivePairingCode,
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
    accountOverviewDigestInput: () => accountOverviewDigestInput,
    accountOverviewRead: () => accountOverviewRead,
    activeDeviceInventoryDigestInput: () => activeDeviceInventoryDigestInput,
    activeDeviceInventoryRead: () => activeDeviceInventoryRead,
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
    deletionProfileRefDigestInput: () => deletionProfileRefDigestInput,
    deletionWrite: () => deletionWrite,
    deviceRevocationDigestInput: () => deviceRevocationDigestInput,
    deviceRevocationWrite: () => deviceRevocationWrite,
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
    revokeChallengeWrite: () => revokeChallengeWrite,
    registrationChallenge,
    revocationWrite: () => revocationWrite,
    service,
    sourcePauseWrite: () => sourcePauseWrite,
    sourceReactivationChallengeWrite: () => sourceReactivationChallengeWrite,
    sourceReactivationWrite: () => sourceReactivationWrite,
    sourceUnlinkChallengeWrite: () => sourceUnlinkChallengeWrite,
    sourceUnlinkWrite: () => sourceUnlinkWrite,
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
    const start = service.beginGithub(join);
    expect(start).toBeDefined();
    const authorization = new URL(start?.redirectUrl ?? "invalid:");
    const state = authorization.searchParams.get("state");
    expect(state).toHaveLength(43);

    const callback = await service.completeGithub(
      "valid_code_123",
      state ?? "",
      start?.oauthCookie ?? "",
      new AbortController().signal,
    );
    expect(callback).toBeDefined();
    expect(exchangeGithub).toHaveBeenCalledOnce();
    const enrollingSession = service.readSession(callback?.sessionCookie);
    expect(enrollingSession).toMatchObject({
      expiresAt: Math.floor(now.valueOf() / 1000) + 15 * 60,
      handle: "pixel_driver",
      locale: "en",
      passkeyRegistered: false,
    });
    expect(database.enrollProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        githubUserId: 123_456,
        handle: "pixel_driver",
        inviteId: join.inviteId,
        profileId: "00000000-0000-4000-8000-000000000502",
      }),
    );
    expect(enrollmentWrite()?.inviteVerifierDigest).toEqual(Buffer.alloc(32, 0x41));
    expect(enrollmentWrite()?.sessionVerifierDigest).toEqual(
      createHash("sha256")
        .update(Buffer.from(enrollingSession?.sessionVerifier ?? "", "base64url"))
        .digest(),
    );

    const passkeyStart = await service.beginPasskey(callback?.sessionCookie ?? "");
    expect(passkeyStart?.options.challenge).toHaveLength(43);
    expect(database.createPasskeyChallenge).toHaveBeenCalledOnce();
    expect(challengeSessionDigest()).toEqual(
      createHash("sha256")
        .update(Buffer.from(enrollingSession?.sessionVerifier ?? "", "base64url"))
        .digest(),
    );
    expect(challengeSessionDigestInput()).toEqual(Buffer.alloc(32));
    const completion = await service.completePasskey(
      callback?.sessionCookie ?? "",
      passkeyStart?.passkeyCookie ?? "",
      { label: "Primary passkey", response: { id: "synthetic" } },
    );
    expect(completion).toBeDefined();
    expect(verifyPasskey).toHaveBeenCalledOnce();
    expect(database.completeInitialPasskey).toHaveBeenCalledWith(
      expect.objectContaining({
        challengeId: "00000000-0000-4000-8000-000000000505",
        passkeyId: "00000000-0000-4000-8000-000000000506",
        rotatedSessionId: "00000000-0000-4000-8000-000000000508",
        rotatedSessionExpiresAt: new Date(now.valueOf() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        rotationAuditEventId: "00000000-0000-4000-8000-000000000509",
        sessionId: "00000000-0000-4000-8000-000000000503",
        signCount: 3,
      }),
    );
    const activeSession = service.readSession(completion?.sessionCookie);
    expect(activeSession).toMatchObject({
      expiresAt: Math.floor(now.valueOf() / 1000) + 30 * 24 * 60 * 60,
      passkeyRegistered: true,
      sessionId: "00000000-0000-4000-8000-000000000508",
    });
    expect(activeSession?.sessionVerifier).not.toBe(enrollingSession?.sessionVerifier);
    await expect(service.logout(completion?.sessionCookie)).resolves.toBe(true);
    expect(database.revokeSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "00000000-0000-4000-8000-000000000508" }),
    );
  });

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

  it("reviews one pending device before a fresh passkey atomically approves it", async () => {
    derivePairingCode.mockClear();
    const { authenticationChallenge, cookieCodec, database, service, verifyLogin } =
      createFixture();
    const verifier = Buffer.alloc(32, 0x47);
    const sessionId = "00000000-0000-4000-8000-000000000512";
    const pairingId = "00000000-0000-4000-8000-000000001001";
    const sessionCookie = cookieCodec.seal("session", {
      expiresAt: Math.floor(now.valueOf() / 1000) + 3600,
      handle: join.handle,
      locale: join.locale,
      passkeyRegistered: true,
      profileId: join.inviteId,
      sessionId,
      sessionVerifier: verifier.toString("base64url"),
      version: 1,
    });
    const publicKey = Buffer.alloc(32, 0x64);
    const expectedFingerprint = `SHA256:${createHash("sha256").update(publicKey).digest("base64url")}`;
    vi.mocked(database.readPairingApproval).mockResolvedValueOnce({
      architecture: "x86_64",
      candidateIndex: 1,
      connectorVersion: "1.2.3",
      deviceLabel: "Studio PC",
      expiresAt: "2026-07-16T10:09:00.000Z",
      osFamily: "windows",
      pairingId,
      publicKey,
    });

    const start = await service.beginPairingApproval(sessionCookie, {
      userCode: "7K9M-P2QR-W4XY",
    });
    expect(start).toMatchObject({
      options: { challenge: authenticationChallenge },
      pairing: {
        architecture: "x86_64",
        connectorVersion: "1.2.3",
        deviceLabel: "Studio PC",
        osFamily: "windows",
        publicKeyFingerprint: expectedFingerprint,
      },
    });
    expect(database.readPairingApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptLimit: config.pairingApprovalAttemptLimit,
        secondaryActive: false,
        sessionId,
        windowSeconds: config.pairingApprovalWindowSeconds,
      }),
    );
    expect(database.createPairingApprovalChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        challengeId: "00000000-0000-4000-8000-000000000502",
        pairingId,
        sessionId,
      }),
    );
    const approvalChallengeInput = vi.mocked(database.createPairingApprovalChallenge).mock
      .calls[0]?.[0];
    expect(approvalChallengeInput?.sourceId).toMatch(/^src_[A-Za-z0-9_-]{22}$/);
    const sealedChallenge = cookieCodec.open("passkey", start?.pairingApprovalCookie ?? "");
    expect(sealedChallenge).toMatchObject({
      challenge: authenticationChallenge,
      challengeId: "00000000-0000-4000-8000-000000000502",
      pairingId,
      version: 1,
    });
    const sealedSourceId = (sealedChallenge as Record<string, unknown>).sourceId;
    expect(sealedSourceId).toMatch(/^src_[A-Za-z0-9_-]{22}$/);
    expect(sealedChallenge).not.toHaveProperty("sessionId");
    expect(start?.pairingApprovalCookie).not.toContain("7K9M-P2QR-W4XY");
    expect(publicKey).toEqual(Buffer.alloc(32));

    const credentialId = Buffer.alloc(32, 0x74);
    const response = {
      id: credentialId.toString("base64url"),
      rawId: credentialId.toString("base64url"),
      response: {},
      type: "public-key",
    };
    await expect(
      service.completePairingApproval(sessionCookie, start?.pairingApprovalCookie ?? "", {
        response,
      }),
    ).resolves.toBe(true);
    expect(verifyLogin).toHaveBeenCalledWith(
      response,
      authenticationChallenge,
      config.webauthnOrigin,
      config.webauthnRpId,
      expect.any(Object),
    );
    expect(database.completePairingApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        auditEventId: "00000000-0000-4000-8000-000000000503",
        challengeId: "00000000-0000-4000-8000-000000000502",
        observedSignCount: 4,
        pairingId,
        sessionId,
        verifiedPasskeyId: "00000000-0000-4000-8000-000000000511",
      }),
    );

    vi.mocked(database.readPairingApproval).mockResolvedValueOnce({
      architecture: "x86_64",
      candidateIndex: 1,
      connectorVersion: "1.2.3",
      deviceLabel: "Studio PC",
      expiresAt: "2026-07-16T10:09:00.000Z",
      osFamily: "windows",
      pairingId,
      publicKey: Buffer.alloc(32, 0x65),
    });
    await expect(
      service.beginPairingApproval(sessionCookie, { userCode: "not-a-code" }),
    ).resolves.toBeUndefined();
    expect(database.readPairingApproval).toHaveBeenCalledTimes(2);
    expect(database.createPairingApprovalChallenge).toHaveBeenCalledOnce();
  });

  it("reads only the exact active session's bounded passkey inventory", async () => {
    const { cookieCodec, database, inventorySessionDigest, inventorySessionDigestInput, service } =
      createFixture();
    const verifier = Buffer.alloc(32, 0x45);
    const sessionCookie = cookieCodec.seal("session", {
      expiresAt: Math.floor(now.valueOf() / 1000) + 3600,
      handle: join.handle,
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

  it("reads active devices and immediately revokes only one exact owned device", async () => {
    const {
      activeDeviceInventoryDigestInput,
      activeDeviceInventoryRead,
      cookieCodec,
      database,
      deviceRevocationDigestInput,
      deviceRevocationWrite,
      service,
    } = createFixture();
    const verifier = Buffer.alloc(32, 0x49);
    const sessionId = "00000000-0000-4000-8000-000000000514";
    const sessionCookie = cookieCodec.seal("session", {
      expiresAt: Math.floor(now.valueOf() / 1000) + 3600,
      handle: join.handle,
      locale: join.locale,
      passkeyRegistered: true,
      profileId: join.inviteId,
      sessionId,
      sessionVerifier: verifier.toString("base64url"),
      version: 1,
    });
    const deviceId = `dev_${"A".repeat(22)}`;

    await expect(service.readActiveDeviceInventory(sessionCookie)).resolves.toEqual([
      expect.objectContaining({
        devices: [expect.objectContaining({ deviceId, label: "Studio PC" })],
        state: "active",
      }),
    ]);
    expect(activeDeviceInventoryRead()).toMatchObject({
      sessionId,
      sessionVerifierDigest: createHash("sha256").update(verifier).digest(),
    });
    expect(activeDeviceInventoryDigestInput()).toEqual(Buffer.alloc(32));

    await expect(service.revokeDevice(sessionCookie, "invalid")).resolves.toBe(false);
    expect(database.revokeDevice).not.toHaveBeenCalled();
    await expect(service.revokeDevice(sessionCookie, deviceId)).resolves.toBe(true);
    expect(deviceRevocationWrite()).toMatchObject({
      auditEventId: "00000000-0000-4000-8000-000000000502",
      deviceId,
      requestId: "req_AAAAAAAAAAAAAAAAAAAAAA",
      sessionId,
      sessionVerifierDigest: createHash("sha256").update(verifier).digest(),
    });
    expect(deviceRevocationDigestInput()).toEqual(Buffer.alloc(32));

    await expect(service.readActiveDeviceInventory("invalid")).resolves.toBeUndefined();
    await expect(service.revokeDevice("invalid", deviceId)).resolves.toBe(false);
    expect(database.readActiveDeviceInventory).toHaveBeenCalledOnce();
    expect(database.revokeDevice).toHaveBeenCalledOnce();
  });

  it("binds source pause and fresh-passkey reactivation to an opaque session control", async () => {
    const {
      cookieCodec,
      database,
      service,
      sourcePauseWrite,
      sourceReactivationChallengeWrite,
      sourceReactivationWrite,
      sourceUnlinkChallengeWrite,
      sourceUnlinkWrite,
      verifyLogin,
    } = createFixture();
    const verifier = Buffer.alloc(32, 0x4a);
    const sessionId = "00000000-0000-4000-8000-000000000515";
    const sessionCookie = cookieCodec.seal("session", {
      expiresAt: Math.floor(now.valueOf() / 1000) + 3600,
      handle: join.handle,
      locale: join.locale,
      passkeyRegistered: true,
      profileId: join.inviteId,
      sessionId,
      sessionVerifier: verifier.toString("base64url"),
      version: 1,
    });
    const inventory = await service.readActiveDeviceInventory(sessionCookie);
    const sourceControl = inventory?.[0]?.sourceControl;
    expect(sourceControl).toBeDefined();
    expect(sourceControl).not.toContain("src_");
    expect(Object.keys(inventory?.[0] ?? {})).toEqual(["devices", "sourceControl", "state"]);

    await expect(service.pauseSource(sessionCookie, "invalid")).resolves.toBe(false);
    await expect(service.pauseSource(sessionCookie, sourceControl ?? "")).resolves.toBe(true);
    expect(sourcePauseWrite()).toMatchObject({
      auditEventId: "00000000-0000-4000-8000-000000000502",
      sessionId,
      sessionVerifierDigest: createHash("sha256").update(verifier).digest(),
      sourceId: `src_${"B".repeat(22)}`,
    });

    const start = await service.beginSourceReactivation(sessionCookie, { sourceControl });
    expect(start?.options.challenge).toHaveLength(43);
    expect(sourceReactivationChallengeWrite()).toMatchObject({
      challengeId: "00000000-0000-4000-8000-000000000503",
      sessionId,
      sourceId: `src_${"B".repeat(22)}`,
    });
    expect(sourceReactivationChallengeWrite()?.contextDigest).toEqual(
      createHash("sha256")
        .update(
          `viberacing-source-reactivation-v1\n${sessionId}\nsrc_${"B".repeat(22)}\n${config.webauthnRpId}\n${config.webauthnOrigin}`,
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
      service.completeSourceReactivation(sessionCookie, start?.sourceReactivationCookie ?? "", {
        response,
      }),
    ).resolves.toBe(true);
    expect(verifyLogin).toHaveBeenCalledOnce();
    expect(sourceReactivationWrite()).toMatchObject({
      auditEventId: "00000000-0000-4000-8000-000000000504",
      challengeId: "00000000-0000-4000-8000-000000000503",
      observedSignCount: 4,
      sessionId,
      sourceId: `src_${"B".repeat(22)}`,
      verifiedPasskeyId: "00000000-0000-4000-8000-000000000511",
    });

    const unlinkStart = await service.beginSourceUnlink(sessionCookie, { sourceControl });
    expect(unlinkStart?.options.challenge).toHaveLength(43);
    expect(sourceUnlinkChallengeWrite()).toMatchObject({
      challengeId: "00000000-0000-4000-8000-000000000505",
      sessionId,
      sourceId: `src_${"B".repeat(22)}`,
    });
    expect(sourceUnlinkChallengeWrite()?.contextDigest).toEqual(
      createHash("sha256")
        .update(
          `viberacing-source-unlink-v1\n${sessionId}\nsrc_${"B".repeat(22)}\n${config.webauthnRpId}\n${config.webauthnOrigin}`,
          "utf8",
        )
        .digest(),
    );
    await expect(
      service.completeSourceUnlink(sessionCookie, unlinkStart?.sourceUnlinkCookie ?? "", {
        response,
      }),
    ).resolves.toBe(true);
    expect(sourceUnlinkWrite()).toMatchObject({
      auditEventId: "00000000-0000-4000-8000-000000000506",
      challengeId: "00000000-0000-4000-8000-000000000505",
      observedSignCount: 4,
      sessionId,
      sourceId: `src_${"B".repeat(22)}`,
      verifiedPasskeyId: "00000000-0000-4000-8000-000000000511",
    });

    vi.mocked(database.completeSourceReactivation).mockResolvedValueOnce(false);
    await expect(
      service.completeSourceReactivation(sessionCookie, start?.sourceReactivationCookie ?? "", {
        response,
      }),
    ).resolves.toBe(false);
    await expect(
      service.beginSourceReactivation(sessionCookie, {
        extra: true,
        sourceControl,
      }),
    ).resolves.toBeUndefined();
    const otherSessionCookie = cookieCodec.seal("session", {
      expiresAt: Math.floor(now.valueOf() / 1000) + 3600,
      handle: join.handle,
      locale: join.locale,
      passkeyRegistered: true,
      profileId: join.inviteId,
      sessionId: "00000000-0000-4000-8000-000000000516",
      sessionVerifier: verifier.toString("base64url"),
      version: 1,
    });
    await expect(
      service.beginSourceReactivation(otherSessionCookie, { sourceControl }),
    ).resolves.toBeUndefined();
    await expect(
      service.beginSourceUnlink(otherSessionCookie, { sourceControl }),
    ).resolves.toBeUndefined();
    await expect(service.pauseSource(otherSessionCookie, sourceControl ?? "")).resolves.toBe(false);
    expect(database.pauseSource).toHaveBeenCalledOnce();
    expect(database.createSourceReactivationChallenge).toHaveBeenCalledOnce();
    expect(database.createSourceUnlinkChallenge).toHaveBeenCalledOnce();
    expect(database.completeSourceUnlink).toHaveBeenCalledOnce();
  });

  it("reads and changes only the possessed session's public profile visibility", async () => {
    const {
      cookieCodec,
      database,
      service,
      visibilityRead,
      visibilityReadDigestInput,
      visibilityWrite,
      visibilityWriteDigestInput,
    } = createFixture();
    const verifier = Buffer.alloc(32, 0x47);
    const sessionCookie = cookieCodec.seal("session", {
      expiresAt: Math.floor(now.valueOf() / 1000) + 3600,
      handle: join.handle,
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

    await expect(service.readProfileVisibility("invalid")).resolves.toBeUndefined();
    await expect(service.setProfileVisibility("invalid", true)).resolves.toBeUndefined();
    expect(database.readProfileVisibility).toHaveBeenCalledOnce();
    expect(database.setProfileVisibility).toHaveBeenCalledOnce();
  });

  it("reads the possessed account's current Community week without retaining the verifier", async () => {
    const { accountOverviewDigestInput, accountOverviewRead, cookieCodec, database, service } =
      createFixture();
    const verifier = Buffer.alloc(32, 0x48);
    const sessionCookie = cookieCodec.seal("session", {
      expiresAt: Math.floor(now.valueOf() / 1000) + 3600,
      handle: join.handle,
      locale: join.locale,
      passkeyRegistered: true,
      profileId: join.inviteId,
      sessionId: "00000000-0000-4000-8000-000000000513",
      sessionVerifier: verifier.toString("base64url"),
      version: 1,
    });

    await expect(service.readAccountOverview(sessionCookie)).resolves.toEqual({
      score: null,
      visibility: "public",
    });
    expect(accountOverviewRead()).toEqual({
      seasonStart: "2026-07-13",
      sessionId: "00000000-0000-4000-8000-000000000513",
      sessionVerifierDigest: createHash("sha256").update(verifier).digest(),
    });
    expect(accountOverviewDigestInput()).toEqual(Buffer.alloc(32));

    await expect(service.readAccountOverview("invalid")).resolves.toBeUndefined();
    expect(database.readAccountOverview).toHaveBeenCalledOnce();
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
      handle: join.handle,
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
      auditEventId: "00000000-0000-4000-8000-000000000504",
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
      handle: join.handle,
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
      targetPasskeyId,
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
      auditEventId: "00000000-0000-4000-8000-000000000503",
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
      handle: join.handle,
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
          `viberacing-recovery-code-rotation-v1\n${sessionId}\n${join.inviteId}\n${config.webauthnRpId}\n${config.webauthnOrigin}`,
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
      auditEventId: "00000000-0000-4000-8000-000000000504",
      backupState: true,
      batchId: "00000000-0000-4000-8000-000000000503",
      challengeId: "00000000-0000-4000-8000-000000000502",
      observedSignCount: 4,
      recoveryCodeIds: recoveryCodeRecords.map(({ codeId }) => codeId),
      requestId: "req_AAAAAAAAAAAAAAAAAAAAAA",
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
      auditEventId: "00000000-0000-4000-8000-000000000503",
      authorityId: "00000000-0000-4000-8000-000000000502",
      expiresAt: "2026-07-16T10:05:00.000Z",
      recoveryCodeId: recoveryCode?.codeId,
      requestId: "req_AAAAAAAAAAAAAAAAAAAAAA",
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
      auditEventId: "00000000-0000-4000-8000-000000000506",
      authorityId: "00000000-0000-4000-8000-000000000502",
      backupEligible: true,
      backupState: false,
      label: "Replacement passkey",
      passkeyId: "00000000-0000-4000-8000-000000000504",
      requestId: "req_AAAAAAAAAAAAAAAAAAAAAA",
      sessionExpiresAt: "2026-08-15T10:00:00.000Z",
      sessionId: "00000000-0000-4000-8000-000000000505",
      signCount: 3,
    });
    expect(service.readSession(completed?.sessionCookie)).toMatchObject({
      handle: join.handle,
      passkeyRegistered: true,
      profileId: join.inviteId,
      sessionId: "00000000-0000-4000-8000-000000000505",
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
      deletionProfileRefDigestInput,
      deletionWrite,
      authenticationChallenge,
      service,
      verifyLogin,
    } = createFixture();
    const verifier = Buffer.alloc(32, 0x48);
    const sessionId = "00000000-0000-4000-8000-000000000520";
    const sessionCookie = cookieCodec.seal("session", {
      expiresAt: Math.floor(now.valueOf() / 1000) + 3600,
      handle: join.handle,
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
    const start = await service.beginProfileDeletion(sessionCookie, { handle: join.handle });
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
          `viberacing-profile-deletion-v1\n${sessionId}\n${join.inviteId}\n${join.handle}\n${config.webauthnRpId}\n${config.webauthnOrigin}`,
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
      auditEventId: "00000000-0000-4000-8000-000000000504",
      challengeId: "00000000-0000-4000-8000-000000000502",
      deletionJobId: "00000000-0000-4000-8000-000000000503",
      observedSignCount: 4,
      profileRefDigest: Buffer.alloc(32, 0x22),
      sessionId,
      typedHandle: join.handle,
      verifiedPasskeyId: "00000000-0000-4000-8000-000000000511",
    });
    expect(deletionProfileRefDigestInput()).toEqual(Buffer.alloc(32));

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
      createRequestId: () => "req_AAAAAAAAAAAAAAAAAAAAAA",
      database: fixture.database,
      derivePairingCode,
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
        auditEventId: "00000000-0000-4000-8000-000000000522",
        sessionId: "00000000-0000-4000-8000-000000000520",
      }),
    );
  });

  it("fails closed for mismatched state, invalid cookies, repeated registration, and unsafe labels", async () => {
    const { database, exchangeGithub, service, verifyPasskey } = createFixture();
    const start = service.beginGithub(join);
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
      ),
    ).resolves.toBeUndefined();
    expect(exchangeGithub).not.toHaveBeenCalled();
    await expect(service.beginPasskey("invalid")).resolves.toBeUndefined();
    await expect(service.completePasskey("invalid", "invalid", {})).resolves.toBeUndefined();
    await expect(service.logout("invalid")).resolves.toBe(true);
    expect(database.enrollProfile).not.toHaveBeenCalled();

    const callback = await service.completeGithub(
      "valid_code_123",
      state,
      start?.oauthCookie ?? "",
      new AbortController().signal,
    );
    const passkey = await service.beginPasskey(callback?.sessionCookie ?? "");
    await expect(
      service.completePasskey(callback?.sessionCookie ?? "", passkey?.passkeyCookie ?? "", {
        label: "unsafe\nlabel",
        response: {},
      }),
    ).resolves.toBeUndefined();
    expect(verifyPasskey).not.toHaveBeenCalled();

    const completed = await service.completePasskey(
      callback?.sessionCookie ?? "",
      passkey?.passkeyCookie ?? "",
      { label: "Primary passkey", response: {} },
    );
    await expect(
      service.completePasskey(completed?.sessionCookie ?? "", passkey?.passkeyCookie ?? "", {
        label: "Primary passkey",
        response: {},
      }),
    ).resolves.toBeUndefined();
    expect(database.completeInitialPasskey).toHaveBeenCalledOnce();
  });

  it("contains unavailable dependencies and invalid clocks", async () => {
    const fixture = createFixture();
    vi.mocked(fixture.database.enrollProfile).mockResolvedValue(false);
    const start = fixture.service.beginGithub(join);
    const state = new URL(start?.redirectUrl ?? "invalid:").searchParams.get("state") ?? "";
    await expect(
      fixture.service.completeGithub(
        "valid_code_123",
        state,
        start?.oauthCookie ?? "",
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();

    const invalidClockService = createEnrollmentService({
      config,
      cookieCodec: createEnrollmentCookieCodec(config.cookieKey),
      database: fixture.database,
      derivePairingCode,
      now: () => new Date(Number.NaN),
    });
    expect(invalidClockService.beginGithub(join)).toBeUndefined();
    expect(invalidClockService.readSession(undefined)).toBeUndefined();
  });

  it("seals continuation cookies before consuming an invite or passkey challenge", async () => {
    const database: EnrollmentDatabase = {
      completePairingApproval: vi.fn(() => Promise.resolve(true)),
      completeInitialPasskey: vi.fn(() => Promise.resolve(true)),
      completePasskeyAddition: vi.fn(() => Promise.resolve(true)),
      completePasskeyLogin: vi.fn(() =>
        Promise.resolve({
          handle: "pixel_driver",
          locale: "en" as const,
          profileId: join.inviteId,
        }),
      ),
      completeRecoveryRegistration: vi.fn(() =>
        Promise.resolve({
          handle: "pixel_driver",
          locale: "en" as const,
          profileId: join.inviteId,
        }),
      ),
      completePasskeyRevocation: vi.fn(() => Promise.resolve(true)),
      completeProfileDeletion: vi.fn(() => Promise.resolve(true)),
      completeRecoveryCodeReplacement: vi.fn(() => Promise.resolve(true)),
      completeSourceReactivation: vi.fn(() => Promise.resolve(true)),
      completeSourceUnlink: vi.fn(() => Promise.resolve(true)),
      createPasskeyAddChallenge: vi.fn(() => Promise.resolve(true)),
      createPairingApprovalChallenge: vi.fn(() => Promise.resolve(true)),
      createPasskeyChallenge: vi.fn(() => Promise.resolve(true)),
      createPasskeyRevokeChallenge: vi.fn(() => Promise.resolve(true)),
      createProfileDeletionChallenge: vi.fn(() => Promise.resolve(true)),
      createRecoveryCodeChallenge: vi.fn(() => Promise.resolve(true)),
      createSourceReactivationChallenge: vi.fn(() => Promise.resolve(true)),
      createSourceUnlinkChallenge: vi.fn(() => Promise.resolve(true)),
      enrollProfile: vi.fn(() => Promise.resolve(true)),
      pauseSource: vi.fn(() => Promise.resolve(true)),
      readAccountOverview: vi.fn(() =>
        Promise.resolve({ score: null, visibility: "public" as const }),
      ),
      readActiveDeviceInventory: vi.fn(() => Promise.resolve([])),
      readPasskeyInventory: vi.fn(() => Promise.resolve([])),
      readPairingApproval: vi.fn(() => Promise.resolve(undefined)),
      readPasskeyLoginMaterial: vi.fn(() => Promise.resolve(undefined)),
      readRecoveryCodeVerificationMaterial: vi.fn(() => Promise.resolve(undefined)),
      readProfileVisibility: vi.fn(() => Promise.resolve("public" as const)),
      revokeDevice: vi.fn(() => Promise.resolve(true)),
      revokeSession: vi.fn(() => Promise.resolve(true)),
      setProfileVisibility: vi.fn(() => Promise.resolve("hidden" as const)),
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
      derivePairingCode,
      exchangeGithub: () => Promise.resolve(123),
      now: () => now,
      randomBytes: (size) => Buffer.alloc(size, 5),
      randomUuid: () => "00000000-0000-4000-8000-000000000509",
    });
    await expect(
      oauthService.completeGithub("valid_code_123", state, "opaque", new AbortController().signal),
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
                version: 1,
              },
        seal: () => {
          throw new Error("cookie unavailable");
        },
      },
      database,
      derivePairingCode,
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
    await expect(passkeyService.beginPasskey("session")).resolves.toBeUndefined();
    expect(database.createPasskeyChallenge).not.toHaveBeenCalled();
    await expect(
      passkeyService.completePasskey("session", "passkey", {
        label: "Primary passkey",
        response: {},
      }),
    ).resolves.toBeUndefined();
    expect(database.completeInitialPasskey).not.toHaveBeenCalled();
  });
});
