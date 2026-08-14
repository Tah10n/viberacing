import {
  collectJsonl,
  componentEntry,
  dayPattern,
  diagnosePath,
  mergeEntries,
  utcDay,
} from "./shared.mjs";

export function parseAntigravityLines(lines) {
  const seen = new Set();
  const entries = [];
  for (const line of lines)
    try {
      const record = JSON.parse(line);
      const usage = record?.usage ?? record?.result?.usage;
      const id = record?.id ?? record?.session_id;
      if (!usage || !id || seen.has(id)) continue;
      seen.add(id);
      const date = dayPattern.test(record.date ?? "")
        ? record.date
        : utcDay(record.timestamp ?? record.time ?? Date.now());
      if (date === null) continue;
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
      if (entry) entries.push(entry);
    } catch {}
  return mergeEntries(entries);
}

function captureEventKey(line) {
  try {
    const record = JSON.parse(line);
    return record?.usage && typeof record?.id === "string" && dayPattern.test(record?.date ?? "")
      ? { id: record.id, date: record.date }
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
  trigger: "viberacing run antigravity",
  defaultPaths: [],
  detect: async () => [],
  collect: (source, range, state) =>
    collectJsonl(source, parseAntigravityLines, () => true, state, range, captureEventKey),
  parseCapture: parseAntigravityLines,
  diagnose: (source) => diagnosePath(source, ["Antigravity Desktop usage"]),
});
