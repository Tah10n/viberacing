import { describe, expect, it } from "vitest";

import { getSyntheticRacePayload } from "./race-data";

describe("synthetic public race payload", () => {
  it("contains only scored public fields and no raw token data", () => {
    const payload = getSyntheticRacePayload();
    const serialized = JSON.stringify(payload);
    expect(payload.participants).toHaveLength(8);
    expect(serialized).not.toMatch(/token/i);
    expect(serialized).not.toMatch(/(?:https?:\/\/|[A-Za-z]:\\|@[^\s]+\.[A-Za-z]{2,})/);
    for (const participant of payload.participants) {
      expect(Object.keys(participant).sort()).toEqual([
        "activeDays",
        "car",
        "freshnessDays",
        "handle",
        "id",
        "rank",
        "sourceCount",
        "streakDays",
        "weeklyScore",
      ]);
      expect("dailyScores" in participant).toBe(false);
    }
    expect(payload.profile.dailyScores).toHaveLength(7);
  });

  it("orders descending scores and represents a shared rank without a token tie-break", () => {
    const { participants } = getSyntheticRacePayload();
    for (let index = 1; index < participants.length; index += 1) {
      expect(participants[index - 1]?.weeklyScore).toBeGreaterThanOrEqual(
        participants[index]?.weeklyScore ?? 0,
      );
    }
    const demo = participants.find((participant) => participant.id === "demo-driver");
    const loop = participants.find((participant) => participant.id === "loop-lantern");
    expect(demo?.weeklyScore).toBe(loop?.weeklyScore);
    expect(demo?.activeDays).toBe(loop?.activeDays);
    expect(demo?.rank).toBe(loop?.rank);
  });

  it("keeps the demo profile internally consistent", () => {
    const payload = getSyntheticRacePayload();
    const participant = payload.participants.find((entry) => entry.id === "demo-driver");
    expect(payload.profile.handle).toBe("demo_driver");
    expect(payload.profile.weeklyScore).toBe(participant?.weeklyScore);
    expect(payload.profile.sourceCount).toBe(2);
    expect(payload.profile.deviceCount).toBe(2);
  });
});
