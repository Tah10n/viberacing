import { resolveJobsDatabaseConfig } from "./database-config.js";
import {
  createJobsDatabasePool,
  type JobsDatabaseClient,
  type JobsDatabasePool,
  type JobsDatabasePoolSignalSink,
} from "./database-pool.js";

const minimumSeasonStart = "1999-12-27";
const maximumSeasonStart = "2099-12-28";
const maximumPostgresInteger = 2_147_483_647;
const pairingRequestWindowCount = 130;
const runtimeBoundaryColumns = ["role_ok", "login_scope_ok", "search_path_ok"] as const;
const runtimeBoundaryColumnSet = new Set<string>(runtimeBoundaryColumns);

export const maximumCleanupBatchSize = 1_000;
export const maximumProfileDeletionPurgeBatchSize = 10;

export type CommunityMaintenanceJob =
  | Readonly<{
      batchSize: number;
      kind: "cleanup_abandoned_enrollments";
    }>
  | Readonly<{
      batchSize: number;
      kind: "cleanup_finalized_source_day_values";
    }>
  | Readonly<{
      batchSize: number;
      kind: "cleanup_aged_revoked_devices";
    }>
  | Readonly<{
      batchSize: number;
      kind: "cleanup_aged_revoked_passkeys";
    }>
  | Readonly<{
      batchSize: number;
      kind: "cleanup_expired_auth_state";
    }>
  | Readonly<{
      batchSize: number;
      kind: "cleanup_expired_audit_events";
    }>
  | Readonly<{
      batchSize: number;
      kind: "cleanup_expired_car_recipe_proposals";
    }>
  | Readonly<{
      batchSize: number;
      kind: "cleanup_expired_invites";
    }>
  | Readonly<{
      batchSize: number;
      kind: "cleanup_expired_ingest_state";
    }>
  | Readonly<{
      batchSize: number;
      kind: "cleanup_expired_pairing_state";
    }>
  | Readonly<{
      batchSize: number;
      kind: "cleanup_expired_sessions";
    }>
  | Readonly<{
      batchSize: number;
      kind: "cleanup_terminal_deletion_jobs";
    }>
  | Readonly<{
      batchSize: number;
      kind: "purge_profile_deletions";
    }>
  | Readonly<{
      batchSize: number;
      kind: "redact_aged_pairing_approval_provenance";
    }>
  | Readonly<{
      kind: "reset_expired_pairing_request_windows";
    }>
  | Readonly<{
      kind: "finalize_community_season_backlog";
    }>
  | Readonly<{
      kind: "finalize_community_season";
      seasonStart: string;
    }>
  | Readonly<{
      kind: "refresh_community_season";
      seasonStart: string;
    }>;

export type CommunityMaintenanceResult =
  | Readonly<{
      deletedEnrollments: number;
      kind: "cleanup_abandoned_enrollments";
    }>
  | Readonly<{
      deletedSourceDayValues: number;
      kind: "cleanup_finalized_source_day_values";
    }>
  | Readonly<{
      deletedDeviceKeys: number;
      deletedPairings: number;
      kind: "cleanup_aged_revoked_devices";
    }>
  | Readonly<{
      deletedPasskeys: number;
      kind: "cleanup_aged_revoked_passkeys";
    }>
  | Readonly<{
      deletedChallenges: number;
      deletedRecoveryAuthorities: number;
      deletedUsedRecoveryCodes: number;
      kind: "cleanup_expired_auth_state";
    }>
  | Readonly<{
      deletedAuditEvents: number;
      kind: "cleanup_expired_audit_events";
    }>
  | Readonly<{
      deletedProposals: number;
      kind: "cleanup_expired_car_recipe_proposals";
    }>
  | Readonly<{
      deletedInvites: number;
      kind: "cleanup_expired_invites";
    }>
  | Readonly<{
      deletedNonces: number;
      deletedOriginNonces: number;
      deletedSnapshots: number;
      kind: "cleanup_expired_ingest_state";
    }>
  | Readonly<{
      deletedPairings: number;
      deletedPendingKeys: number;
      kind: "cleanup_expired_pairing_state";
    }>
  | Readonly<{
      deletedSessions: number;
      kind: "cleanup_expired_sessions";
    }>
  | Readonly<{
      deletedDeletionJobs: number;
      kind: "cleanup_terminal_deletion_jobs";
    }>
  | Readonly<{
      kind: "purge_profile_deletions";
      purgedProfiles: number;
    }>
  | Readonly<{
      kind: "redact_aged_pairing_approval_provenance";
      redactedPairings: number;
    }>
  | Readonly<{
      kind: "reset_expired_pairing_request_windows";
      resetWindows: number;
    }>
  | Readonly<{
      finalizedSeasonCount: number;
      kind: "finalize_community_season_backlog";
      profileCount: number;
    }>
  | Readonly<{
      kind: "finalize_community_season";
      profileCount: number;
    }>
  | Readonly<{
      kind: "refresh_community_season";
      profileCount: number;
    }>;

