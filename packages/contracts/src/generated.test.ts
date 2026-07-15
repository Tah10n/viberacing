import { describe, expect, it } from "vitest";

import * as publicApi from "./index";
import {
  communityScorePageV1Schema,
  connectorSyncV1Schema,
  validateCommunityScorePageV1,
  validateConnectorSyncResultV1,
  validateConnectorSyncV1,
  validateProblemDetailsV1,
} from "./generated";

function validScorePage() {
  return {
    schemaVersion: 1,
    trustTier: "community",
    selfReported: true,
    participants: [
      {
        seasonStart: "2026-07-13",
        seasonEnd: "2026-07-19",
        scoreVersion: "community_v1",
        seasonFinalized: false,
        handle: "demo_driver",
        weeklyScore: 4321,
        activeDays: 6,
        sourceCount: 2,
        rankPosition: 1,
        displayPosition: 1,
      },
    ],
  };
}

function validSync() {
  return {
    schemaVersion: 1,
    sourceId: "src_0123456789ABCDEFGHIJKL",
    syncId: "syn_0123456789ABCDEFGHIJKL",
    observedAt: "2026-07-14T17:00:00.000Z",
    connectorVersion: "0.1.0",
    codexVersion: "1.2.3",
    dailyEntries: [
      { codexReportedDate: "2026-07-13", tokens: 123_456 },
      { codexReportedDate: "2026-07-14", tokens: 234_567 },
    ],
  };
}

