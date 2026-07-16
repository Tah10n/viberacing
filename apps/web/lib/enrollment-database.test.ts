/* eslint-disable @typescript-eslint/unbound-method -- Vitest inspects injected method spies without invoking them. */

import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import { createEnrollmentDatabase, EnrollmentDatabaseError } from "./enrollment-database";
import type { EnrollmentDatabaseClient, EnrollmentDatabasePool } from "./pairing-database-pool";

function fixture(overrides: Partial<EnrollmentDatabaseClient> = {}) {
  const releases: boolean[] = [];
  const client: EnrollmentDatabaseClient = {
    completeInitialPasskey: vi.fn(() => Promise.resolve([{ registered: true }])),
    completePasskeyLogin: vi.fn(() =>
      Promise.resolve([
        {
          handle: "pixel_driver",
          locale: "en",
          profile_id: "00000000-0000-4000-8000-000000000402",
        },
      ]),
    ),
    completePasskeyRevocation: vi.fn(() => Promise.resolve([{ revoked: true }])),
    createPasskeyChallenge: vi.fn(() => Promise.resolve([{ created: true }])),
    createPasskeyRevokeChallenge: vi.fn(() => Promise.resolve([{ created: true }])),
    enrollProfile: vi.fn(() => Promise.resolve([{ enrolled: true }])),
    readPasskeyInventory: vi.fn(() =>
      Promise.resolve([
        {
          created_on: "2026-07-15",
          current_authenticator: true,
          label: "Primary passkey",
          passkey_id: "00000000-0000-4000-8000-000000000406",
          state: "active",
        },
        {
          created_on: "2026-07-16",
          current_authenticator: false,
          label: "Retired key",
          passkey_id: "00000000-0000-4000-8000-000000000407",
          state: "revoked",
        },
      ]),
    ),
    readPasskeyLoginMaterial: vi.fn(() =>
      Promise.resolve([
        {
          backup_eligible: true,
          backup_state: false,
          cose_public_key: Buffer.alloc(77, 0x51),
          passkey_id: "00000000-0000-4000-8000-000000000406",
          sign_count: "1",
        },
      ]),
    ),
    release(destroy = false): void {
      releases.push(destroy);
    },
    revokeEnrollmentSession: vi.fn(() => Promise.resolve([{ revoked: true }])),
    verifyRuntimeBoundary: vi.fn(() =>
      Promise.resolve([
        {
          login_scope_ok: true,
          read_write_ok: true,
          role_ok: true,
          search_path_ok: true,
        },
      ]),
    ),
    ...overrides,
  };
  const pool: EnrollmentDatabasePool = {
    close: () => Promise.resolve(),
    connect: () => Promise.resolve(client),
  };
  return { client, database: createEnrollmentDatabase(pool), pool, releases };
}

const profile = {
  auditEventId: "00000000-0000-4000-8000-000000000405",
  githubUserId: 123,
  handle: "pixel_driver",
  inviteId: "00000000-0000-4000-8000-000000000401",
  inviteVerifierDigest: new Uint8Array(32),
  locale: "en" as const,
  motionPreference: "system" as const,
  profileId: "00000000-0000-4000-8000-000000000402",
  requestId: "req_AAAAAAAAAAAAAAAAAAAAAA",
  sessionExpiresAt: "2026-08-15T10:00:00.000Z",
  sessionId: "00000000-0000-4000-8000-000000000403",
  sessionVerifierDigest: new Uint8Array(32),
  streakVisible: false,
  theme: "neon-night" as const,
};