export type CommunityMaintenanceErrorCode =
  | "connection_release_failed"
  | "connection_unavailable"
  | "job_invalid"
  | "pool_close_failed"
  | "query_failed"
  | "result_invalid"
  | "runtime_boundary_mismatch";

export class CommunityMaintenanceError extends Error {
  readonly code: CommunityMaintenanceErrorCode;

  constructor(code: CommunityMaintenanceErrorCode) {
    super("Community maintenance job failed.");
    this.name = "CommunityMaintenanceError";
    this.code = code;
  }
}

export interface CommunityMaintenanceRunner {
  execute(job: unknown): Promise<CommunityMaintenanceResult>;
}

export interface ConfiguredCommunityMaintenanceRunner extends CommunityMaintenanceRunner {
  close(): Promise<void>;
}

function fail(code: CommunityMaintenanceErrorCode): never {
  throw new CommunityMaintenanceError(code);
}

function ownDataValue(object: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
    fail("job_invalid");
  }
  return descriptor.value as unknown;
}

function isPlainRecord(value: unknown): value is object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: object, expected: ReadonlySet<string>): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.size &&
    keys.every((key) => typeof key === "string" && expected.has(key))
  );
}

function validSeasonStart(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < minimumSeasonStart ||
    value > maximumSeasonStart
  ) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value &&
    date.getUTCDay() === 1
  );
}

function readJob(value: unknown): CommunityMaintenanceJob {
  try {
    if (!isPlainRecord(value)) {
      fail("job_invalid");
    }
    const kind = ownDataValue(value, "kind");
    if (
      kind === "reset_expired_pairing_request_windows" ||
      kind === "finalize_community_season_backlog"
    ) {
      if (!hasExactKeys(value, new Set(["kind"]))) {
        fail("job_invalid");
      }
      return Object.freeze({ kind });
    }
    if (kind === "purge_profile_deletions") {
      if (!hasExactKeys(value, new Set(["batchSize", "kind"]))) {
        fail("job_invalid");
      }
      const batchSize = ownDataValue(value, "batchSize");
      if (
        typeof batchSize !== "number" ||
        !Number.isSafeInteger(batchSize) ||
        batchSize < 1 ||
        batchSize > maximumProfileDeletionPurgeBatchSize
      ) {
        fail("job_invalid");
      }
      return Object.freeze({ batchSize, kind });
    }
    if (
      kind === "cleanup_abandoned_enrollments" ||
      kind === "cleanup_finalized_source_day_values" ||
      kind === "cleanup_aged_revoked_devices" ||
      kind === "cleanup_aged_revoked_passkeys" ||
      kind === "cleanup_expired_auth_state" ||
      kind === "cleanup_expired_audit_events" ||
      kind === "cleanup_expired_car_recipe_proposals" ||
      kind === "cleanup_expired_invites" ||
      kind === "cleanup_expired_ingest_state" ||
      kind === "cleanup_expired_pairing_state" ||
      kind === "cleanup_expired_sessions" ||
      kind === "cleanup_terminal_deletion_jobs" ||
      kind === "redact_aged_pairing_approval_provenance"
    ) {
      if (!hasExactKeys(value, new Set(["batchSize", "kind"]))) {
        fail("job_invalid");
      }
      const batchSize = ownDataValue(value, "batchSize");
      if (
        typeof batchSize !== "number" ||
        !Number.isSafeInteger(batchSize) ||
        batchSize < 1 ||
        batchSize > maximumCleanupBatchSize
      ) {
        fail("job_invalid");
      }
      return Object.freeze({ batchSize, kind });
    }
    if (kind === "refresh_community_season" || kind === "finalize_community_season") {
      if (!hasExactKeys(value, new Set(["kind", "seasonStart"]))) {
        fail("job_invalid");
      }
      const seasonStart = ownDataValue(value, "seasonStart");
      if (!validSeasonStart(seasonStart)) {
        fail("job_invalid");
      }
      return Object.freeze({ kind, seasonStart });
    }
    fail("job_invalid");
  } catch (error) {
    if (error instanceof CommunityMaintenanceError) {
      throw error;
    }
    fail("job_invalid");
  }
}

