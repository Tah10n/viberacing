import { describe, expect, it } from "vitest";

import * as publicApi from "./index";
import {
  connectorSyncV1Schema,
  validateConnectorSyncResultV1,
  validateConnectorSyncV1,
  validateProblemDetailsV1,
} from "./generated";

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
