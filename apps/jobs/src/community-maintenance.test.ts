import { describe, expect, it, vi } from "vitest";

import {
  CommunityMaintenanceError,
  createCloseableCommunityMaintenanceRunner,
  createCommunityMaintenanceRunner,
  createConfiguredCommunityMaintenanceRunner,
  type CommunityMaintenanceErrorCode,
  type CommunityMaintenanceJob,
} from "./community-maintenance.js";
import type { JobsDatabaseClient, JobsDatabasePool } from "./database-pool.js";

const privateDetail = "private database detail must not leak";
const runtimeBoundary = [
  {
    login_scope_ok: true,
    role_ok: true,
    search_path_ok: true,
  },
];

interface PoolFixture {
  readonly client: JobsDatabaseClient;
  readonly close: ReturnType<typeof vi.fn>;
  readonly cleanupAbandonedEnrollments: ReturnType<typeof vi.fn>;
  readonly cleanupAgedRevokedDevices: ReturnType<typeof vi.fn>;
  readonly cleanupAgedRevokedPasskeys: ReturnType<typeof vi.fn>;
  readonly cleanupExpiredAuthState: ReturnType<typeof vi.fn>;
  readonly cleanupExpiredAuditEvents: ReturnType<typeof vi.fn>;
  readonly cleanupExpiredCarRecipeProposals: ReturnType<typeof vi.fn>;
  readonly cleanupExpiredInvites: ReturnType<typeof vi.fn>;
  readonly cleanupExpiredIngestState: ReturnType<typeof vi.fn>;
  readonly cleanupExpiredPairingState: ReturnType<typeof vi.fn>;
  readonly cleanupExpiredSessions: ReturnType<typeof vi.fn>;
  readonly cleanupTerminalDeletionJobs: ReturnType<typeof vi.fn>;
  readonly connect: ReturnType<typeof vi.fn>;
  readonly finalizeCommunitySeason: ReturnType<typeof vi.fn>;
  readonly pool: JobsDatabasePool;
  readonly purgeProfileDeletions: ReturnType<typeof vi.fn>;
  readonly redactAgedPairingApprovalProvenance: ReturnType<typeof vi.fn>;
  readonly release: ReturnType<typeof vi.fn>;
  readonly resetExpiredPairingRequestWindows: ReturnType<typeof vi.fn>;
  readonly refreshCommunitySeason: ReturnType<typeof vi.fn>;
  readonly verifyRuntimeBoundary: ReturnType<typeof vi.fn>;
}

function createPoolFixture(jobResult: unknown): PoolFixture {
  const cleanupAbandonedEnrollments = vi.fn(() => Promise.resolve(jobResult));
  const cleanupAgedRevokedDevices = vi.fn(() => Promise.resolve(jobResult));
  const cleanupAgedRevokedPasskeys = vi.fn(() => Promise.resolve(jobResult));
  const cleanupExpiredAuthState = vi.fn(() => Promise.resolve(jobResult));
  const cleanupExpiredAuditEvents = vi.fn(() => Promise.resolve(jobResult));
  const cleanupExpiredCarRecipeProposals = vi.fn(() => Promise.resolve(jobResult));
  const cleanupExpiredInvites = vi.fn(() => Promise.resolve(jobResult));
  const cleanupExpiredIngestState = vi.fn(() => Promise.resolve(jobResult));
  const cleanupExpiredPairingState = vi.fn(() => Promise.resolve(jobResult));
  const cleanupExpiredSessions = vi.fn(() => Promise.resolve(jobResult));
  const cleanupTerminalDeletionJobs = vi.fn(() => Promise.resolve(jobResult));
  const finalizeCommunitySeason = vi.fn(() => Promise.resolve(jobResult));
  const purgeProfileDeletions = vi.fn(() => Promise.resolve(jobResult));
  const redactAgedPairingApprovalProvenance = vi.fn(() => Promise.resolve(jobResult));
  const release = vi.fn();
  const resetExpiredPairingRequestWindows = vi.fn(() => Promise.resolve(jobResult));
  const refreshCommunitySeason = vi.fn(() => Promise.resolve(jobResult));
  const verifyRuntimeBoundary = vi.fn(() => Promise.resolve(runtimeBoundary));
  const client: JobsDatabaseClient = {
    cleanupAbandonedEnrollments,
    cleanupAgedRevokedDevices,
    cleanupAgedRevokedPasskeys,
    cleanupExpiredAuthState,
    cleanupExpiredAuditEvents,
    cleanupExpiredCarRecipeProposals,
    cleanupExpiredInvites,
    cleanupExpiredIngestState,
    cleanupExpiredPairingState,
    cleanupExpiredSessions,
    cleanupTerminalDeletionJobs,
    finalizeCommunitySeason,
    purgeProfileDeletions,
    redactAgedPairingApprovalProvenance,
    release,
    resetExpiredPairingRequestWindows,
    refreshCommunitySeason,
    verifyRuntimeBoundary,
  };
  const connect = vi.fn(() => Promise.resolve(client));
  const close = vi.fn(() => Promise.resolve());
  return {
    client,
    close,
    cleanupAbandonedEnrollments,
    cleanupAgedRevokedDevices,
    cleanupAgedRevokedPasskeys,
    cleanupExpiredAuthState,
    cleanupExpiredAuditEvents,
    cleanupExpiredCarRecipeProposals,
    cleanupExpiredInvites,
    cleanupExpiredIngestState,
    cleanupExpiredPairingState,
    cleanupExpiredSessions,
    cleanupTerminalDeletionJobs,
    connect,
    finalizeCommunitySeason,
    pool: { close, connect },
    purgeProfileDeletions,
    redactAgedPairingApprovalProvenance,
    release,
    resetExpiredPairingRequestWindows,
    refreshCommunitySeason,
    verifyRuntimeBoundary,
  };
}

