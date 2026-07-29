/* eslint-disable @typescript-eslint/unbound-method -- Vitest inspects injected method spies without invoking them. */

import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import { createEnrollmentDatabase, EnrollmentDatabaseError } from "./enrollment-database";
import type { EnrollmentDatabaseClient, EnrollmentDatabasePool } from "./pairing-database-pool";

function carRecipeStateRow() {
  return {
    active_chassis: "roadster",
    active_cockpit: "canopy",
    active_nose: "classic",
    active_palette: "mint",
    active_schema_version: 1,
    active_seed: 7,
    active_trail: "none",
    active_wheels: "street",
    active_wing: "none",
    proposal_chassis: "rally",
    proposal_cockpit: "rally",
    proposal_expires_at: "2026-07-17T11:00:00.000Z",
    proposal_id: "00000000-0000-4000-8000-000000000701",
    proposal_nose: "scoop",
    proposal_palette: "sunburst",
    proposal_schema_version: 1,
    proposal_seed: 42,
    proposal_trail: "spark",
    proposal_wheels: "all-terrain",
    proposal_wing: "low",
  };
}

function fixture(overrides: Partial<EnrollmentDatabaseClient> = {}) {
  const releases: boolean[] = [];
  const client: EnrollmentDatabaseClient = {
    approveCarRecipe: vi.fn(() => Promise.resolve([{ approved: true }])),
    completeAgentAccountReactivation: vi.fn(() => Promise.resolve([{ completed: true }])),
    completeAgentAccountUnlink: vi.fn(() => Promise.resolve([{ completed: true }])),
    completeDeviceKeyRevocation: vi.fn(() => Promise.resolve([{ completed: true }])),
    completeInstallationRevocation: vi.fn(() => Promise.resolve([{ completed: true }])),
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
    createPasskeyAddChallenge: vi.fn(() => Promise.resolve([{ created: true }])),
    createPasskeyChallenge: vi.fn(() => Promise.resolve([{ created: true }])),
    createPasskeyRevokeChallenge: vi.fn(() => Promise.resolve([{ created: true }])),
    createProfileDeletionChallenge: vi.fn(() => Promise.resolve([{ created: true }])),
    createAccountTargetChallenge: vi.fn(() => Promise.resolve([{ created: true }])),
    createRecoveryCodeChallenge: vi.fn(() => Promise.resolve([{ created: true }])),
    enrollProfile: vi.fn(() =>
      Promise.resolve([
        {
          created: true,
          handle: "pending_0000000000004000",
          locale: "en",
          profile_id: "00000000-0000-4000-8000-000000000402",
          profile_state: "enrolling",
          session_created: true,
        },
      ]),
    ),
    pauseAgentAccount: vi.fn(() => Promise.resolve([{ paused: true }])),
    proposeCarRecipe: vi.fn(() => Promise.resolve([{ proposed: true }])),
    readAgentAccountDashboard: vi.fn(() => Promise.resolve([])),
    readCarRecipeState: vi.fn(() =>
      Promise.resolve([
        {
          active_chassis: null,
          active_cockpit: null,
          active_nose: null,
          active_palette: null,
          active_schema_version: null,
          active_seed: null,
          active_trail: null,
          active_wheels: null,
          active_wing: null,
          proposal_chassis: null,
          proposal_cockpit: null,
          proposal_expires_at: null,
          proposal_id: null,
          proposal_nose: null,
          proposal_palette: null,
          proposal_schema_version: null,
          proposal_seed: null,
          proposal_trail: null,
          proposal_wheels: null,
          proposal_wing: null,
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
    readPrivateDashboardRanking: vi.fn(() =>
      Promise.resolve([
        {
          participant_count: 10,
          provider_breakdown_visible: false,
          public_visibility: "public",
          rank_position: "2",
          season_end: "2026-07-19",
          season_start: "2026-07-13",
          season_state: "open",
          snapshot_generated_at: "2026-07-16T10:00Z",
          weekly_token_total: "2800",
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
    rejectCarRecipe: vi.fn(() => Promise.resolve([{ rejected: true }])),
    setProfileVisibility: vi.fn(() => Promise.resolve([{ visibility: "hidden" }])),
    setProviderBreakdownVisibility: vi.fn(() =>
      Promise.resolve([{ provider_breakdown_visible: false }]),
    ),
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
  githubUserId: 123,
  handle: "pending_0000000000004000",
  inviteId: "00000000-0000-4000-8000-000000000401",
  inviteRequired: true,
  inviteVerifierDigest: new Uint8Array(32),
  locale: "en" as const,
  profileId: "00000000-0000-4000-8000-000000000402",
  sessionExpiresAt: "2026-08-15T10:00:00.000Z",
  sessionId: "00000000-0000-4000-8000-000000000403",
  sessionVerifierDigest: new Uint8Array(32),
};

describe("enrollment database", () => {
  it("probes every checkout and exposes only the fixed identity operations", async () => {
    const { client, database, releases } = fixture();
    await expect(database.enrollProfile(profile)).resolves.toEqual({
      created: true,
      handle: "pending_0000000000004000",
      locale: "en",
      profileId: profile.profileId,
      profileState: "enrolling",
      sessionCreated: true,
    });
    await expect(
      database.createPasskeyChallenge({
        challengeDigest: new Uint8Array(32),
        challengeId: "00000000-0000-4000-8000-000000000404",
        contextDigest: new Uint8Array(32),
        expiresAt: "2026-07-16T10:05:00.000Z",
        handle: "pixel_driver",
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
      }),
    ).resolves.toBe(true);
    await expect(
      database.completeInitialPasskey({
        backupEligible: false,
        backupState: false,
        challengeId: "00000000-0000-4000-8000-000000000404",
        contextDigest: new Uint8Array(32),
        cosePublicKey: new Uint8Array(77),
        credentialId: new Uint8Array(32),
        handle: "pixel_driver",
        passkeyId: "00000000-0000-4000-8000-000000000406",
        rotatedSessionExpiresAt: profile.sessionExpiresAt,
        rotatedSessionId: "00000000-0000-4000-8000-000000000407",
        rotatedSessionVerifierDigest: new Uint8Array(32),
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
        backupEligible: false,
        backupState: false,
        challengeId: "00000000-0000-4000-8000-000000000411",
        contextDigest: new Uint8Array(32),
        cosePublicKey: new Uint8Array(77),
        credentialId: new Uint8Array(32),
        label: "Backup passkey",
        observedSignCount: 2,
        passkeyId: "00000000-0000-4000-8000-000000000412",
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
      }),
    ).resolves.toBe(true);
    await expect(
      database.completePasskeyRevocation({
        backupState: false,
        challengeId: "00000000-0000-4000-8000-000000000411",
        contextDigest: new Uint8Array(32),
        observedSignCount: 2,
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
        backupState: false,
        batchId: "00000000-0000-4000-8000-000000000414",
        challengeId: "00000000-0000-4000-8000-000000000413",
        contextDigest: new Uint8Array(32),
        observedSignCount: 3,
        recoveryCodeIds: Array.from(
          { length: 10 },
          (_, index) => `00000000-0000-4000-8000-${String(500 + index).padStart(12, "0")}`,
        ),
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
        backupState: false,
        challengeId: "00000000-0000-4000-8000-000000000413",
        contextDigest: new Uint8Array(32),
        observedSignCount: 3,
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
        typedHandle: profile.handle,
        verifiedPasskeyId: "00000000-0000-4000-8000-000000000406",
      }),
    ).resolves.toBe(true);
    await expect(
      database.completePasskeyLogin({
        backupState: false,
        challengeDigest: new Uint8Array(32),
        challengeExpiresAt: "2026-07-16T10:05:00.000Z",
        challengeId: "00000000-0000-4000-8000-000000000409",
        contextDigest: new Uint8Array(32),
        credentialId: new Uint8Array(32),
        observedSignCount: 2,
        passkeyId: "00000000-0000-4000-8000-000000000406",
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
        authorityId: "00000000-0000-4000-8000-000000000421",
        authorityVerifierDigest: new Uint8Array(32),
        challengeDigest: new Uint8Array(32),
        contextDigest: new Uint8Array(32),
        expiresAt: "2026-07-16T10:05:00.000Z",
        recoveryCodeId: "00000000-0000-4000-8000-000000000420",
      }),
    ).resolves.toBe(true);
    await expect(
      database.completeRecoveryRegistration({
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
    await expect(
      database.setProfileVisibility({
        publiclyVisible: false,
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
      }),
    ).resolves.toBe("hidden");
    await expect(
      database.revokeSession({
        sessionId: profile.sessionId,
        sessionVerifierDigest: new Uint8Array(32),
      }),
    ).resolves.toBe(true);
    expect(client.verifyRuntimeBoundary).toHaveBeenCalledTimes(20);
    expect(releases).toEqual(Array.from({ length: 20 }, () => false));
  });

  it("maps exact private ranking and grouped agent-account dashboard rows", async () => {
    const request = {
      sessionId: profile.sessionId,
      sessionVerifierDigest: new Uint8Array(32),
    };
    const firstAccountId = `acc_${"A".repeat(22)}`;
    const secondAccountId = `acc_${"B".repeat(22)}`;
    const installationId = `ins_${"C".repeat(22)}`;
    const deviceId = `dev_${"D".repeat(22)}`;
    const base = {
      account_state: "active",
      accounting_revision: 1,
      agent_account_id: firstAccountId,
      architecture: "x86_64",
      connected_date: "2026-07-14",
      connector_version: "1.2.3",
      device_id: deviceId,
      device_state: "active",
      expected_reader_version: "codex_daily_usage_v1",
      identity_assurance: "community_local",
      installation_id: installationId,
      installation_label: "Studio PC",
      installation_state: "active",
      last_seen_date: "2026-07-16",
      last_successful_sync_date: "2026-07-16",
      observed_reader_version: "codex_daily_usage_v1",
      os_family: "windows",
      private_label: "Personal account",
      provider_code: "codex",
      quarantine_reason: null,
      status_code: "connected",
      today_token_total: "9007199254740993",
      weekly_token_total: "999999999999999999999999999999999999999999999999999999999999",
    };
    const withoutDevice = {
      ...base,
      agent_account_id: secondAccountId,
      architecture: null,
      connected_date: null,
      connector_version: null,
      device_id: null,
      device_state: null,
      installation_id: null,
      installation_label: null,
      installation_state: null,
      last_seen_date: null,
      last_successful_sync_date: null,
      observed_reader_version: null,
      os_family: null,
      private_label: "Work account",
      status_code: "needs_login",
      today_token_total: "0",
      weekly_token_total: "0",
    };
    const { database } = fixture({
      readAgentAccountDashboard: () => Promise.resolve([base, withoutDevice]),
    });

    await expect(database.readPrivateDashboardRanking(request)).resolves.toEqual({
      participantCount: 10,
      providerBreakdownVisible: false,
      publicVisibility: "public",
      rankPosition: 2,
      seasonEnd: "2026-07-19",
      seasonStart: "2026-07-13",
      seasonState: "open",
      snapshotGeneratedAt: "2026-07-16T10:00Z",
      weeklyTokenTotal: "2800",
    });
    await expect(database.readAgentAccountDashboard(request)).resolves.toEqual({
      accounts: [
        {
          accountingRevision: 1,
          agentAccountId: firstAccountId,
          devices: [{ deviceId, installationId, state: "active" }],
          expectedReaderVersion: "codex_daily_usage_v1",
          identityAssurance: "community_local",
          lastSuccessfulSyncDate: "2026-07-16",
          observedReaderVersion: "codex_daily_usage_v1",
          privateLabel: "Personal account",
          provider: "codex",
          quarantineReason: null,
          state: "active",
          status: "connected",
          todayTokenTotal: "9007199254740993",
          weeklyTokenTotal: "999999999999999999999999999999999999999999999999999999999999",
        },
        {
          accountingRevision: 1,
          agentAccountId: secondAccountId,
          devices: [],
          expectedReaderVersion: "codex_daily_usage_v1",
          identityAssurance: "community_local",
          lastSuccessfulSyncDate: null,
          observedReaderVersion: null,
          privateLabel: "Work account",
          provider: "codex",
          quarantineReason: null,
          state: "active",
          status: "needs_login",
          todayTokenTotal: "0",
          weeklyTokenTotal: "0",
        },
      ],
      installations: [
        {
          accounts: [
            {
              agentAccountId: firstAccountId,
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

    for (const rows of [
      [{ ...base, today_token_total: `${base.weekly_token_total}0` }, withoutDevice],
      [{ ...base, observed_reader_version: null }, withoutDevice],
      [{ ...base, status_code: "needs_login" }, withoutDevice],
      [{ ...base, extra_private_value: "sentinel" }, withoutDevice],
      [base, { ...withoutDevice, status_code: "connected" }],
      [base, base],
    ]) {
      await expect(
        fixture({
          readAgentAccountDashboard: () => Promise.resolve(rows),
        }).database.readAgentAccountDashboard(request),
      ).rejects.toMatchObject({ code: "result_invalid" });
    }

    await expect(
      fixture({
        readPrivateDashboardRanking: () =>
          Promise.resolve([
            {
              participant_count: null,
              provider_breakdown_visible: false,
              public_visibility: "hidden",
              rank_position: null,
              season_end: "2026-07-19",
              season_start: "2026-07-13",
              season_state: "pending",
              snapshot_generated_at: null,
              weekly_token_total: null,
            },
          ]),
      }).database.readPrivateDashboardRanking(request),
    ).resolves.toMatchObject({
      participantCount: null,
      publicVisibility: "hidden",
      seasonState: "pending",
      weeklyTokenTotal: null,
    });
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

  it("maps one exact CarRecipe state and rejects malformed or widened database rows", async () => {
    const request = {
      sessionId: profile.sessionId,
      sessionVerifierDigest: new Uint8Array(32),
    };
    const valid = fixture({
      readCarRecipeState: () => Promise.resolve([carRecipeStateRow()]),
    });
    const state = await valid.database.readCarRecipeState(request);
    expect(state).toEqual({
      active: {
        schemaVersion: 1,
        chassis: "roadster",
        nose: "classic",
        cockpit: "canopy",
        wing: "none",
        wheels: "street",
        palette: "mint",
        trail: "none",
        seed: 7,
      },
      proposal: {
        expiresAt: "2026-07-17T11:00:00.000Z",
        proposalId: "00000000-0000-4000-8000-000000000701",
        recipe: {
          schemaVersion: 1,
          chassis: "rally",
          nose: "scoop",
          cockpit: "rally",
          wing: "low",
          wheels: "all-terrain",
          palette: "sunburst",
          trail: "spark",
          seed: 42,
        },
      },
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.active)).toBe(true);
    expect(Object.isFrozen(state.proposal)).toBe(true);
    expect(Object.isFrozen(state.proposal?.recipe)).toBe(true);
    expect(valid.releases).toEqual([false]);

    await expect(
      valid.database.proposeCarRecipe({
        expiresAt: "2026-07-17T11:00:00.000Z",
        proposalId: "00000000-0000-4000-8000-000000000701",
        recipe: state.proposal?.recipe ?? state.active!,
        ...request,
      }),
    ).resolves.toBe(true);
    await expect(
      valid.database.approveCarRecipe({
        proposalId: "00000000-0000-4000-8000-000000000701",
        ...request,
      }),
    ).resolves.toBe(true);
    await expect(
      valid.database.rejectCarRecipe({
        proposalId: "00000000-0000-4000-8000-000000000701",
        ...request,
      }),
    ).resolves.toBe(true);
    expect(valid.releases).toEqual([false, false, false, false]);

    const row = carRecipeStateRow();
    const invalidRows: readonly unknown[] = [
      [],
      [row, row],
      [{ ...row, remote_asset_url: "https://invalid.example/car.svg" }],
      [{ ...row, active_chassis: null }],
      [{ ...row, active_schema_version: 2 }],
      [{ ...row, proposal_palette: "custom" }],
      [{ ...row, proposal_seed: 65_536 }],
      [{ ...row, proposal_id: "not-a-uuid" }],
      [{ ...row, proposal_expires_at: "2026-07-17 11:00:00+00" }],
      [
        {
          ...row,
          proposal_chassis: null,
          proposal_cockpit: null,
          proposal_nose: null,
          proposal_palette: null,
          proposal_schema_version: null,
          proposal_seed: null,
          proposal_trail: null,
          proposal_wheels: null,
          proposal_wing: null,
        },
      ],
    ];
    for (const rows of invalidRows) {
      const invalid = fixture({ readCarRecipeState: () => Promise.resolve(rows) });
      await expect(invalid.database.readCarRecipeState(request)).rejects.toMatchObject({
        code: "result_invalid",
      });
      expect(invalid.releases).toEqual([true]);
    }
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
