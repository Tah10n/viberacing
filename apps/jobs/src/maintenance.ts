import { resolveJobsDatabaseConfig } from "./database-config.js";
import {
  createJobsDatabasePool,
  type JobsDatabaseClient,
  type JobsDatabasePool,
  type JobsDatabasePoolSignalSink,
} from "./database-pool.js";

const runtimeBoundaryColumns = [
  "role_ok",
  "login_scope_ok",
  "search_path_ok",
  "read_write_ok",
] as const;
const runtimeBoundaryColumnSet = new Set<string>(runtimeBoundaryColumns);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const snapshotIdPattern = /^snp_[A-Za-z0-9_-]{22}$/;

export const maximumCleanupBatchSize = 1_000;
export const maximumProfileDeletionPurgeBatchSize = 10;

export type JobsMaintenanceJob =
  | Readonly<{ kind: "ensure_current_season" }>
  | Readonly<{ kind: "refresh_dirty_leaderboard" }>
  | Readonly<{ kind: "finalize_due_season" }>
  | Readonly<{ kind: "reset_expired_pairing_request_windows" }>
  | Readonly<{ batchSize: number; kind: "cleanup_expired_pairing_state" }>
  | Readonly<{ batchSize: number; kind: "cleanup_expired_usage_nonces" }>
  | Readonly<{ batchSize: number; kind: "cleanup_expired_usage_history" }>
  | Readonly<{ batchSize: number; kind: "cleanup_expired_auth_state" }>
  | Readonly<{ batchSize: number; kind: "cleanup_aged_revoked_authority" }>
  | Readonly<{ batchSize: number; kind: "cleanup_snapshot_history" }>
  | Readonly<{ batchSize: number; kind: "cleanup_expired_ranking_events" }>
  | Readonly<{ batchSize: number; kind: "purge_profile_deletions" }>
  | Readonly<{ batchSize: number; kind: "cleanup_terminal_deletion_jobs" }>;

export type JobsMaintenanceResult =
  | Readonly<{
      kind: "ensure_current_season";
      outcome: "busy" | "ensured";
    }>
  | Readonly<{
      kind: "refresh_dirty_leaderboard";
      outcome: "busy" | "idle" | "published" | "retry_scheduled";
    }>
  | Readonly<{
      kind: "finalize_due_season";
      outcome: "busy" | "finalized" | "idle" | "needs_refresh" | "retry_scheduled";
    }>
  | Readonly<{
      affectedCount: number;
      kind: Exclude<
        JobsMaintenanceJob["kind"],
        "ensure_current_season" | "refresh_dirty_leaderboard" | "finalize_due_season"
      >;
    }>;

export type JobsMaintenanceErrorCode =
  | "connection_release_failed"
  | "connection_unavailable"
  | "input_invalid"
  | "pool_close_failed"
  | "query_failed"
  | "result_invalid"
  | "runtime_boundary_mismatch";

export class JobsMaintenanceError extends Error {
  readonly code: JobsMaintenanceErrorCode;

  constructor(code: JobsMaintenanceErrorCode) {
    super("Jobs maintenance operation failed.");
    this.name = "JobsMaintenanceError";
    this.code = code;
  }
}

export interface JobsMaintenanceRunner {
  execute(job: unknown): Promise<JobsMaintenanceResult>;
}

export interface ConfiguredJobsMaintenanceRunner extends JobsMaintenanceRunner {
  close(): Promise<void>;
}

const noArgumentKinds = new Set<JobsMaintenanceJob["kind"]>([
  "ensure_current_season",
  "refresh_dirty_leaderboard",
  "finalize_due_season",
  "reset_expired_pairing_request_windows",
]);
const cleanupKinds = new Set<JobsMaintenanceJob["kind"]>([
  "cleanup_expired_pairing_state",
  "cleanup_expired_usage_nonces",
  "cleanup_expired_usage_history",
  "cleanup_expired_auth_state",
  "cleanup_aged_revoked_authority",
  "cleanup_snapshot_history",
  "cleanup_expired_ranking_events",
  "purge_profile_deletions",
  "cleanup_terminal_deletion_jobs",
]);

