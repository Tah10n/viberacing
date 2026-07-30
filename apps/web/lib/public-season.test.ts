import { describe, expect, it } from "vitest";

import {
  currentCommunitySeasonStart,
  isCommunitySeasonStart,
  isPublicSnapshotHandle,
} from "./public-season";

describe("public season and handle helpers", () => {
  it("derives only canonical UTC Monday seasons", () => {
    expect(currentCommunitySeasonStart(new Date("2026-07-29T23:59:59.999Z"))).toBe("2026-07-27");
    expect(currentCommunitySeasonStart(new Date("2026-08-02T23:59:59.999Z"))).toBe("2026-07-27");
    expect(currentCommunitySeasonStart(new Date("2026-08-03T00:00:00.000Z"))).toBe("2026-08-03");
    expect(currentCommunitySeasonStart(new Date(Number.NaN))).toBeUndefined();
    expect(isCommunitySeasonStart("2026-07-27")).toBe(true);
    expect(isCommunitySeasonStart("2026-07-28")).toBe(false);
  });

  it("accepts only canonical public handles", () => {
    expect(isPublicSnapshotHandle("agent_driver")).toBe(true);
    expect(isPublicSnapshotHandle("UPPER")).toBe(false);
    expect(isPublicSnapshotHandle(["agent_driver"])).toBe(false);
    expect(isPublicSnapshotHandle("ab")).toBe(false);
  });
});
