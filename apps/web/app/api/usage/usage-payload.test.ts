import { describe, expect, it } from "vitest";
import { componentTotalsAccepted, parseSnapshots, parseSourceErrors } from "./route";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const sourceId = "11111111-1111-4111-8111-111111111111";

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

  it("accepts only an allowlisted content-free source diagnostic", () => {
    expect(parseSourceErrors([{ sourceId, code: "collector_failed" }])).toEqual([
      { sourceId, code: "collector_failed" },
    ]);
    for (const unsafe of [
      { sourceId, code: "collector_failed", path: "/private/repository" },
      { sourceId, code: "ENOENT /private/repository" },
      { sourceId, code: "collector_failed", message: "prompt content" },
    ]) {
      expect(() => parseSourceErrors([unsafe])).toThrow("invalid_source_error");
    }
  });
});
