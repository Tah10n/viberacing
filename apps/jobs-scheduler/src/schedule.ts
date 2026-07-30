import {
  maximumCleanupBatchSize,
  maximumProfileDeletionPurgeBatchSize,
  type JobsMaintenanceJob,
} from "@viberacing/jobs";

const oneMinuteMs = 60 * 1_000;
const fiveMinutesMs = 5 * oneMinuteMs;
const oneHourMs = 60 * oneMinuteMs;
const minimumClockMs = Date.UTC(2000, 0, 3);
const maximumClockExclusiveMs = Date.UTC(2100, 0, 4);

// This is an execution order, not only an inventory. Refresh runs before purge so a hidden or
// deletion-pending profile leaves the current public snapshot first. Audit expiry precedes usage
// history expiry, pairing expiry precedes auth/authority cleanup, and terminal deletion evidence is
// retained after the primary purge.
export const hourlyJobs: readonly JobsMaintenanceJob[] = Object.freeze([
  Object.freeze({ kind: "ensure_current_season" }),
  Object.freeze({ kind: "refresh_dirty_leaderboard" }),
  Object.freeze({ kind: "finalize_due_season" }),
  Object.freeze({
    batchSize: maximumCleanupBatchSize,
    kind: "cleanup_expired_audit_events",
  }),
  Object.freeze({
    batchSize: maximumCleanupBatchSize,
    kind: "cleanup_expired_usage_nonces",
  }),
  Object.freeze({
    batchSize: maximumCleanupBatchSize,
    kind: "cleanup_expired_usage_history",
  }),
  Object.freeze({
    batchSize: maximumCleanupBatchSize,
    kind: "cleanup_expired_pairing_state",
  }),
  Object.freeze({
    batchSize: maximumCleanupBatchSize,
    kind: "cleanup_expired_auth_state",
  }),
  Object.freeze({
    batchSize: maximumCleanupBatchSize,
    kind: "cleanup_aged_revoked_authority",
  }),
  Object.freeze({
    batchSize: maximumCleanupBatchSize,
    kind: "cleanup_snapshot_history",
  }),
  Object.freeze({
    batchSize: maximumProfileDeletionPurgeBatchSize,
    kind: "purge_profile_deletions",
  }),
  Object.freeze({
    batchSize: maximumCleanupBatchSize,
    kind: "cleanup_terminal_deletion_jobs",
  }),
  Object.freeze({ kind: "reset_expired_pairing_request_windows" }),
]);

export type MaintenanceScheduleErrorCode = "clock_invalid";

export class MaintenanceScheduleError extends Error {
  readonly code: MaintenanceScheduleErrorCode;

  constructor(code: MaintenanceScheduleErrorCode) {
    super("Jobs maintenance schedule failed closed.");
    this.name = "MaintenanceScheduleError";
    this.code = code;
  }
}

export interface MaintenanceSchedule {
  due(nowEpochMs: unknown): readonly JobsMaintenanceJob[];
}

function fail(): never {
  throw new MaintenanceScheduleError("clock_invalid");
}

function readClock(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimumClockMs ||
    value >= maximumClockExclusiveMs
  ) {
    fail();
  }
  return value;
}

export function createMaintenanceSchedule(): MaintenanceSchedule {
  let previousClockMs: number | undefined;
  let previousMinuteSlot: number | undefined;
  let previousFiveMinuteSlot: number | undefined;
  let previousHourSlot: number | undefined;

  return Object.freeze({
    due(rawNowEpochMs: unknown): readonly JobsMaintenanceJob[] {
      const nowEpochMs = readClock(rawNowEpochMs);
      if (previousClockMs !== undefined && nowEpochMs < previousClockMs) {
        fail();
      }
      previousClockMs = nowEpochMs;

      const hourSlot = Math.floor(nowEpochMs / oneHourMs);
      const minuteSlot = Math.floor(nowEpochMs / oneMinuteMs);
      const fiveMinuteSlot = Math.floor(nowEpochMs / fiveMinutesMs);
      if (previousHourSlot !== hourSlot) {
        previousHourSlot = hourSlot;
        previousMinuteSlot = minuteSlot;
        previousFiveMinuteSlot = fiveMinuteSlot;
        return hourlyJobs;
      }

      const jobs: JobsMaintenanceJob[] = [];
      if (previousMinuteSlot !== minuteSlot) {
        previousMinuteSlot = minuteSlot;
        jobs.push(Object.freeze({ kind: "refresh_dirty_leaderboard" }));
      }
      if (previousFiveMinuteSlot !== fiveMinuteSlot) {
        previousFiveMinuteSlot = fiveMinuteSlot;
        jobs.push(Object.freeze({ kind: "finalize_due_season" }));
      }
      return Object.freeze(jobs);
    },
  });
}
