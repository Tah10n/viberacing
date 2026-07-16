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
import type {
  EnrollmentDatabaseLoginCompletion,
  EnrollmentDatabasePasskeyChallenge,
  EnrollmentDatabasePasskeyInventoryRequest,
  EnrollmentDatabaseProfile,
} from "./pairing-database-pool";

const now = new Date("2026-07-16T10:00:00.000Z");
const config = resolveEnrollmentConfig({
  GITHUB_CLIENT_ID: "Ov23abcdefghijklmno",
  GITHUB_CLIENT_SECRET: "a".repeat(40),
  NODE_ENV: "test",
  SESSION_SECRET: Buffer.alloc(32, 0x31).toString("base64url"),
  VIBERACING_PUBLIC_ORIGIN: "https://race.example.com",
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

function createFixture() {
  let enrollmentWrite: EnrollmentDatabaseProfile | undefined;
  let challengeSessionDigest: Buffer | undefined;
  let challengeSessionDigestInput: Uint8Array | undefined;
  let loginCompletion: EnrollmentDatabaseLoginCompletion | undefined;
  let loginCredentialLookup: Buffer | undefined;
  let inventorySessionDigest: Buffer | undefined;
  let inventorySessionDigestInput: Uint8Array | undefined;
  let verifiedLoginCredential: Buffer | undefined;
  const database: EnrollmentDatabase = {
    completeInitialPasskey: vi.fn(() => Promise.resolve(true)),
    completePasskeyLogin: vi.fn((input: EnrollmentDatabaseLoginCompletion) => {
      loginCompletion = input;
      return Promise.resolve({
        handle: "pixel_driver",
        locale: "en" as const,
        profileId: join.inviteId,
      });
    }),
    createPasskeyChallenge: vi.fn((input: EnrollmentDatabasePasskeyChallenge) => {
      challengeSessionDigest = Buffer.from(input.sessionVerifierDigest);
      challengeSessionDigestInput = input.sessionVerifierDigest;
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
    revokeSession: vi.fn(() => Promise.resolve(true)),
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
  ];
  const challenge = Buffer.alloc(32, 0x61).toString("base64url");
  const options = { challenge } as PublicKeyCredentialCreationOptionsJSON;
  const loginOptions = { challenge } as PublicKeyCredentialRequestOptionsJSON;
  const exchangeGithub = vi.fn(() => Promise.resolve(123_456));
  const createOptions = vi.fn(() => Promise.resolve(options));
  const createLoginOptions = vi.fn(() => Promise.resolve(loginOptions));
  const verifyPasskey = vi.fn(() =>
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
  let randomFill = 0x21;
  const cookieCodec = createEnrollmentCookieCodec(config.cookieKey, (size) =>
    Buffer.alloc(size, 0x21),
  );
  const service = createEnrollmentService({
    config,
    cookieCodec,
    createLoginOptions,
    createOptions,
    createRequestId: () => "req_AAAAAAAAAAAAAAAAAAAAAA",
    database,
    exchangeGithub,
    now: () => now,
    randomBytes: (size) => Buffer.alloc(size, (randomFill += 1)),
    randomUuid: () => uuids.shift() ?? "invalid",
    verifyLogin,
    verifyPasskey,
  });
  return {
    challengeSessionDigest: () => challengeSessionDigest,
    challengeSessionDigestInput: () => challengeSessionDigestInput,
    cookieCodec,
    createOptions,
    createLoginOptions,
    database,
    enrollmentWrite: () => enrollmentWrite,
    exchangeGithub,
    loginCredentialLookup: () => loginCredentialLookup,
    loginCompletion: () => loginCompletion,
    inventorySessionDigest: () => inventorySessionDigest,
    inventorySessionDigestInput: () => inventorySessionDigestInput,
    service,
    verifyPasskey,
    verifyLogin,
    verifiedLoginCredential: () => verifiedLoginCredential,
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
    ]);
    expect(database.readPasskeyInventory).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "00000000-0000-4000-8000-000000000512" }),
    );
    expect(inventorySessionDigest()).toEqual(createHash("sha256").update(verifier).digest());
    expect(inventorySessionDigestInput()).toEqual(Buffer.alloc(32));
    await expect(service.readPasskeyInventory("invalid")).resolves.toBeUndefined();
    expect(database.readPasskeyInventory).toHaveBeenCalledOnce();
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
      now: () => new Date(Number.NaN),
    });
    expect(invalidClockService.beginGithub(join)).toBeUndefined();
    expect(invalidClockService.readSession(undefined)).toBeUndefined();
  });

  it("seals continuation cookies before consuming an invite or passkey challenge", async () => {
    const database: EnrollmentDatabase = {
      completeInitialPasskey: vi.fn(() => Promise.resolve(true)),
      completePasskeyLogin: vi.fn(() =>
        Promise.resolve({
          handle: "pixel_driver",
          locale: "en" as const,
          profileId: join.inviteId,
        }),
      ),
      createPasskeyChallenge: vi.fn(() => Promise.resolve(true)),
      enrollProfile: vi.fn(() => Promise.resolve(true)),
      readPasskeyInventory: vi.fn(() => Promise.resolve([])),
      readPasskeyLoginMaterial: vi.fn(() => Promise.resolve(undefined)),
      revokeSession: vi.fn(() => Promise.resolve(true)),
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
