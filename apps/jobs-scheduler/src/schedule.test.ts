import { describe, expect, it } from "vitest";

import { MaintenanceScheduleError, createMaintenanceSchedule } from "./schedule.js";

const monday = Date.parse("2026-07-13T12:34:00.000Z");
const wednesday = Date.parse("2026-07-15T12:34:00.000Z");

const hourlyKinds = [
  "finalize_community_season_backlog",
  "purge_profile_deletions",
  "cleanup_expired_auth_state",
  "cleanup_expired_ingest_state",
  "cleanup_expired_pairing_state",
  "cleanup_expired_car_recipe_proposals",
  "redact_aged_pairing_approval_provenance",
  "cleanup_expired_sessions",
  "cleanup_expired_invites",
  "cleanup_abandoned_enrollments",
  "cleanup_finalized_source_day_values",
  "cleanup_terminal_deletion_jobs",
  "cleanup_expired_audit_events",
  "cleanup_aged_revoked_passkeys",
  "cleanup_aged_revoked_devices",
  "reset_expired_pairing_request_windows",
] as const;

describe("createMaintenanceSchedule", () => {
  it("returns the exact Monday startup catalog with the latest grace-eligible season", () => {
    const jobs = createMaintenanceSchedule().due(monday);

    expect(Object.isFrozen(jobs)).toBe(true);
    expect(jobs).toHaveLength(18);
    expect(jobs[0]).toEqual({
      kind: "finalize_community_season",
      seasonStart: "2026-06-29",
    });
    expect(jobs[1]).toEqual({
      kind: "refresh_community_season",
      seasonStart: "2026-07-13",
    });
    expect(jobs.slice(2).map((job) => job.kind)).toEqual(hourlyKinds);
    expect(jobs[2]).toEqual({ kind: "finalize_community_season_backlog" });
    expect(jobs[3]).toEqual({ batchSize: 10, kind: "purge_profile_deletions" });
    for (const job of jobs.slice(4, -1)) {
      expect(job).toMatchObject({ batchSize: 1_000 });
    }
    expect(jobs.at(-1)).toEqual({ kind: "reset_expired_pairing_request_windows" });
    expect(jobs.every(Object.isFrozen)).toBe(true);
  });

  it("moves finalization to the prior season when Wednesday begins", () => {
    const jobs = createMaintenanceSchedule().due(wednesday);

    expect(jobs).toHaveLength(18);
    expect(jobs[0]).toEqual({
      kind: "finalize_community_season",
      seasonStart: "2026-07-06",
    });
    expect(jobs[1]).toEqual({
      kind: "refresh_community_season",
      seasonStart: "2026-07-13",
    });
  });

  it("releases pairing provenance before dependent authentication and device retention", () => {
    const kinds = createMaintenanceSchedule()
      .due(wednesday)
      .map((job) => job.kind);
    const provenanceIndex = kinds.indexOf("redact_aged_pairing_approval_provenance");
    const sessionIndex = kinds.indexOf("cleanup_expired_sessions");
    const passkeyIndex = kinds.indexOf("cleanup_aged_revoked_passkeys");
    const deviceIndex = kinds.indexOf("cleanup_aged_revoked_devices");

    expect(provenanceIndex).toBeGreaterThanOrEqual(0);
    expect(provenanceIndex).toBeLessThan(sessionIndex);
    expect(sessionIndex).toBeLessThan(passkeyIndex);
    expect(passkeyIndex).toBeLessThan(deviceIndex);
  });

  it("marks slots before returning and advances only changed fixed cadences", () => {
    const schedule = createMaintenanceSchedule();

    expect(schedule.due(wednesday)).toHaveLength(18);
    expect(schedule.due(wednesday)).toEqual([]);
    expect(schedule.due(wednesday + 5 * 60_000)).toEqual([
      { kind: "refresh_community_season", seasonStart: "2026-07-13" },
    ]);
    const nextHour = Date.parse("2026-07-15T13:00:00.000Z");
    expect(schedule.due(nextHour).map((job) => job.kind)).toEqual([
      "refresh_community_season",
      ...hourlyKinds,
    ]);
    const nextDay = Date.parse("2026-07-16T00:00:00.000Z");
    expect(schedule.due(nextDay).map((job) => job.kind)).toEqual([
      "finalize_community_season",
      "refresh_community_season",
      ...hourlyKinds,
    ]);
  });

  it("crosses the Tuesday grace boundary and UTC year boundary without local time", () => {
    const schedule = createMaintenanceSchedule();
    expect(schedule.due(Date.parse("2027-01-05T23:59:59.999Z"))[0]).toEqual({
      kind: "finalize_community_season",
      seasonStart: "2026-12-21",
    });

    expect(schedule.due(Date.parse("2027-01-06T00:00:00.000Z"))[0]).toEqual({
      kind: "finalize_community_season",
      seasonStart: "2026-12-28",
    });
  });

  it("accepts the last supported scheduler week", () => {
    const jobs = createMaintenanceSchedule().due(Date.parse("2100-01-03T23:59:59.999Z"));

    expect(jobs[0]).toEqual({
      kind: "finalize_community_season",
      seasonStart: "2099-12-21",
    });
    expect(jobs[1]).toEqual({
      kind: "refresh_community_season",
      seasonStart: "2099-12-28",
    });
  });

  it("starts at the first supported week without inventing an older season", () => {
    const jobs = createMaintenanceSchedule().due(Date.UTC(2000, 0, 3));

    expect(jobs).toHaveLength(17);
    expect(jobs[0]).toEqual({
      kind: "refresh_community_season",
      seasonStart: "2000-01-03",
    });
    expect(jobs.some((job) => job.kind === "finalize_community_season")).toBe(false);
  });

  it.each([
    null,
    "2026-07-15",
    Number.NaN,
    Number.POSITIVE_INFINITY,
    monday + 0.5,
    Date.UTC(2000, 0, 3) - 1,
    Date.UTC(2100, 0, 4),
  ])("rejects the invalid clock %#", (clock) => {
    expect(() => createMaintenanceSchedule().due(clock)).toThrow(
      expect.objectContaining({ code: "clock_invalid" }),
    );
  });

  it("rejects a backward wall clock", () => {
    const schedule = createMaintenanceSchedule();
    schedule.due(wednesday);

    expect(() => schedule.due(wednesday - 1)).toThrow(MaintenanceScheduleError);
  });
});