function readDataValue(object: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor !== undefined && "value" in descriptor && descriptor.enumerable
    ? (descriptor.value as unknown)
    : undefined;
}

function readSingleRow(value: unknown, expectedColumns: ReadonlySet<string>): object {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length !== 1
    ) {
      fail("result_invalid");
    }
    const arrayKeys = Reflect.ownKeys(value);
    if (arrayKeys.length !== 2 || !arrayKeys.includes("0") || !arrayKeys.includes("length")) {
      fail("result_invalid");
    }
    const row = readDataValue(value, "0");
    if (!isPlainRecord(row) || !hasExactKeys(row, expectedColumns)) {
      fail("result_invalid");
    }
    return row;
  } catch (error) {
    if (error instanceof CommunityMaintenanceError) {
      throw error;
    }
    fail("result_invalid");
  }
}

function readCount(row: object, key: string, maximum: number): number {
  const value = readDataValue(row, key);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
    fail("result_invalid");
  }
  return value;
}

function mapResult(job: CommunityMaintenanceJob, value: unknown): CommunityMaintenanceResult {
  if (job.kind === "finalize_community_season_backlog") {
    const row = readSingleRow(value, new Set(["finalized_season_count", "profile_count"]));
    const finalizedSeasonCount = readCount(row, "finalized_season_count", 1);
    const profileCount = readCount(row, "profile_count", maximumPostgresInteger);
    if (finalizedSeasonCount === 0 && profileCount !== 0) {
      fail("result_invalid");
    }
    return Object.freeze({
      finalizedSeasonCount,
      kind: job.kind,
      profileCount,
    });
  }

  if (job.kind === "reset_expired_pairing_request_windows") {
    const row = readSingleRow(value, new Set(["reset_windows"]));
    return Object.freeze({
      kind: job.kind,
      resetWindows: readCount(row, "reset_windows", pairingRequestWindowCount),
    });
  }

  if (job.kind === "cleanup_abandoned_enrollments") {
    const row = readSingleRow(value, new Set(["deleted_enrollments"]));
    return Object.freeze({
      deletedEnrollments: readCount(row, "deleted_enrollments", job.batchSize),
      kind: job.kind,
    });
  }

  if (job.kind === "cleanup_finalized_source_day_values") {
    const row = readSingleRow(value, new Set(["deleted_source_day_values"]));
    return Object.freeze({
      deletedSourceDayValues: readCount(row, "deleted_source_day_values", job.batchSize),
      kind: job.kind,
    });
  }

  if (job.kind === "cleanup_aged_revoked_devices") {
    const row = readSingleRow(value, new Set(["deleted_device_keys", "deleted_pairings"]));
    const deletedDeviceKeys = readCount(row, "deleted_device_keys", job.batchSize);
    const deletedPairings = readCount(row, "deleted_pairings", job.batchSize);
    if (deletedDeviceKeys !== deletedPairings) {
      fail("result_invalid");
    }
    return Object.freeze({
      deletedDeviceKeys,
      deletedPairings,
      kind: job.kind,
    });
  }

  if (job.kind === "cleanup_aged_revoked_passkeys") {
    const row = readSingleRow(value, new Set(["deleted_passkeys"]));
    return Object.freeze({
      deletedPasskeys: readCount(row, "deleted_passkeys", job.batchSize),
      kind: job.kind,
    });
  }

  if (job.kind === "cleanup_expired_auth_state") {
    const row = readSingleRow(
      value,
      new Set([
        "deleted_challenges",
        "deleted_recovery_authorities",
        "deleted_used_recovery_codes",
      ]),
    );
    const deletedChallenges = readCount(row, "deleted_challenges", job.batchSize);
    const deletedRecoveryAuthorities = readCount(
      row,
      "deleted_recovery_authorities",
      job.batchSize,
    );
    const deletedUsedRecoveryCodes = readCount(row, "deleted_used_recovery_codes", job.batchSize);
    if (deletedUsedRecoveryCodes > deletedRecoveryAuthorities) {
      fail("result_invalid");
    }
    return Object.freeze({
      deletedChallenges,
      deletedRecoveryAuthorities,
      deletedUsedRecoveryCodes,
      kind: job.kind,
    });
  }

  if (job.kind === "cleanup_expired_audit_events") {
    const row = readSingleRow(value, new Set(["deleted_audit_events"]));
    return Object.freeze({
      deletedAuditEvents: readCount(row, "deleted_audit_events", job.batchSize),
      kind: job.kind,
    });
  }

  if (job.kind === "cleanup_expired_car_recipe_proposals") {
    const row = readSingleRow(value, new Set(["deleted_proposals"]));
    return Object.freeze({
      deletedProposals: readCount(row, "deleted_proposals", job.batchSize),
      kind: job.kind,
    });
  }

  if (job.kind === "cleanup_expired_invites") {
    const row = readSingleRow(value, new Set(["deleted_invites"]));
    return Object.freeze({
      deletedInvites: readCount(row, "deleted_invites", job.batchSize),
      kind: job.kind,
    });
  }

  if (job.kind === "cleanup_expired_ingest_state") {
    const row = readSingleRow(
      value,
      new Set(["deleted_nonces", "deleted_origin_nonces", "deleted_snapshots"]),
    );
    return Object.freeze({
      deletedNonces: readCount(row, "deleted_nonces", job.batchSize),
      deletedOriginNonces: readCount(row, "deleted_origin_nonces", job.batchSize),
      deletedSnapshots: readCount(row, "deleted_snapshots", job.batchSize),
      kind: job.kind,
    });
  }

  if (job.kind === "cleanup_expired_pairing_state") {
    const row = readSingleRow(value, new Set(["deleted_pairings", "deleted_pending_keys"]));
    const deletedPairings = readCount(row, "deleted_pairings", job.batchSize);
    const deletedPendingKeys = readCount(row, "deleted_pending_keys", job.batchSize);
    if (deletedPairings !== deletedPendingKeys) {
      fail("result_invalid");
    }
    return Object.freeze({
      deletedPairings,
      deletedPendingKeys,
      kind: job.kind,
    });
  }

  if (job.kind === "cleanup_expired_sessions") {
    const row = readSingleRow(value, new Set(["deleted_sessions"]));
    return Object.freeze({
      deletedSessions: readCount(row, "deleted_sessions", job.batchSize),
      kind: job.kind,
    });
  }

  if (job.kind === "cleanup_terminal_deletion_jobs") {
    const row = readSingleRow(value, new Set(["deleted_deletion_jobs"]));
    return Object.freeze({
      deletedDeletionJobs: readCount(row, "deleted_deletion_jobs", job.batchSize),
      kind: job.kind,
    });
  }

  if (job.kind === "purge_profile_deletions") {
    const row = readSingleRow(value, new Set(["purged_profiles"]));
    return Object.freeze({
      kind: job.kind,
      purgedProfiles: readCount(row, "purged_profiles", job.batchSize),
    });
  }

  if (job.kind === "redact_aged_pairing_approval_provenance") {
    const row = readSingleRow(value, new Set(["redacted_pairings"]));
    return Object.freeze({
      kind: job.kind,
      redactedPairings: readCount(row, "redacted_pairings", job.batchSize),
    });
  }

  const row = readSingleRow(value, new Set(["profile_count"]));
  return Object.freeze({
    kind: job.kind,
    profileCount: readCount(row, "profile_count", maximumPostgresInteger),
  });
}

