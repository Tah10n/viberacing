import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  collectJsonl,
  componentEntry,
  diagnosePath,
  integer,
  mergeEntries,
  utcDay,
} from "./shared.mjs";

export function parseGeminiRecords(records) {
  const seen = new Set();
  const entries = [];
  for (const record of records) {
    if (record?.type !== "gemini") continue;
    const usage = record?.usageMetadata ?? record?.usage ?? record?.tokenUsage ?? record?.tokens;
    const id = record?.id ?? record?.messageId ?? record?.event_id;
    const day = utcDay(record?.timestamp ?? record?.time ?? record?.startTime);
    if (!usage || !id || seen.has(id) || day === null) continue;
    const input = integer(
      usage.input ?? usage.promptTokenCount ?? usage.inputTokens ?? usage.input_token_count,
    );
    const cached = integer(
      usage.cached ??
        usage.cachedContentTokenCount ??
        usage.cacheReadTokens ??
        usage.cache_read_token_count ??
        0,
    );
    if (input === null || cached === null) continue;
    seen.add(id);
    entries.push(
      componentEntry(
        day,
        {
          inputTokens: input >= cached ? input - cached : input,
          outputTokens:
            usage.output ??
            usage.candidatesTokenCount ??
            usage.outputTokens ??
            usage.output_token_count,
          cacheReadTokens: cached,
          cacheWriteTokens: usage.cacheWriteTokens ?? usage.cache_write_token_count,
          reasoningTokens:
            usage.thoughts ??
            usage.thoughtsTokenCount ??
            usage.thoughtTokens ??
            usage.thought_token_count,
        },
        usage.total ?? usage.totalTokenCount ?? usage.totalTokens ?? usage.total_token_count,
      ),
    );
  }
  return mergeEntries(entries);
}

function parseGeminiLines(lines) {
  const records = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line));
    } catch {}
  }
  return parseGeminiRecords(records);
}

function geminiEventKey(line) {
  try {
    const record = JSON.parse(line);
    const id = record?.id ?? record?.messageId ?? record?.event_id;
    const date = utcDay(record?.timestamp ?? record?.time ?? record?.startTime);
    const usage = record?.usageMetadata ?? record?.usage ?? record?.tokenUsage ?? record?.tokens;
    return record?.type === "gemini" && usage && typeof id === "string" && date
      ? { id, date }
      : null;
  } catch {
    return null;
  }
}

const geminiHome = process.env.GEMINI_CLI_HOME ? resolve(process.env.GEMINI_CLI_HOME) : homedir();
const defaultPath = join(geminiHome, ".gemini", "tmp");
export const geminiAdapter = Object.freeze({
  id: "gemini_cli",
  displayName: "Gemini CLI",
  supportedSurfaces: ["cli"],
  collectionMethods: ["gemini_session_json"],
  aggregationMode: "source_sum",
  trigger: "SessionEnd hook",
  defaultPaths: [defaultPath],
  detect: async () =>
    (
      await diagnosePath({
        dataPath: defaultPath,
        collectionMethod: "gemini_session_json",
        supportedSurface: "cli",
      })
    ).dataLocationAvailable
      ? [
          {
            dataPath: defaultPath,
            collectionMethod: "gemini_session_json",
            supportedSurface: "cli",
            suggestedLabel: "Gemini CLI",
          },
        ]
      : [],
  collect: (source, range, state) =>
    collectJsonl(
      source,
      parseGeminiLines,
      (path) => basename(path).startsWith("session-"),
      state,
      range,
      geminiEventKey,
    ),
  diagnose: (source) => diagnosePath(source),
});
