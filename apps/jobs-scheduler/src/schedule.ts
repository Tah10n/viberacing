import {
  maximumCleanupBatchSize,
  maximumProfileDeletionPurgeBatchSize,
  type CommunityMaintenanceJob,
} from "@viberacing/jobs";

const fiveMinutesMs = 5 * 60 * 1_000;
const oneHourMs = 60 * 60 * 1_000;
const oneDayMs = 24 * oneHourMs;
const minimumSeasonStartMs = Date.UTC(1999, 11, 27);
const minimumClockMs = Date.UTC(2000, 0, 3);
const maximumClockExclusiveMs = Date.UTC(2100, 0, 4);

// This catalog is ordered, not merely enumerated. Approval provenance must be redacted before
// expired sessions and aged passkeys/devices can become eligible for physical deletion.
const hourlyJobs: readonly CommunityMaintenanceJob[] = Object.freeze([
  Object.freeze({ kind: "finalize_community_season_backlog" }),
  Object.freeze({
    batchSize: maximumProfileDeletionPurgeBatchSize,
    kind: "purge_profile_deletions",
  }),
  Object.freeze({ batchSize: maximumCleanupBatchSize, kind: "cleanup_expired_auth_state" }),
  Object.freeze({ batchSize: maximumCleanupBatchSize, kind: "cleanup_expired_ingest_state" }),
  Object.freeze({ batchSize: maximumCleanupBatchSize, kind: "cleanup_expired_pairing_state" }),
  Object.freeze({
    batchSize: maximumCleanupBatchSize,
    kind: "cleanup_expired_car_recipe_proposals",
  }),
  Object.freeze({
    batchSize: maximumCleanupBatchSize,
    kind: "redact_aged_pairing_approval_provenance",
  }),
  Object.freeze({ batchSize: maximumCleanupBatchSize, kind: "cleanup_expired_sessions" }),
  Object.freeze({ batchSize: maximumCleanupBatchSize, kind: "cleanup_expired_invites" }),
  Object.freeze({
    batchSize: maximumCleanupBatchSize,
    kind: "cleanup_abandoned_enrollments",
  }),
  Object.freeze({
    batchSize: maximumCleanupBatchSize,
    kind: "cleanup_finalized_source_day_values",
  }),
  Object.freeze({
    batchSize: maximumCleanupBatchSize,
    kind: "cleanup_terminal_deletion_jobs",
  }),
  Object.freeze({
    batchSize: maximumCleanupBatchSize,
    kind: "cleanup_expired_audit_events",
  }),
  Object.freeze({
    batchSize: maximumCleanupBatchSize,
    kind: "cleanup_aged_revoked_passkeys",
  }),
  Object.freeze({
    batchSize: maximumCleanupBatchSize,
    kind: "cleanup_aged_revoked_devices",
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
  due(nowEpochMs: unknown): readonly CommunityMaintenanceJob[];
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

function utcMonday(nowEpochMs: number): number {
  const now = new Date(nowEpochMs);
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday);
}

function dateLabel(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

export function createMaintenanceSchedule(): MaintenanceSchedule {
  let previousClockMs: number | undefined;
  let previousFiveMinuteSlot: number | undefined;
  let previousHourSlot: number | undefined;
  let previousFinalizationDay: string | undefined;

  return Object.freeze({
    due(rawNowEpochMs: unknown): readonly CommunityMaintenanceJob[] {
      const nowEpochMs = readClock(rawNowEpochMs);
      if (previousClockMs !== undefined && nowEpochMs < previousClockMs) {
        fail();
      }
      previousClockMs = nowEpochMs;

      const jobs: CommunityMaintenanceJob[] = [];
      const currentMondayMs = utcMonday(nowEpochMs);
      const finalizationDay = dateLabel(nowEpochMs);
      const latestDueSeasonMs =
        currentMondayMs - (nowEpochMs >= currentMondayMs + 2 * oneDayMs ? 7 : 14) * oneDayMs;
      if (
        latestDueSeasonMs >= minimumSeasonStartMs &&
        previousFinalizationDay !== finalizationDay
      ) {
        previousFinalizationDay = finalizationDay;
        jobs.push(
          Object.freeze({
            kind: "finalize_community_season",
            seasonStart: dateLabel(latestDueSeasonMs),
          }),
        );
      }

      const fiveMinuteSlot = Math.floor(nowEpochMs / fiveMinutesMs);
      if (previousFiveMinuteSlot !== fiveMinuteSlot) {
        previousFiveMinuteSlot = fiveMinuteSlot;
        jobs.push(
          Object.freeze({
            kind: "refresh_community_season",
            seasonStart: dateLabel(currentMondayMs),
          }),
        );
      }

      const hourSlot = Math.floor(nowEpochMs / oneHourMs);
      if (previousHourSlot !== hourSlot) {
        previousHourSlot = hourSlot;
        jobs.push(...hourlyJobs);
      }

      return Object.freeze(jobs);
    },
  });
}
