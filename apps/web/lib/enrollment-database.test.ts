/* eslint-disable @typescript-eslint/unbound-method -- Vitest inspects injected method spies without invoking them. */

import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import { createEnrollmentDatabase, EnrollmentDatabaseError } from "./enrollment-database";
import type { EnrollmentDatabaseClient, EnrollmentDatabasePool } from "./pairing-database-pool";

function accountScoreRows() {
  return Array.from({ length: 7 }, (_, index) => ({
    active_days: 7,
    daily_score: (index + 1) * 100,
    score_date: `2026-07-${String(13 + index).padStart(2, "0")}`,
    season_end: "2026-07-19",
    season_finalized: false,
    season_start: "2026-07-13",
    source_count: 2,
    visibility: "public",
    weekly_score: 2800,
  }));
}

const accountOverviewRequest = {
  seasonStart: "2026-07-13",
  sessionId: "00000000-0000-4000-8000-000000000403",
  sessionVerifierDigest: new Uint8Array(32),
};

function fixture(overrides: Partial<EnrollmentDatabaseClient> = {}) {
  const releases: boolean[] = [];
  const client: EnrollmentDatabaseClient = {
    completePairingApproval: vi.fn(() => Promise.resolve([{ approved: true }])),
    completeInitialPasskey: vi.fn(() => Promise.resolve([{ registered: true }])),
    completePasskeyAddition: vi.fn(() => Promise.resolve([{ added: true }])),
    completePasskeyLogin: vi.fn(() =>
      Promise.resolve([
        {
          handle: "pixel_driver",
          locale: "en",
          profile_id: "00000000-0000-4000-8000-000000000402",
        },
      ]),
    ),
    completeRecoveryRegistration: vi.fn(() =>
      Promise.resolve([
        {
          handle: "pixel_driver",
          locale: "en",
          profile_id: "00000000-0000-4000-8000-000000000402",
        },
      ]),
    ),
    completePasskeyRevocation: vi.fn(() => Promise.resolve([{ revoked: true }])),
    completeProfileDeletion: vi.fn(() => Promise.resolve([{ deleted: true }])),
    completeRecoveryCodeReplacement: vi.fn(() => Promise.resolve([{ replaced: true }])),
    completeSourceReactivation: vi.fn(() => Promise.resolve([{ reactivated: true }])),
    completeSourceUnlink: vi.fn(() => Promise.resolve([{ unlinked: true }])),
    createPasskeyAddChallenge: vi.fn(() => Promise.resolve([{ created: true }])),
    createPairingApprovalChallenge: vi.fn(() => Promise.resolve([{ created: true }])),
    createPasskeyChallenge: vi.fn(() => Promise.resolve([{ created: true }])),
    createPasskeyRevokeChallenge: vi.fn(() => Promise.resolve([{ created: true }])),
    createProfileDeletionChallenge: vi.fn(() => Promise.resolve([{ created: true }])),
    createRecoveryCodeChallenge: vi.fn(() => Promise.resolve([{ created: true }])),
    createSourceReactivationChallenge: vi.fn(() => Promise.resolve([{ created: true }])),
    createSourceUnlinkChallenge: vi.fn(() => Promise.resolve([{ created: true }])),
    enrollProfile: vi.fn(() => Promise.resolve([{ enrolled: true }])),
    pauseSource: vi.fn(() => Promise.resolve([{ paused: true }])),
    readAccountOverview: vi.fn(() => Promise.resolve(accountScoreRows())),
    readActiveDeviceInventory: vi.fn(() =>
      Promise.resolve([
        {
          activated_on: "2026-07-14",
          architecture: "x86_64",
          connector_version: "1.2.3",
          device_id: `dev_${"A".repeat(22)}`,
          device_label: "Studio PC",
          device_state: "active",
          os_family: "windows",
          source_id: `src_${"B".repeat(22)}`,
          source_state: "active",
        },
      ]),
    ),
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
    readPairingApproval: vi.fn(() => Promise.resolve([])),
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
    readRecoveryCodeVerificationMaterial: vi.fn(() =>
      Promise.resolve([
        {
          recovery_code_id: "00000000-0000-4000-8000-000000000420",
          verifier_phc: `$argon2id$v=19$m=19456,t=2,p=2$${"A".repeat(22)}$${"B".repeat(43)}`,
        },
      ]),
    ),
    readProfileVisibility: vi.fn(() => Promise.resolve([{ visibility: "public" }])),
    release(destroy = false): void {
      releases.push(destroy);
    },
    revokeEnrollmentSession: vi.fn(() => Promise.resolve([{ revoked: true }])),
    revokeDevice: vi.fn(() => Promise.resolve([{ revoked: true }])),
    setProfileVisibility: vi.fn(() => Promise.resolve([{ visibility: "hidden" }])),
    startRecovery: vi.fn(() => Promise.resolve([{ started: true }])),
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
      database.readActiveDeviceInventory({
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
      }),
    ).resolves.toEqual([
      {
        devices: [
          {
            activatedOn: "2026-07-14",
            architecture: "x86_64",
            connectorVersion: "1.2.3",
            deviceId: `dev_${"A".repeat(22)}`,
            label: "Studio PC",
            osFamily: "windows",
          },
        ],
        sourceId: `src_${"B".repeat(22)}`,
        state: "active",
      },
    ]);
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
      database.createPasskeyAddChallenge({
        challengeDigest: new Uint8Array(32),
        challengeId: "00000000-0000-4000-8000-000000000411",
        contextDigest: new Uint8Array(32),
        expiresAt: "2026-07-16T10:05:00.000Z",
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
      }),
    ).resolves.toBe(true);
    await expect(
      database.completePasskeyAddition({
        auditEventId: profile.auditEventId,
        backupEligible: false,
        backupState: false,
        challengeDigest: new Uint8Array(32),
        challengeId: "00000000-0000-4000-8000-000000000411",
        contextDigest: new Uint8Array(32),
        cosePublicKey: new Uint8Array(77),
        credentialId: new Uint8Array(32),
        label: "Backup passkey",
        observedSignCount: 2,
        passkeyId: "00000000-0000-4000-8000-000000000412",
        requestId: profile.requestId,
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
        signCount: 0,
        verifiedBackupState: false,
        verifiedPasskeyId: "00000000-0000-4000-8000-000000000406",
      }),
    ).resolves.toBe(true);
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
      database.createRecoveryCodeChallenge({
        challengeDigest: new Uint8Array(32),
        challengeId: "00000000-0000-4000-8000-000000000413",
        contextDigest: new Uint8Array(32),
        expiresAt: "2026-07-16T10:05:00.000Z",
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
      }),
    ).resolves.toBe(true);
    await expect(
      database.completeRecoveryCodeReplacement({
        auditEventId: profile.auditEventId,
        backupState: false,
        batchId: "00000000-0000-4000-8000-000000000414",
        challengeDigest: new Uint8Array(32),
        challengeId: "00000000-0000-4000-8000-000000000413",
        contextDigest: new Uint8Array(32),
        observedSignCount: 3,
        recoveryCodeIds: Array.from(
          { length: 10 },
          (_, index) => `00000000-0000-4000-8000-${String(500 + index).padStart(12, "0")}`,
        ),
        requestId: profile.requestId,
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
        verifierPhcs: Array.from(
          { length: 10 },
          (_, index) =>
            `$argon2id$v=19$m=19456,t=2,p=2$${"A".repeat(22)}$${String(index)}${"B".repeat(42)}`,
        ),
        verifiedPasskeyId: "00000000-0000-4000-8000-000000000406",
      }),
    ).resolves.toBe(true);
    await expect(
      database.createProfileDeletionChallenge({
        challengeDigest: new Uint8Array(32),
        challengeId: "00000000-0000-4000-8000-000000000413",
        contextDigest: new Uint8Array(32),
        expiresAt: "2026-07-16T10:05:00.000Z",
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
      }),
    ).resolves.toBe(true);
    await expect(
      database.completeProfileDeletion({
        auditEventId: profile.auditEventId,
        backupState: false,
        challengeDigest: new Uint8Array(32),
        challengeId: "00000000-0000-4000-8000-000000000413",
        contextDigest: new Uint8Array(32),
        deletionJobId: "00000000-0000-4000-8000-000000000414",
        observedSignCount: 3,
        profileRefDigest: new Uint8Array(32),
        requestId: profile.requestId,
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
        typedHandle: profile.handle,
        verifiedPasskeyId: "00000000-0000-4000-8000-000000000406",
      }),
    ).resolves.toBe(true);
    await expect(
      database.pauseSource({
        auditEventId: profile.auditEventId,
        requestId: profile.requestId,
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
        sourceId: `src_${"A".repeat(22)}`,
      }),
    ).resolves.toBe(true);
    await expect(
      database.createSourceReactivationChallenge({
        challengeDigest: new Uint8Array(32),
        challengeId: "00000000-0000-4000-8000-000000000415",
        contextDigest: new Uint8Array(32),
        expiresAt: "2026-07-16T10:05:00.000Z",
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
        sourceId: `src_${"A".repeat(22)}`,
      }),
    ).resolves.toBe(true);
    await expect(
      database.completeSourceReactivation({
        auditEventId: profile.auditEventId,
        backupState: false,
        challengeDigest: new Uint8Array(32),
        challengeId: "00000000-0000-4000-8000-000000000415",
        contextDigest: new Uint8Array(32),
        observedSignCount: 4,
        requestId: profile.requestId,
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
        sourceId: `src_${"A".repeat(22)}`,
        verifiedPasskeyId: "00000000-0000-4000-8000-000000000406",
      }),
    ).resolves.toBe(true);
    await expect(
      database.createSourceUnlinkChallenge({
        challengeDigest: new Uint8Array(32),
        challengeId: "00000000-0000-4000-8000-000000000416",
        contextDigest: new Uint8Array(32),
        expiresAt: "2026-07-16T10:05:00.000Z",
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
        sourceId: `src_${"A".repeat(22)}`,
      }),
    ).resolves.toBe(true);
    await expect(
      database.completeSourceUnlink({
        auditEventId: profile.auditEventId,
        backupState: false,
        challengeDigest: new Uint8Array(32),
        challengeId: "00000000-0000-4000-8000-000000000416",
        contextDigest: new Uint8Array(32),
        observedSignCount: 5,
        requestId: profile.requestId,
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
        sourceId: `src_${"A".repeat(22)}`,
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
      database.readRecoveryCodeVerificationMaterial("00000000-0000-4000-8000-000000000420"),
    ).resolves.toEqual({
      recoveryCodeId: "00000000-0000-4000-8000-000000000420",
      verifierPhc: `$argon2id$v=19$m=19456,t=2,p=2$${"A".repeat(22)}$${"B".repeat(43)}`,
    });
    await expect(
      database.startRecovery({
        auditEventId: profile.auditEventId,
        authorityId: "00000000-0000-4000-8000-000000000421",
        authorityVerifierDigest: new Uint8Array(32),
        challengeDigest: new Uint8Array(32),
        contextDigest: new Uint8Array(32),
        expiresAt: "2026-07-16T10:05:00.000Z",
        recoveryCodeId: "00000000-0000-4000-8000-000000000420",
        requestId: profile.requestId,
      }),
    ).resolves.toBe(true);
    await expect(
      database.completeRecoveryRegistration({
        auditEventId: profile.auditEventId,
        authorityId: "00000000-0000-4000-8000-000000000421",
        authorityVerifierDigest: new Uint8Array(32),
        backupEligible: true,
        backupState: false,
        challengeDigest: new Uint8Array(32),
        contextDigest: new Uint8Array(32),
        cosePublicKey: new Uint8Array(77),
        credentialId: new Uint8Array(32),
        label: "Replacement passkey",
        passkeyId: "00000000-0000-4000-8000-000000000422",
        requestId: profile.requestId,
        sessionExpiresAt: profile.sessionExpiresAt,
        sessionId: "00000000-0000-4000-8000-000000000423",
        sessionVerifierDigest: new Uint8Array(32),
        signCount: 0,
      }),
    ).resolves.toEqual({
      handle: "pixel_driver",
      locale: "en",
      profileId: profile.profileId,
    });
    await expect(
      database.readProfileVisibility({
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
      }),
    ).resolves.toBe("public");
    const accountOverview = await database.readAccountOverview(accountOverviewRequest);
    expect(accountOverview).toEqual({
      score: {
        activeDays: 7,
        dailyScores: [100, 200, 300, 400, 500, 600, 700],
        seasonEnd: "2026-07-19",
        seasonFinalized: false,
        seasonStart: "2026-07-13",
        sourceCount: 2,
        weeklyScore: 2800,
      },
      visibility: "public",
    });
    expect(Object.isFrozen(accountOverview)).toBe(true);
    expect(Object.isFrozen(accountOverview.score)).toBe(true);
    expect(Object.isFrozen(accountOverview.score?.dailyScores)).toBe(true);
    await expect(
      database.setProfileVisibility({
        publiclyVisible: false,
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
      }),
    ).resolves.toBe("hidden");
    await expect(
      database.revokeDevice({
        auditEventId: profile.auditEventId,
        deviceId: `dev_${"A".repeat(22)}`,
        requestId: profile.requestId,
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
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
    expect(client.verifyRuntimeBoundary).toHaveBeenCalledTimes(28);
    expect(releases).toEqual(Array.from({ length: 28 }, () => false));
  });

  it("maps only one exact pending pairing and composes its approval writes", async () => {
    const row = {
      architecture: "x86_64",
      candidate_index: 1,
      connector_version: "1.2.3",
      device_label: "Studio PC",
      expires_at: "2026-07-16T10:09:00.000Z",
      os_family: "windows",
      pairing_id: "00000000-0000-4000-8000-000000000430",
      public_key: Buffer.alloc(32, 0x44),
    };
    const { database } = fixture({
      readPairingApproval: vi.fn(() => Promise.resolve([row])),
    });
    const read = {
      attemptLimit: 6,
      codeDigests: [new Uint8Array(32), new Uint8Array(32)] as const,
      secondaryActive: false,
      sessionId: profile.sessionId,
      sessionVerifierDigest: new Uint8Array(32),
      windowSeconds: 600,
    };

    const material = await database.readPairingApproval(read);
    expect(material).toMatchObject({
      architecture: "x86_64",
      candidateIndex: 1,
      connectorVersion: "1.2.3",
      deviceLabel: "Studio PC",
      expiresAt: "2026-07-16T10:09:00.000Z",
      osFamily: "windows",
      pairingId: row.pairing_id,
    });
    expect(material?.publicKey).toEqual(Buffer.alloc(32, 0x44));
    material?.publicKey.fill(0);
    await expect(
      database.createPairingApprovalChallenge({
        challengeDigest: new Uint8Array(32),
        challengeId: "00000000-0000-4000-8000-000000000431",
        contextDigest: new Uint8Array(32),
        expiresAt: "2026-07-16T10:05:00.000Z",
        pairingId: row.pairing_id,
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
        sourceChoice: "new",
        sourceId: `src_${"A".repeat(22)}`,
        userCodeDigest: new Uint8Array(32),
      }),
    ).resolves.toBe(true);
    await expect(
      database.completePairingApproval({
        auditEventId: profile.auditEventId,
        backupState: false,
        challengeDigest: new Uint8Array(32),
        challengeId: "00000000-0000-4000-8000-000000000431",
        contextDigest: new Uint8Array(32),
        observedSignCount: 4,
        pairingId: row.pairing_id,
        requestId: profile.requestId,
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
        verifiedPasskeyId: "00000000-0000-4000-8000-000000000406",
      }),
    ).resolves.toBe(true);

    await expect(
      fixture({
        readPairingApproval: vi.fn(() =>
          Promise.resolve([{ ...row, public_key: Buffer.alloc(32) }]),
        ),
      }).database.readPairingApproval(read),
    ).rejects.toMatchObject({ code: "result_invalid" });
    await expect(
      fixture({
        readPairingApproval: vi.fn(() => Promise.resolve([row, row])),
      }).database.readPairingApproval(read),
    ).rejects.toMatchObject({ code: "result_invalid" });
  });

  it("accepts only an exact bounded account score projection", async () => {
    for (const visibility of ["hidden", "public"] as const) {
      const empty = fixture({
        readAccountOverview: () =>
          Promise.resolve([
            {
              active_days: null,
              daily_score: null,
              score_date: null,
              season_end: null,
              season_finalized: null,
              season_start: null,
              source_count: null,
              visibility,
              weekly_score: null,
            },
          ]),
      });
      await expect(empty.database.readAccountOverview(accountOverviewRequest)).resolves.toEqual({
        score: null,
        visibility,
      });
      expect(empty.releases).toEqual([false]);
    }

    const validRows = accountScoreRows();
    const invalidResults: readonly unknown[] = [
      validRows.slice(0, 6),
      [...validRows, validRows[6]],
      validRows.map((row, index) => (index === 3 ? { ...row, season_end: "2026-07-20" } : row)),
      validRows.map((row) => ({ ...row, visibility: "hidden" })),
      validRows.map((row, index) => (index === 1 ? { ...row, score_date: "2026-07-16" } : row)),
      validRows.map((row, index) => ({
        ...row,
        score_date: `2026-07-${String(6 + index).padStart(2, "0")}`,
        season_end: "2026-07-12",
        season_start: "2026-07-06",
      })),
      validRows.map((row) => ({ ...row, weekly_score: 2799 })),
      [
        {
          ...validRows[0],
          active_days: null,
          daily_score: null,
          score_date: null,
          season_end: null,
          season_finalized: null,
          season_start: null,
          source_count: null,
        },
      ],
      validRows.map((row) => ({ ...row, raw_tokens: 123 })),
    ];

    for (const rows of invalidResults) {
      const invalid = fixture({ readAccountOverview: () => Promise.resolve(rows) });
      await expect(
        invalid.database.readAccountOverview(accountOverviewRequest),
      ).rejects.toMatchObject({ code: "result_invalid" });
      expect(invalid.releases).toEqual([true]);
    }
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

    const malformedDeviceInventory = fixture({
      readActiveDeviceInventory: () =>
        Promise.resolve([
          {
            activated_on: "2026-07-14",
            architecture: "x86_64",
            connector_version: "1.2.3",
            device_id: `dev_${"A".repeat(22)}`,
            device_key_id: "00000000-0000-4000-8000-000000000499",
            device_label: "Studio PC",
            device_state: "active",
            os_family: "windows",
            source_id: `src_${"B".repeat(22)}`,
            source_state: "active",
          },
        ]),
    });
    await expect(
      malformedDeviceInventory.database.readActiveDeviceInventory({
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
      }),
    ).rejects.toMatchObject({ code: "result_invalid" });
    expect(malformedDeviceInventory.releases).toEqual([true]);

    const malformedVisibility = fixture({
      readProfileVisibility: () => Promise.resolve([{ visibility: "private" }]),
    });
    await expect(
      malformedVisibility.database.readProfileVisibility({
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
      }),
    ).rejects.toMatchObject({ code: "result_invalid" });
    expect(malformedVisibility.releases).toEqual([true]);

    const mismatchedVisibility = fixture({
      setProfileVisibility: () => Promise.resolve([{ visibility: "public" }]),
    });
    await expect(
      mismatchedVisibility.database.setProfileVisibility({
        publiclyVisible: false,
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
      }),
    ).rejects.toMatchObject({ code: "result_invalid" });
    expect(mismatchedVisibility.releases).toEqual([true]);

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

  it("keeps empty owned sources visible and enforces the active-device ceiling", async () => {
    const emptySource = fixture({
      readActiveDeviceInventory: () =>
        Promise.resolve([
          {
            activated_on: null,
            architecture: null,
            connector_version: null,
            device_id: null,
            device_label: null,
            device_state: null,
            os_family: null,
            source_id: `src_${"A".repeat(22)}`,
            source_state: "paused",
          },
        ]),
    });
    await expect(
      emptySource.database.readActiveDeviceInventory({
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
      }),
    ).resolves.toEqual([
      {
        devices: [],
        sourceId: `src_${"A".repeat(22)}`,
        state: "paused",
      },
    ]);

    const overflow = fixture({
      readActiveDeviceInventory: () =>
        Promise.resolve(
          Array.from({ length: 65 }, (_, index) => ({
            activated_on: "2026-07-14",
            architecture: "x86_64",
            connector_version: "1.2.3",
            device_id: `dev_${String(index).padStart(22, "0")}`,
            device_label: `Device ${String(index).padStart(2, "0")}`,
            device_state: "active",
            os_family: "windows",
            source_id: `src_${"B".repeat(22)}`,
            source_state: "active",
          })),
        ),
    });
    await expect(
      overflow.database.readActiveDeviceInventory({
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
      }),
    ).rejects.toMatchObject({ code: "result_invalid" });
    expect(overflow.releases).toEqual([true]);
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
