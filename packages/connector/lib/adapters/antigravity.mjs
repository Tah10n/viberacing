import {
  collectCaptureJsonl,
  componentEntry,
  dayPattern,
  diagnosePath,
  mergeEntries,
  parserResult,
  utcDay,
} from "./shared.mjs";

const antigravityParserVersion = 2;

function analyzeAntigravityLines(lines) {
  const seen = new Set();
  const entries = [];
  let candidateRecords = 0;
  let parsedRecords = 0;
  let unsupportedCandidates = 0;
  for (const line of lines) {
    candidateRecords += 1;
    try {
      const record = JSON.parse(line);
      const usage = record?.usage ?? record?.result?.usage;
      if (!usage) {
        unsupportedCandidates += 1;
        continue;
      }
      const id = record?.id ?? record?.session_id;
      const date = dayPattern.test(record.date ?? "")
        ? record.date
        : utcDay(record.timestamp ?? record.time);
      const entry = componentEntry(
        date,
        {
          inputTokens: usage.input_tokens ?? usage.inputTokens,
          outputTokens: usage.output_tokens ?? usage.outputTokens,
          cacheReadTokens: usage.cache_read_tokens ?? usage.cacheReadTokens,
          cacheWriteTokens: usage.cache_write_tokens ?? usage.cacheWriteTokens,
          reasoningTokens: usage.reasoning_tokens ?? usage.thinking_tokens ?? usage.reasoningTokens,
        },
        usage.total_tokens ?? usage.totalTokens,
      );
      if (
        typeof id !== "string" ||
        id.length < 1 ||
        id.length > 256 ||
        date === null ||
        entry === null
      ) {
        unsupportedCandidates += 1;
        continue;
      }
      parsedRecords += 1;
      if (seen.has(id)) continue;
      seen.add(id);
      entries.push(entry);
    } catch {
      unsupportedCandidates += 1;
    }
  }
  return parserResult(
    mergeEntries(entries),
    candidateRecords,
    parsedRecords,
    unsupportedCandidates,
  );
}

export function parseAntigravityLines(lines) {
  return analyzeAntigravityLines(lines).entries;
}

function captureEventKey(line) {
  try {
    const record = JSON.parse(line);
    const entry = analyzeAntigravityLines([line]).entries[0];
    return record?.usage &&
      typeof record?.id === "string" &&
      dayPattern.test(record?.date ?? "") &&
      entry
      ? { id: record.id, date: record.date, entry }
      : null;
  } catch {
    return null;
  }
}

export const antigravityAdapter = Object.freeze({
  id: "antigravity",
  displayName: "Antigravity CLI",
  supportedSurfaces: ["cli"],
  collectionMethods: ["antigravity_cli_capture"],
  aggregationMode: "source_sum",
  accountSwitchMode: "explicit_capture",
  trigger: "viberacing run antigravity",
  defaultPaths: [],
  detect: async () => [],
  collect: async (source, range, state = {}, context = {}) => {
    const result = await collectCaptureJsonl(
      source,
      analyzeAntigravityLines,
      state,
      range,
      captureEventKey,
      antigravityParserVersion,
    );
    return {
      ...result,
      retentionSafe: result.completeness === "complete",
      completeness: context.historical ? "partial" : result.completeness,
      nextState: { ...result.nextState, parserVersion: antigravityParserVersion },
    };
  },
  parseCapture: parseAntigravityLines,
  diagnose: (source) => diagnosePath(source, ["Antigravity Desktop usage"]),
});