async function expectMaintenanceError(
  promise: Promise<unknown>,
  code: CommunityMaintenanceErrorCode,
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CommunityMaintenanceError);
    expect(error).toMatchObject({
      code,
      message: "Community maintenance job failed.",
      name: "CommunityMaintenanceError",
    });
    expect(String(error)).not.toContain(privateDetail);
    return;
  }
  throw new Error("expected maintenance execution to fail");
}

describe("Community maintenance runner", () => {
  it.each([
    {
      expected: {
        deletedEnrollments: 4,
        kind: "cleanup_abandoned_enrollments",
      },
      functionName: "cleanup_abandoned_enrollments",
      input: { batchSize: 6, kind: "cleanup_abandoned_enrollments" },
      rows: [{ deleted_enrollments: 4 }],
      values: [6],
    },
    {
      expected: {
        deletedDeviceKeys: 4,
        deletedPairings: 4,
        kind: "cleanup_aged_revoked_devices",
      },
      functionName: "cleanup_aged_revoked_devices",
      input: { batchSize: 6, kind: "cleanup_aged_revoked_devices" },
      rows: [{ deleted_device_keys: 4, deleted_pairings: 4 }],
      values: [6],
    },
    {
      expected: {
        deletedPasskeys: 4,
        kind: "cleanup_aged_revoked_passkeys",
      },
      functionName: "cleanup_aged_revoked_passkeys",
      input: { batchSize: 6, kind: "cleanup_aged_revoked_passkeys" },
      rows: [{ deleted_passkeys: 4 }],
      values: [6],
    },
    {
      expected: {
        deletedChallenges: 6,
        deletedRecoveryAuthorities: 4,
        deletedUsedRecoveryCodes: 3,
        kind: "cleanup_expired_auth_state",
      },
      functionName: "cleanup_expired_auth_state",
      input: { batchSize: 9, kind: "cleanup_expired_auth_state" },
      rows: [
        {
          deleted_challenges: 6,
          deleted_recovery_authorities: 4,
          deleted_used_recovery_codes: 3,
        },
      ],
      values: [9],
    },
    {
      expected: {
        deletedAuditEvents: 4,
        kind: "cleanup_expired_audit_events",
      },
      functionName: "cleanup_expired_audit_events",
      input: { batchSize: 6, kind: "cleanup_expired_audit_events" },
      rows: [{ deleted_audit_events: 4 }],
      values: [6],
    },
    {
      expected: {
        deletedProposals: 5,
        kind: "cleanup_expired_car_recipe_proposals",
      },
      functionName: "cleanup_expired_car_recipe_proposals",
      input: { batchSize: 7, kind: "cleanup_expired_car_recipe_proposals" },
      rows: [{ deleted_proposals: 5 }],
      values: [7],
    },
    {
      expected: {
        deletedInvites: 4,
        kind: "cleanup_expired_invites",
      },
      functionName: "cleanup_expired_invites",
      input: { batchSize: 6, kind: "cleanup_expired_invites" },
      rows: [{ deleted_invites: 4 }],
      values: [6],
    },
    {
      expected: {
        deletedNonces: 7,
        deletedOriginNonces: 3,
        deletedSnapshots: 5,
        kind: "cleanup_expired_ingest_state",
      },
      functionName: "cleanup_expired_ingest_state",
      input: { batchSize: 10, kind: "cleanup_expired_ingest_state" },
      rows: [{ deleted_nonces: 7, deleted_origin_nonces: 3, deleted_snapshots: 5 }],
      values: [10],
    },
    {
      expected: {
        deletedPairings: 4,
        deletedPendingKeys: 4,
        kind: "cleanup_expired_pairing_state",
      },
      functionName: "cleanup_expired_pairing_state",
      input: { batchSize: 8, kind: "cleanup_expired_pairing_state" },
      rows: [{ deleted_pairings: 4, deleted_pending_keys: 4 }],
      values: [8],
    },
    {
      expected: {
        deletedSessions: 6,
        kind: "cleanup_expired_sessions",
      },
      functionName: "cleanup_expired_sessions",
      input: { batchSize: 9, kind: "cleanup_expired_sessions" },
      rows: [{ deleted_sessions: 6 }],
      values: [9],
    },
    {
      expected: {
        deletedDeletionJobs: 5,
        kind: "cleanup_terminal_deletion_jobs",
      },
      functionName: "cleanup_terminal_deletion_jobs",
      input: { batchSize: 7, kind: "cleanup_terminal_deletion_jobs" },
      rows: [{ deleted_deletion_jobs: 5 }],
      values: [7],
    },
    {
      expected: { kind: "purge_profile_deletions", purgedProfiles: 3 },
      functionName: "purge_profile_deletions",
      input: { batchSize: 5, kind: "purge_profile_deletions" },
      rows: [{ purged_profiles: 3 }],
      values: [5],
    },
    {
      expected: {
        kind: "redact_aged_pairing_approval_provenance",
        redactedPairings: 4,
      },
      functionName: "redact_aged_pairing_approval_provenance",
      input: { batchSize: 6, kind: "redact_aged_pairing_approval_provenance" },
      rows: [{ redacted_pairings: 4 }],
      values: [6],
    },
    {
      expected: {
        kind: "reset_expired_pairing_request_windows",
        resetWindows: 7,
      },
      functionName: "reset_expired_pairing_request_windows",
      input: { kind: "reset_expired_pairing_request_windows" },
      rows: [{ reset_windows: 7 }],
      values: [],
    },
    {
      expected: { kind: "refresh_community_season", profileCount: 12 },
      functionName: "refresh_community_season",
      input: { kind: "refresh_community_season", seasonStart: "2026-07-13" },
      rows: [{ profile_count: 12 }],
      values: ["2026-07-13"],
    },
    {
      expected: { kind: "finalize_community_season", profileCount: 0 },
      functionName: "finalize_community_season",
      input: { kind: "finalize_community_season", seasonStart: "1999-12-27" },
      rows: [{ profile_count: 0 }],
      values: ["1999-12-27"],
    },
  ] as const)("executes only the fixed $functionName capability", async (testCase) => {
    const fixture = createPoolFixture(testCase.rows);
    const runner = createCommunityMaintenanceRunner(fixture.pool);

    const result = await runner.execute(testCase.input);

    expect(result).toEqual(testCase.expected);
    expect(Object.isFrozen(result)).toBe(true);
    expect(fixture.connect).toHaveBeenCalledOnce();
    expect(fixture.verifyRuntimeBoundary).toHaveBeenCalledOnce();
    if (testCase.input.kind === "reset_expired_pairing_request_windows") {
      expect(fixture.resetExpiredPairingRequestWindows).toHaveBeenCalledWith();
    } else if (testCase.input.kind === "cleanup_abandoned_enrollments") {
      expect(fixture.cleanupAbandonedEnrollments).toHaveBeenCalledWith(testCase.values[0]);
    } else if (testCase.input.kind === "cleanup_aged_revoked_devices") {
      expect(fixture.cleanupAgedRevokedDevices).toHaveBeenCalledWith(testCase.values[0]);
    } else if (testCase.input.kind === "cleanup_aged_revoked_passkeys") {
      expect(fixture.cleanupAgedRevokedPasskeys).toHaveBeenCalledWith(testCase.values[0]);
    } else if (testCase.input.kind === "cleanup_expired_auth_state") {
      expect(fixture.cleanupExpiredAuthState).toHaveBeenCalledWith(testCase.values[0]);
    } else if (testCase.input.kind === "cleanup_expired_audit_events") {
      expect(fixture.cleanupExpiredAuditEvents).toHaveBeenCalledWith(testCase.values[0]);
    } else if (testCase.input.kind === "cleanup_expired_car_recipe_proposals") {
      expect(fixture.cleanupExpiredCarRecipeProposals).toHaveBeenCalledWith(testCase.values[0]);
    } else if (testCase.input.kind === "cleanup_expired_invites") {
      expect(fixture.cleanupExpiredInvites).toHaveBeenCalledWith(testCase.values[0]);
    } else if (testCase.input.kind === "cleanup_expired_ingest_state") {
      expect(fixture.cleanupExpiredIngestState).toHaveBeenCalledWith(testCase.values[0]);
    } else if (testCase.input.kind === "cleanup_expired_pairing_state") {
      expect(fixture.cleanupExpiredPairingState).toHaveBeenCalledWith(testCase.values[0]);
    } else if (testCase.input.kind === "cleanup_expired_sessions") {
      expect(fixture.cleanupExpiredSessions).toHaveBeenCalledWith(testCase.values[0]);
    } else if (testCase.input.kind === "cleanup_terminal_deletion_jobs") {
      expect(fixture.cleanupTerminalDeletionJobs).toHaveBeenCalledWith(testCase.values[0]);
    } else if (testCase.input.kind === "purge_profile_deletions") {
      expect(fixture.purgeProfileDeletions).toHaveBeenCalledWith(testCase.values[0]);
    } else if (testCase.input.kind === "redact_aged_pairing_approval_provenance") {
      expect(fixture.redactAgedPairingApprovalProvenance).toHaveBeenCalledWith(testCase.values[0]);
    } else if (testCase.input.kind === "refresh_community_season") {
      expect(fixture.refreshCommunitySeason).toHaveBeenCalledWith(testCase.values[0]);
    } else {
      expect(fixture.finalizeCommunitySeason).toHaveBeenCalledWith(testCase.values[0]);
    }
    expect(
      fixture.cleanupAbandonedEnrollments.mock.calls.length +
        fixture.cleanupAgedRevokedDevices.mock.calls.length +
        fixture.cleanupAgedRevokedPasskeys.mock.calls.length +
        fixture.cleanupExpiredAuthState.mock.calls.length +
        fixture.cleanupExpiredAuditEvents.mock.calls.length +
        fixture.cleanupExpiredCarRecipeProposals.mock.calls.length +
        fixture.cleanupExpiredInvites.mock.calls.length +
        fixture.cleanupExpiredIngestState.mock.calls.length +
        fixture.cleanupExpiredPairingState.mock.calls.length +
        fixture.cleanupExpiredSessions.mock.calls.length +
        fixture.cleanupTerminalDeletionJobs.mock.calls.length +
        fixture.purgeProfileDeletions.mock.calls.length +
        fixture.redactAgedPairingApprovalProvenance.mock.calls.length +
        fixture.resetExpiredPairingRequestWindows.mock.calls.length +
        fixture.refreshCommunitySeason.mock.calls.length +
        fixture.finalizeCommunitySeason.mock.calls.length,
    ).toBe(1);
    expect(fixture.release).toHaveBeenCalledWith(false);
  });

  it.each([
    null,
    [],
    { extra: true, kind: "reset_expired_pairing_request_windows" },
    { batchSize: 1, kind: "reset_expired_pairing_request_windows" },
    { batchSize: 0, kind: "cleanup_abandoned_enrollments" },
    { batchSize: 1_001, kind: "cleanup_abandoned_enrollments" },
    { batchSize: 1.5, kind: "cleanup_abandoned_enrollments" },
    { batchSize: "1", kind: "cleanup_abandoned_enrollments" },
    { batchSize: 1, extra: true, kind: "cleanup_abandoned_enrollments" },
    { batchSize: 0, kind: "cleanup_aged_revoked_devices" },
    { batchSize: 1_001, kind: "cleanup_aged_revoked_devices" },
    { batchSize: 1.5, kind: "cleanup_aged_revoked_devices" },
    { batchSize: "1", kind: "cleanup_aged_revoked_devices" },
    { batchSize: 1, extra: true, kind: "cleanup_aged_revoked_devices" },
    { batchSize: 0, kind: "cleanup_aged_revoked_passkeys" },
    { batchSize: 1_001, kind: "cleanup_aged_revoked_passkeys" },
    { batchSize: 1.5, kind: "cleanup_aged_revoked_passkeys" },
    { batchSize: "1", kind: "cleanup_aged_revoked_passkeys" },
    { batchSize: 1, extra: true, kind: "cleanup_aged_revoked_passkeys" },
    { batchSize: 0, kind: "cleanup_expired_auth_state" },
    { batchSize: 1_001, kind: "cleanup_expired_auth_state" },
    { batchSize: 1.5, kind: "cleanup_expired_auth_state" },
    { batchSize: "1", kind: "cleanup_expired_auth_state" },
    { batchSize: 1, extra: true, kind: "cleanup_expired_auth_state" },
    { batchSize: 0, kind: "cleanup_expired_audit_events" },
    { batchSize: 1_001, kind: "cleanup_expired_audit_events" },
    { batchSize: 1.5, kind: "cleanup_expired_audit_events" },
    { batchSize: "1", kind: "cleanup_expired_audit_events" },
    { batchSize: 1, extra: true, kind: "cleanup_expired_audit_events" },
    { batchSize: 0, kind: "cleanup_expired_car_recipe_proposals" },
    { batchSize: 1_001, kind: "cleanup_expired_car_recipe_proposals" },
    { batchSize: 1.5, kind: "cleanup_expired_car_recipe_proposals" },
    { batchSize: "1", kind: "cleanup_expired_car_recipe_proposals" },
    { batchSize: 1, extra: true, kind: "cleanup_expired_car_recipe_proposals" },
    { batchSize: 0, kind: "cleanup_expired_invites" },
    { batchSize: 1_001, kind: "cleanup_expired_invites" },
    { batchSize: 1.5, kind: "cleanup_expired_invites" },
    { batchSize: "1", kind: "cleanup_expired_invites" },
    { batchSize: 1, extra: true, kind: "cleanup_expired_invites" },
    { batchSize: 0, kind: "cleanup_expired_ingest_state" },
    { batchSize: 1_001, kind: "cleanup_expired_ingest_state" },
    { batchSize: 1.5, kind: "cleanup_expired_ingest_state" },
    { batchSize: "1", kind: "cleanup_expired_ingest_state" },
    { batchSize: 1, extra: true, kind: "cleanup_expired_ingest_state" },
    { batchSize: 0, kind: "cleanup_expired_pairing_state" },
    { batchSize: 1_001, kind: "cleanup_expired_pairing_state" },
    { batchSize: 1, extra: true, kind: "cleanup_expired_pairing_state" },
    { batchSize: 0, kind: "cleanup_expired_sessions" },
    { batchSize: 1_001, kind: "cleanup_expired_sessions" },
    { batchSize: 1.5, kind: "cleanup_expired_sessions" },
    { batchSize: "1", kind: "cleanup_expired_sessions" },
    { batchSize: 1, extra: true, kind: "cleanup_expired_sessions" },
    { batchSize: 0, kind: "cleanup_terminal_deletion_jobs" },
    { batchSize: 1_001, kind: "cleanup_terminal_deletion_jobs" },
    { batchSize: 1.5, kind: "cleanup_terminal_deletion_jobs" },
    { batchSize: "1", kind: "cleanup_terminal_deletion_jobs" },
    { batchSize: 1, extra: true, kind: "cleanup_terminal_deletion_jobs" },
    { batchSize: 0, kind: "purge_profile_deletions" },
    { batchSize: 11, kind: "purge_profile_deletions" },
    { batchSize: 1.5, kind: "purge_profile_deletions" },
    { batchSize: "1", kind: "purge_profile_deletions" },
    { batchSize: 1, extra: true, kind: "purge_profile_deletions" },
    { batchSize: 0, kind: "redact_aged_pairing_approval_provenance" },
    { batchSize: 1_001, kind: "redact_aged_pairing_approval_provenance" },
    { batchSize: 1.5, kind: "redact_aged_pairing_approval_provenance" },
    { batchSize: "1", kind: "redact_aged_pairing_approval_provenance" },
    { batchSize: 1, extra: true, kind: "redact_aged_pairing_approval_provenance" },
    { kind: "refresh_community_season", seasonStart: "2026-07-14" },
    { extra: true, kind: "refresh_community_season", seasonStart: "2026-07-13" },
    { kind: "refresh_community_season", seasonStart: "2026-02-30" },
    { kind: "refresh_community_season", seasonStart: "1999-12-20" },
    { kind: "finalize_community_season", seasonStart: "2100-01-04" },
    { kind: "unknown", seasonStart: "2026-07-13" },
    Object.assign(Object.create({ inherited: true }), {
      kind: "refresh_community_season",
      seasonStart: "2026-07-13",
    }),
  ])("rejects an invalid job before opening a connection", async (input) => {
    const fixture = createPoolFixture([{ profile_count: 1 }]);
    const runner = createCommunityMaintenanceRunner(fixture.pool);

    await expectMaintenanceError(runner.execute(input), "job_invalid");
    expect(fixture.connect).not.toHaveBeenCalled();
  });

  it("does not invoke input accessors and contains proxy traps", async () => {
    let getterCalls = 0;
    const accessorInput = { batchSize: 1 };
    Object.defineProperty(accessorInput, "kind", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "cleanup_expired_ingest_state";
      },
    });
    const proxyInput = new Proxy(
      { batchSize: 1, kind: "cleanup_expired_ingest_state" },
      {
        getPrototypeOf() {
          throw new Error(privateDetail);
        },
      },
    );
    const fixture = createPoolFixture([
      { deleted_nonces: 0, deleted_origin_nonces: 0, deleted_snapshots: 0 },
    ]);
    const runner = createCommunityMaintenanceRunner(fixture.pool);

    await expectMaintenanceError(runner.execute(accessorInput), "job_invalid");
    await expectMaintenanceError(runner.execute(proxyInput), "job_invalid");
    expect(getterCalls).toBe(0);
    expect(fixture.connect).not.toHaveBeenCalled();
  });

  it.each([
    { rows: [] },
    { rows: [{ login_scope_ok: true, role_ok: false, search_path_ok: true }] },
    { rows: [{ extra: true, login_scope_ok: true, role_ok: true, search_path_ok: true }] },
    { rows: [{ login_scope_ok: true, role_ok: true }] },
  ])("rejects a malformed or false runtime boundary and destroys the client", async ({ rows }) => {
    const fixture = createPoolFixture([{ profile_count: 1 }]);
    fixture.verifyRuntimeBoundary.mockResolvedValueOnce(rows);
    const runner = createCommunityMaintenanceRunner(fixture.pool);

    await expectMaintenanceError(
      runner.execute({ kind: "refresh_community_season", seasonStart: "2026-07-13" }),
      "runtime_boundary_mismatch",
    );
    expect(fixture.verifyRuntimeBoundary).toHaveBeenCalledOnce();
    expect(fixture.refreshCommunitySeason).not.toHaveBeenCalled();
    expect(fixture.release).toHaveBeenCalledWith(true);
  });

  it("rejects accessor-backed runtime rows without invoking the accessor", async () => {
    let getterCalls = 0;
    const row = { login_scope_ok: true, search_path_ok: true };
    Object.defineProperty(row, "role_ok", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return true;
      },
    });
    const fixture = createPoolFixture([{ profile_count: 1 }]);
    fixture.verifyRuntimeBoundary.mockResolvedValueOnce([row]);

    await expectMaintenanceError(
      createCommunityMaintenanceRunner(fixture.pool).execute({
        kind: "refresh_community_season",
        seasonStart: "2026-07-13",
      }),
      "runtime_boundary_mismatch",
    );
    expect(getterCalls).toBe(0);
  });

  it.each([
    { cleanup: false, rows: [] },
    { cleanup: false, rows: [{ profile_count: -1 }] },
    { cleanup: false, rows: [{ profile_count: 2_147_483_648 }] },
    { cleanup: false, rows: [{ profile_count: "1" }] },
    { cleanup: false, rows: [{ extra: true, profile_count: 1 }] },
    { cleanup: true, rows: [{ deleted_nonces: 2, deleted_snapshots: 0 }] },
    { cleanup: "audit", rows: [{ deleted_audit_event_count: 1 }] },
    { cleanup: "pairing", rows: [{ deleted_pairings: 1 }] },
    { cleanup: "session", rows: [{ deleted_session_count: 1 }] },
    { cleanup: "deletion-job", rows: [{ deleted_deletion_job_count: 1 }] },
    { cleanup: "purge", rows: [{ purged_profile_count: 1 }] },
    { cleanup: "provenance", rows: [{ redacted_pairing_count: 1 }] },
    { cleanup: "rate-window", rows: [{ reset_window_count: 1 }] },
    { cleanup: "device", rows: [{ deleted_pairings: 1 }] },
    { cleanup: "passkey", rows: [{ deleted_passkey_count: 1 }] },
    { cleanup: "enrollment", rows: [{ deleted_enrollment_count: 1 }] },
    {
      cleanup: "auth",
      rows: [{ deleted_challenges: 1, deleted_recovery_authorities: 1 }],
    },
    { cleanup: "car", rows: [{ deleted_proposal_count: 1 }] },
    { cleanup: "invite", rows: [{ deleted_invite_count: 1 }] },
  ])("rejects invalid fixed result shapes", async ({ cleanup, rows }) => {
    const fixture = createPoolFixture(rows);
    const job: CommunityMaintenanceJob =
      cleanup === "rate-window"
        ? { kind: "reset_expired_pairing_request_windows" }
        : cleanup === "enrollment"
          ? { batchSize: 1, kind: "cleanup_abandoned_enrollments" }
          : cleanup === "device"
            ? { batchSize: 1, kind: "cleanup_aged_revoked_devices" }
            : cleanup === "passkey"
              ? { batchSize: 1, kind: "cleanup_aged_revoked_passkeys" }
              : cleanup === "auth"
                ? { batchSize: 1, kind: "cleanup_expired_auth_state" }
                : cleanup === "audit"
                  ? { batchSize: 1, kind: "cleanup_expired_audit_events" }
                  : cleanup === "deletion-job"
                    ? { batchSize: 1, kind: "cleanup_terminal_deletion_jobs" }
                    : cleanup === "invite"
                      ? { batchSize: 1, kind: "cleanup_expired_invites" }
                      : cleanup === "session"
                        ? { batchSize: 1, kind: "cleanup_expired_sessions" }
                        : cleanup === "car"
                          ? { batchSize: 1, kind: "cleanup_expired_car_recipe_proposals" }
                          : cleanup === "purge"
                            ? { batchSize: 1, kind: "purge_profile_deletions" }
                            : cleanup === "pairing"
                              ? { batchSize: 1, kind: "cleanup_expired_pairing_state" }
                              : cleanup === "provenance"
                                ? { batchSize: 1, kind: "redact_aged_pairing_approval_provenance" }
                                : cleanup
                                  ? { batchSize: 1, kind: "cleanup_expired_ingest_state" }
                                  : { kind: "refresh_community_season", seasonStart: "2026-07-13" };

    await expectMaintenanceError(
      createCommunityMaintenanceRunner(fixture.pool).execute(job),
      "result_invalid",
    );
    expect(fixture.release).toHaveBeenCalledWith(true);
  });

  it("rejects sparse arrays, row accessors, and hostile result proxies", async () => {
    const sparse = new Array(1);
    let getterCalls = 0;
    const row = {};
    Object.defineProperty(row, "profile_count", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 1;
      },
    });
    const proxy = new Proxy([{ profile_count: 1 }], {
      ownKeys() {
        throw new Error(privateDetail);
      },
    });

    for (const result of [sparse, [row], proxy]) {
      const fixture = createPoolFixture(result);
      await expectMaintenanceError(
        createCommunityMaintenanceRunner(fixture.pool).execute({
          kind: "refresh_community_season",
          seasonStart: "2026-07-13",
        }),
        "result_invalid",
      );
    }
    expect(getterCalls).toBe(0);
  });

  it.each([
    { reset_windows: -1 },
    { reset_windows: 131 },
    { reset_windows: 1.5 },
    { reset_windows: "1" },
  ])("bounds fixed rate-window reset counts", async (row) => {
    const fixture = createPoolFixture([row]);
    await expectMaintenanceError(
      createCommunityMaintenanceRunner(fixture.pool).execute({
        kind: "reset_expired_pairing_request_windows",
      }),
      "result_invalid",
    );
  });

  it.each([
    { deleted_nonces: 2, deleted_origin_nonces: 0, deleted_snapshots: 0 },
    { deleted_nonces: 0, deleted_origin_nonces: 2, deleted_snapshots: 0 },
    { deleted_nonces: 0, deleted_origin_nonces: 0, deleted_snapshots: 2 },
  ])("bounds every cleanup result count to the requested batch", async (row) => {
    const fixture = createPoolFixture([row]);
    await expectMaintenanceError(
      createCommunityMaintenanceRunner(fixture.pool).execute({
        batchSize: 1,
        kind: "cleanup_expired_ingest_state",
      }),
      "result_invalid",
    );
  });

  it.each([
    { batchSize: 1, row: { deleted_enrollments: 2 } },
    { batchSize: 10, row: { deleted_enrollments: -1 } },
    { batchSize: 10, row: { deleted_enrollments: "1" } },
  ])("bounds the abandoned-enrollment cleanup result", async ({ batchSize, row }) => {
    const fixture = createPoolFixture([row]);
    await expectMaintenanceError(
      createCommunityMaintenanceRunner(fixture.pool).execute({
        batchSize,
        kind: "cleanup_abandoned_enrollments",
      }),
      "result_invalid",
    );
  });

  it.each([
    { batchSize: 1, row: { deleted_device_keys: 1, deleted_pairings: 2 } },
    { batchSize: 1, row: { deleted_device_keys: 2, deleted_pairings: 1 } },
    { batchSize: 10, row: { deleted_device_keys: 1, deleted_pairings: -1 } },
    { batchSize: 10, row: { deleted_device_keys: -1, deleted_pairings: 1 } },
    { batchSize: 10, row: { deleted_device_keys: 1, deleted_pairings: "1" } },
    { batchSize: 10, row: { deleted_device_keys: "1", deleted_pairings: 1 } },
    { batchSize: 10, row: { deleted_device_keys: 0, deleted_pairings: 1 } },
  ])("bounds and cross-checks the revoked-device cleanup result", async ({ batchSize, row }) => {
    const fixture = createPoolFixture([row]);
    await expectMaintenanceError(
      createCommunityMaintenanceRunner(fixture.pool).execute({
        batchSize,
        kind: "cleanup_aged_revoked_devices",
      }),
      "result_invalid",
    );
  });

  it.each([
    { batchSize: 1, row: { deleted_passkeys: 2 } },
    { batchSize: 10, row: { deleted_passkeys: -1 } },
    { batchSize: 10, row: { deleted_passkeys: "1" } },
  ])("bounds the revoked-passkey cleanup result", async ({ batchSize, row }) => {
    const fixture = createPoolFixture([row]);
    await expectMaintenanceError(
      createCommunityMaintenanceRunner(fixture.pool).execute({
        batchSize,
        kind: "cleanup_aged_revoked_passkeys",
      }),
      "result_invalid",
    );
  });

  it.each([
    { batchSize: 1, row: { deleted_sessions: 2 } },
    { batchSize: 10, row: { deleted_sessions: -1 } },
    { batchSize: 10, row: { deleted_sessions: "1" } },
  ])("bounds the session cleanup result", async ({ batchSize, row }) => {
    const fixture = createPoolFixture([row]);
    await expectMaintenanceError(
      createCommunityMaintenanceRunner(fixture.pool).execute({
        batchSize,
        kind: "cleanup_expired_sessions",
      }),
      "result_invalid",
    );
  });

  it.each([
    { batchSize: 1, row: { deleted_audit_events: 2 } },
    { batchSize: 10, row: { deleted_audit_events: -1 } },
    { batchSize: 10, row: { deleted_audit_events: "1" } },
  ])("bounds the audit-event cleanup result", async ({ batchSize, row }) => {
    const fixture = createPoolFixture([row]);
    await expectMaintenanceError(
      createCommunityMaintenanceRunner(fixture.pool).execute({
        batchSize,
        kind: "cleanup_expired_audit_events",
      }),
      "result_invalid",
    );
  });

  it.each([
    { batchSize: 1, row: { redacted_pairings: 2 } },
    { batchSize: 10, row: { redacted_pairings: -1 } },
    { batchSize: 10, row: { redacted_pairings: "1" } },
  ])("bounds the pairing approval-provenance redaction result", async ({ batchSize, row }) => {
    const fixture = createPoolFixture([row]);
    await expectMaintenanceError(
      createCommunityMaintenanceRunner(fixture.pool).execute({
        batchSize,
        kind: "redact_aged_pairing_approval_provenance",
      }),
      "result_invalid",
    );
  });

  it.each([
    { batchSize: 1, row: { deleted_deletion_jobs: 2 } },
    { batchSize: 10, row: { deleted_deletion_jobs: -1 } },
    { batchSize: 10, row: { deleted_deletion_jobs: "1" } },
  ])("bounds the terminal deletion-job cleanup result", async ({ batchSize, row }) => {
    const fixture = createPoolFixture([row]);
    await expectMaintenanceError(
      createCommunityMaintenanceRunner(fixture.pool).execute({
        batchSize,
        kind: "cleanup_terminal_deletion_jobs",
      }),
      "result_invalid",
    );
  });

  it.each([
    { batchSize: 1, row: { deleted_invites: 2 } },
    { batchSize: 10, row: { deleted_invites: -1 } },
    { batchSize: 10, row: { deleted_invites: "1" } },
  ])("bounds the invite cleanup result", async ({ batchSize, row }) => {
    const fixture = createPoolFixture([row]);
    await expectMaintenanceError(
      createCommunityMaintenanceRunner(fixture.pool).execute({
        batchSize,
        kind: "cleanup_expired_invites",
      }),
      "result_invalid",
    );
  });

  it.each([
    { batchSize: 1, row: { deleted_proposals: 2 } },
    { batchSize: 10, row: { deleted_proposals: -1 } },
    { batchSize: 10, row: { deleted_proposals: "1" } },
  ])("bounds the CarRecipe proposal cleanup result", async ({ batchSize, row }) => {
    const fixture = createPoolFixture([row]);
    await expectMaintenanceError(
      createCommunityMaintenanceRunner(fixture.pool).execute({
        batchSize,
        kind: "cleanup_expired_car_recipe_proposals",
      }),
      "result_invalid",
    );
  });

  it.each([
    { batchSize: 1, row: { deleted_pairings: 2, deleted_pending_keys: 0 } },
    { batchSize: 1, row: { deleted_pairings: 0, deleted_pending_keys: 2 } },
    { batchSize: 2, row: { deleted_pairings: 1, deleted_pending_keys: 0 } },
    { batchSize: 2, row: { deleted_pairings: 0, deleted_pending_keys: 1 } },
  ])("bounds and correlates pairing cleanup result counts", async ({ batchSize, row }) => {
    const fixture = createPoolFixture([row]);
    await expectMaintenanceError(
      createCommunityMaintenanceRunner(fixture.pool).execute({
        batchSize,
        kind: "cleanup_expired_pairing_state",
      }),
      "result_invalid",
    );
  });

  it.each([
    { batchSize: 1, row: { purged_profiles: 2 } },
    { batchSize: 10, row: { purged_profiles: -1 } },
    { batchSize: 10, row: { purged_profiles: "1" } },
  ])("bounds the profile deletion purge result", async ({ batchSize, row }) => {
    const fixture = createPoolFixture([row]);
    await expectMaintenanceError(
      createCommunityMaintenanceRunner(fixture.pool).execute({
        batchSize,
        kind: "purge_profile_deletions",
      }),
      "result_invalid",
    );
  });

  it.each([
    {
      batchSize: 1,
      row: {
        deleted_challenges: 2,
        deleted_recovery_authorities: 0,
        deleted_used_recovery_codes: 0,
      },
    },
    {
      batchSize: 1,
      row: {
        deleted_challenges: 0,
        deleted_recovery_authorities: 2,
        deleted_used_recovery_codes: 0,
      },
    },
    {
      batchSize: 1,
      row: {
        deleted_challenges: 0,
        deleted_recovery_authorities: 0,
        deleted_used_recovery_codes: 2,
      },
    },
    {
      batchSize: 2,
      row: {
        deleted_challenges: 0,
        deleted_recovery_authorities: 1,
        deleted_used_recovery_codes: 2,
      },
    },
  ])("bounds and correlates authentication cleanup result counts", async ({ batchSize, row }) => {
    const fixture = createPoolFixture([row]);
    await expectMaintenanceError(
      createCommunityMaintenanceRunner(fixture.pool).execute({
        batchSize,
        kind: "cleanup_expired_auth_state",
      }),
      "result_invalid",
    );
  });

  it("translates connection and query failures without reflecting details", async () => {
    const connectFailure = createPoolFixture([{ profile_count: 1 }]);
    connectFailure.connect.mockRejectedValueOnce(new Error(privateDetail));
    await expectMaintenanceError(
      createCommunityMaintenanceRunner(connectFailure.pool).execute({
        kind: "refresh_community_season",
        seasonStart: "2026-07-13",
      }),
      "connection_unavailable",
    );

    for (const failingQueryIndex of [1, 2]) {
      const fixture = createPoolFixture([{ profile_count: 1 }]);
      if (failingQueryIndex === 1) {
        fixture.verifyRuntimeBoundary.mockRejectedValueOnce(new Error(privateDetail));
      } else {
        fixture.refreshCommunitySeason.mockRejectedValueOnce(new Error(privateDetail));
      }
      await expectMaintenanceError(
        createCommunityMaintenanceRunner(fixture.pool).execute({
          kind: "refresh_community_season",
          seasonStart: "2026-07-13",
        }),
        "query_failed",
      );
      expect(fixture.release).toHaveBeenCalledWith(true);
    }
  });

  it("holds the client until the capability query settles", async () => {
    let resolveRows: ((value: unknown) => void) | undefined;
    const deferredRows = new Promise<unknown>((resolve) => {
      resolveRows = resolve;
    });
    const fixture = createPoolFixture([{ profile_count: 1 }]);
    fixture.refreshCommunitySeason.mockReturnValueOnce(deferredRows);
    const pending = createCommunityMaintenanceRunner(fixture.pool).execute({
      kind: "refresh_community_season",
      seasonStart: "2026-07-13",
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(fixture.release).not.toHaveBeenCalled();
    resolveRows?.([{ profile_count: 1 }]);
    await expect(pending).resolves.toEqual({
      kind: "refresh_community_season",
      profileCount: 1,
    });
    expect(fixture.release).toHaveBeenCalledWith(false);
  });

  it("fails closed when releasing either a healthy or failed client throws", async () => {
    for (const queryFails of [false, true]) {
      const fixture = createPoolFixture([{ profile_count: 1 }]);
      if (queryFails) {
        fixture.refreshCommunitySeason.mockRejectedValueOnce(new Error(privateDetail));
      }
      fixture.release.mockImplementation(() => {
        throw new Error(privateDetail);
      });
      await expectMaintenanceError(
        createCommunityMaintenanceRunner(fixture.pool).execute({
          kind: "refresh_community_season",
          seasonStart: "2026-07-13",
        }),
        "connection_release_failed",
      );
    }
  });

  it("closes a configured boundary and translates close failure", async () => {
    const fixture = createPoolFixture([{ profile_count: 1 }]);
    const runner = createCloseableCommunityMaintenanceRunner(fixture.pool);
    await expect(
      runner.execute({ kind: "refresh_community_season", seasonStart: "2026-07-13" }),
    ).resolves.toEqual({ kind: "refresh_community_season", profileCount: 1 });
    await runner.close();
    expect(fixture.close).toHaveBeenCalledOnce();

    fixture.close.mockRejectedValueOnce(new Error(privateDetail));
    await expectMaintenanceError(runner.close(), "pool_close_failed");
  });

  it("can construct and close the configured pool without opening a connection", async () => {
    const runner = createConfiguredCommunityMaintenanceRunner({
      NODE_ENV: "test",
      VIBERACING_JOBS_DATABASE_HOST: "127.0.0.1",
      VIBERACING_JOBS_DATABASE_NAME: "viberacing_local",
      VIBERACING_JOBS_DATABASE_PASSWORD: "private-test-password-value",
      VIBERACING_JOBS_DATABASE_PORT: "54329",
      VIBERACING_JOBS_DATABASE_TLS_MODE: "disable",
      VIBERACING_JOBS_DATABASE_USER: "viberacing_jobs_login",
    });

    await expect(runner.close()).resolves.toBeUndefined();
  });
});
