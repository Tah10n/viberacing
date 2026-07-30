import { describe, expect, it, vi } from "vitest";

import { createPublicSnapshotAdmission } from "./public-snapshot-admission";
import { loadPublicHomeSnapshot } from "./public-home-snapshot";
import { getSyntheticPublicHomePayload } from "./race-data";
import { PublicSnapshotStoreError } from "./public-snapshot-store";

function record(value: unknown): Readonly<{ canonicalPayload: string }> {
  return Object.freeze({ canonicalPayload: JSON.stringify(value) });
}

describe("public home snapshot loader", () => {
  it("stays closed before admission or storage when the module decision is disabled", async () => {
    const readCurrentLeaderboard = vi.fn();
    const readCurrentProfile = vi.fn();
    await expect(
      loadPublicHomeSnapshot("2026-07-27", "demo_driver", {
        admission: createPublicSnapshotAdmission(4),
        enabled: false,
        readCurrentLeaderboard,
        readCurrentProfile,
      }),
    ).resolves.toBeUndefined();
    expect(readCurrentLeaderboard).not.toHaveBeenCalled();
    expect(readCurrentProfile).not.toHaveBeenCalled();
  });

  it("loads one exact page and an outside-page profile under one admission lease", async () => {
    const fixture = getSyntheticPublicHomePayload("2026-07-27", "demo_driver");
    const admission = createPublicSnapshotAdmission(1);
    const readCurrentLeaderboard = vi.fn(() => {
      expect(admission.tryAcquire()).toBeUndefined();
      return Promise.resolve(record(fixture.leaderboard));
    });
    const readCurrentProfile = vi.fn(() => {
      expect(admission.tryAcquire()).toBeUndefined();
      return Promise.resolve(record(fixture.profile));
    });

    const result = await loadPublicHomeSnapshot("2026-07-27", "demo_driver", {
      admission,
      enabled: true,
      readCurrentLeaderboard,
      readCurrentProfile,
    });

    expect(result).toEqual({
      leaderboard: fixture.leaderboard,
      profile: fixture.profile,
      profileState: "ready",
      source: "community",
    });
    expect(readCurrentLeaderboard).toHaveBeenCalledWith(1);
    expect(readCurrentProfile).toHaveBeenCalledWith("demo_driver");
    const recovered = admission.tryAcquire();
    expect(recovered).toBeDefined();
    recovered?.release();
  });

  it("keeps a valid leaderboard when a requested profile is absent or unavailable", async () => {
    const fixture = getSyntheticPublicHomePayload("2026-07-27");
    const base = {
      admission: createPublicSnapshotAdmission(4),
      enabled: true,
      readCurrentLeaderboard: vi.fn(() => Promise.resolve(record(fixture.leaderboard))),
    } as const;

    const missing = await loadPublicHomeSnapshot("2026-07-27", "missing_driver", {
      ...base,
      readCurrentProfile: vi.fn(() => Promise.reject(new PublicSnapshotStoreError("not_found"))),
    });
    expect(missing?.profileState).toBe("not-found");
    expect(missing?.profile).toBeNull();

    const unavailable = await loadPublicHomeSnapshot("2026-07-27", "missing_driver", {
      ...base,
      readCurrentProfile: vi.fn(() => Promise.reject(new Error("private detail"))),
    });
    expect(unavailable?.profileState).toBe("unavailable");
    expect(unavailable?.profile).toBeNull();
  });

  it("rejects malformed or wrong-season payloads without leaking partial data", async () => {
    const fixture = getSyntheticPublicHomePayload("2026-07-27");
    const readCurrentProfile = vi.fn();

    await expect(
      loadPublicHomeSnapshot("2026-08-03", "demo_driver", {
        admission: createPublicSnapshotAdmission(4),
        enabled: true,
        readCurrentLeaderboard: vi.fn(() => Promise.resolve(record(fixture.leaderboard))),
        readCurrentProfile,
      }),
    ).resolves.toBeUndefined();
    expect(readCurrentProfile).not.toHaveBeenCalled();

    await expect(
      loadPublicHomeSnapshot("2026-07-27", undefined, {
        admission: createPublicSnapshotAdmission(4),
        enabled: true,
        readCurrentLeaderboard: vi.fn(() =>
          Promise.resolve(
            Object.freeze({
              canonicalPayload: '{"participants":[]}',
            }),
          ),
        ),
        readCurrentProfile,
      }),
    ).resolves.toBeUndefined();
  });
});