function validRuntimeBoundary(value: unknown): boolean {
  try {
    const row = readSingleRow(value, runtimeBoundaryColumnSet);
    return runtimeBoundaryColumns.every((column) => readDataValue(row, column) === true);
  } catch {
    return false;
  }
}

function releaseClient(client: JobsDatabaseClient, destroy: boolean): void {
  try {
    client.release(destroy);
  } catch {
    fail("connection_release_failed");
  }
}

function executeCapability(
  client: JobsDatabaseClient,
  job: CommunityMaintenanceJob,
): Promise<unknown> {
  if (job.kind === "finalize_community_season_backlog") {
    return client.finalizeCommunitySeasonBacklog();
  }
  if (job.kind === "reset_expired_pairing_request_windows") {
    return client.resetExpiredPairingRequestWindows();
  }
  if (job.kind === "cleanup_abandoned_enrollments") {
    return client.cleanupAbandonedEnrollments(job.batchSize);
  }
  if (job.kind === "cleanup_finalized_source_day_values") {
    return client.cleanupFinalizedSourceDayValues(job.batchSize);
  }
  if (job.kind === "cleanup_aged_revoked_devices") {
    return client.cleanupAgedRevokedDevices(job.batchSize);
  }
  if (job.kind === "cleanup_aged_revoked_passkeys") {
    return client.cleanupAgedRevokedPasskeys(job.batchSize);
  }
  if (job.kind === "cleanup_expired_auth_state") {
    return client.cleanupExpiredAuthState(job.batchSize);
  }
  if (job.kind === "cleanup_expired_audit_events") {
    return client.cleanupExpiredAuditEvents(job.batchSize);
  }
  if (job.kind === "cleanup_expired_car_recipe_proposals") {
    return client.cleanupExpiredCarRecipeProposals(job.batchSize);
  }
  if (job.kind === "cleanup_expired_invites") {
    return client.cleanupExpiredInvites(job.batchSize);
  }
  if (job.kind === "cleanup_expired_ingest_state") {
    return client.cleanupExpiredIngestState(job.batchSize);
  }
  if (job.kind === "cleanup_expired_pairing_state") {
    return client.cleanupExpiredPairingState(job.batchSize);
  }
  if (job.kind === "cleanup_expired_sessions") {
    return client.cleanupExpiredSessions(job.batchSize);
  }
  if (job.kind === "cleanup_terminal_deletion_jobs") {
    return client.cleanupTerminalDeletionJobs(job.batchSize);
  }
  if (job.kind === "purge_profile_deletions") {
    return client.purgeProfileDeletions(job.batchSize);
  }
  if (job.kind === "redact_aged_pairing_approval_provenance") {
    return client.redactAgedPairingApprovalProvenance(job.batchSize);
  }
  if (job.kind === "refresh_community_season") {
    return client.refreshCommunitySeason(job.seasonStart);
  }
  return client.finalizeCommunitySeason(job.seasonStart);
}

