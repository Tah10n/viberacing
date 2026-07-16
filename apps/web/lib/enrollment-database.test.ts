/* eslint-disable @typescript-eslint/unbound-method -- Vitest inspects injected method spies without invoking them. */

import { describe, expect, it, vi } from "vitest";

import { createEnrollmentDatabase, EnrollmentDatabaseError } from "./enrollment-database";
import type { EnrollmentDatabaseClient, EnrollmentDatabasePool } from "./pairing-database-pool";

function fixture(overrides: Partial<EnrollmentDatabaseClient> = {}) {
  const releases: boolean[] = [];
  const client: EnrollmentDatabaseClient = {
    completeInitialPasskey: vi.fn(() => Promise.resolve([{ registered: true }])),
    createPasskeyChallenge: vi.fn(() => Promise.resolve([{ created: true }])),
    enrollProfile: vi.fn(() => Promise.resolve([{ enrolled: true }])),
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
  it("probes every checkout and exposes four fixed boolean operations", async () => {
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
    await expect(
      database.revokeSession({
        auditEventId: profile.auditEventId,
        requestId: profile.requestId,
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
      }),
    ).resolves.toBe(true);
    expect(client.verifyRuntimeBoundary).toHaveBeenCalledTimes(4);
    expect(releases).toEqual([false, false, false, false]);
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
