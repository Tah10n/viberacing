import { describe, expect, it } from "vitest";

import { getSyntheticPublicHomePayload } from "./race-data";

describe("synthetic public snapshot fallback", () => {
  it("uses the final direct-token contract without private or legacy score fields", () => {
    const payload = getSyntheticPublicHomePayload("2026-07-27");
    const serialized = JSON.stringify(payload);

    expect(payload.leaderboard.participants).toHaveLength(8);
    expect(payload.leaderboard.metricVersion).toBe("provider_reported_tokens_v1");
    expect(payload.source).toBe("fallback");
    expect(serialized).not.toMatch(
      /(?:activeDays|dailyScores|deviceCount|sourceCount|weeklyScore|community_v1)/,
    );
    expect(serialized).not.toMatch(/(?:https?:\/\/|[A-Za-z]:\\|@[^\s"]+\.[A-Za-z]{2,})/);
    for (const participant of payload.leaderboard.participants) {
      expect(participant.weeklyTokenTotal).toMatch(/^(?:0|[1-9][0-9]{0,59})$/);
      expect(typeof participant.weeklyTokenTotal).toBe("string");
    }
  });

  it("keeps exact descending totals and shared ranks without Number conversion", () => {
    const participants = getSyntheticPublicHomePayload("2026-07-27").leaderboard.participants;
    for (let index = 1; index < participants.length; index += 1) {
      const previous = participants[index - 1];
      const current = participants[index];
      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      expect(BigInt(previous?.weeklyTokenTotal ?? "0")).toBeGreaterThanOrEqual(
        BigInt(current?.weeklyTokenTotal ?? "0"),
      );
    }
    const demo = participants.find((participant) => participant.handle === "demo_driver");
    const loop = participants.find((participant) => participant.handle === "loop_lantern");
    expect(demo?.weeklyTokenTotal).toBe(loop?.weeklyTokenTotal);
    expect(demo?.rankPosition).toBe(loop?.rankPosition);
    expect(demo?.displayPosition).not.toBe(loop?.displayPosition);
  });

  it("materializes only a requested public fallback profile", () => {
    const found = getSyntheticPublicHomePayload("2026-07-27", "demo_driver");
    expect(found.profileState).toBe("ready");
    expect(found.profile?.handle).toBe("demo_driver");
    expect(found.profile?.weeklyTokenTotal).toBe("690000");

    const missing = getSyntheticPublicHomePayload("2026-07-27", "missing_driver");
    expect(missing.profileState).toBe("not-found");
    expect(missing.profile).toBeNull();
    expect(() => getSyntheticPublicHomePayload("2026-07-28")).toThrow(RangeError);
  });
});