function issueCodes(value: unknown): string[] {
  const result = validateConnectorSyncV1(value);
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

function scoreIssueCodes(value: unknown): string[] {
  const result = validateCommunityScorePageV1(value);
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

describe("generated connector sync contract", () => {
  it("accepts the bounded writable payload and returns a typed value", () => {
    const input = validSync();
    const result = validateConnectorSyncV1(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(input);
      expect(result.value.dailyEntries[0]?.tokens).toBe(123_456);
    }
    expect(Object.isFrozen(connectorSyncV1Schema)).toBe(true);
    expect(Object.isFrozen(connectorSyncV1Schema.properties.dailyEntries.items.properties)).toBe(
      true,
    );
    expect(Object.hasOwn(publicApi, "validateContract")).toBe(false);
  });

  it("rejects server-owned and unknown fields without echoing their name or value", () => {
    const result = validateConnectorSyncV1({
      ...validSync(),
      profileId: "private-profile-value",
      trustTier: "verified",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({ code: "unknown_field", path: "$" });
      expect(JSON.stringify(result.issues)).not.toContain("profileId");
      expect(JSON.stringify(result.issues)).not.toContain("private-profile-value");
      expect(JSON.stringify(result.issues)).not.toContain("trustTier");
    }
  });

  it("rejects malformed identifiers, versions, timestamps, and schema versions", () => {
    expect(issueCodes({ ...validSync(), schemaVersion: 2 })).toContain("const");
    expect(issueCodes({ ...validSync(), sourceId: "src_short" })).toContain("min_length");
    expect(issueCodes({ ...validSync(), syncId: "syn_../../private-value" })).toContain("pattern");
    expect(issueCodes({ ...validSync(), connectorVersion: "latest" })).toContain("pattern");
    expect(issueCodes({ ...validSync(), observedAt: "2026-02-30T17:00:00.000Z" })).toContain(
      "format",
    );
    expect(issueCodes({ ...validSync(), observedAt: "2026-07-14T25:00:00.000Z" })).toContain(
      "format",
    );
  });

  it("enforces collection, date, integer, and same-date deduplication bounds", () => {
    expect(issueCodes({ ...validSync(), dailyEntries: [] })).toContain("min_items");
    expect(
      issueCodes({
        ...validSync(),
        dailyEntries: Array.from({ length: 32 }, (_, index) => ({
          codexReportedDate: `2026-07-${String((index % 28) + 1).padStart(2, "0")}`,
          tokens: index,
        })),
      }),
    ).toEqual(expect.arrayContaining(["max_items", "duplicate_item_key"]));
    expect(
      issueCodes({
        ...validSync(),
        dailyEntries: [
          { codexReportedDate: "2026-07-14", tokens: 1 },
          { codexReportedDate: "2026-07-14", tokens: 2 },
        ],
      }),
    ).toContain("duplicate_item_key");
    expect(
      issueCodes({
        ...validSync(),
        dailyEntries: [{ codexReportedDate: "2026-02-30", tokens: 1 }],
      }),
    ).toContain("format");
    expect(
      issueCodes({
        ...validSync(),
        dailyEntries: [{ codexReportedDate: "2026-07-14", tokens: -1 }],
      }),
    ).toContain("minimum");
    expect(
      issueCodes({
        ...validSync(),
        dailyEntries: [{ codexReportedDate: "2026-07-14", tokens: 1.5 }],
      }),
    ).toContain("type");
  });

  it("rejects unknown fields inside daily entries at the bounded schema path", () => {
    const input = validSync();
    input.dailyEntries[0] = { ...input.dailyEntries[0], tokens: 1, rawPrompt: "do not echo" } as {
      codexReportedDate: string;
      tokens: number;
    };
    const result = validateConnectorSyncV1(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({
        code: "unknown_field",
        path: "$.dailyEntries[0]",
      });
      expect(JSON.stringify(result.issues)).not.toContain("rawPrompt");
    }
  });
});

describe("generated response contracts", () => {
  it("accepts bounded sync acknowledgements and public problem details", () => {
    expect(
      validateConnectorSyncResultV1({
        schemaVersion: 1,
        requestId: "req_0123456789ABCDEFGHIJKL",
        syncId: "syn_0123456789ABCDEFGHIJKL",
        outcome: "accepted",
        acceptedEntries: 2,
      }).ok,
    ).toBe(true);
    expect(
      validateProblemDetailsV1({
        schemaVersion: 1,
        requestId: "req_0123456789ABCDEFGHIJKL",
        status: 429,
        errorCode: "rate_limited",
        title: "Rate limited",
        retryable: true,
      }).ok,
    ).toBe(true);
  });

  it("rejects internal reasons, invalid outcomes, status values, and oversized titles", () => {
    const result = validateConnectorSyncResultV1({
      schemaVersion: 1,
      requestId: "req_0123456789ABCDEFGHIJKL",
      syncId: "syn_0123456789ABCDEFGHIJKL",
      outcome: "accepted",
      acceptedEntries: 1,
      internalReason: "private detector name",
    });
    expect(result.ok).toBe(false);
    expect(
      validateConnectorSyncResultV1({
        schemaVersion: 1,
        requestId: "req_0123456789ABCDEFGHIJKL",
        syncId: "syn_0123456789ABCDEFGHIJKL",
        outcome: "verified",
        acceptedEntries: 1,
      }).ok,
    ).toBe(false);
    expect(
      validateProblemDetailsV1({
        schemaVersion: 1,
        requestId: "req_0123456789ABCDEFGHIJKL",
        status: 200,
        errorCode: "internal_error",
        title: "x".repeat(121),
        retryable: false,
      }).ok,
    ).toBe(false);
  });
});

describe("generated Community score response contract", () => {
  it("accepts bounded public rows, explicit Community metadata, and an empty page", () => {
    const input = validScorePage();
    const result = validateCommunityScorePageV1(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(input);
      expect(result.value.participants[0]?.weeklyScore).toBe(4321);
      expect(result.value.trustTier).toBe("community");
      expect(result.value.selfReported).toBe(true);
    }
    expect(
      validateCommunityScorePageV1({
        schemaVersion: 1,
        trustTier: "community",
        selfReported: true,
        participants: [],
      }).ok,
    ).toBe(true);
    const participant = input.participants[0];
    if (!participant) {
      throw new Error("valid score fixture is missing its participant");
    }
    expect(
      validateCommunityScorePageV1({
        ...input,
        participants: Array.from({ length: 32 }, (_, index) => ({
          ...participant,
          handle: `driver_${String(index + 1).padStart(2, "0")}`,
          weeklyScore: 7000 - index,
          rankPosition: index + 1,
          displayPosition: index + 1,
        })),
      }).ok,
    ).toBe(true);
    expect(
      validateCommunityScorePageV1({
        ...input,
        participants: [{ ...participant, seasonStart: "1999-12-27", seasonEnd: "2000-01-02" }],
      }).ok,
    ).toBe(true);
    expect(
      validateCommunityScorePageV1({
        ...input,
        participants: [{ ...participant, seasonStart: "2099-12-28", seasonEnd: "2100-01-03" }],
      }).ok,
    ).toBe(true);
    expect(Object.isFrozen(communityScorePageV1Schema)).toBe(true);
    expect(
      Object.isFrozen(communityScorePageV1Schema.properties.participants.items.properties),
    ).toBe(true);
  });

  it("rejects private and unknown fields without echoing their names or values", () => {
    const rootResult = validateCommunityScorePageV1({
      ...validScorePage(),
      cacheKey: "private-cache-value",
    });
    expect(rootResult.ok).toBe(false);
    if (!rootResult.ok) {
      expect(rootResult.issues).toContainEqual({ code: "unknown_field", path: "$" });
      expect(JSON.stringify(rootResult.issues)).not.toContain("cacheKey");
      expect(JSON.stringify(rootResult.issues)).not.toContain("private-cache-value");
    }

    const input = validScorePage();
    input.participants[0] = {
      ...input.participants[0],
      profileId: "private-profile-value",
      rawTokens: 123_456,
    } as (typeof input.participants)[number];
    const result = validateCommunityScorePageV1(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({
        code: "unknown_field",
        path: "$.participants[0]",
      });
      expect(JSON.stringify(result.issues)).not.toContain("profileId");
      expect(JSON.stringify(result.issues)).not.toContain("private-profile-value");
      expect(JSON.stringify(result.issues)).not.toContain("rawTokens");
    }
  });

  it("rejects trust drift, malformed rows, oversized pages, and duplicate display positions", () => {
    expect(scoreIssueCodes({ ...validScorePage(), trustTier: "verified" })).toContain("const");
    expect(scoreIssueCodes({ ...validScorePage(), selfReported: false })).toContain("const");
    const { selfReported: removedTrustFlag, ...missingTrustFlag } = validScorePage();
    expect(removedTrustFlag).toBe(true);
    expect(scoreIssueCodes(missingTrustFlag)).toContain("required");

    const input = validScorePage();
    const participant = input.participants[0];
    if (!participant) {
      throw new Error("valid score fixture is missing its participant");
    }
    expect(
      scoreIssueCodes({
        ...input,
        participants: [{ ...participant, seasonStart: "2026-02-30" }],
      }),
    ).toContain("format");
    expect(
      scoreIssueCodes({
        ...input,
        participants: [{ ...participant, seasonStart: "1999-12-26" }],
      }),
    ).toContain("pattern");
    expect(
      scoreIssueCodes({
        ...input,
        participants: [{ ...participant, seasonEnd: "2100-01-04" }],
      }),
    ).toContain("pattern");
    expect(
      scoreIssueCodes({
        ...input,
        participants: [{ ...participant, handle: "Private Driver" }],
      }),
    ).toContain("pattern");
    expect(
      scoreIssueCodes({
        ...input,
        participants: [{ ...participant, weeklyScore: 7001 }],
      }),
    ).toContain("maximum");
    expect(
      scoreIssueCodes({
        ...input,
        participants: [{ ...participant, activeDays: 8 }],
      }),
    ).toContain("maximum");
    expect(
      scoreIssueCodes({
        ...input,
        participants: [{ ...participant, sourceCount: 33 }],
      }),
    ).toContain("maximum");
    expect(
      scoreIssueCodes({
        ...input,
        participants: [{ ...participant, rankPosition: 0 }],
      }),
    ).toContain("minimum");
    expect(
      scoreIssueCodes({
        ...input,
        participants: Array.from({ length: 33 }, (_, index) => ({
          ...participant,
          displayPosition: index + 1,
        })),
      }),
    ).toContain("max_items");
    expect(
      scoreIssueCodes({
        ...input,
        participants: [participant, { ...participant, handle: "other_driver" }],
      }),
    ).toContain("duplicate_item_key");
  });
});
