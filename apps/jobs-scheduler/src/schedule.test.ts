import { describe, expect, it } from "vitest";

import { createMaintenanceSchedule, hourlyJobs, MaintenanceScheduleError } from "./schedule.js";

const start = Date.parse("2026-07-15T12:30:00.000Z");
const hourlyKinds = [
  "ensure_current_season",
  "refresh_dirty_leaderboard",
  "finalize_due_season",
  "cleanup_expired_audit_events",
  "cleanup_expired_usage_nonces",
  "cleanup_expired_usage_history",
  "cleanup_expired_pairing_state",
  "cleanup_expired_auth_state",
  "cleanup_aged_revoked_authority",
  "cleanup_snapshot_history",
  "purge_profile_deletions",
  "cleanup_terminal_deletion_jobs",
  "reset_expired_pairing_request_windows",
] as const;

describe("createMaintenanceSchedule", () => {
  it("returns the exact frozen startup catalog without caller-selected dates", () => {
    const jobs = createMaintenanceSchedule().due(start);

    expect(jobs).toBe(hourlyJobs);
    expect(Object.isFrozen(jobs)).toBe(true);
    expect(jobs).toHaveLength(13);
    expect(jobs.map((job) => job.kind)).toEqual(hourlyKinds);
    expect(jobs[0]).toEqual({ kind: "ensure_current_season" });
    expect(jobs[1]).toEqual({ kind: "refresh_dirty_leaderboard" });
    expect(jobs[2]).toEqual({ kind: "finalize_due_season" });
    expect(jobs[10]).toEqual({ batchSize: 10, kind: "purge_profile_deletions" });
    for (const job of jobs.slice(3, -1)) {
      expect("batchSize" in job && typeof job.batchSize === "number").toBe(true);
    }
    expect(jobs.at(-1)).toEqual({ kind: "reset_expired_pairing_request_windows" });
    expect(jobs.every(Object.isFrozen)).toBe(true);
  });

  it("preserves dependency order for audit, usage, pairing, auth, purge, and evidence", () => {
    const kinds = createMaintenanceSchedule()
      .due(start)
      .map((job) => job.kind);

    expect(kinds.indexOf("refresh_dirty_leaderboard")).toBeLessThan(
      kinds.indexOf("purge_profile_deletions"),
    );
    expect(kinds.indexOf("cleanup_expired_audit_events")).toBeLessThan(
      kinds.indexOf("cleanup_expired_usage_history"),
    );
    expect(kinds.indexOf("cleanup_expired_pairing_state")).toBeLessThan(
      kinds.indexOf("cleanup_expired_auth_state"),
    );
    expect(kinds.indexOf("cleanup_expired_auth_state")).toBeLessThan(
      kinds.indexOf("cleanup_aged_revoked_authority"),
    );
    expect(kinds.indexOf("purge_profile_deletions")).toBeLessThan(
      kinds.indexOf("cleanup_terminal_deletion_jobs"),
    );
  });

  it("marks slots before returning and advances only minute, five-minute, and hourly cadences", () => {
    const schedule = createMaintenanceSchedule();

    expect(schedule.due(start)).toHaveLength(13);
    expect(schedule.due(start)).toEqual([]);
    expect(schedule.due(start + 60_000)).toEqual([{ kind: "refresh_dirty_leaderboard" }]);
    expect(schedule.due(start + 5 * 60_000)).toEqual([
      { kind: "refresh_dirty_leaderboard" },
      { kind: "finalize_due_season" },
    ]);
    expect(schedule.due(Date.parse("2026-07-15T13:00:00.000Z")).map((job) => job.kind)).toEqual(
      hourlyKinds,
    );
  });

  it("accepts the exact supported clock boundaries without deriving season authority", () => {
    expect(createMaintenanceSchedule().due(Date.UTC(2000, 0, 3))).toHaveLength(13);
    expect(createMaintenanceSchedule().due(Date.parse("2100-01-03T23:59:59.999Z"))).toHaveLength(
      13,
    );
  });

  it.each([
    null,
    "2026-07-15",
    Number.NaN,
    Number.POSITIVE_INFINITY,
    start + 0.5,
    Date.UTC(2000, 0, 3) - 1,
    Date.UTC(2100, 0, 4),
  ])("rejects the invalid clock %#", (clock) => {
    expect(() => createMaintenanceSchedule().due(clock)).toThrow(
      expect.objectContaining({ code: "clock_invalid" }),
    );
  });

  it("rejects a backward wall clock", () => {
    const schedule = createMaintenanceSchedule();
    schedule.due(start);

    expect(() => schedule.due(start - 1)).toThrow(MaintenanceScheduleError);
  });
});