function fail(code: JobsMaintenanceErrorCode): never {
  throw new JobsMaintenanceError(code);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactDataKeys(value: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expected.size ||
    keys.some((key) => typeof key !== "string" || !expected.has(key))
  ) {
    return false;
  }
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor && descriptor.enumerable;
  });
}

function dataValue(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function readJob(value: unknown): JobsMaintenanceJob {
  try {
    if (!isPlainRecord(value) || !Object.isFrozen(value)) {
      fail("input_invalid");
    }
    const kind = dataValue(value, "kind");
    if (typeof kind !== "string") {
      fail("input_invalid");
    }
    if (noArgumentKinds.has(kind as JobsMaintenanceJob["kind"])) {
      if (!exactDataKeys(value, new Set(["kind"]))) {
        fail("input_invalid");
      }
      return value as JobsMaintenanceJob;
    }
    if (!cleanupKinds.has(kind as JobsMaintenanceJob["kind"])) {
      fail("input_invalid");
    }
    if (!exactDataKeys(value, new Set(["batchSize", "kind"]))) {
      fail("input_invalid");
    }
    const batchSize = dataValue(value, "batchSize");
    const maximum =
      kind === "purge_profile_deletions"
        ? maximumProfileDeletionPurgeBatchSize
        : maximumCleanupBatchSize;
    if (
      typeof batchSize !== "number" ||
      !Number.isSafeInteger(batchSize) ||
      batchSize < 1 ||
      batchSize > maximum
    ) {
      fail("input_invalid");
    }
    return value as JobsMaintenanceJob;
  } catch (error) {
    if (error instanceof JobsMaintenanceError) {
      throw error;
    }
    fail("input_invalid");
  }
}

function readSingleRow(value: unknown, columns: ReadonlySet<string>): Record<string, unknown> {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length !== 1
  ) {
    fail("result_invalid");
  }
  const row: unknown = value[0];
  if (!isPlainRecord(row) || !exactDataKeys(row, columns)) {
    fail("result_invalid");
  }
  return row;
}

function readCount(row: Record<string, unknown>, column: string, maximum: number): number {
  const value = dataValue(row, column);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
    fail("result_invalid");
  }
  return value;
}

function readDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !datePattern.test(value)) {
    return undefined;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

function validSnapshotId(value: unknown): value is string {
  return typeof value === "string" && snapshotIdPattern.test(value);
}

function mapEnsureResult(value: unknown): JobsMaintenanceResult {
  const row = readSingleRow(value, new Set(["season_start"]));
  const seasonStart = dataValue(row, "season_start");
  if (seasonStart === null) {
    return Object.freeze({ kind: "ensure_current_season", outcome: "busy" });
  }
  if (readDate(seasonStart) === undefined) {
    fail("result_invalid");
  }
  return Object.freeze({ kind: "ensure_current_season", outcome: "ensured" });
}

function mapRefreshResult(value: unknown): JobsMaintenanceResult {
  const row = readSingleRow(value, new Set(["outcome", "season_start", "snapshot_id"]));
  const outcome = dataValue(row, "outcome");
  const seasonStart = dataValue(row, "season_start");
  const snapshotId = dataValue(row, "snapshot_id");
  if ((outcome === "busy" || outcome === "idle") && seasonStart === null && snapshotId === null) {
    return Object.freeze({ kind: "refresh_dirty_leaderboard", outcome });
  }
  if (outcome === "retry_scheduled" && readDate(seasonStart) !== undefined && snapshotId === null) {
    return Object.freeze({ kind: "refresh_dirty_leaderboard", outcome });
  }
  if (
    outcome === "published" &&
    readDate(seasonStart) !== undefined &&
    validSnapshotId(snapshotId)
  ) {
    return Object.freeze({ kind: "refresh_dirty_leaderboard", outcome });
  }
  fail("result_invalid");
}

function mapFinalizationResult(value: unknown): JobsMaintenanceResult {
  const row = readSingleRow(value, new Set(["outcome", "season_start", "snapshot_id"]));
  const outcome = dataValue(row, "outcome");
  const seasonStart = dataValue(row, "season_start");
  const snapshotId = dataValue(row, "snapshot_id");
  if ((outcome === "busy" || outcome === "idle") && seasonStart === null && snapshotId === null) {
    return Object.freeze({ kind: "finalize_due_season", outcome });
  }
  if (
    (outcome === "needs_refresh" || outcome === "retry_scheduled") &&
    readDate(seasonStart) !== undefined &&
    snapshotId === null
  ) {
    return Object.freeze({ kind: "finalize_due_season", outcome });
  }
  if (
    outcome === "finalized" &&
    readDate(seasonStart) !== undefined &&
    validSnapshotId(snapshotId)
  ) {
    return Object.freeze({ kind: "finalize_due_season", outcome });
  }
  fail("result_invalid");
}

const cleanupResultColumns = Object.freeze({
  cleanup_aged_revoked_authority: Object.freeze({
    deleted_device_keys: maximumCleanupBatchSize,
    deleted_installations: maximumCleanupBatchSize,
    deleted_passkeys: maximumCleanupBatchSize,
    redacted_pairings: maximumCleanupBatchSize,
  }),
  cleanup_expired_auth_state: Object.freeze({
    deleted_challenges: maximumCleanupBatchSize,
    deleted_invites: maximumCleanupBatchSize,
    deleted_recovery_codes: maximumCleanupBatchSize,
    deleted_sessions: maximumCleanupBatchSize,
  }),
  cleanup_expired_pairing_state: Object.freeze({
    deleted_accounts: maximumCleanupBatchSize * 16,
    deleted_installations: maximumCleanupBatchSize,
    deleted_pairings: maximumCleanupBatchSize,
  }),
  cleanup_expired_ranking_events: Object.freeze({
    deleted_events: maximumCleanupBatchSize,
  }),
  cleanup_expired_usage_history: Object.freeze({
    deleted_idempotency_records: maximumCleanupBatchSize,
    deleted_observations: maximumCleanupBatchSize,
    redacted_day_totals: maximumCleanupBatchSize * 31,
  }),
  cleanup_expired_usage_nonces: Object.freeze({
    deleted_device_nonces: maximumCleanupBatchSize,
    deleted_origin_nonces: maximumCleanupBatchSize,
  }),
  cleanup_snapshot_history: Object.freeze({
    deleted_snapshots: maximumCleanupBatchSize,
  }),
  cleanup_terminal_deletion_jobs: Object.freeze({
    deleted_deletion_jobs: maximumCleanupBatchSize,
  }),
  purge_profile_deletions: Object.freeze({
    purged_profiles: maximumProfileDeletionPurgeBatchSize,
  }),
  reset_expired_pairing_request_windows: Object.freeze({
    reset_windows: 130,
  }),
} as const);

type CleanupResultKind = keyof typeof cleanupResultColumns;

function mapCleanupResult(
  job: Extract<JobsMaintenanceJob, { kind: CleanupResultKind }>,
  value: unknown,
): JobsMaintenanceResult {
  const columnBounds = cleanupResultColumns[job.kind];
  const columns = Object.keys(columnBounds);
  const row = readSingleRow(value, new Set(columns));
  let affectedCount = 0;
  for (const column of columns) {
    affectedCount += readCount(row, column, columnBounds[column as keyof typeof columnBounds]);
  }
  return Object.freeze({ affectedCount, kind: job.kind });
}

function validRuntimeBoundary(value: unknown): boolean {
  try {
    const row = readSingleRow(value, runtimeBoundaryColumnSet);
    return runtimeBoundaryColumns.every((column) => dataValue(row, column) === true);
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

function executeCapability(client: JobsDatabaseClient, job: JobsMaintenanceJob): Promise<unknown> {
  switch (job.kind) {
    case "ensure_current_season":
      return client.ensureCurrentSeason();
    case "refresh_dirty_leaderboard":
      return client.refreshDirtyLeaderboard();
    case "finalize_due_season":
      return client.finalizeDueSeason();
    case "reset_expired_pairing_request_windows":
      return client.resetExpiredPairingRequestWindows();
    case "cleanup_expired_pairing_state":
      return client.cleanupExpiredPairingState(job.batchSize);
    case "cleanup_expired_usage_nonces":
      return client.cleanupExpiredUsageNonces(job.batchSize);
    case "cleanup_expired_usage_history":
      return client.cleanupExpiredUsageHistory(job.batchSize);
    case "cleanup_expired_auth_state":
      return client.cleanupExpiredAuthState(job.batchSize);
    case "cleanup_aged_revoked_authority":
      return client.cleanupAgedRevokedAuthority(job.batchSize);
    case "cleanup_snapshot_history":
      return client.cleanupSnapshotHistory(job.batchSize);
    case "cleanup_expired_ranking_events":
      return client.cleanupExpiredRankingEvents(job.batchSize);
    case "purge_profile_deletions":
      return client.purgeProfileDeletions(job.batchSize);
    case "cleanup_terminal_deletion_jobs":
      return client.cleanupTerminalDeletionJobs(job.batchSize);
  }
}

function mapResult(job: JobsMaintenanceJob, value: unknown): JobsMaintenanceResult {
  if (job.kind === "ensure_current_season") {
    return mapEnsureResult(value);
  }
  if (job.kind === "refresh_dirty_leaderboard") {
    return mapRefreshResult(value);
  }
  if (job.kind === "finalize_due_season") {
    return mapFinalizationResult(value);
  }
  return mapCleanupResult(job, value);
}

async function executeJob(
  pool: JobsDatabasePool,
  job: JobsMaintenanceJob,
): Promise<JobsMaintenanceResult> {
  let client: JobsDatabaseClient;
  try {
    client = await pool.connect();
  } catch {
    fail("connection_unavailable");
  }

  let destroyClient = true;
  let outcome:
    | Readonly<{ code: JobsMaintenanceErrorCode; ok: false }>
    | Readonly<{ ok: true; result: JobsMaintenanceResult }>;
  try {
    if (!validRuntimeBoundary(await client.verifyRuntimeBoundary())) {
      fail("runtime_boundary_mismatch");
    }
    const result = mapResult(job, await executeCapability(client, job));
    destroyClient = false;
    outcome = { ok: true, result };
  } catch (error) {
    outcome = {
      code: error instanceof JobsMaintenanceError ? error.code : "query_failed",
      ok: false,
    };
  }

  releaseClient(client, destroyClient);
  if (!outcome.ok) {
    fail(outcome.code);
  }
  return outcome.result;
}

export function createJobsMaintenanceRunner(pool: JobsDatabasePool): JobsMaintenanceRunner {
  return Object.freeze({
    async execute(value: unknown): Promise<JobsMaintenanceResult> {
      return executeJob(pool, readJob(value));
    },
  });
}

export function createCloseableJobsMaintenanceRunner(
  pool: JobsDatabasePool,
): ConfiguredJobsMaintenanceRunner {
  const runner = createJobsMaintenanceRunner(pool);
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

export function createConfiguredJobsMaintenanceRunner(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  signalSink?: JobsDatabasePoolSignalSink,
): ConfiguredJobsMaintenanceRunner {
  return createCloseableJobsMaintenanceRunner(
    createJobsDatabasePool(resolveJobsDatabaseConfig(environment), signalSink),
  );
}
