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