async function executeJob(
  pool: JobsDatabasePool,
  job: CommunityMaintenanceJob,
): Promise<CommunityMaintenanceResult> {
  let client: JobsDatabaseClient;
  try {
    client = await pool.connect();
  } catch {
    fail("connection_unavailable");
  }

  let destroyClient = true;
  let outcome:
    | Readonly<{ code: CommunityMaintenanceErrorCode; ok: false }>
    | Readonly<{ ok: true; result: CommunityMaintenanceResult }>;
  try {
    const runtimeBoundary = await client.verifyRuntimeBoundary();
    if (!validRuntimeBoundary(runtimeBoundary)) {
      fail("runtime_boundary_mismatch");
    }
    const result = mapResult(job, await executeCapability(client, job));
    destroyClient = false;
    outcome = { ok: true, result };
  } catch (error) {
    outcome = {
      code: error instanceof CommunityMaintenanceError ? error.code : "query_failed",
      ok: false,
    };
  }

  releaseClient(client, destroyClient);
  if (!outcome.ok) {
    fail(outcome.code);
  }
  return outcome.result;
}

export function createCommunityMaintenanceRunner(
  pool: JobsDatabasePool,
): CommunityMaintenanceRunner {
  return Object.freeze({
    async execute(value: unknown): Promise<CommunityMaintenanceResult> {
      const job = readJob(value);
      return executeJob(pool, job);
    },
  });
}

export function createCloseableCommunityMaintenanceRunner(
  pool: JobsDatabasePool,
): ConfiguredCommunityMaintenanceRunner {
  const runner = createCommunityMaintenanceRunner(pool);
  return Object.freeze({
    async close(): Promise<void> {
      try {
        await pool.close();
      } catch {
        fail("pool_close_failed");
      }
    },
    execute: (job: unknown) => runner.execute(job),
  });
}

export function createConfiguredCommunityMaintenanceRunner(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  signalSink?: JobsDatabasePoolSignalSink,
): ConfiguredCommunityMaintenanceRunner {
  const pool = createJobsDatabasePool(resolveJobsDatabaseConfig(environment), signalSink);
  return createCloseableCommunityMaintenanceRunner(pool);
}