describe("enrollment database", () => {
  it("probes every checkout and exposes only the fixed identity operations", async () => {
    const { client, database, releases } = fixture();
    await expect(database.enrollProfile(profile)).resolves.toBe(true);
    await expect(
      database.createPasskeyChallenge({
        challengeDigest: new Uint8Array(32),
        challengeId: "00000000-0000-4000-8000-000000000404",
        contextDigest: new Uint8Array(32),
        expiresAt: "2026-07-16T10:05:00.000Z",
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
      }),
    ).resolves.toBe(true);
    await expect(
      database.completeInitialPasskey({
        auditEventId: profile.auditEventId,
        backupEligible: false,
        backupState: false,
        challengeDigest: new Uint8Array(32),
        challengeId: "00000000-0000-4000-8000-000000000404",
        contextDigest: new Uint8Array(32),
        cosePublicKey: new Uint8Array(77),
        credentialId: new Uint8Array(32),
        label: "Primary passkey",
        passkeyId: "00000000-0000-4000-8000-000000000406",
        requestId: profile.requestId,
        rotatedSessionExpiresAt: profile.sessionExpiresAt,
        rotatedSessionId: "00000000-0000-4000-8000-000000000407",
        rotatedSessionVerifierDigest: new Uint8Array(32),
        rotationAuditEventId: "00000000-0000-4000-8000-000000000408",
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
        signCount: 0,
      }),
    ).resolves.toBe(true);
    await expect(database.readPasskeyLoginMaterial(new Uint8Array(32))).resolves.toMatchObject({
      backupEligible: true,
      backupState: false,
      passkeyId: "00000000-0000-4000-8000-000000000406",
      signCount: 1,
    });
    await expect(
      database.readPasskeyInventory({
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
      }),
    ).resolves.toEqual([
      {
        createdOn: "2026-07-15",
        currentAuthenticator: true,
        label: "Primary passkey",
        passkeyId: "00000000-0000-4000-8000-000000000406",
        state: "active",
      },
      {
        createdOn: "2026-07-16",
        currentAuthenticator: false,
        label: "Retired key",
        passkeyId: "00000000-0000-4000-8000-000000000407",
        state: "revoked",
      },
    ]);
    await expect(
      database.createPasskeyRevokeChallenge({
        challengeDigest: new Uint8Array(32),
        challengeId: "00000000-0000-4000-8000-000000000411",
        contextDigest: new Uint8Array(32),
        expiresAt: "2026-07-16T10:05:00.000Z",
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
        targetPasskeyId: "00000000-0000-4000-8000-000000000407",
      }),
    ).resolves.toBe(true);
    await expect(
      database.completePasskeyRevocation({
        auditEventId: profile.auditEventId,
        backupState: false,
        challengeDigest: new Uint8Array(32),
        challengeId: "00000000-0000-4000-8000-000000000411",
        contextDigest: new Uint8Array(32),
        observedSignCount: 2,
        requestId: profile.requestId,
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
        targetPasskeyId: "00000000-0000-4000-8000-000000000407",
        verifiedPasskeyId: "00000000-0000-4000-8000-000000000406",
      }),
    ).resolves.toBe(true);
    await expect(
      database.completePasskeyLogin({
        auditEventId: profile.auditEventId,
        backupState: false,
        challengeDigest: new Uint8Array(32),
        challengeExpiresAt: "2026-07-16T10:05:00.000Z",
        challengeId: "00000000-0000-4000-8000-000000000409",
        contextDigest: new Uint8Array(32),
        credentialId: new Uint8Array(32),
        observedSignCount: 2,
        passkeyId: "00000000-0000-4000-8000-000000000406",
        requestId: profile.requestId,
        sessionExpiresAt: profile.sessionExpiresAt,
        sessionId: "00000000-0000-4000-8000-000000000410",
        sessionVerifierDigest: new Uint8Array(32),
      }),
    ).resolves.toEqual({
      handle: "pixel_driver",
      locale: "en",
      profileId: profile.profileId,
    });
    await expect(
      database.revokeSession({
        auditEventId: profile.auditEventId,
        requestId: profile.requestId,
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
      }),
    ).resolves.toBe(true);
    expect(client.verifyRuntimeBoundary).toHaveBeenCalledTimes(9);
    expect(releases).toEqual([false, false, false, false, false, false, false, false, false]);
  });

  it("destroys a checkout after boundary, query, or result failure", async () => {
    const mismatch = fixture({
      verifyRuntimeBoundary: () => Promise.resolve([{ role_ok: false }]),
    });
    await expect(mismatch.database.enrollProfile(profile)).rejects.toMatchObject({
      code: "runtime_boundary_mismatch",
    });
    expect(mismatch.releases).toEqual([true]);

    const queryFailure = fixture({ enrollProfile: () => Promise.reject(new Error("private")) });
    await expect(queryFailure.database.enrollProfile(profile)).rejects.toMatchObject({
      code: "query_failed",
    });
    expect(queryFailure.releases).toEqual([true]);

    const invalid = fixture({ enrollProfile: () => Promise.resolve([{ enrolled: "yes" }]) });
    await expect(invalid.database.enrollProfile(profile)).rejects.toMatchObject({
      code: "result_invalid",
    });
    expect(invalid.releases).toEqual([true]);

    const malformedMaterial = fixture({
      readPasskeyLoginMaterial: () =>
        Promise.resolve([
          {
            backup_eligible: false,
            backup_state: true,
            cose_public_key: Buffer.alloc(77),
            passkey_id: "00000000-0000-4000-8000-000000000406",
            sign_count: "1",
          },
        ]),
    });
    await expect(
      malformedMaterial.database.readPasskeyLoginMaterial(new Uint8Array(32)),
    ).rejects.toMatchObject({ code: "result_invalid" });
    expect(malformedMaterial.releases).toEqual([true]);

    const malformedInventory = fixture({
      readPasskeyInventory: () =>
        Promise.resolve([
          {
            created_on: "2026-07-15",
            current_authenticator: false,
            label: "Primary passkey",
            passkey_id: "00000000-0000-4000-8000-000000000406",
            state: "active",
          },
        ]),
    });
    await expect(
      malformedInventory.database.readPasskeyInventory({
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
      }),
    ).rejects.toMatchObject({ code: "result_invalid" });
    expect(malformedInventory.releases).toEqual([true]);

    const unorderedInventory = fixture({
      readPasskeyInventory: () =>
        Promise.resolve([
          {
            created_on: "2026-07-15",
            current_authenticator: false,
            label: "Later key",
            passkey_id: "00000000-0000-4000-8000-000000000407",
            state: "active",
          },
          {
            created_on: "2026-07-15",
            current_authenticator: true,
            label: "Current key",
            passkey_id: "00000000-0000-4000-8000-000000000406",
            state: "active",
          },
        ]),
    });
    await expect(
      unorderedInventory.database.readPasskeyInventory({
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
      }),
    ).rejects.toMatchObject({ code: "result_invalid" });
    expect(unorderedInventory.releases).toEqual([true]);
  });

  it("contains connection and release failures without reflecting driver detail", async () => {
    const unavailable = createEnrollmentDatabase({
      close: () => Promise.resolve(),
      connect: () => Promise.reject(new Error("private-connect")),
    });
    await expect(unavailable.enrollProfile(profile)).rejects.toEqual(
      new EnrollmentDatabaseError("connection_unavailable"),
    );

    const releaseFailure = fixture({
      release: () => {
        throw new Error("private-release");
      },
    });
    await expect(releaseFailure.database.enrollProfile(profile)).rejects.toMatchObject({
      code: "connection_release_failed",
    });
  });
});
