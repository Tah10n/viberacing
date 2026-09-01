import { describe, expect, it } from "vitest";
import {
  componentTotalsAccepted,
  entryCompletenessAccepted,
  parseSnapshots as parseVersionedSnapshots,
  parseSourceErrors,
} from "./route";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const sourceId = "11111111-1111-4111-8111-111111111111";
const parseSnapshots = (value: unknown) => parseVersionedSnapshots(value, 3);

describe("usage payload privacy and numeric contract", () => {
  it("allows bounded v5 current-year chunks while v4 remains rolling-only", () => {
    const now = new Date("2026-09-01T12:00:00.000Z");
    const januaryChunk = {
      sourceId,
      syncSequence: "1",
      kind: "year_backfill",
      rangeStart: "2026-01-01",
      rangeEnd: "2026-01-31",
      completeness: "complete",
      historyYearComplete: "complete",
      entries: [{ date: "2026-01-01", totalTokens: "1" }],
    };
    expect(parseVersionedSnapshots([januaryChunk], 5, now)[0]).toMatchObject({
      kind: "year_backfill",
      historyYearComplete: "complete",
    });
    expect(() => parseVersionedSnapshots([januaryChunk], 4, now)).toThrow("invalid_snapshot");
    expect(() =>
      parseVersionedSnapshots(
        [{ ...januaryChunk, rangeStart: "2025-12-31", historyYearComplete: undefined }],
        5,
        now,
      ),
    ).toThrow("invalid_snapshot");
    expect(() =>
      parseVersionedSnapshots(
        [
          {
            ...januaryChunk,
            rangeStart: "2026-08-02",
            rangeEnd: "2026-09-01",
            historyYearComplete: undefined,
            entries: [],
          },
        ],
        5,
        now,
      ),
    ).not.toThrow();
    expect(() =>
      parseVersionedSnapshots(
        [
          {
            ...januaryChunk,
            rangeStart: "2026-08-01",
            rangeEnd: "2026-09-01",
            historyYearComplete: undefined,
            entries: [],
          },
        ],
        5,
        now,
      ),
    ).toThrow("invalid_snapshot");
  });

  it("accepts a v5 rolling window and completion metadata across New Year", () => {
    const now = new Date("2027-01-01T12:00:00.000Z");
    const rolling = {
      sourceId,
      syncSequence: "1",
      kind: "rolling",
      rangeStart: "2026-12-02",
      rangeEnd: "2027-01-01",
      completeness: "complete",
      historyYearComplete: "complete",
      entries: [
        { date: "2026-12-31", totalTokens: "10" },
        { date: "2027-01-01", totalTokens: "11" },
      ],
    };
    expect(parseVersionedSnapshots([rolling], 5, now)[0]).toMatchObject({
      kind: "rolling",
      historyYearComplete: "complete",
      rangeStart: "2026-12-02",
    });
    expect(() =>
      parseVersionedSnapshots(
        [
          {
            ...rolling,
            historyYearComplete: undefined,
            entries: [{ date: "2026-12-31", totalTokens: "12" }],
          },
        ],
        5,
        now,
      ),
    ).not.toThrow();
  });

  it("rejects future history, incomplete completion metadata, and unknown history fields", () => {
    const now = new Date("2026-09-01T12:00:00.000Z");
    const snapshot = {
      sourceId,
      syncSequence: "1",
      kind: "year_backfill",
      rangeStart: "2026-09-01",
      rangeEnd: "2026-09-02",
      completeness: "partial",
      entries: [],
    };
    expect(() => parseVersionedSnapshots([snapshot], 5, now)).toThrow("invalid_snapshot");
    expect(() =>
      parseVersionedSnapshots(
        [
          {
            ...snapshot,
            rangeStart: "2026-08-01",
            rangeEnd: "2026-08-31",
            historyYearComplete: "partial",
          },
        ],
        5,
        now,
      ),
    ).toThrow("invalid_snapshot");
    expect(() =>
      parseVersionedSnapshots(
        [
          {
            ...snapshot,
            rangeStart: "2026-01-01",
            rangeEnd: "2026-01-31",
            historyCursor: "private",
          },
        ],
        5,
        now,
      ),
    ).toThrow("invalid_snapshot");
  });

  it("accepts canonical decimal strings beyond JavaScript integer precision", () => {
    const date = today();
    expect(
      parseSnapshots([
        {
          sourceId,
          syncSequence: "9007199254740993",
          rangeStart: date,
          rangeEnd: date,
          completeness: "complete",
          entries: [{ date, totalTokens: "9007199254740993" }],
        },
      ])[0]?.entries[0]?.totalTokens,
    ).toBe("9007199254740993");
  });

  it("rejects content, paths, models, arbitrary agents, and unknown fields", () => {
    const date = today();
    for (const extra of [
      { prompt: "private" },
      { path: "/private/path" },
      { model: "private-model" },
      { agent: "codex" },
    ]) {
      expect(() =>
        parseSnapshots([
          {
            sourceId,
            syncSequence: "1",
            rangeStart: date,
            rangeEnd: date,
            completeness: "complete",
            entries: [{ date, totalTokens: "1", ...extra }],
          },
        ]),
      ).toThrow("invalid_entry");
    }
  });

  it("requires either all token components or none", () => {
    const date = today();
    expect(() =>
      parseSnapshots([
        {
          sourceId,
          syncSequence: "1",
          rangeStart: date,
          rangeEnd: date,
          completeness: "complete",
          entries: [{ date, totalTokens: "2", inputTokens: "2" }],
        },
      ]),
    ).toThrow("token_components_mismatch");
  });

  it("defaults per-day completeness and restricts authoritative partial entries to Codex", () => {
    const date = today();
    const partial = parseSnapshots([
      {
        sourceId,
        syncSequence: "1",
        rangeStart: date,
        rangeEnd: date,
        completeness: "partial",
        entries: [{ date, totalTokens: "2", completeness: "complete" }],
      },
    ])[0];
    if (!partial) throw new Error("missing partial snapshot");
    expect(partial.entries[0]?.completeness).toBe("complete");
    expect(entryCompletenessAccepted("codex", partial)).toBe(true);
    expect(entryCompletenessAccepted("opencode", partial)).toBe(false);

    const covered = parseSnapshots([
      {
        sourceId,
        syncSequence: "1",
        rangeStart: date,
        rangeEnd: date,
        completeness: "complete",
        entries: [{ date, totalTokens: "2", completeness: "partial" }],
      },
    ])[0];
    if (!covered) throw new Error("missing range-complete snapshot");
    expect(entryCompletenessAccepted("codex", covered)).toBe(true);
    expect(entryCompletenessAccepted("opencode", covered)).toBe(false);

    const complete = parseSnapshots([
      {
        sourceId,
        syncSequence: "1",
        rangeStart: date,
        rangeEnd: date,
        completeness: "complete",
        entries: [{ date, totalTokens: "2" }],
      },
    ])[0];
    if (!complete) throw new Error("missing complete snapshot");
    expect(complete.entries[0]?.completeness).toBe("complete");
    expect(entryCompletenessAccepted("codex", complete)).toBe(true);
  });

  it("keeps v2 payloads compatible while reserving per-day completeness for v3", () => {
    const date = today();
    const legacySnapshot = {
      sourceId,
      syncSequence: "1",
      rangeStart: date,
      rangeEnd: date,
      completeness: "partial",
      entries: [{ date, totalTokens: "2" }],
    };
    expect(parseVersionedSnapshots([legacySnapshot], 2)[0]?.entries[0]?.completeness).toBe(
      "partial",
    );
    expect(() =>
      parseVersionedSnapshots(
        [
          {
            ...legacySnapshot,
            entries: [{ date, totalTokens: "2", completeness: "complete" }],
          },
        ],
        2,
      ),
    ).toThrow("invalid_entry");
    expect(
      parseVersionedSnapshots(
        [
          {
            ...legacySnapshot,
            entries: [{ date, totalTokens: "2", completeness: "complete" }],
          },
        ],
        3,
      )[0]?.entries[0]?.completeness,
    ).toBe("complete");
  });

  it("retains an independently exact component total for source-aware validation", () => {
    const date = today();
    const entries = parseSnapshots([
      {
        sourceId,
        syncSequence: "1",
        rangeStart: date,
        rangeEnd: date,
        completeness: "complete",
        entries: [
          {
            date,
            totalTokens: "100",
            inputTokens: "10",
            outputTokens: "5",
            cacheReadTokens: "3",
            cacheWriteTokens: "2",
            reasoningTokens: "0",
          },
        ],
      },
    ])[0]?.entries;
    expect(entries?.[0]?.componentTotalTokens).toBe("20");
    expect(componentTotalsAccepted("codex", entries ?? [])).toBe(true);
    expect(componentTotalsAccepted("claude_code", entries ?? [])).toBe(false);
    expect(
      componentTotalsAccepted(
        "claude_code",
        parseSnapshots([
          {
            sourceId,
            syncSequence: "1",
            rangeStart: date,
            rangeEnd: date,
            completeness: "complete",
            entries: [
              {
                date,
                totalTokens: "20",
                inputTokens: "10",
                outputTokens: "5",
                cacheReadTokens: "3",
                cacheWriteTokens: "2",
                reasoningTokens: "0",
              },
            ],
          },
        ])[0]?.entries ?? [],
      ),
    ).toBe(true);
  });

  it("keeps legacy source diagnostics compatible but marks them unordered", () => {
    expect(parseSourceErrors([{ sourceId, code: "collector_failed" }], 2)).toEqual([
      { sourceId, code: "collector_failed", observedAfterSequence: null },
    ]);
    expect(parseSourceErrors([{ sourceId, code: "collector_failed" }], 3)).toEqual([
      { sourceId, code: "collector_failed", observedAfterSequence: null },
    ]);
  });

  it("requires canonical bounded ordering metadata for protocol v4 source errors", () => {
    expect(
      parseSourceErrors([{ sourceId, code: "collector_failed", observedAfterSequence: "0" }], 4),
    ).toEqual([{ sourceId, code: "collector_failed", observedAfterSequence: "0" }]);
    for (const unsafe of [
      { sourceId, code: "collector_failed" },
      { sourceId, code: "collector_failed", observedAfterSequence: "-1" },
      { sourceId, code: "collector_failed", observedAfterSequence: "01" },
      { sourceId, code: "collector_failed", observedAfterSequence: "1".repeat(31) },
      { sourceId, code: "collector_failed", path: "/private/repository" },
      { sourceId, code: "ENOENT /private/repository" },
      { sourceId, code: "collector_failed", message: "prompt content" },
    ]) {
      expect(() => parseSourceErrors([unsafe], 4)).toThrow("invalid_source_error");
    }
  });
});
